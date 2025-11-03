import * as XLSX from 'xlsx';
import {
  DEFAULT_PROFITABILITY_MAX_CHECKS_PER_DAY,
  type ProfitabilityImportError,
} from '@shared/schema';
import { ProfitabilityRecordInput } from '../storage';

const PROFITABILITY_COLUMNS = {
  reportDate: [
    'дата/время',
    'дата',
    'shift date',
    'date',
    'смена (дата)',
    'дата смены',
    'смена дата',
  ],
  shiftNumber: [
    'номер',
    'номер смены',
    'shift number',
    'смена',
    'смена (номер)',
    'номер смены (смена)',
  ],
  incomeChecks: [
    'чеков прихода',
    'приход чеков',
    'checks income',
    'receipts income',
    'количество чеков',
    'кол-во чеков',
    'чеков всего',
    'чеков',
  ],
  cashIncome: [
    'приход наличными',
    'наличные',
    'cash income',
    'наличные продажи',
    'наличными (приход)',
    'наличными',
    'касса',
    'наличный расчет',
    'оплата наличными',
  ],
  cashlessIncome: [
    'приход безналичными',
    'безнал',
    'card income',
    'безналичные',
    'терминал',
    'оплата по терминалу',
    'безналичные продажи',
    'оплата картой',
    'эквайринг',
    'безналичный расчет',
  ],
  returnChecks: [
    'чеков возврата прихода',
    'чеков возврата',
    'refund checks',
    'возврат чеков',
    'количество возвратов',
    'чеков возврата всего',
  ],
  cashReturn: [
    'возврат наличными',
    'refund cash',
    'возврат (наличные)',
    'наличные возврат',
    'возвратнал',
    'возврат наличный расчет',
  ],
  cashlessReturn: [
    'возврат безналичными',
    'refund card',
    'возврат (безналичные)',
    'возврат по карте',
    'возврат терминал',
    'возврат безнал',
    'возврат безналичный расчет',
  ],
  correctionChecks: [
    'чеков коррекции прихода',
    'коррекции прихода чеков',
    'correction checks',
    'чеков коррекции',
    'количество коррекций',
  ],
  correctionCash: [
    'коррекции прихода наличными',
    'коррекция наличными',
    'correction cash',
    'коррекция нал',
    'коррекция наличный расчет',
  ],
  correctionCashless: [
    'коррекции прихода безналичными',
    'коррекция безналичными',
    'correction card',
    'коррекция безнал',
    'коррекция терминал',
  ],
} as const;

// Новый формат колонок для детальных позиций продаж
const DETAILED_SALES_COLUMNS = {
  salesPoint: ['торг.точка', 'торг точка', 'торговая точка', 'sales point', 'магазин', 'точка'],
  shiftDate: ['смена (дата)', 'дата смены', 'дата', 'shift date', 'дата чека', 'дата/время чека'],
  shiftNumber: ['смена (номер)', 'номер смены', 'shift number', 'номер смены (смена)'],
  checkNumber: ['номер чека', 'чек', 'чек №', 'check number', 'номер'],
  creationTime: ['время создания', 'время', 'creation time', 'дата время создания', 'дата/время'],
  cashier: ['кассир', 'cashier'],
  waiter: ['официант', 'waiter'],
  itemName: ['наименование', 'название', 'товар', 'item name', 'name', 'product'],
  comment: ['комментарий', 'comment', 'примечание'],
  preparationTime: ['время приготовления', 'preparation time', 'время готовки'],
  cost: ['себестоимость', 'себестоимость позиции', 'себестоимость товара', 'с/с', 'cost'],
  price: ['цена', 'стоимость', 'price', 'цена, руб', 'цена (руб)'],
  discountRub: ['скидка, руб', 'скидка руб', 'скидка (руб)', 'скидка руб.', 'скидка (руб.)', 'discount'],
  priceWithDiscount: [
    'цена со скидкой',
    'цена со скидкой, руб',
    'цена со скидкой (руб)',
    'цена со скидкой руб',
    'цена со скидкой руб.',
    'price with discount',
    'final price',
    'итого',
    'итог',
    'цена итого',
    'цена финальная',
  ],
  bonusUsed: [
    'использовано бонусов',
    'использовано бонус',
    'бонусы использованы',
    'бонусы списаны',
    'списано бонусов',
    'bonus used',
    'бонус',
  ],
  bonusAccrued: [
    'начислено бонусов',
    'начислено бонус',
    'бонусы начислены',
    'бонусы начислено',
    'начисление бонусов',
    'bonus accrued',
    'бонусы начислены, руб',
    'начисленные бонусы',
  ],
  discountPercent: [
    'скидка, %',
    'скидка %',
    'скидка (%)',
    'скидка процентов',
    'discount %',
    'discount percent',
    'процент скидки',
  ],
  arbitraryDiscount: [
    'задана произвольная скидка',
    'произвольная скидка',
    'ручная скидка',
    'скидка произвольная',
    'arbitrary discount',
    'manual discount',
    'custom discount',
  ],
  operationType: ['тип чека', 'тип операции', 'вид операции', 'тип документа', 'тип'],
  paymentType: [
    'способ оплаты',
    'тип оплаты',
    'метод оплаты',
    'форма оплаты',
    'оплата',
    'канал оплаты',
  ],
} as const;

type DetailedColumnKey = keyof typeof DETAILED_SALES_COLUMNS;

type HeaderKey = keyof typeof PROFITABILITY_COLUMNS;

const REQUIRED_HEADER_KEYS: HeaderKey[] = ['reportDate', 'cashIncome', 'cashlessIncome'];
const DETAILED_REQUIRED_HEADER_KEYS: DetailedColumnKey[] = ['shiftDate', 'checkNumber', 'price'];
const MAX_HEADER_SCAN_ROWS = 30;

const FIELD_LABELS: Record<HeaderKey, string> = {
  reportDate: 'Дата/время',
  shiftNumber: 'Номер смены',
  incomeChecks: 'Чеков прихода',
  cashIncome: 'Приход наличными',
  cashlessIncome: 'Приход безналичными',
  returnChecks: 'Чеков возврата',
  cashReturn: 'Возврат наличными',
  cashlessReturn: 'Возврат безналичными',
  correctionChecks: 'Чеков коррекции',
  correctionCash: 'Коррекции наличными',
  correctionCashless: 'Коррекции безналичными',
};

interface ColumnDetectionResult {
  [key: string]: number | undefined;
}

export interface ProfitabilityParseOptions {
  maxChecksPerDay?: number;
}

export interface CashierStatistics {
  cashierName: string;
  totalRevenue: number;
  shiftsCount: number;
}

export interface ProfitabilityParseResult {
  records: ProfitabilityRecordInput[];
  periodStart: Date | null;
  periodEnd: Date | null;
  detectedColumns: Record<string, string | undefined>;
  sheetName: string;
  headerRowIndex: number;
  errors: ProfitabilityImportError[];
  warnings: string[];
  rowsProcessed: number;
  skippedRows: number;
  duplicateCount: number;
  cashierStatistics?: CashierStatistics[];
}

const normalizeHeader = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const HEADER_CONFIG: Record<HeaderKey, { canonical: string; aliases: string[] }> = Object.entries(
  PROFITABILITY_COLUMNS,
).reduce(
  (acc, [key, values]) => {
    const [first, ...rest] = values;
    acc[key as HeaderKey] = {
      canonical: normalizeHeader(first),
      aliases: rest.map((alias) => normalizeHeader(alias)),
    };
    return acc;
  },
  {} as Record<HeaderKey, { canonical: string; aliases: string[] }>,
);

function findHeaderRow(rows: (string | number | null)[][]): { index: number; headers: string[] } {
  const scanLimit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);

  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) {
      continue;
    }

    const headers = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
    const normalized = headers.map(normalizeHeader);

    const isWarningRow = normalized.some(
      (cell) =>
        cell.includes('не предназначены') ||
        cell.includes('бухгалтерской') ||
        cell.includes('отчетности') ||
        cell.includes('полные данные') ||
        cell.includes('личного кабинета') ||
        cell.includes('офд') ||
        cell.length > 100,
    );
    if (isWarningRow) {
      continue;
    }

    // Проверяем новый формат детальных позиций продаж
    const hasDetailedSalesRequired = DETAILED_REQUIRED_HEADER_KEYS.every(
      (key) => detectDetailedColumn(headers, DETAILED_SALES_COLUMNS[key]) !== undefined,
    );

    if (hasDetailedSalesRequired) {
      return { index: i, headers };
    }

    // Fallback: проверяем старый формат Z-отчетов
    const hasSummaryRequired = REQUIRED_HEADER_KEYS.every((key) => {
      const config = HEADER_CONFIG[key];
      const candidates = [config.canonical, ...config.aliases].filter(Boolean);
      return candidates.some((candidate) =>
        normalized.some((header) => header === candidate || header.includes(candidate)),
      );
    });

    if (hasSummaryRequired) {
      return { index: i, headers };
    }
  }

  throw new Error(
    'Не удалось найти строку заголовков. Убедитесь, что файл содержит колонки "Смена (дата)", "Номер чека" и "Цена".',
  );
}

function detectColumns(headers: string[]): ColumnDetectionResult {
  const normalized = headers.map(normalizeHeader);
  const result: ColumnDetectionResult = {};

  (Object.keys(PROFITABILITY_COLUMNS) as HeaderKey[]).forEach((key) => {
    const config = HEADER_CONFIG[key];

    let index = normalized.findIndex((header) => header === config.canonical);
    if (index === -1) {
      for (const alias of config.aliases) {
        index = normalized.findIndex((header) => header === alias);
        if (index !== -1) {
          break;
        }
      }
    }

    if (index === -1) {
      index = normalized.findIndex(
        (header) => config.canonical && header.includes(config.canonical),
      );
    }

    if (index !== -1) {
      result[key] = index;
    }
  });

  return result;
}

function detectDetailedColumn(headers: string[], mappings: readonly string[]): number | undefined {
  const normalizedHeaders = headers.map((header, index) => ({
    index,
    original: header,
    normalized: normalizeHeader(header),
  }));

  for (const mapping of mappings) {
    const normalizedMapping = normalizeHeader(mapping);
    const exact = normalizedHeaders.find((h) => h.normalized === normalizedMapping);
    if (exact) {
      return exact.index;
    }
  }

  for (const mapping of mappings) {
    const normalizedMapping = normalizeHeader(mapping);
    const partial = normalizedHeaders.find(
      (h) => h.normalized && h.normalized.includes(normalizedMapping),
    );
    if (partial) {
      return partial.index;
    }
  }

  return undefined;
}

function detectDetailedSalesColumns(headers: string[]): Record<DetailedColumnKey, number | undefined> {
  const result: Record<string, number | undefined> = {};
  
  (Object.keys(DETAILED_SALES_COLUMNS) as DetailedColumnKey[]).forEach((key) => {
    result[key] = detectDetailedColumn(headers, DETAILED_SALES_COLUMNS[key]);
  });
  
  return result as Record<DetailedColumnKey, number | undefined>;
}

function parseExcelDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/\u00A0/g, ' ');
    if (!trimmed) {
      return null;
    }

    const ruMatch = trimmed.match(
      /^(\d{1,2})[.](\d{1,2})[.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (ruMatch) {
      const day = Number.parseInt(ruMatch[1], 10);
      const month = Number.parseInt(ruMatch[2], 10) - 1;
      const year = Number.parseInt(ruMatch[3], 10);
      const hours = ruMatch[4] ? Number.parseInt(ruMatch[4], 10) : 0;
      const minutes = ruMatch[5] ? Number.parseInt(ruMatch[5], 10) : 0;
      const seconds = ruMatch[6] ? Number.parseInt(ruMatch[6], 10) : 0;
      const candidate = new Date(year, month, day, hours, minutes, seconds);
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }

    const isoCandidate = new Date(trimmed);
    if (!Number.isNaN(isoCandidate.getTime())) {
      return isoCandidate;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const excelEpoch = new Date(1899, 11, 30);
      const candidate = new Date(excelEpoch.getTime() + numeric * 86400000);
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }
  }

  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    let sanitized = value.trim();
    if (!sanitized) {
      return null;
    }

    sanitized = sanitized
      .replace(/[\u00A0\u202F\s]/g, '')
      .replace(/[–—−]/g, '-')
      .replace(/^\((.*)\)$/, '-$1')
      .replace(/,/g, '.');

    if (!sanitized) {
      return null;
    }

    const numeric = Number(sanitized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function parseInteger(value: unknown): number | null {
  const numeric = parseNumber(value);
  if (numeric === null) {
    return null;
  }
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.round(numeric);
  return Number.isNaN(rounded) ? null : rounded;
}

type PaymentCategory = 'cash' | 'cashless' | 'qr' | 'sbp';

interface PaymentBreakdown {
  cash: number;
  cashless: number;
  qr: number;
  sbp: number;
}

function createPaymentBreakdown(): PaymentBreakdown {
  return {
    cash: 0,
    cashless: 0,
    qr: 0,
    sbp: 0,
  };
}

function classifyPaymentMethod(value: unknown): { category: PaymentCategory; raw: string | null } {
  if (value === null || value === undefined) {
    return { category: 'cashless', raw: null };
  }
  const raw = String(value).trim();
  if (!raw) {
    return { category: 'cashless', raw: null };
  }

  const normalized = normalizeHeader(raw);
  if (!normalized) {
    return { category: 'cashless', raw };
  }

  if (normalized.includes('налич')) {
    return { category: 'cash', raw };
  }

  if (normalized.includes('qr')) {
    return { category: 'qr', raw };
  }

  if (normalized.includes('сбп') || normalized.includes('sbp')) {
    return { category: 'sbp', raw };
  }

  if (
    normalized.includes('терминал') ||
    normalized.includes('карта') ||
    normalized.includes('card') ||
    normalized.includes('безнал') ||
    normalized.includes('эквай') ||
    normalized.includes('онлайн') ||
    normalized.includes('tablet') ||
    normalized.includes('банков')
  ) {
    return { category: 'cashless', raw };
  }

  return { category: 'cashless', raw };
}

type OperationCategory = 'income' | 'return' | 'correction';

function classifyOperationType(value: unknown, amount: number): OperationCategory {
  if (value !== null && value !== undefined) {
    const normalized = normalizeHeader(String(value));
    if (normalized.includes('возврат') || normalized.includes('refund')) {
      return 'return';
    }
    if (normalized.includes('коррекц')) {
      return 'correction';
    }
    if (
      normalized.includes('приход') ||
      normalized.includes('продаж') ||
      normalized.includes('реализац') ||
      normalized.includes('sale')
    ) {
      return 'income';
    }
  }

  if (amount < 0) {
    return 'return';
  }

  return 'income';
}

function ensureLineAmount(
  rawAmount: number | null,
  quantity: number | null,
  unitPrice: number | null,
  discountRub: number | null,
): number {
  let amount = rawAmount;
  const qty = quantity !== null && quantity !== undefined ? quantity : 1;

  if (amount === null && unitPrice !== null) {
    amount = unitPrice * (qty || 1);
  }

  if (amount === null) {
    amount = 0;
  }

  if (qty && qty > 1 && unitPrice !== null) {
    const perUnitTolerance = Math.abs(amount - unitPrice) < 0.0001;
    if (perUnitTolerance) {
      amount = unitPrice * qty;
    }
  }

  if (discountRub) {
    amount -= discountRub;
  }

  return amount;
}

function ensureCostAmount(rawCost: number | null, quantity: number | null): number {
  if (rawCost === null) {
    return 0;
  }
  const qty = quantity !== null && quantity !== undefined ? quantity : 1;
  if (qty && qty > 1 && Math.abs(rawCost) < 1) {
    return rawCost * qty;
  }
  return rawCost;
}

interface CheckSummary {
  date: Date;
  shiftNumber: string | null;
  incomeAmount: number;
  returnAmount: number;
  correctionAmount: number;
  payments: {
    income: PaymentBreakdown;
    returns: PaymentBreakdown;
    corrections: PaymentBreakdown;
  };
  cogs: {
    income: number;
    returns: number;
    corrections: number;
  };
}

interface DetailedSalesFormatParams {
  rows: (string | number | null)[][];
  headerRowIndex: number;
  headers: string[];
  sheetName: string;
  columnMap: Record<DetailedColumnKey, number | undefined>;
  options: ProfitabilityParseOptions;
}

function parseDetailedSalesFormat({
  rows,
  headerRowIndex,
  headers,
  sheetName,
  columnMap,
  options,
}: DetailedSalesFormatParams): ProfitabilityParseResult {
  const dataRows = rows.slice(headerRowIndex + 1);
  const errors: ProfitabilityImportError[] = [];
  const warnings: string[] = [];
  const skippedRows = 0;
  
  // Агрегируем данные по чекам/сменам
  const checkSummaries = new Map<string, CheckSummary>();
  const unknownPaymentMethods = new Set<string>();
  
  // Статистика по кассирам: кассир -> { выручка, количество смен }
  const cashierStats = new Map<string, { revenue: number; shifts: Set<string> }>();

  dataRows.forEach((row, index) => {
    if (
      !row ||
      row.length === 0 ||
      row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')
    ) {
      return;
    }

    const excelRowNumber = headerRowIndex + index + 2;
    
    // Извлекаем обязательные поля
    const shiftDateIdx = columnMap.shiftDate;
    const checkNumberIdx = columnMap.checkNumber;
    const priceIdx = columnMap.price;
    
    if (shiftDateIdx === undefined || checkNumberIdx === undefined || priceIdx === undefined) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'header',
        message: 'Не найдены обязательные колонки: Смена (дата), Номер чека или Цена',
      });
      return;
    }

    const rawDate = row[shiftDateIdx];
    const parsedDate = parseExcelDate(rawDate);

    if (!parsedDate) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'reportDate',
        message: 'Не удалось распознать дату смены.',
        value: rawDate === undefined || rawDate === null ? null : String(rawDate),
      });
      return;
    }

    const rawCheckNumber = row[checkNumberIdx];
    const checkNumber =
      rawCheckNumber === undefined || rawCheckNumber === null
        ? null
        : String(rawCheckNumber).trim();
    if (!checkNumber) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'checkNumber',
        message: 'Не указан номер чека.',
      });
      return;
    }

    const shiftNumberIdx = columnMap.shiftNumber;
    const shiftNumber =
      shiftNumberIdx !== undefined && row[shiftNumberIdx] !== null && row[shiftNumberIdx] !== undefined
        ? String(row[shiftNumberIdx]).trim() || null
        : null;

    // Парсим цену, скидку, цену со скидкой и бонусы
    const rawPrice = parseNumber(row[priceIdx]);
    const discountIdx = columnMap.discountRub;
    const rawDiscount = discountIdx !== undefined ? parseNumber(row[discountIdx]) : null;
    const discountRub = rawDiscount ?? 0;
    
    // Приоритет: используем колонку "Цена со скидкой" если она есть
    const priceWithDiscountIdx = columnMap.priceWithDiscount;
    const rawPriceWithDiscount =
      priceWithDiscountIdx !== undefined ? parseNumber(row[priceWithDiscountIdx]) : null;
    
    // Парсим использованные бонусы
    const bonusUsedIdx = columnMap.bonusUsed;
    const rawBonusUsed = bonusUsedIdx !== undefined ? parseNumber(row[bonusUsedIdx]) : null;
    const bonusUsed = rawBonusUsed ?? 0;
    
    // Расчет выручки позиции (финальная цена продажи)
    let lineAmount: number;
    if (rawPriceWithDiscount !== null) {
      // Используем готовую цену со скидкой как приоритетный источник
      // Вычитаем бонусы, так как они уменьшают фактическую выручку
      lineAmount = rawPriceWithDiscount - bonusUsed;
    } else {
      // Fallback: рассчитываем из базовой цены, скидки и бонусов
      lineAmount = (rawPrice ?? 0) - discountRub - bonusUsed;
    }

    if (lineAmount <= 0 && rawPrice === null && rawPriceWithDiscount === null) {
      // Пропускаем строки без цены
      return;
    }

    // Определяем тип операции
    const operationTypeIdx = columnMap.operationType;
    const operationValue = operationTypeIdx !== undefined ? row[operationTypeIdx] : undefined;
    const operationCategory = classifyOperationType(operationValue, lineAmount);
    
    // Используем абсолютное значение суммы
    const absAmount = Math.abs(lineAmount);

    // Определяем способ оплаты
    const paymentTypeIdx = columnMap.paymentType;
    const paymentValue = paymentTypeIdx !== undefined ? row[paymentTypeIdx] : undefined;
    const paymentClassified = classifyPaymentMethod(paymentValue);
    let paymentCategory = paymentClassified.category;

    if (paymentTypeIdx === undefined) {
      paymentCategory = 'cashless';
    } else if (paymentClassified.raw) {
      const normalizedRaw = normalizeHeader(paymentClassified.raw);
      if (
        normalizedRaw &&
        !normalizedRaw.includes('налич') &&
        !normalizedRaw.includes('терминал') &&
        !normalizedRaw.includes('карта') &&
        !normalizedRaw.includes('безнал') &&
        !normalizedRaw.includes('qr') &&
        !normalizedRaw.includes('сбп')
      ) {
        unknownPaymentMethods.add(paymentClassified.raw);
      }
    }

    // Себестоимость
    const costIdx = columnMap.cost;
    const costValue =
      costIdx !== undefined ? (parseNumber(row[costIdx]) ?? 0) : 0;

    // Извлекаем кассира
    const cashierIdx = columnMap.cashier;
    const cashierName = cashierIdx !== undefined && row[cashierIdx] !== null && row[cashierIdx] !== undefined
      ? String(row[cashierIdx]).trim()
      : null;

    // Создаем ключ для чека: дата + смена + номер чека
    const dateKey = parsedDate.toISOString().slice(0, 10);
    const checkKey = `${dateKey}#${shiftNumber ?? '__default__'}#${checkNumber}`;

    let summary = checkSummaries.get(checkKey);
    if (!summary) {
      summary = {
        date: parsedDate,
        shiftNumber,
        incomeAmount: 0,
        returnAmount: 0,
        correctionAmount: 0,
        payments: {
          income: createPaymentBreakdown(),
          returns: createPaymentBreakdown(),
          corrections: createPaymentBreakdown(),
        },
        cogs: {
          income: 0,
          returns: 0,
          corrections: 0,
        },
      };
      checkSummaries.set(checkKey, summary);
    }

    // Распределяем суммы по типам операций и способам оплаты
    let buckets: PaymentBreakdown;
    if (operationCategory === 'income') {
      buckets = summary.payments.income;
    } else if (operationCategory === 'return') {
      buckets = summary.payments.returns;
    } else {
      buckets = summary.payments.corrections;
    }

    switch (paymentCategory) {
      case 'cash':
        buckets.cash += absAmount;
        break;
      case 'qr':
        buckets.qr += absAmount;
        break;
      case 'sbp':
        buckets.sbp += absAmount;
        break;
      default:
        buckets.cashless += absAmount;
        break;
    }

    // Агрегируем выручку и себестоимость по типу операции
    // Прибыль будет рассчитана позже: выручка - себестоимость
    if (operationCategory === 'income') {
      summary.incomeAmount += absAmount; // Выручка по позиции (с учетом скидок и бонусов)
      summary.cogs.income += Math.max(0, costValue); // Себестоимость позиции
      
      // Агрегируем выручку по кассиру
      if (cashierName && cashierName.length > 0) {
        const shiftKey = `${dateKey}#${shiftNumber ?? '__default__'}`;
        let cashierData = cashierStats.get(cashierName);
        if (!cashierData) {
          cashierData = { revenue: 0, shifts: new Set() };
          cashierStats.set(cashierName, cashierData);
        }
        cashierData.revenue += absAmount;
        cashierData.shifts.add(shiftKey);
      }
    } else if (operationCategory === 'return') {
      summary.returnAmount += absAmount;
      summary.cogs.returns += Math.max(0, costValue);
    } else {
      summary.correctionAmount += absAmount;
      summary.cogs.corrections += Math.max(0, costValue);
    }
  });

  if (checkSummaries.size === 0) {
    const error = new Error('Не удалось извлечь данные из файла');
    (error as any).details = { errors, warnings };
    throw error;
  }

  if (unknownPaymentMethods.size > 0) {
    warnings.push(
      `Обнаружены неизвестные методы оплаты (${Array.from(unknownPaymentMethods).join(
        ', ',
      )}). Они учтены как безналичные.`,
    );
  }

  // Агрегируем по сменам
  const recordMap = new Map<
    string,
    {
      record: ProfitabilityRecordInput;
      cogsIncome: number;
      cogsReturn: number;
      cogsCorrection: number;
    }
  >();

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  checkSummaries.forEach((summary) => {
    const dateKey = summary.date.toISOString().slice(0, 10);
    const shiftKey = summary.shiftNumber ?? '__default__';
    const mapKey = `${dateKey}#${shiftKey}`;

    if (!periodStart || summary.date < periodStart) {
      periodStart = summary.date;
    }
    if (!periodEnd || summary.date > periodEnd) {
      periodEnd = summary.date;
    }

    let entry = recordMap.get(mapKey);
    if (!entry) {
      entry = {
        record: {
          reportDate: summary.date,
          shiftNumber: summary.shiftNumber,
          incomeChecks: 0,
          cashIncome: 0,
          cashlessIncome: 0,
          returnChecks: 0,
          cashReturn: 0,
          cashlessReturn: 0,
          correctionChecks: 0,
          correctionCash: 0,
          correctionCashless: 0,
        },
        cogsIncome: 0,
        cogsReturn: 0,
        cogsCorrection: 0,
      };
      recordMap.set(mapKey, entry);
    }

    if (summary.incomeAmount > 0) {
      entry.record.incomeChecks = (entry.record.incomeChecks ?? 0) + 1;
      entry.record.cashIncome = (entry.record.cashIncome ?? 0) + summary.payments.income.cash;
      entry.record.cashlessIncome =
        (entry.record.cashlessIncome ?? 0) +
        summary.payments.income.cashless +
        summary.payments.income.qr +
        summary.payments.income.sbp;
      entry.cogsIncome += summary.cogs.income;
    }

    if (summary.returnAmount > 0) {
      entry.record.returnChecks = (entry.record.returnChecks ?? 0) + 1;
      entry.record.cashReturn = (entry.record.cashReturn ?? 0) + summary.payments.returns.cash;
      entry.record.cashlessReturn =
        (entry.record.cashlessReturn ?? 0) +
        summary.payments.returns.cashless +
        summary.payments.returns.qr +
        summary.payments.returns.sbp;
      entry.cogsReturn += summary.cogs.returns;
    }

    if (summary.correctionAmount > 0) {
      entry.record.correctionChecks = (entry.record.correctionChecks ?? 0) + 1;
      entry.record.correctionCash =
        (entry.record.correctionCash ?? 0) + summary.payments.corrections.cash;
      entry.record.correctionCashless =
        (entry.record.correctionCashless ?? 0) +
        summary.payments.corrections.cashless +
        summary.payments.corrections.qr +
        summary.payments.corrections.sbp;
      entry.cogsCorrection += summary.cogs.corrections;
    }
  });

  const records = Array.from(recordMap.values())
    .map(({ record, cogsIncome, cogsReturn, cogsCorrection }) => {
      // Расчет общей себестоимости по смене:
      // COGS = себестоимость приходов - себестоимость возвратов + себестоимость коррекций
      const cogsTotal = cogsIncome - cogsReturn + cogsCorrection;
      return {
        ...record,
        // Себестоимость сохраняется для последующего расчета прибыли:
        // Прибыль = Выручка - Себестоимость
        // Валовая маржа = (Выручка - Себестоимость) / Выручка × 100
        cogsTotal: cogsTotal !== 0 ? cogsTotal : undefined,
      };
    })
    .sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime());

  // Определяем использованные колонки для detectedColumns
  const usedIndexes = new Set<number>(
    Object.values(columnMap).filter((idx): idx is number => idx !== undefined),
  );
  const ignoredHeaders = headers.filter((_, idx) => !usedIndexes.has(idx));
  if (ignoredHeaders.length > 0) {
    warnings.push(
      `Часть колонок проигнорирована при расчете рентабельности: ${ignoredHeaders.join(', ')}`,
    );
  }

  // Добавляем предупреждения о важных колонках
  if (columnMap.priceWithDiscount === undefined) {
    warnings.push(
      'Колонка "Цена со скидкой" не найдена. Выручка рассчитывается как цена - скидка - бонусы.',
    );
  }
  if (columnMap.bonusUsed === undefined) {
    warnings.push(
      'Колонка "Использовано бонусов" не найдена. Бонусы не учитываются в расчете выручки.',
    );
  }

  const detectedColumns: Record<string, string | undefined> = {
    reportDate: columnMap.shiftDate !== undefined ? headers[columnMap.shiftDate] : undefined,
    shiftNumber: columnMap.shiftNumber !== undefined ? headers[columnMap.shiftNumber] : undefined,
    checkNumber: columnMap.checkNumber !== undefined ? headers[columnMap.checkNumber] : undefined,
    price: columnMap.price !== undefined ? headers[columnMap.price] : undefined,
    cost: columnMap.cost !== undefined ? headers[columnMap.cost] : undefined,
    discountRub: columnMap.discountRub !== undefined ? headers[columnMap.discountRub] : undefined,
    priceWithDiscount:
      columnMap.priceWithDiscount !== undefined ? headers[columnMap.priceWithDiscount] : undefined,
    bonusUsed: columnMap.bonusUsed !== undefined ? headers[columnMap.bonusUsed] : undefined,
    paymentType: columnMap.paymentType !== undefined ? headers[columnMap.paymentType] : undefined,
    operationType: columnMap.operationType !== undefined ? headers[columnMap.operationType] : undefined,
    cashier: columnMap.cashier !== undefined ? headers[columnMap.cashier] : undefined,
  };

  // Формируем статистику по кассирам
  const cashierStatistics: CashierStatistics[] = Array.from(cashierStats.entries())
    .map(([cashierName, data]) => ({
      cashierName,
      totalRevenue: data.revenue,
      shiftsCount: data.shifts.size,
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue); // Сортируем по убыванию выручки

  // Добавляем информацию о кассирах в предупреждения, если есть данные
  if (cashierStatistics.length > 0) {
    const topCashier = cashierStatistics[0];
    const formatCurrency = (value: number) => {
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    };
    const cashierList = cashierStatistics
      .map((c) => `${c.cashierName}: ${formatCurrency(c.totalRevenue)} (${c.shiftsCount} смен)`)
      .join('; ');
    warnings.push(`📊 Статистика по кассирам: ${cashierList}`);
    warnings.push(`🏆 Наибольшая выручка у кассира "${topCashier.cashierName}": ${formatCurrency(topCashier.totalRevenue)} за ${topCashier.shiftsCount} ${topCashier.shiftsCount === 1 ? 'смену' : topCashier.shiftsCount < 5 ? 'смены' : 'смен'}`);
  }

  return {
    records,
    periodStart: periodStart ?? null,
    periodEnd: periodEnd ?? null,
    detectedColumns,
    sheetName,
    headerRowIndex,
    errors,
    warnings,
    rowsProcessed: dataRows.length,
    skippedRows,
    duplicateCount: 0,
    cashierStatistics: cashierStatistics.length > 0 ? cashierStatistics : undefined,
  };
}

export function parseProfitabilityExcelFile(
  buffer: Buffer,
  options: ProfitabilityParseOptions = {},
): ProfitabilityParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  // Используем первый лист или любой подходящий
  let rawSheetName = workbook.SheetNames[0];
  if (!rawSheetName) {
    const err = new Error('Файл не содержит листов');
    (err as any).details = {
      errors: [
        {
          rowNumber: 0,
          field: 'sheet',
          message: 'Файл не содержит листов',
        },
      ],
    };
    throw err;
  }

  const sheet = workbook.Sheets[rawSheetName];
  if (!sheet) {
    const err = new Error('Лист не найден');
    (err as any).details = {
      errors: [
        {
          rowNumber: 0,
          field: 'sheet',
          message: 'Лист не найден в файле',
        },
      ],
    };
    throw err;
  }

  // Чтение данных
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });
  
  if (rows.length === 0) {
    const err = new Error('Лист с данными пуст');
    (err as any).details = {
      errors: [
        {
          rowNumber: 0,
          field: 'header',
          message: 'Лист должен содержать строку с заголовками и данные.',
        },
      ],
    };
    throw err;
  }

  // Ограничиваем парсинг только колонками A-R (первые 18 колонок)
  const MAX_COLUMNS = 18;
  const limitedRows = rows.map((row) => row.slice(0, MAX_COLUMNS));

  const { index: headerRowIndex, headers } = findHeaderRow(limitedRows);
  const trimmedHeaders = headers.slice(0, MAX_COLUMNS).map((cell) =>
    cell === null || cell === undefined ? '' : String(cell).trim(),
  );
  
  // Определяем формат: новый детальный формат или старый формат Z-отчетов
  const detailedColumns = detectDetailedSalesColumns(trimmedHeaders);
  const hasDetailedFormat = DETAILED_REQUIRED_HEADER_KEYS.every(
    (key) => detailedColumns[key] !== undefined,
  );

  if (hasDetailedFormat) {
    // Парсим новый формат детальных позиций продаж
    return parseDetailedSalesFormat({
      rows: limitedRows,
      headerRowIndex,
      headers: trimmedHeaders,
      sheetName: rawSheetName,
      columnMap: detailedColumns,
      options,
    });
  }

  // Fallback: старый формат Z-отчетов
  const columnMap = detectColumns(trimmedHeaders);
  const missingRequiredKeys = REQUIRED_HEADER_KEYS.filter((key) => columnMap[key] === undefined);
  
  if (missingRequiredKeys.length > 0) {
    const err = new Error('Структура заголовков не совпадает с ожидаемой (см. детали)');
    (err as any).details = {
      errors: [
        {
          rowNumber: headerRowIndex + 1,
          field: 'header',
          message: `Отсутствуют обязательные колонки: ${missingRequiredKeys
            .map((key) => FIELD_LABELS[key])
            .join(', ')}`,
        },
      ],
    };
    throw err;
  }

  const optionalHeaderKeys = (Object.keys(PROFITABILITY_COLUMNS) as HeaderKey[]).filter(
    (key) => !REQUIRED_HEADER_KEYS.includes(key),
  );
  const missingOptional = optionalHeaderKeys.filter((key) => columnMap[key] === undefined);

  const recognizedColumnIndexes = new Set<number>();
  (Object.keys(columnMap) as HeaderKey[]).forEach((key) => {
    const index = columnMap[key];
    if (typeof index === 'number') {
      recognizedColumnIndexes.add(index);
    }
  });

  const ignoredHeaders = trimmedHeaders.filter(
    (header, idx) => header && !recognizedColumnIndexes.has(idx),
  );

  const headerWarnings: string[] = [];
  if (ignoredHeaders.length > 0) {
    headerWarnings.push(
      `Обнаружены дополнительные колонки, которые будут проигнорированы: ${ignoredHeaders.join(
        ', ',
      )}`,
    );
  }
  if (missingOptional.length > 0) {
    headerWarnings.push(
      `Не найдены необязательные колонки: ${missingOptional
        .map((key) => FIELD_LABELS[key])
        .join(', ')}. Эти значения будут импортированы как 0.`,
    );
  }

  const dataRows = limitedRows.slice(headerRowIndex + 1);

  const errors: ProfitabilityImportError[] = [];
  const warnings: string[] = [...headerWarnings];
  const recordsByKey = new Map<string, { record: ProfitabilityRecordInput; rowNumber: number }>();

  let skippedRows = 0;
  let duplicateCount = 0;
  const maxChecksPerDay = options.maxChecksPerDay ?? DEFAULT_PROFITABILITY_MAX_CHECKS_PER_DAY;

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex];
    if (!row || row.length === 0) {
      continue;
    }

    const hasValues = row.some((cell) => {
      if (cell === null || cell === undefined) return false;
      if (typeof cell === 'string') {
        return cell.trim().length > 0;
      }
      return true;
    });
    if (!hasValues) {
      continue;
    }

    const excelRowNumber = rowIndex + headerRowIndex + 2; // Adjust for skipped header rows
    const dateIndex = columnMap.reportDate;
    if (dateIndex === undefined) {
      continue;
    }

    const rawDate = row[dateIndex];
    const parsedDate = parseExcelDate(rawDate);

    if (!parsedDate) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'reportDate',
        message: 'Не удалось распознать дату/время.',
        value: typeof rawDate === 'string' || typeof rawDate === 'number' ? rawDate : null,
      });
      skippedRows += 1;
      continue;
    }

    const shiftNumberIndex = columnMap.shiftNumber;
    const rawShift = shiftNumberIndex !== undefined ? row[shiftNumberIndex] : undefined;
    const shiftNumber =
      rawShift !== undefined && rawShift !== null ? String(rawShift).trim() || null : null;

    const incomeChecksValue =
      columnMap.incomeChecks !== undefined ? parseInteger(row[columnMap.incomeChecks]) : null;
    const returnChecksValue =
      columnMap.returnChecks !== undefined ? parseInteger(row[columnMap.returnChecks]) : null;
    const correctionChecksValue =
      columnMap.correctionChecks !== undefined
        ? parseInteger(row[columnMap.correctionChecks])
        : null;

    const cashIncomeValue =
      columnMap.cashIncome !== undefined ? parseNumber(row[columnMap.cashIncome]) : null;
    const cashlessIncomeValue =
      columnMap.cashlessIncome !== undefined ? parseNumber(row[columnMap.cashlessIncome]) : null;
    const cashReturnValue =
      columnMap.cashReturn !== undefined ? parseNumber(row[columnMap.cashReturn]) : null;
    const cashlessReturnValue =
      columnMap.cashlessReturn !== undefined ? parseNumber(row[columnMap.cashlessReturn]) : null;
    const correctionCashValue =
      columnMap.correctionCash !== undefined ? parseNumber(row[columnMap.correctionCash]) : null;
    const correctionCashlessValue =
      columnMap.correctionCashless !== undefined
        ? parseNumber(row[columnMap.correctionCashless])
        : null;

    const rowErrors: ProfitabilityImportError[] = [];

    [
      { key: 'incomeChecks' as HeaderKey, value: incomeChecksValue },
      { key: 'returnChecks' as HeaderKey, value: returnChecksValue },
      { key: 'correctionChecks' as HeaderKey, value: correctionChecksValue },
    ].forEach(({ key, value }) => {
      if (value === null) {
        return;
      }
      if (value < 0 || value > maxChecksPerDay) {
        rowErrors.push({
          rowNumber: excelRowNumber,
          field: key,
          message: `Количество в колонке "${FIELD_LABELS[key]}" должно быть в диапазоне 0…${maxChecksPerDay}.`,
          value,
        });
      }
    });

    [
      { key: 'cashIncome' as HeaderKey, value: cashIncomeValue },
      { key: 'cashlessIncome' as HeaderKey, value: cashlessIncomeValue },
      { key: 'cashReturn' as HeaderKey, value: cashReturnValue },
      { key: 'cashlessReturn' as HeaderKey, value: cashlessReturnValue },
      { key: 'correctionCash' as HeaderKey, value: correctionCashValue },
      { key: 'correctionCashless' as HeaderKey, value: correctionCashlessValue },
    ].forEach(({ key, value }) => {
      if (value === null) {
        return;
      }
      if (value < 0) {
        rowErrors.push({
          rowNumber: excelRowNumber,
          field: key,
          message: `Значение в колонке "${FIELD_LABELS[key]}" не может быть отрицательным.`,
          value,
        });
      }
    });

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      skippedRows += 1;
      continue;
    }

    const record: ProfitabilityRecordInput = {
      reportDate: parsedDate,
      shiftNumber,
      incomeChecks: incomeChecksValue ?? 0,
      cashIncome: cashIncomeValue ?? 0,
      cashlessIncome: cashlessIncomeValue ?? 0,
      returnChecks: returnChecksValue ?? 0,
      cashReturn: cashReturnValue ?? 0,
      cashlessReturn: cashlessReturnValue ?? 0,
      correctionChecks: correctionChecksValue ?? 0,
      correctionCash: correctionCashValue ?? 0,
      correctionCashless: correctionCashlessValue ?? 0,
    };

    const dateKey = parsedDate.toISOString().slice(0, 10);
    const shiftKey = shiftNumber ?? '__default__';
    const dedupKey = `${dateKey}#${shiftKey}`;

    if (recordsByKey.has(dedupKey)) {
      duplicateCount += 1;
      warnings.push(
        `Дубликат записи за ${dateKey} (${shiftNumber ?? 'без номера смены'}). Строка ${excelRowNumber} заменила предыдущие данные.`,
      );
    }

    recordsByKey.set(dedupKey, { record, rowNumber: excelRowNumber });
  }

  const records = Array.from(recordsByKey.values())
    .map((entry) => entry.record)
    .sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime());

  if (records.length === 0) {
    const error = new Error('Не удалось извлечь данные из файла');
    (error as any).details = { errors, warnings };
    throw error;
  }

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  records.forEach((record) => {
    if (!periodStart || record.reportDate < periodStart) {
      periodStart = record.reportDate;
    }
    if (!periodEnd || record.reportDate > periodEnd) {
      periodEnd = record.reportDate;
    }
  });

  return {
    records,
    periodStart,
    periodEnd,
    detectedColumns: Object.fromEntries(
      Object.entries(columnMap).map(([key, index]) => [
        key,
        index !== undefined && headers[index] !== undefined ? String(headers[index]) : undefined,
      ]),
    ),
    sheetName: rawSheetName,
    headerRowIndex,
    errors,
    warnings,
    rowsProcessed: records.length,
    skippedRows,
    duplicateCount,
  };
}
