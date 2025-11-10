import * as XLSX from 'xlsx';
import { startOfDay, endOfDay } from 'date-fns';
import type { PeriodSummary, TopProductsResponse } from '@shared/schema';
import { storage } from '../storage';

export interface TopProduct {
  itemName: string;
  unitCost: number; // Себестоимость за единицу (средняя)
  averagePrice: number; // Средняя итоговая цена за единицу (после скидок/бонусов)
  averageProfit: number; // Валовая прибыль за единицу (средняя)
  averageMargin: number; // Валовая маржа за единицу (%)
  totalProfit: number; // Совокупная валовая прибыль по позиции за период
  salesCount: number; // Количество продаж (для ранжирования, но не показываем в UI)
}

interface ProductSalesData {
  itemName: string;
  salesCount: number;
  totalRevenue: number;
  totalCost: number;
  totalDiscounts: number;
  totalBonuses: number;
}

/**
 * Рассчитывает бонусы и скидки из файла без полного парсинга продуктов
 * Бонусы = сумма всех цен - сумма всех цен со скидкой
 */
export function calculateBonusesAndDiscountsFromBuffer(
  buffer: Buffer,
  from?: Date,
  to?: Date,
): { totalBonuses: number; totalDiscounts: number; totalBonusAccrued: number } {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });

  if (rows.length === 0) {
    return { totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  // Ищем строку заголовков
  let headerRowIndex = -1;
  const MAX_HEADER_SCAN_ROWS = 30;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const headers = row.map((cell) => String(cell || '').trim().toLowerCase());
    const hasRequired = 
      headers.some(h => h.includes('смена') && h.includes('дата')) &&
      headers.some(h => h.includes('номер') && h.includes('чек')) &&
      headers.some(h => h.includes('цена') || h.includes('price'));
    
    if (hasRequired) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const headers = rows[headerRowIndex].map((cell) => String(cell || '').trim());
  const normalizeHeader = (value: string): string => 
    value.toLowerCase().replace(/\s+/g, ' ').trim();

  const findColumn = (patterns: string[]): number | undefined => {
    for (const pattern of patterns) {
      const normalizedPattern = normalizeHeader(pattern);
      const idx = headers.findIndex(h => normalizeHeader(h) === normalizedPattern || normalizeHeader(h).includes(normalizedPattern));
      if (idx !== -1) return idx;
    }
    return undefined;
  };

  const priceIdx = findColumn(['цена', 'стоимость', 'price', 'цена, руб', 'цена (руб)']);
  const priceWithDiscountIdx = findColumn(['цена со скидкой', 'цена со скидкой, руб', 'price with discount', 'final price', 'итого', 'итог']);
  const discountIdx = findColumn(['скидка, руб', 'скидка руб', 'скидка (руб)', 'discount']);
  const discountPercentIdx = findColumn(['скидка, %', 'скидка %', 'скидка (%)', 'скидка процентов', 'discount %', 'discount percent', 'процент скидки']);
  const bonusUsedIdx = findColumn(['использовано бонусов', 'использовано бонус', 'bonus used', 'бонус', 'бонусы', 'списано бонусов']);
  const bonusAccruedIdx = findColumn(['начислено бонусов', 'начислено бонус', 'бонусы начислены', 'бонусы начислено', 'начисление бонусов', 'bonus accrued', 'бонусы начислены, руб', 'начисленные бонусы']);
  const shiftDateIdx = findColumn(['смена (дата)', 'дата смены', 'дата', 'shift date', 'дата чека']);
  const operationTypeIdx = findColumn(['тип чека', 'тип операции', 'вид операции', 'тип']);

  if (!priceIdx || !shiftDateIdx) {
    return { totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const sanitized = value.trim().replace(/[\u00A0\u202F\s]/g, '').replace(/,/g, '.');
      const num = Number(sanitized);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };

  const parseExcelDate = (value: unknown): Date | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + value * 86400000);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const ruMatch = trimmed.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})/);
      if (ruMatch) {
        const day = Number.parseInt(ruMatch[1], 10);
        const month = Number.parseInt(ruMatch[2], 10) - 1;
        const year = Number.parseInt(ruMatch[3], 10);
        const candidate = new Date(year, month, day);
        return Number.isNaN(candidate.getTime()) ? null : candidate;
      }
      const isoCandidate = new Date(trimmed);
      if (!Number.isNaN(isoCandidate.getTime())) return isoCandidate;
    }
    return null;
  };

  const dataRows = rows.slice(headerRowIndex + 1);
  
  // Суммируем все цены и все цены со скидкой отдельно
  let totalPriceSum = 0;
  let totalPriceWithDiscountSum = 0;
  let totalDiscounts = 0;
  let totalBonusAccrued = 0;
  
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) continue;

    const rawDate = shiftDateIdx !== undefined ? row[shiftDateIdx] : null;
    const date = parseExcelDate(rawDate);
    if (!date) continue;

    // Фильтр по дате
    if (from && date < startOfDay(from)) continue;
    if (to && date > endOfDay(to)) continue;

    const operationType = operationTypeIdx !== undefined && row[operationTypeIdx] !== null
      ? String(row[operationTypeIdx]).trim().toLowerCase()
      : '';

    // Пропускаем возвраты и коррекции
    if (operationType.includes('возврат') || operationType.includes('коррекц') || operationType.includes('refund')) {
      continue;
    }

    const rawPrice = parseNumber(row[priceIdx]);
    const rawPriceWithDiscount = priceWithDiscountIdx !== undefined ? parseNumber(row[priceWithDiscountIdx]) : null;
    const rawDiscount = discountIdx !== undefined ? parseNumber(row[discountIdx]) : null;
    const rawDiscountPercent = discountPercentIdx !== undefined ? parseNumber(row[discountPercentIdx]) : null;
    const rawBonusAccrued = bonusAccruedIdx !== undefined ? parseNumber(row[bonusAccruedIdx]) : null;

    // Суммируем все цены (включая нулевые, но исключая null/undefined)
    if (rawPrice !== null && Number.isFinite(rawPrice)) {
      totalPriceSum += rawPrice;
    }
    
    // Суммируем все цены со скидкой (включая нулевые, но исключая null/undefined)
    if (rawPriceWithDiscount !== null && Number.isFinite(rawPriceWithDiscount)) {
      totalPriceWithDiscountSum += rawPriceWithDiscount;
    }

    // Суммируем скидки из колонки "скидка, руб"
    let discount = rawDiscount ?? 0;
    
    // Если есть колонка "скидка, %", пересчитываем процент в рубли и добавляем к скидке
    if (rawDiscountPercent !== null && Number.isFinite(rawDiscountPercent) && rawDiscountPercent > 0) {
      if (rawPrice !== null && Number.isFinite(rawPrice) && rawPrice > 0) {
        // Пересчитываем процент скидки в рубли: цена * (скидка % / 100)
        const discountFromPercent = rawPrice * (rawDiscountPercent / 100);
        discount += discountFromPercent;
      }
    }
    
    if (discount > 0) {
      totalDiscounts += discount;
    }

    // Суммируем начисленные бонусы
    const bonusAccrued = rawBonusAccrued ?? 0;
    if (bonusAccrued > 0) {
      totalBonusAccrued += bonusAccrued;
    }
  }

  // Бонусы = сумма всех значений столбца "цена" - сумма всех значений столбца "цена со скидкой"
  const totalBonuses = Math.max(0, totalPriceSum - totalPriceWithDiscountSum);

  return { totalBonuses, totalDiscounts, totalBonusAccrued };
}

function parseProductDetailsFromBuffer(
  buffer: Buffer,
  from?: Date,
  to?: Date,
): {
  products: Map<string, ProductSalesData>;
  totalBonuses: number;
  totalDiscounts: number;
  totalBonusAccrued: number;
} {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { products: new Map(), totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });

  if (rows.length === 0) {
    return { products: new Map(), totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  // Используем существующую логику парсинга для получения детальных данных
  // Для этого нужно переиспользовать логику из parseDetailedSalesFormat
  // Но так как она не экспортирует детальные данные, создадим упрощенную версию
  
  const products = new Map<string, ProductSalesData>();
  let totalBonuses = 0;
  let totalDiscounts = 0;
  let totalBonusAccrued = 0;

  // Ищем строку заголовков (упрощенная версия)
  let headerRowIndex = -1;
  const MAX_HEADER_SCAN_ROWS = 30;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN_ROWS); i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    const headers = row.map((cell) => String(cell || '').trim().toLowerCase());
    const hasRequired = 
      headers.some(h => h.includes('смена') && h.includes('дата')) &&
      headers.some(h => h.includes('номер') && h.includes('чек')) &&
      headers.some(h => h.includes('цена') || h.includes('price'));
    
    if (hasRequired) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    return { products: new Map(), totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const headers = rows[headerRowIndex].map((cell) => String(cell || '').trim());
  const normalizeHeader = (value: string): string => 
    value.toLowerCase().replace(/\s+/g, ' ').trim();

  const findColumn = (patterns: string[]): number | undefined => {
    for (const pattern of patterns) {
      const normalizedPattern = normalizeHeader(pattern);
      const idx = headers.findIndex(h => normalizeHeader(h) === normalizedPattern || normalizeHeader(h).includes(normalizedPattern));
      if (idx !== -1) return idx;
    }
    return undefined;
  };

  const itemNameIdx = findColumn(['наименование', 'название', 'товар', 'item name', 'name', 'product']);
  const priceIdx = findColumn(['цена', 'стоимость', 'price', 'цена, руб', 'цена (руб)']);
  const priceWithDiscountIdx = findColumn(['цена со скидкой', 'цена со скидкой, руб', 'price with discount', 'final price', 'итого', 'итог']);
  const discountIdx = findColumn(['скидка, руб', 'скидка руб', 'скидка (руб)', 'discount']);
  const discountPercentIdx = findColumn(['скидка, %', 'скидка %', 'скидка (%)', 'скидка процентов', 'discount %', 'discount percent', 'процент скидки']);
  const bonusIdx = findColumn(['использовано бонусов', 'использовано бонус', 'bonus used', 'бонус']);
  const bonusAccruedIdx = findColumn(['начислено бонусов', 'начислено бонус', 'бонусы начислены', 'бонусы начислено', 'начисление бонусов', 'bonus accrued', 'бонусы начислены, руб', 'начисленные бонусы']);
  const costIdx = findColumn(['себестоимость', 'себестоимость позиции', 'себестоимость товара', 'с/с', 'cost']);
  const shiftDateIdx = findColumn(['смена (дата)', 'дата смены', 'дата', 'shift date', 'дата чека']);
  const operationTypeIdx = findColumn(['тип чека', 'тип операции', 'вид операции', 'тип']);

  if (!itemNameIdx || !priceIdx || !shiftDateIdx) {
    return { products: new Map(), totalBonuses: 0, totalDiscounts: 0, totalBonusAccrued: 0 };
  }

  const parseNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const sanitized = value.trim().replace(/[\u00A0\u202F\s]/g, '').replace(/,/g, '.');
      const num = Number(sanitized);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  };

  const parseExcelDate = (value: unknown): Date | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const excelEpoch = new Date(1899, 11, 30);
      return new Date(excelEpoch.getTime() + value * 86400000);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const ruMatch = trimmed.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})/);
      if (ruMatch) {
        const day = Number.parseInt(ruMatch[1], 10);
        const month = Number.parseInt(ruMatch[2], 10) - 1;
        const year = Number.parseInt(ruMatch[3], 10);
        const candidate = new Date(year, month, day);
        return Number.isNaN(candidate.getTime()) ? null : candidate;
      }
      const isoCandidate = new Date(trimmed);
      if (!Number.isNaN(isoCandidate.getTime())) return isoCandidate;
    }
    return null;
  };

  const dataRows = rows.slice(headerRowIndex + 1);
  
  // Суммируем все цены и все цены со скидкой отдельно
  let totalPriceSum = 0;
  let totalPriceWithDiscountSum = 0;
  
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) continue;

    const itemName = itemNameIdx !== undefined && row[itemNameIdx] !== null && row[itemNameIdx] !== undefined
      ? String(row[itemNameIdx]).trim()
      : '';

    if (!itemName) continue;

    const rawDate = shiftDateIdx !== undefined ? row[shiftDateIdx] : null;
    const date = parseExcelDate(rawDate);
    if (!date) continue;

    // Фильтр по дате
    if (from && date < startOfDay(from)) continue;
    if (to && date > endOfDay(to)) continue;

    const operationType = operationTypeIdx !== undefined && row[operationTypeIdx] !== null
      ? String(row[operationTypeIdx]).trim().toLowerCase()
      : '';

    // Пропускаем возвраты и коррекции при расчете топ-5 позиций
    if (operationType.includes('возврат') || operationType.includes('коррекц') || operationType.includes('refund')) {
      continue;
    }

    const rawPrice = parseNumber(row[priceIdx]);
    const rawPriceWithDiscount = priceWithDiscountIdx !== undefined ? parseNumber(row[priceWithDiscountIdx]) : null;

    // Суммируем все цены (включая нулевые, но исключая null/undefined)
    if (rawPrice !== null && Number.isFinite(rawPrice)) {
      totalPriceSum += rawPrice;
    }
    
    // Суммируем все цены со скидкой (включая нулевые, но исключая null/undefined)
    if (rawPriceWithDiscount !== null && Number.isFinite(rawPriceWithDiscount)) {
      totalPriceWithDiscountSum += rawPriceWithDiscount;
    }
  }

  // Бонусы = сумма всех значений столбца "цена" - сумма всех значений столбца "цена со скидкой"
  const calculatedBonuses = Math.max(0, totalPriceSum - totalPriceWithDiscountSum);

  // Теперь проходим второй раз для расчета продуктов и скидок построчно
  for (const row of dataRows) {
    if (!row || row.length === 0) continue;
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) continue;

    const itemName = itemNameIdx !== undefined && row[itemNameIdx] !== null && row[itemNameIdx] !== undefined
      ? String(row[itemNameIdx]).trim()
      : '';

    if (!itemName) continue;

    const rawDate = shiftDateIdx !== undefined ? row[shiftDateIdx] : null;
    const date = parseExcelDate(rawDate);
    if (!date) continue;

    // Фильтр по дате
    if (from && date < startOfDay(from)) continue;
    if (to && date > endOfDay(to)) continue;

    const operationType = operationTypeIdx !== undefined && row[operationTypeIdx] !== null
      ? String(row[operationTypeIdx]).trim().toLowerCase()
      : '';

    // Пропускаем возвраты и коррекции при расчете топ-5 позиций
    if (operationType.includes('возврат') || operationType.includes('коррекц') || operationType.includes('refund')) {
      continue;
    }

    const rawPrice = parseNumber(row[priceIdx]);
    const rawPriceWithDiscount = priceWithDiscountIdx !== undefined ? parseNumber(row[priceWithDiscountIdx]) : null;
    const rawDiscount = discountIdx !== undefined ? parseNumber(row[discountIdx]) : null;
    const rawDiscountPercent = discountPercentIdx !== undefined ? parseNumber(row[discountPercentIdx]) : null;
    const rawBonusAccrued = bonusAccruedIdx !== undefined ? parseNumber(row[bonusAccruedIdx]) : null;
    const rawCost = costIdx !== undefined ? parseNumber(row[costIdx]) : null;

    // Скидка из колонки "скидка, руб"
    let discount = rawDiscount ?? 0;
    
    // Если есть колонка "скидка, %", пересчитываем процент в рубли и добавляем к скидке
    if (rawDiscountPercent !== null && Number.isFinite(rawDiscountPercent) && rawDiscountPercent > 0) {
      if (rawPrice !== null && Number.isFinite(rawPrice) && rawPrice > 0) {
        // Пересчитываем процент скидки в рубли: цена * (скидка % / 100)
        const discountFromPercent = rawPrice * (rawDiscountPercent / 100);
        discount += discountFromPercent;
      }
    }
    
    totalDiscounts += discount;

    // Начисленные бонусы
    const bonusAccrued = rawBonusAccrued ?? 0;
    if (bonusAccrued > 0) {
      totalBonusAccrued += bonusAccrued;
    }

    let revenue: number;
    if (rawPriceWithDiscount !== null) {
      // Цена со скидкой уже учитывает скидки и бонусы
      revenue = rawPriceWithDiscount;
    } else if (rawPrice !== null) {
      // Если нет цены со скидкой, вычитаем скидку из базовой цены
      revenue = rawPrice - discount;
    } else {
      continue;
    }

    if (revenue <= 0) continue;

    const cost = rawCost ?? 0;

    if (!products.has(itemName)) {
      products.set(itemName, {
        itemName,
        salesCount: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalDiscounts: 0,
        totalBonuses: 0,
      });
    }

    const product = products.get(itemName)!;
    product.salesCount += 1;
    product.totalRevenue += revenue;
    product.totalCost += cost;
    product.totalDiscounts += discount;
  }

  return { products, totalBonuses: calculatedBonuses, totalDiscounts, totalBonusAccrued };
}

export async function calculateTopProducts(
  datasetId: string,
  fileBuffer?: Buffer,
  from?: Date,
  to?: Date,
): Promise<TopProductsResponse> {
  const dataset = await storage.getProfitabilityDataset(datasetId);
  if (!dataset) {
    throw new Error('Набор данных не найден');
  }

  const filteredRecords = dataset.records.filter((record) => {
    const recordDate = record.reportDate.getTime();
    if (from && recordDate < startOfDay(from).getTime()) return false;
    if (to && recordDate > endOfDay(to).getTime()) return false;
    return true;
  });

  // Рассчитываем итоги периода
  const netRevenue = filteredRecords.reduce((sum, r) => {
    return sum + (r.cashIncome ?? 0) + (r.cashlessIncome ?? 0) - (r.cashReturn ?? 0) - (r.cashlessReturn ?? 0) + (r.correctionCash ?? 0) + (r.correctionCashless ?? 0);
  }, 0);

  const cogs = filteredRecords.reduce((sum, r) => sum + (r.cogsTotal ?? 0), 0);
  const grossProfit = netRevenue - cogs;
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;

  let products: TopProduct[] = [];
  let bottomProducts: TopProduct[] = [];
  let negativeMarginProducts: TopProduct[] = [];
  
  // Используем сохраненные значения бонусов и скидок из dataset
  let totalBonuses = dataset.dataset.totalBonuses ?? 0;
  let totalDiscounts = dataset.dataset.totalDiscounts ?? 0;
  let totalBonusAccrued = dataset.dataset.totalBonusAccrued ?? 0;
  
  // Логируем если fileBuffer отсутствует (для диагностики)
  if (!fileBuffer) {
    console.warn(`[topProducts] fileBuffer отсутствует для datasetId=${datasetId}. Топ-5 продуктов не будет рассчитан.`);
  }

  // Если применены фильтры по датам, пересчитываем бонусы и скидки пропорционально
  if (from || to) {
    const allRecordsCount = dataset.records.length;
    const filteredRecordsCount = filteredRecords.length;
    
    // Если есть отфильтрованные записи и они не равны общему количеству,
    // пересчитываем пропорционально
    if (allRecordsCount > 0 && filteredRecordsCount > 0 && filteredRecordsCount !== allRecordsCount) {
      const ratio = filteredRecordsCount / allRecordsCount;
      totalBonuses = totalBonuses * ratio;
      totalDiscounts = totalDiscounts * ratio;
    }
  }

  // Если есть доступ к исходному файлу, анализируем детальные данные для топ-5 продуктов
  // и пересчитываем бонусы/скидки с учетом фильтров даты
  if (fileBuffer) {
    const { products: productMap } = parseProductDetailsFromBuffer(fileBuffer, from, to);
    
    // Пересчитываем бонусы, скидки и начисленные бонусы для точности (с учетом фильтров даты)
    const bonusesAndDiscounts = calculateBonusesAndDiscountsFromBuffer(fileBuffer, from, to);
    totalBonuses = bonusesAndDiscounts.totalBonuses;
    totalDiscounts = bonusesAndDiscounts.totalDiscounts;
    totalBonusAccrued = bonusesAndDiscounts.totalBonusAccrued;

    // Преобразуем Map в массив и рассчитываем метрики
    const allProducts = Array.from(productMap.values())
      .map((product) => {
        const avgPrice = product.salesCount > 0 ? product.totalRevenue / product.salesCount : 0;
        const avgCost = product.salesCount > 0 ? product.totalCost / product.salesCount : 0;
        const avgProfit = avgPrice - avgCost;
        const avgMargin = avgPrice > 0 ? (avgProfit / avgPrice) * 100 : 0;
        const totalProfit = product.totalRevenue - product.totalCost;

        return {
          itemName: product.itemName,
          unitCost: avgCost,
          averagePrice: avgPrice,
          averageProfit: avgProfit,
          averageMargin: avgMargin,
          totalProfit,
          salesCount: product.salesCount,
        };
      });

    // Top-5 по популярности (частота продаж)
    products = [...allProducts]
      .sort((a, b) => {
        if (a.salesCount !== b.salesCount) {
          return b.salesCount - a.salesCount;
        }
        return b.totalProfit - a.totalProfit;
      })
      .slice(0, 5);

    // Bottom-5 по марже (самые убыточные/низкомаржинальные)
    // Фильтруем только позиции с количеством продаж > 10
    bottomProducts = [...allProducts]
      .filter((p) => p.salesCount > 10) // Только позиции, проданные более 10 раз за период
      .sort((a, b) => {
        // Сначала по марже (от меньшей к большей)
        if (a.averageMargin !== b.averageMargin) {
          return a.averageMargin - b.averageMargin;
        }
        // Затем по совокупной прибыли (от меньшей к большей)
        return a.totalProfit - b.totalProfit;
      })
      .slice(0, 5);

    // Позиции с негативной маржой (GP<0)
    negativeMarginProducts = allProducts
      .filter((p) => p.averageMargin < 0 || p.totalProfit < 0)
      .sort((a, b) => {
        // Сначала по марже (от меньшей к большей)
        if (a.averageMargin !== b.averageMargin) {
          return a.averageMargin - b.averageMargin;
        }
        // Затем по совокупной прибыли (от меньшей к большей)
        return a.totalProfit - b.totalProfit;
      });
  }

  // Убеждаемся, что значения определены и являются числами
  const safeTotalBonuses = Number.isFinite(totalBonuses) ? totalBonuses : 0;
  const safeTotalDiscounts = Number.isFinite(totalDiscounts) ? totalDiscounts : 0;
  const safeTotalBonusAccrued = Number.isFinite(totalBonusAccrued) ? totalBonusAccrued : 0;
  const safeTotalLosses = safeTotalBonuses + safeTotalDiscounts;
  // Валовая выручка = чистая выручка + бонусы + скидки
  const grossRevenue = netRevenue + safeTotalBonuses + safeTotalDiscounts;
  const safeTotalLossesPercent = netRevenue > 0 ? (safeTotalLosses / netRevenue) * 100 : 0;
  const safeBonusesPercent = grossRevenue > 0 ? (safeTotalBonuses / grossRevenue) * 100 : 0;
  const safeDiscountsPercent = grossRevenue > 0 ? (safeTotalDiscounts / grossRevenue) * 100 : 0;

  return {
    products,
    bottomProducts,
    negativeMarginProducts,
    periodSummary: {
      netRevenue,
      cogs,
      grossProfit,
      grossMargin,
      totalBonuses: safeTotalBonuses,
      totalDiscounts: safeTotalDiscounts,
      totalBonusAccrued: safeTotalBonusAccrued,
      totalLosses: safeTotalLosses,
      totalLossesPercent: safeTotalLossesPercent,
      bonusesPercent: safeBonusesPercent,
      discountsPercent: safeDiscountsPercent,
    },
  };
}
