import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as pdfParse from 'pdf-parse';
import { COLUMN_MAPPINGS as BASE_COLUMN_MAPPINGS } from '@shared/schema';
import { log } from '../vite';
import type { ProfitabilityImportError } from '@shared/schema';

const COLUMN_MAPPINGS = {
  ...BASE_COLUMN_MAPPINGS,
  month: [
    ...BASE_COLUMN_MAPPINGS.month,
    'месяц(указан номер месяца)',
    'месяц (указан номер месяца)',
  ],
  amount: [...BASE_COLUMN_MAPPINGS.amount, 'выручка за день'],
  cashPayment: [
    ...BASE_COLUMN_MAPPINGS.cashPayment,
    'наличная выручка',
    'выручка наличными',
    'наличные продажи',
    'наличный приход',
    'наличная оплата',
  ],
  terminalPayment: [
    ...BASE_COLUMN_MAPPINGS.terminalPayment,
    'безналичная выручка',
    'выручка по карте',
    'безналичные платежи',
    'безналичный приход',
    'оплата через терминал',
    'эквайринг выручка',
  ],
  qrPayment: [
    ...BASE_COLUMN_MAPPINGS.qrPayment,
    'оплата по qr-коду/сбп',
    'оплата по qr коду/сбп',
    'qr выручка',
    'выручка qr',
    'qr платежи',
  ],
  sbpPayment: [...BASE_COLUMN_MAPPINGS.sbpPayment, 'выручка сбп', 'платежи сбп', 'поступления сбп'],
};

export interface ParsedRow {
  date: Date;
  year?: number;
  month?: number;
  amount: number;
  costOfGoods?: number;
  checksCount?: number; // Количество чеков (по умолчанию 1 если не указано)
  cashPayment?: number;
  terminalPayment?: number;
  qrPayment?: number;
  sbpPayment?: number;
  refundChecksCount?: number; // Количество возвратов
  refundCashPayment?: number;
  refundTerminalPayment?: number;
  refundQrPayment?: number;
  refundSbpPayment?: number;
  category?: string;
  employee?: string;
}

export interface ParseError {
  row: number;
  field?: string;
  message: string;
  value?: any;
}

export interface ParseResult {
  rows: ParsedRow[];
  columnsDetected: {
    date: string;
    year?: string;
    month?: string;
    amount: string;
    costOfGoods?: string;
    checksCount?: string;
    cashPayment?: string;
    terminalPayment?: string;
    qrPayment?: string;
    sbpPayment?: string;
    refundChecksCount?: string;
    refundCashPayment?: string;
    refundTerminalPayment?: string;
    refundQrPayment?: string;
    refundSbpPayment?: string;
    category?: string;
    employee?: string;
  };
  errors: ParseError[]; // <-- новое поле
}

export interface ParsedSalesPositionRow {
  date: Date;
  waiter?: string;
  comment?: string;
  item?: string;
  price: number;
  cost: number;
  qty: number;
  sum: number; // price * qty
}

export interface SalesPositionsParseResult {
  rows: ParsedSalesPositionRow[];
  columnsDetected: {
    date?: number;
    price?: number;
    cost?: number;
    qty?: number;
    item?: number;
    comment?: number;
    waiter?: number;
  };
  errors?: ParseError[];
}

export interface ParsedSalesPositionFullRow {
  checkType: string;
  shiftDate: string;
  shiftNumber: string;
  checkNumberTime: string;
  cashier: string;
  waiter: string;
  item: string;
  comment: string;
  prepTime: string;
  cost: number | null;
  price: number | null;
  discountRub: number | null;
  discountPct: number | null;
  productionTask: string;
  notBonusUsed: string;
  qty: number | null;
  productionPrice: number | null;
  source: string;
  itemMark: string;
}

export interface SalesPositionsFullParseResult {
  rows: ParsedSalesPositionFullRow[];
  columnsDetected: string[];
  errors?: ParseError[];
}

// --- UTILITY: Fuzzy normalize for column names ---
function normalizeColumnFuzzy(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- ETAP 1: Автоопределение строки заголовков и формата ---
/**
 * Определяет строку headers и формат исходя из F1/F2.
 * @param data – двумерный массив XLSX (sheet_to_json header:1)
 * @returns { headerRowIndex, headers, format: 'F1' | 'F2', matches }
 */
function findHeaderRowAndFormat(data: any[][]): {
  headerRowIndex: number;
  headers: string[];
  format: 'F1' | 'F2';
  matches: string[];
} {
  // F1 — etalon: перечень заголовков для Z-отчётов
  const F1_HEADERS = [
    'дата/время',
    'номер',
    'чеков прихода',
    'приход наличными',
    'приход безналичными',
    'чеков возврата прихода',
    'возврат наличными',
    'возврат безналичными',
    'чеков коррекции прихода',
    'коррекции прихода наличными',
    'коррекции прихода безналичными',
  ];
  const f1Norms = F1_HEADERS.map(normalizeColumnFuzzy);

  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;
    const headers = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
    const rowNorm = headers.map(normalizeColumnFuzzy);

    // Подсчитываем совпадения с эталоном F1 и дополнительными маппингами
    const legacyMatches = f1Norms.filter((hNorm) => rowNorm.some((col) => col.includes(hNorm)));
    const hasDate = detectColumn(headers, COLUMN_MAPPINGS.date) !== undefined;
    if (!hasDate && legacyMatches.length < 1) {
      continue;
    }

    const detectedGroups: string[] = [];
    if (hasDate || legacyMatches.some((m) => m.includes('дата'))) {
      detectedGroups.push('date');
    }
    if (detectColumn(headers, COLUMN_MAPPINGS.cashPayment)) {
      detectedGroups.push('cashPayment');
    }
    if (detectColumn(headers, COLUMN_MAPPINGS.terminalPayment)) {
      detectedGroups.push('terminalPayment');
    }
    if (detectColumn(headers, COLUMN_MAPPINGS.checksCount)) {
      detectedGroups.push('checksCount');
    }
    if (detectColumn(headers, COLUMN_MAPPINGS.refundCashPayment)) {
      detectedGroups.push('refundCashPayment');
    }
    if (detectColumn(headers, COLUMN_MAPPINGS.refundTerminalPayment)) {
      detectedGroups.push('refundTerminalPayment');
    }

    const uniqueMatches = new Set([...legacyMatches, ...detectedGroups]);
    const f1Confidence =
      hasDate && detectedGroups.filter((group) => group !== 'date').length >= 2
        ? detectedGroups
        : legacyMatches;

    if (f1Confidence.length >= 2) {
      return {
        headerRowIndex: i,
        headers,
        format: 'F1',
        matches: Array.from(uniqueMatches),
      };
    }
  }
  // Иначе считаем F2, ищем первую строку с хотя бы одной датой/временем и суммой/выручкой
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i];
    if (!row || row.length < 4) continue;
    const headers = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
    const norm = headers.map(normalizeColumnFuzzy);
    const hasDate = norm.some(
      (c) =>
        c.includes('дата') || c.includes('date') || c.includes('время') || c.includes('timestamp'),
    );
    const hasAmount =
      norm.some((c) => c.includes('итого') || c.includes('total') || c.includes('сумма')) ||
      detectColumn(headers, COLUMN_MAPPINGS.amount) !== undefined ||
      detectColumn(headers, COLUMN_MAPPINGS.cashPayment) !== undefined ||
      detectColumn(headers, COLUMN_MAPPINGS.terminalPayment) !== undefined ||
      detectColumn(headers, COLUMN_MAPPINGS.qrPayment) !== undefined ||
      detectColumn(headers, COLUMN_MAPPINGS.sbpPayment) !== undefined;
    if (hasDate && hasAmount) {
      return {
        headerRowIndex: i,
        headers,
        format: 'F2',
        matches: [
          norm.find((c) => c.includes('дата') || c.includes('date')) || '',
          norm.find((c) => c.includes('итого') || c.includes('total') || c.includes('сумма')) || '',
        ],
      };
    }
  }
  // Fallback: первая непустая строка
  for (let i = 0; i < Math.min(20, data.length); i++) {
    const row = data[i];
    if (!row || row.length < 3) continue;
    return {
      headerRowIndex: i,
      headers: row.map(String),
      format: 'F2',
      matches: [],
    };
  }
  // Fallback: defaults
  return { headerRowIndex: 0, headers: [], format: 'F2', matches: [] };
}

// Кеш для нормализации имен колонок
const normalizeColumnNameCache = new Map<string, string>();

function normalizeColumnName(name: string): string {
  // Проверяем кеш
  const cached = normalizeColumnNameCache.get(name);
  if (cached !== undefined) {
    return cached;
  }

  // Remove BOM, normalize spaces, convert to lowercase
  const normalized = name
    .replace(/^\uFEFF/, '') // Remove BOM
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Normalize multiple spaces to single space

  // Оптимизация: увеличен размер кеша для лучшей производительности
  if (normalizeColumnNameCache.size < 2000) {
    normalizeColumnNameCache.set(name, normalized);
  }

  return normalized;
}

// Кеш для результатов detectColumn
// Ключ: JSON.stringify({ headers: headers.join('|'), mappings: mappings.join('|') })
const detectColumnCache = new Map<string, string | undefined>();

function detectColumn(headers: string[], mappings: readonly string[]): string | undefined {
  // Создаем ключ кеша на основе headers и mappings
  const cacheKey = `${headers.join('|')}::${mappings.join('|')}`;
  const cached = detectColumnCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let result: string | undefined;

  // 1. Точное совпадение (без normalize, strict)
  for (const mapping of mappings) {
    const found = headers.find((h) => h === mapping);
    if (found) {
      result = found;
      break;
    }
  }

  if (!result) {
    // 2. Совпадение через normalize
    // Кешируем нормализованные headers для повторного использования
    const normalizedHeaders = headers.map((h) => ({
      original: h,
      normalized: normalizeColumnName(h),
    }));

    for (const mapping of mappings) {
      const normalizedMapping = normalizeColumnName(mapping);
      const found = normalizedHeaders.find((h) => h.normalized === normalizedMapping);
      if (found) {
        result = found.original;
        break;
      }
    }
  }

  if (!result) {
    // 3. Совпадение substring по normalize
    const normalizedHeaders = headers.map((h) => ({
      original: h,
      normalized: normalizeColumnName(h),
    }));

    for (const mapping of mappings) {
      const normalizedMapping = normalizeColumnName(mapping);
      const found = normalizedHeaders.find((h) => h.normalized.includes(normalizedMapping));
      if (found) {
        result = found.original;
        break;
      }
    }
  }

  // Оптимизация: увеличен размер кеша для лучшей производительности
  if (detectColumnCache.size < 1000) {
    detectColumnCache.set(cacheKey, result);
  }

  return result;
}

const PAYMENT_EXCLUDED_KEYWORDS = ['возврат', 'refund', 'return'];

function detectPaymentColumn(
  headers: string[],
  mappings: readonly string[],
  usedColumns: Set<string>,
): string | undefined {
  if (headers.length === 0) {
    return undefined;
  }

  const normalizedHeaders = headers.map((h) => ({
    original: h,
    normalized: normalizeColumnName(h),
  }));

  const isEligible = (header: string): boolean => {
    if (usedColumns.has(header)) {
      return false;
    }
    const normalized = normalizeColumnName(header);
    return !PAYMENT_EXCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword));
  };

  const search = (
    matcher: (
      entry: { original: string; normalized: string },
      mapping: string,
      normalizedMapping: string,
    ) => boolean,
  ): string | undefined => {
    for (const mapping of mappings) {
      const normalizedMapping = normalizeColumnName(mapping);
      for (const entry of normalizedHeaders) {
        if (!isEligible(entry.original)) {
          continue;
        }
        if (matcher(entry, mapping, normalizedMapping)) {
          usedColumns.add(entry.original);
          return entry.original;
        }
      }
    }
    return undefined;
  };

  // Exact match
  const exact = search((entry, mapping) => entry.original === mapping);
  if (exact) {
    return exact;
  }

  // Normalized equality
  const normalizedMatch = search(
    (entry, _mapping, normalizedMapping) => entry.normalized === normalizedMapping,
  );
  if (normalizedMatch) {
    return normalizedMatch;
  }

  // Normalized substring
  return search((entry, _mapping, normalizedMapping) =>
    entry.normalized.includes(normalizedMapping),
  );
}

function isSummaryRow(row: any[]): boolean {
  if (!row || !Array.isArray(row)) return false;
  return row.some((cell) => {
    if (cell === null || cell === undefined) return false;
    const normalized = normalizeColumnName(String(cell));
    if (!normalized) return false;
    return (
      normalized.startsWith('итог') ||
      normalized.startsWith('всего') ||
      normalized.includes('итогов')
    );
  });
}

// Кешируем регулярные выражения для парсинга дат
const DATE_REGEXES = {
  ruFormat: /^(\d{1,2})[.](\d{1,2})[.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  slashFormat: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
};

// Кеш для результатов парсинга дат (ограниченный размер)
// Оптимизация: увеличен размер кеша для лучшей производительности
const parseDateCache = new Map<string, Date | null>();
const PARSE_DATE_CACHE_SIZE = 5000; // Увеличено с 1000 до 5000

// Константа для Excel epoch (1899-12-30)
const EXCEL_EPOCH = new Date(1899, 11, 30);
const MS_PER_DAY = 86400000;

function parseDate(value: any): Date | null {
  if (value === null || value === undefined) return null;

  // Excel serial date number
  if (typeof value === 'number' && isFinite(value)) {
    return new Date(EXCEL_EPOCH.getTime() + value * MS_PER_DAY);
  }

  // Already a Date instance
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const s = value.trim().replace(/\u00A0/g, ' ');
    if (!s) return null;

    // Проверяем кеш
    const cached = parseDateCache.get(s);
    if (cached !== undefined) {
      return cached;
    }

    let result: Date | null = null;

    // Common RU formats: DD.MM.YYYY[ HH:MM[:SS]]
    const ruMatch = s.match(DATE_REGEXES.ruFormat);
    if (ruMatch) {
      const day = parseInt(ruMatch[1], 10);
      const month = parseInt(ruMatch[2], 10) - 1;
      const year = parseInt(ruMatch[3], 10);
      const hours = ruMatch[4] ? parseInt(ruMatch[4], 10) : 0;
      const minutes = ruMatch[5] ? parseInt(ruMatch[5], 10) : 0;
      const seconds = ruMatch[6] ? parseInt(ruMatch[6], 10) : 0;
      const d = new Date(year, month, day, hours, minutes, seconds);
      result = isNaN(d.getTime()) ? null : d;
    }

    if (!result) {
      // Alternate: DD/MM/YYYY
      const slMatch = s.match(DATE_REGEXES.slashFormat);
      if (slMatch) {
        const day = parseInt(slMatch[1], 10);
        const month = parseInt(slMatch[2], 10) - 1;
        const year = parseInt(slMatch[3], 10);
        const d = new Date(year, month, day);
        result = isNaN(d.getTime()) ? null : d;
      }
    }

    if (!result) {
      // ISO-like: YYYY-MM-DD[THH:MM[:SS]]
      const iso = new Date(s);
      if (!isNaN(iso.getTime())) {
        result = iso;
      }
    }

    if (!result) {
      // Excel serial number encoded as string
      const numeric = Number(s);
      if (!isNaN(numeric) && isFinite(numeric)) {
        const d = new Date(EXCEL_EPOCH.getTime() + numeric * MS_PER_DAY);
        result = isNaN(d.getTime()) ? null : d;
      }
    }

    // Сохраняем в кеш
    if (parseDateCache.size < PARSE_DATE_CACHE_SIZE) {
      parseDateCache.set(s, result);
    }

    return result;
  }

  return null;
}

// Кеш для результатов парсинга чисел (ограниченный размер)
// Оптимизация: увеличен размер кеша для лучшей производительности
const parseAmountCache = new Map<string, number | null>();
const PARSE_AMOUNT_CACHE_SIZE = 2000; // Увеличено с 500 до 2000

// Предкомпилированные регулярные выражения для парсинга чисел
const AMOUNT_REGEXES = {
  spaces: /[\u00A0\u202F\s]/g,
  dashes: /[–—−]/g,
  parentheses: /^\((.*)\)$/,
  nonNumeric: /[^0-9.,]/g,
  allSeparators: /[.,]/g,
};

function parseAmount(value: any): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;

  if (typeof value === 'string') {
    const originalValue = value;
    let s = value.trim();
    if (!s) return null;

    // Проверяем кеш для оригинального значения
    const cached = parseAmountCache.get(originalValue);
    if (cached !== undefined) {
      return cached;
    }

    // Normalize minus variations and NBSP/thin spaces
    s = s
      .replace(AMOUNT_REGEXES.spaces, '') // remove spaces & NBSP
      .replace(AMOUNT_REGEXES.dashes, '-') // dashes to minus
      .replace(AMOUNT_REGEXES.parentheses, '-$1'); // (123) -> -123

    // Keep only digits, dots and commas and leading minus
    const sign = s.startsWith('-') ? -1 : 1;
    s = s.replace(/^-/, '');
    s = s.replace(AMOUNT_REGEXES.nonNumeric, '');

    if (!s) {
      const result = null;
      if (parseAmountCache.size < PARSE_AMOUNT_CACHE_SIZE) {
        parseAmountCache.set(originalValue, result);
      }
      return result;
    }

    // Determine decimal separator as the last occurrence of dot or comma
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const decSep = Math.max(lastDot, lastComma) === -1 ? null : lastDot > lastComma ? '.' : ',';

    if (decSep) {
      // Remove all thousand separators (the other char) and replace decimal with '.'
      const thouSep = decSep === '.' ? ',' : '.';
      s = s.split(thouSep).join('');
      s = s.replace(decSep, '.');
    } else {
      // No decimal sep, just remove all separators
      s = s.replace(AMOUNT_REGEXES.allSeparators, '');
    }

    const num = parseFloat(s);
    const result = isNaN(num) ? null : sign * num;

    // Сохраняем в кеш
    if (parseAmountCache.size < PARSE_AMOUNT_CACHE_SIZE) {
      parseAmountCache.set(originalValue, result);
    }

    return result;
  }

  return null;
}

function parseInteger(value: any): number | undefined {
  const n = parseAmount(value);
  if (n === null || n === undefined || !isFinite(n)) return undefined;
  const i = Math.round(n);
  return isNaN(i) ? undefined : i;
}

export async function parseExcelFile(buffer: Buffer): Promise<ParseResult> {
  const startTime = performance.now();
  const fileSizeKB = (buffer.length / 1024).toFixed(2);
  
  const readStartTime = performance.now();
  // Оптимизация: отключаем парсинг дат, форматирования и стилей для ускорения
  // Добавлены дополнительные опции для ускорения чтения больших файлов
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false, // Не парсим даты автоматически (делаем это вручную быстрее)
    cellNF: false, // Не парсим форматирование чисел
    cellStyles: false, // Не парсим стили ячеек
    dense: false, // Используем sparse arrays для экономии памяти
    sheetStubs: false, // Не создаем stub ячейки для пустых значений
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const readTime = (performance.now() - readStartTime).toFixed(2);

  const parseDataStartTime = performance.now();
  // Оптимизация: пропускаем пустые строки и используем null для пустых ячеек
  // Добавлена опция raw: false для более быстрой обработки чисел
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null, // Используем null вместо undefined для пустых ячеек
    blankrows: false, // Пропускаем полностью пустые строки
    raw: false, // Преобразуем числа в числа (быстрее чем raw: true)
  });
  const parseDataTime = (performance.now() - parseDataStartTime).toFixed(2);

  if (data.length < 2) {
    throw new Error('Файл должен содержать заголовки и хотя бы одну строку данных');
  }

  const detectStartTime = performance.now();
  const { headerRowIndex, headers, format } = findHeaderRowAndFormat(data);
  const detectTime = (performance.now() - detectStartTime).toFixed(2);

  if (!headers || headers.length === 0) {
    throw new Error('Не удалось определить строку заголовков для файла.');
  }

  const parseStartTime = performance.now();
  let result: ParseResult;
  if (format === 'F1') {
    result = parseExcelF1(data, headerRowIndex, headers);
  } else {
    result = parseExcelF2(data, headerRowIndex, headers);
  }
  const parseTime = (performance.now() - parseStartTime).toFixed(2);
  
  const totalTime = (performance.now() - startTime).toFixed(2);
  log(`📊 Парсинг Excel: ${fileSizeKB}KB, ${result.rows.length} строк, формат ${format} | Чтение: ${readTime}ms, Определение колонок: ${detectTime}ms, Парсинг: ${parseTime}ms, Всего: ${totalTime}ms`, 'fileParser');

  return result;
}

function parseExcelF1(data: any[][], headerRowIndex: number, headers: string[]): ParseResult {
  const dateCol = detectColumn(headers, ['Дата/время']);
  if (!dateCol) {
    throw new Error('Формат F1: не удалось определить колонку "Дата/время".');
  }

  const checksCountCol = detectColumn(headers, ['Чеков прихода']);
  const correctionChecksCol = detectColumn(headers, ['Чеков коррекции прихода']);
  const cashIncomeCol = detectColumn(headers, ['Приход наличными']);
  const terminalIncomeCol = detectColumn(headers, ['Приход безналичными']);
  const correctionCashIncomeCol = detectColumn(headers, ['Коррекции прихода наличными']);
  const correctionTerminalIncomeCol = detectColumn(headers, ['Коррекции прихода безналичными']);
  const refundChecksCountCol = detectColumn(headers, ['Чеков возврата прихода']);
  const refundCashCol = detectColumn(headers, ['Возврат наличными']);
  const refundTerminalCol = detectColumn(headers, ['Возврат безналичными']);

  const dateIndex = headers.indexOf(dateCol);
  const checksCountIndex = checksCountCol ? headers.indexOf(checksCountCol) : -1;
  const correctionChecksIndex = correctionChecksCol ? headers.indexOf(correctionChecksCol) : -1;
  const cashIncomeIndex = cashIncomeCol ? headers.indexOf(cashIncomeCol) : -1;
  const terminalIncomeIndex = terminalIncomeCol ? headers.indexOf(terminalIncomeCol) : -1;
  const correctionCashIncomeIndex = correctionCashIncomeCol
    ? headers.indexOf(correctionCashIncomeCol)
    : -1;
  const correctionTerminalIncomeIndex = correctionTerminalIncomeCol
    ? headers.indexOf(correctionTerminalIncomeCol)
    : -1;
  const refundChecksCountIndex = refundChecksCountCol ? headers.indexOf(refundChecksCountCol) : -1;
  const refundCashIndex = refundCashCol ? headers.indexOf(refundCashCol) : -1;
  const refundTerminalIndex = refundTerminalCol ? headers.indexOf(refundTerminalCol) : -1;

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  // Оптимизация: inline функция для быстрого доступа к значениям
  const getAmount = (row: any[], index: number): number | null => {
    if (index < 0 || index >= row.length) return null;
    return parseAmount(row[index]);
  };

  // Оптимизация: предвычисляем длину массива для более быстрого доступа
  const dataLength = data.length;
  for (let i = headerRowIndex + 1; i < dataLength; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    if (isSummaryRow(row)) continue;

    // Оптимизация: проверяем индекс один раз
    const rawDate = dateIndex >= 0 && dateIndex < row.length ? row[dateIndex] : undefined;
    const date = rawDate !== undefined ? parseDate(rawDate) : null;

    const cashIncome = getAmount(row, cashIncomeIndex);
    const terminalIncome = getAmount(row, terminalIncomeIndex);
    const correctionCashIncome = getAmount(row, correctionCashIncomeIndex);
    const correctionTerminalIncome = getAmount(row, correctionTerminalIncomeIndex);
    const refundCash = getAmount(row, refundCashIndex);
    const refundTerminal = getAmount(row, refundTerminalIndex);

    const hasNumericData =
      cashIncome !== null ||
      terminalIncome !== null ||
      correctionCashIncome !== null ||
      correctionTerminalIncome !== null ||
      refundCash !== null ||
      refundTerminal !== null;

    if (!hasNumericData) {
      continue;
    }

    if (!date) {
      errors.push({
        row: i,
        field: 'date',
        message: 'Не удалось распарсить дату для строки формата F1',
        value: rawDate,
      });
      continue;
    }

    const checksCount = checksCountIndex >= 0 ? parseInteger(row[checksCountIndex]) : undefined;
    const correctionChecks =
      correctionChecksIndex >= 0 ? parseInteger(row[correctionChecksIndex]) : undefined;
    const totalChecks = (checksCount ?? 0) + (correctionChecks ?? 0);

    const refundChecksCount =
      refundChecksCountIndex >= 0 ? parseInteger(row[refundChecksCountIndex]) : undefined;

    const incomeCashTotal = (cashIncome ?? 0) + (correctionCashIncome ?? 0);
    const incomeTerminalTotal = (terminalIncome ?? 0) + (correctionTerminalIncome ?? 0);
    const refundsCashTotal = refundCash ?? 0;
    const refundsTerminalTotal = refundTerminal ?? 0;

    const netAmount =
      incomeCashTotal + incomeTerminalTotal - refundsCashTotal - refundsTerminalTotal;

    if (!Number.isFinite(netAmount)) {
      errors.push({
        row: i,
        field: 'amount',
        message: 'Не удалось вычислить сумму для строки формата F1',
        value: netAmount,
      });
      continue;
    }

    rows.push({
      date,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      amount: netAmount,
      checksCount: totalChecks > 0 ? totalChecks : undefined,
      cashPayment:
        cashIncome !== null || correctionCashIncome !== null ? incomeCashTotal : undefined,
      terminalPayment:
        terminalIncome !== null || correctionTerminalIncome !== null
          ? incomeTerminalTotal
          : undefined,
      refundChecksCount,
      refundCashPayment: refundCash !== null ? refundsCashTotal : undefined,
      refundTerminalPayment: refundTerminal !== null ? refundsTerminalTotal : undefined,
    });
  }

  if (rows.length === 0) {
    throw new Error('Формат F1: не удалось извлечь ни одной строки данных.');
  }

  return {
    rows,
    columnsDetected: {
      date: dateCol,
      year: undefined,
      month: undefined,
      amount: 'Calculated from payment columns (F1)',
      costOfGoods: undefined,
      checksCount: checksCountCol ?? correctionChecksCol,
      cashPayment: cashIncomeCol ?? correctionCashIncomeCol,
      terminalPayment: terminalIncomeCol ?? correctionTerminalIncomeCol,
      qrPayment: undefined,
      sbpPayment: undefined,
      refundChecksCount: refundChecksCountCol,
      refundCashPayment: refundCashCol,
      refundTerminalPayment: refundTerminalCol,
      refundQrPayment: undefined,
      refundSbpPayment: undefined,
      category: undefined,
      employee: undefined,
    },
    errors,
  };
}

function parseExcelF2(data: any[][], headerRowIndex: number, headers: string[]): ParseResult {
  const dateCol = detectColumn(headers, COLUMN_MAPPINGS.date);
  const yearCol = detectColumn(headers, COLUMN_MAPPINGS.year);
  const monthCol = detectColumn(headers, COLUMN_MAPPINGS.month);
  const amountCol = detectColumn(headers, COLUMN_MAPPINGS.amount);
  const costOfGoodsCol = detectColumn(headers, COLUMN_MAPPINGS.costOfGoods ?? []);
  const checksCountCol = detectColumn(headers, COLUMN_MAPPINGS.checksCount);
  const usedPaymentHeaders = new Set<string>();
  const cashPaymentCol = detectPaymentColumn(
    headers,
    COLUMN_MAPPINGS.cashPayment,
    usedPaymentHeaders,
  );
  const terminalPaymentCol = detectPaymentColumn(
    headers,
    COLUMN_MAPPINGS.terminalPayment,
    usedPaymentHeaders,
  );
  const qrPaymentCol = detectPaymentColumn(headers, COLUMN_MAPPINGS.qrPayment, usedPaymentHeaders);
  const sbpPaymentCol = detectPaymentColumn(
    headers,
    COLUMN_MAPPINGS.sbpPayment,
    usedPaymentHeaders,
  );
  const refundChecksCountCol = detectColumn(headers, COLUMN_MAPPINGS.refundChecksCount);
  const refundCashPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundCashPayment);
  const refundTerminalPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundTerminalPayment);
  const refundQrPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundQrPayment);
  const refundSbpPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundSbpPayment);
  const categoryCol = detectColumn(headers, COLUMN_MAPPINGS.category);
  const employeeCol = detectColumn(headers, COLUMN_MAPPINGS.employee);

  const usePaymentColumns =
    !amountCol && (cashPaymentCol || terminalPaymentCol || qrPaymentCol || sbpPaymentCol);

  if (!dateCol || (!amountCol && !usePaymentColumns)) {
    throw new Error(
      'Не удалось определить колонки "Дата" и "Сумма". Убедитесь, что они присутствуют в файле.',
    );
  }

  const dateIndex = headers.indexOf(dateCol);
  const yearIndex = yearCol ? headers.indexOf(yearCol) : -1;
  const monthIndex = monthCol ? headers.indexOf(monthCol) : -1;
  const amountIndex = amountCol ? headers.indexOf(amountCol) : -1;
  const costOfGoodsIndex = costOfGoodsCol ? headers.indexOf(costOfGoodsCol) : -1;
  const checksCountIndex = checksCountCol ? headers.indexOf(checksCountCol) : -1;
  const cashPaymentIndex = cashPaymentCol ? headers.indexOf(cashPaymentCol) : -1;
  const terminalPaymentIndex = terminalPaymentCol ? headers.indexOf(terminalPaymentCol) : -1;
  const qrPaymentIndex = qrPaymentCol ? headers.indexOf(qrPaymentCol) : -1;
  const sbpPaymentIndex = sbpPaymentCol ? headers.indexOf(sbpPaymentCol) : -1;
  const refundChecksCountIndex = refundChecksCountCol ? headers.indexOf(refundChecksCountCol) : -1;
  const refundCashPaymentIndex = refundCashPaymentCol ? headers.indexOf(refundCashPaymentCol) : -1;
  const refundTerminalPaymentIndex = refundTerminalPaymentCol
    ? headers.indexOf(refundTerminalPaymentCol)
    : -1;
  const refundQrPaymentIndex = refundQrPaymentCol ? headers.indexOf(refundQrPaymentCol) : -1;
  const refundSbpPaymentIndex = refundSbpPaymentCol ? headers.indexOf(refundSbpPaymentCol) : -1;

  const rawRows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  // Оптимизация: предвычисляем длину массива для более быстрого доступа
  // Предвыделяем память для массива (примерная оценка размера)
  const dataLength = data.length;
  const estimatedRows = Math.max(0, dataLength - headerRowIndex - 1);
  rawRows.length = estimatedRows; // Предвыделяем память
  
  // Оптимизация: ранний выход при обнаружении пустых данных
  if (dataLength <= headerRowIndex + 1) {
    throw new Error('Файл не содержит данных после строки заголовков');
  }

  let validRowIndex = 0; // Индекс для валидных строк
  for (let i = headerRowIndex + 1; i < dataLength; i++) {
    const row = data[i];
    // Оптимизация: быстрая проверка пустых строк
    if (!row || row.length === 0) continue;
    // Оптимизация: проверка summary row только если строка содержит текст
    if (isSummaryRow(row)) continue;

    // Оптимизация: проверяем индекс и длину массива один раз
    const rawDate = dateIndex >= 0 && dateIndex < row.length ? row[dateIndex] : undefined;
    const date = rawDate !== undefined ? parseDate(rawDate) : null;

    // Оптимизация: проверяем индексы и длину массива один раз для каждого поля
    const rowLength = row.length;
    const year = yearIndex >= 0 && yearIndex < rowLength ? parseInteger(row[yearIndex]) : undefined;
    const month = monthIndex >= 0 && monthIndex < rowLength ? parseInteger(row[monthIndex]) : undefined;

    const costOfGoods = costOfGoodsIndex >= 0 && costOfGoodsIndex < rowLength ? parseAmount(row[costOfGoodsIndex]) : undefined;
    const checksCount = checksCountIndex >= 0 && checksCountIndex < rowLength ? parseInteger(row[checksCountIndex]) : undefined;
    const cashPayment = cashPaymentIndex >= 0 && cashPaymentIndex < rowLength ? parseAmount(row[cashPaymentIndex]) : undefined;
    const terminalPayment = terminalPaymentIndex >= 0 && terminalPaymentIndex < rowLength ? parseAmount(row[terminalPaymentIndex]) : undefined;
    const qrPayment = qrPaymentIndex >= 0 && qrPaymentIndex < rowLength ? parseAmount(row[qrPaymentIndex]) : undefined;
    const sbpPayment = sbpPaymentIndex >= 0 && sbpPaymentIndex < rowLength ? parseAmount(row[sbpPaymentIndex]) : undefined;

    const refundChecksCount = refundChecksCountIndex >= 0 && refundChecksCountIndex < rowLength ? parseInteger(row[refundChecksCountIndex]) : undefined;
    const refundCashPayment = refundCashPaymentIndex >= 0 && refundCashPaymentIndex < rowLength ? parseAmount(row[refundCashPaymentIndex]) : undefined;
    const refundTerminalPayment = refundTerminalPaymentIndex >= 0 && refundTerminalPaymentIndex < rowLength ? parseAmount(row[refundTerminalPaymentIndex]) : undefined;
    const refundQrPayment = refundQrPaymentIndex >= 0 && refundQrPaymentIndex < rowLength ? parseAmount(row[refundQrPaymentIndex]) : undefined;
    const refundSbpPayment = refundSbpPaymentIndex >= 0 && refundSbpPaymentIndex < rowLength ? parseAmount(row[refundSbpPaymentIndex]) : undefined;

    let amount: number | null = null;
    if (amountIndex >= 0 && amountIndex < rowLength) {
      amount = parseAmount(row[amountIndex]);
    } else if (usePaymentColumns) {
      const totalIncome =
        (cashPayment ?? 0) + (terminalPayment ?? 0) + (qrPayment ?? 0) + (sbpPayment ?? 0);
      const totalRefunds =
        (refundCashPayment ?? 0) +
        (refundTerminalPayment ?? 0) +
        (refundQrPayment ?? 0) +
        (refundSbpPayment ?? 0);
      amount = totalIncome - totalRefunds;
    }

    if (amount !== null && amount !== undefined && !Number.isFinite(amount)) {
      errors.push({
        row: i,
        field: 'amount',
        message: 'Сумма содержит некорректное значение',
        value: amount,
      });
      continue;
    }

    const hasNumericData =
      amount !== null ||
      cashPayment !== undefined ||
      terminalPayment !== undefined ||
      qrPayment !== undefined ||
      sbpPayment !== undefined;

    if (!date) {
      if (hasNumericData) {
        errors.push({
          row: i,
          field: 'date',
          message: 'Не удалось распарсить дату',
          value: rawDate,
        });
      }
      continue;
    }

    if (amount === null || amount === undefined) {
      errors.push({
        row: i,
        field: 'amount',
        message: 'Сумма не может быть пустой или нулевой',
        value: amount,
      });
      continue;
    }

    // Оптимизация: используем прямое присваивание вместо push для предвыделенного массива
    rawRows[validRowIndex++] = {
      date,
      year: year ?? date.getFullYear(),
      month: month ?? date.getMonth() + 1,
      amount,
      checksCount,
      costOfGoods: costOfGoods ?? undefined,
      cashPayment: cashPayment ?? undefined,
      terminalPayment: terminalPayment ?? undefined,
      qrPayment: qrPayment ?? undefined,
      sbpPayment: sbpPayment ?? undefined,
      refundChecksCount,
      refundCashPayment: refundCashPayment ?? undefined,
      refundTerminalPayment: refundTerminalPayment ?? undefined,
      refundQrPayment: refundQrPayment ?? undefined,
      refundSbpPayment: refundSbpPayment ?? undefined,
    };
  }

  // Оптимизация: обрезаем массив до реального размера
  rawRows.length = validRowIndex;

  // Оптимизация: ранний выход если нет валидных строк
  if (rawRows.length === 0) {
    throw new Error('Не удалось извлечь ни одной валидной строки данных');
  }

  const aggregatedRows = aggregateRowsByDay(rawRows);

  return {
    rows: aggregatedRows,
    columnsDetected: {
      date: dateCol,
      year: yearCol,
      month: monthCol,
      amount: amountCol || 'Calculated from payment columns',
      costOfGoods: costOfGoodsCol,
      checksCount: checksCountCol,
      cashPayment: cashPaymentCol,
      terminalPayment: terminalPaymentCol,
      qrPayment: qrPaymentCol,
      sbpPayment: sbpPaymentCol,
      refundChecksCount: refundChecksCountCol,
      refundCashPayment: refundCashPaymentCol,
      refundTerminalPayment: refundTerminalPaymentCol,
      refundQrPayment: refundQrPaymentCol,
      refundSbpPayment: refundSbpPaymentCol,
      category: categoryCol,
      employee: employeeCol,
    },
    errors,
  };
}

interface AggregationState {
  day: Date;
  amountSum: number;
  checksSum: number;
  costOfGoodsSum: number;
  hasCostOfGoods: boolean;
  cashPaymentSum: number;
  hasCashPayment: boolean;
  terminalPaymentSum: number;
  hasTerminalPayment: boolean;
  qrPaymentSum: number;
  hasQrPayment: boolean;
  sbpPaymentSum: number;
  hasSbpPayment: boolean;
  refundChecksSum: number;
  hasRefundChecks: boolean;
  refundCashPaymentSum: number;
  hasRefundCash: boolean;
  refundTerminalPaymentSum: number;
  hasRefundTerminal: boolean;
  refundQrPaymentSum: number;
  hasRefundQr: boolean;
  refundSbpPaymentSum: number;
  hasRefundSbp: boolean;
}

function aggregateRowsByDay(rows: ParsedRow[]): ParsedRow[] {
  if (rows.length === 0) {
    return [];
  }

  // Оптимизация: используем числовой ключ вместо строкового для более быстрого сравнения
  // Формат: YYYYMMDD (например, 20240115) - числовой ключ быстрее строкового
  const aggregation = new Map<number, AggregationState>();

  // Оптимизация: функция для вычисления числового ключа дня без создания Date объекта
  const getDayKey = (date: Date): number => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    // Числовой формат YYYYMMDD для быстрого сравнения (без padStart)
    return year * 10000 + month * 100 + day;
  };

  for (const row of rows) {
    // Оптимизация: вычисляем ключ напрямую из row.date без создания нового Date объекта
    const date = row.date;
    const key = getDayKey(date);

    let state = aggregation.get(key);
    if (!state) {
      // Оптимизация: создаем Date объект только один раз при создании нового состояния
      // Используем UTC для избежания проблем с часовыми поясами
      const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      state = {
        day,
        amountSum: 0,
        checksSum: 0,
        costOfGoodsSum: 0,
        hasCostOfGoods: false,
        cashPaymentSum: 0,
        hasCashPayment: false,
        terminalPaymentSum: 0,
        hasTerminalPayment: false,
        qrPaymentSum: 0,
        hasQrPayment: false,
        sbpPaymentSum: 0,
        hasSbpPayment: false,
        refundChecksSum: 0,
        hasRefundChecks: false,
        refundCashPaymentSum: 0,
        hasRefundCash: false,
        refundTerminalPaymentSum: 0,
        hasRefundTerminal: false,
        refundQrPaymentSum: 0,
        hasRefundQr: false,
        refundSbpPaymentSum: 0,
        hasRefundSbp: false,
      };
      aggregation.set(key, state);
    }

    // Оптимизация: используем оператор += для накопления сумм
    state.amountSum += row.amount;
    state.checksSum += row.checksCount ?? 1;

    // Оптимизация: проверяем undefined один раз и используем флаги
    if (row.costOfGoods !== undefined) {
      state.costOfGoodsSum += row.costOfGoods;
      state.hasCostOfGoods = true;
    }
    if (row.cashPayment !== undefined) {
      state.cashPaymentSum += row.cashPayment;
      state.hasCashPayment = true;
    }
    if (row.terminalPayment !== undefined) {
      state.terminalPaymentSum += row.terminalPayment;
      state.hasTerminalPayment = true;
    }
    if (row.qrPayment !== undefined) {
      state.qrPaymentSum += row.qrPayment;
      state.hasQrPayment = true;
    }
    if (row.sbpPayment !== undefined) {
      state.sbpPaymentSum += row.sbpPayment;
      state.hasSbpPayment = true;
    }
    if (row.refundChecksCount !== undefined) {
      state.refundChecksSum += row.refundChecksCount;
      state.hasRefundChecks = true;
    }
    if (row.refundCashPayment !== undefined) {
      state.refundCashPaymentSum += row.refundCashPayment;
      state.hasRefundCash = true;
    }
    if (row.refundTerminalPayment !== undefined) {
      state.refundTerminalPaymentSum += row.refundTerminalPayment;
      state.hasRefundTerminal = true;
    }
    if (row.refundQrPayment !== undefined) {
      state.refundQrPaymentSum += row.refundQrPayment;
      state.hasRefundQr = true;
    }
    if (row.refundSbpPayment !== undefined) {
      state.refundSbpPaymentSum += row.refundSbpPayment;
      state.hasRefundSbp = true;
    }
  }

  // Оптимизация: сортируем по числовому ключу (быстрее чем строковый)
  // и создаем результат за один проход
  const sortedKeys = Array.from(aggregation.keys()).sort((a, b) => a - b);
  return sortedKeys.map((key) => {
    const state = aggregation.get(key)!;
    // Оптимизация: предвычисляем year и month один раз
    const year = state.day.getFullYear();
    const month = state.day.getMonth() + 1;
    const aggregatedRow: ParsedRow = {
      date: state.day,
      year,
      month,
      amount: state.amountSum,
      checksCount: state.checksSum,
    };

    // Условно добавляем поля только если они были заполнены
    if (state.hasCostOfGoods) {
      aggregatedRow.costOfGoods = state.costOfGoodsSum;
    }
    if (state.hasCashPayment) {
      aggregatedRow.cashPayment = state.cashPaymentSum;
    }
    if (state.hasTerminalPayment) {
      aggregatedRow.terminalPayment = state.terminalPaymentSum;
    }
    if (state.hasQrPayment) {
      aggregatedRow.qrPayment = state.qrPaymentSum;
    }
    if (state.hasSbpPayment) {
      aggregatedRow.sbpPayment = state.sbpPaymentSum;
    }
    if (state.hasRefundChecks) {
      aggregatedRow.refundChecksCount = state.refundChecksSum;
    }
    if (state.hasRefundCash) {
      aggregatedRow.refundCashPayment = state.refundCashPaymentSum;
    }
    if (state.hasRefundTerminal) {
      aggregatedRow.refundTerminalPayment = state.refundTerminalPaymentSum;
    }
    if (state.hasRefundQr) {
      aggregatedRow.refundQrPayment = state.refundQrPaymentSum;
    }
    if (state.hasRefundSbp) {
      aggregatedRow.refundSbpPayment = state.refundSbpPaymentSum;
    }

    return aggregatedRow;
  });
}

export async function parseCSVFile(buffer: Buffer): Promise<ParseResult> {
  const startTime = performance.now();
  const fileSizeKB = (buffer.length / 1024).toFixed(2);
  
  // Remove BOM if present
  let csvText = buffer.toString('utf-8');
  if (csvText.charCodeAt(0) === 0xfeff) {
    csvText = csvText.slice(1);
  }

  return new Promise((resolve, reject) => {
    const parseStartTime = performance.now();
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parseTime = (performance.now() - parseStartTime).toFixed(2);
          
          if (!results.data || results.data.length === 0) {
            throw new Error('CSV файл пуст');
          }

          const headers = results.meta.fields || [];

          // Detect columns (detect refunds first to avoid conflicts with income columns)
          const dateCol = detectColumn(headers, COLUMN_MAPPINGS.date);
          const yearCol = detectColumn(headers, COLUMN_MAPPINGS.year);
          const monthCol = detectColumn(headers, COLUMN_MAPPINGS.month);
          const amountCol = detectColumn(headers, COLUMN_MAPPINGS.amount);
          const costOfGoodsCol = detectColumn(headers, COLUMN_MAPPINGS.costOfGoods ?? []);

          // Detect refund columns first (more specific)
          const refundChecksCountCol = detectColumn(headers, COLUMN_MAPPINGS.refundChecksCount);
          const refundCashPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundCashPayment);
          const refundTerminalPaymentCol = detectColumn(
            headers,
            COLUMN_MAPPINGS.refundTerminalPayment,
          );
          const refundQrPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundQrPayment);
          const refundSbpPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundSbpPayment);

          // Then detect income columns
          const checksCountCol = detectColumn(headers, COLUMN_MAPPINGS.checksCount);
          const cashPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.cashPayment);
          const terminalPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.terminalPayment);
          const qrPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.qrPayment);
          const sbpPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.sbpPayment);

          const categoryCol = detectColumn(headers, COLUMN_MAPPINGS.category);
          const employeeCol = detectColumn(headers, COLUMN_MAPPINGS.employee);

          // If amount column is not directly found, use sum of all payment columns
          const usePaymentColumns =
            !amountCol && (cashPaymentCol || terminalPaymentCol || qrPaymentCol || sbpPaymentCol);

          if (!dateCol || (!amountCol && !usePaymentColumns)) {
            throw new Error(
              'Не удалось определить колонки "Дата" и "Сумма". Убедитесь, что они присутствуют в файле.',
            );
          }

          const rows: ParsedRow[] = [];
          const errors: ParseError[] = [];

          for (const row of results.data as any[]) {
            const date = parseDate(row[dateCol]);
            const year = yearCol ? parseInteger(row[yearCol]) : undefined;
            const month = monthCol ? parseInteger(row[monthCol]) : undefined;

            // Parse payment columns
            const checksCount = checksCountCol ? parseInteger(row[checksCountCol]) : undefined;
            const costOfGoods = costOfGoodsCol ? parseAmount(row[costOfGoodsCol]) : undefined;
            const cashPayment = cashPaymentCol ? parseAmount(row[cashPaymentCol]) : undefined;
            const terminalPayment = terminalPaymentCol
              ? parseAmount(row[terminalPaymentCol])
              : undefined;
            const qrPayment = qrPaymentCol ? parseAmount(row[qrPaymentCol]) : undefined;
            const sbpPayment = sbpPaymentCol ? parseAmount(row[sbpPaymentCol]) : undefined;

            // Parse refund columns
            const refundChecksCount = refundChecksCountCol
              ? parseInteger(row[refundChecksCountCol])
              : undefined;
            const refundCashPayment = refundCashPaymentCol
              ? parseAmount(row[refundCashPaymentCol])
              : undefined;
            const refundTerminalPayment = refundTerminalPaymentCol
              ? parseAmount(row[refundTerminalPaymentCol])
              : undefined;
            const refundQrPayment = refundQrPaymentCol
              ? parseAmount(row[refundQrPaymentCol])
              : undefined;
            const refundSbpPayment = refundSbpPaymentCol
              ? parseAmount(row[refundSbpPaymentCol])
              : undefined;

            // Calculate net amount: (income - refunds)
            let amount: number | null = null;
            if (amountCol) {
              amount = parseAmount(row[amountCol]);
            } else if (usePaymentColumns) {
              const totalIncome =
                (cashPayment || 0) + (terminalPayment || 0) + (qrPayment || 0) + (sbpPayment || 0);
              const totalRefunds =
                (refundCashPayment || 0) +
                (refundTerminalPayment || 0) +
                (refundQrPayment || 0) +
                (refundSbpPayment || 0);
              amount = totalIncome - totalRefunds;
            }

            // Skip rows where date is missing OR amount is null/undefined (but allow amount === 0)
            if (date && amount !== null && amount !== undefined) {
              rows.push({
                date,
                year: year !== null ? year : undefined,
                month: month !== null ? month : undefined,
                amount,
                checksCount: checksCount !== null ? checksCount : undefined,
                costOfGoods:
                  costOfGoods !== null && costOfGoods !== undefined ? costOfGoods : undefined,
                cashPayment: cashPayment !== null ? cashPayment : undefined,
                terminalPayment: terminalPayment !== null ? terminalPayment : undefined,
                qrPayment: qrPayment !== null ? qrPayment : undefined,
                sbpPayment: sbpPayment !== null ? sbpPayment : undefined,
                refundChecksCount: refundChecksCount !== null ? refundChecksCount : undefined,
                refundCashPayment: refundCashPayment !== null ? refundCashPayment : undefined,
                refundTerminalPayment:
                  refundTerminalPayment !== null ? refundTerminalPayment : undefined,
                refundQrPayment: refundQrPayment !== null ? refundQrPayment : undefined,
                refundSbpPayment: refundSbpPayment !== null ? refundSbpPayment : undefined,
                category: categoryCol ? row[categoryCol]?.toString() : undefined,
                employee: employeeCol ? row[employeeCol]?.toString() : undefined,
              });
            } else {
              errors.push({
                row: results.data.indexOf(row), // Use results.data.indexOf(row) to get the original row index
                field: 'amount',
                message: 'Сумма не может быть пустой или нулевой',
                value: amount,
              });
            }
          }

          const totalTime = (performance.now() - startTime).toFixed(2);
          log(`📊 Парсинг CSV: ${fileSizeKB}KB, ${rows.length} строк | Парсинг: ${parseTime}ms, Всего: ${totalTime}ms`, 'fileParser');
          
          resolve({
            rows,
            columnsDetected: {
              date: dateCol,
              year: yearCol,
              month: monthCol,
              amount: amountCol || 'Calculated from payment columns',
              costOfGoods: costOfGoodsCol,
              checksCount: checksCountCol,
              cashPayment: cashPaymentCol,
              terminalPayment: terminalPaymentCol,
              qrPayment: qrPaymentCol,
              sbpPayment: sbpPaymentCol,
              refundChecksCount: refundChecksCountCol,
              refundCashPayment: refundCashPaymentCol,
              refundTerminalPayment: refundTerminalPaymentCol,
              refundQrPayment: refundQrPaymentCol,
              refundSbpPayment: refundSbpPaymentCol,
              category: categoryCol,
              employee: employeeCol,
            },
            errors,
          });
        } catch (error) {
          reject(error);
        }
      },
      error: (error: any) => {
        reject(new Error(`Ошибка парсинга CSV: ${error.message}`));
      },
    });
  });
}

export async function parsePDFFile(buffer: Buffer): Promise<ParseResult> {
  const startTime = performance.now();
  const fileSizeKB = (buffer.length / 1024).toFixed(2);
  
  // Use PDFParse from the pdf-parse module
  const { PDFParse } = pdfParse as any;
  const parser = new PDFParse({ data: buffer });

  const extractStartTime = performance.now();
  const result = await parser.getText();
  const text = result.text;
  const extractTime = (performance.now() - extractStartTime).toFixed(2);

  // Clean up
  await parser.destroy();

  // Split text into lines
  const lines = text
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0);

  // First pass: extract rows with dates and cash amounts
  // Format: DD.MM.YYYY HH:MM:SS Number Checks CashAmount
  const datePattern = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(\d+)\s+(\d+)/;

  const cashRows: Array<{
    date: Date;
    year: number;
    month: number;
    cash: number;
    checksCount: number;
    dateKey: string;
  }> = [];

  for (const line of lines) {
    const match = line.match(datePattern);

    if (match) {
      const [, datePart, timePart, reportNum, checksCount, cashAmount] = match;

      // Parse date (DD.MM.YYYY)
      const [day, month, year] = datePart.split('.').map(Number);
      const date = new Date(year, month - 1, day);

      if (!isNaN(date.getTime())) {
        cashRows.push({
          date,
          year,
          month,
          cash: parseFloat(cashAmount) || 0,
          checksCount: parseInt(checksCount) || 0,
          dateKey: datePart,
        });
      }
    }
  }

  // Second pass: extract terminal/non-cash amounts (numbers without dates)
  // These appear in order matching the cash amounts
  const terminalPattern = /^\s*(\d+)\s+\d+\s+\d+\s+\d+\s*$/;
  const terminalAmounts: number[] = [];

  for (const line of lines) {
    // Skip lines with dates (already processed)
    if (line.match(datePattern)) continue;

    const match = line.match(terminalPattern);
    if (match) {
      const amount = parseFloat(match[1]) || 0;
      if (amount > 0) {
        terminalAmounts.push(amount);
      }
    }
  }

  // Combine cash and terminal amounts
  const rows: ParsedRow[] = cashRows.map((cashRow, index) => {
    const terminal = index < terminalAmounts.length ? terminalAmounts[index] : 0;
    const total = cashRow.cash + terminal;

    return {
      date: cashRow.date,
      year: cashRow.year,
      month: cashRow.month,
      amount: total,
      checksCount: cashRow.checksCount,
      cashPayment: cashRow.cash > 0 ? cashRow.cash : undefined,
      terminalPayment: terminal > 0 ? terminal : undefined,
    };
  });

  if (rows.length === 0) {
    throw new Error(
      'Не удалось извлечь данные из PDF файла. Убедитесь, что файл содержит данные в правильном формате.',
    );
  }

  // Sort by date descending (most recent first)
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());

  const totalTime = (performance.now() - startTime).toFixed(2);
  log(`📊 Парсинг PDF: ${fileSizeKB}KB, ${rows.length} строк | Извлечение текста: ${extractTime}ms, Всего: ${totalTime}ms`, 'fileParser');

  return {
    rows,
    columnsDetected: {
      date: 'Дата/время',
      year: 'Год',
      month: 'Месяц',
      amount: 'Общая выручка',
      cashPayment: 'Приход наличными',
      terminalPayment: 'Приход безналичными',
    },
    errors: [], // PDF parser doesn't have errors in the same way as Excel/CSV
  };
}

export async function parseSalesPositionsExcelFile(
  buffer: Buffer,
): Promise<SalesPositionsFullParseResult> {
  // Оптимизация: отключаем парсинг дат, форматирования и стилей для ускорения
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellStyles: false,
  });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  // Оптимизация: пропускаем пустые строки
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (data.length < 2) {
    throw new Error('Файл должен содержать заголовки и хотя бы одну строку данных');
  }

  // Берём первые 18 столбцов (A–R)
  const headersRow = data[0];
  const relevantCols = headersRow.slice(0, 18).map((h) => String(h || '').trim());

  // Колонки по порядку:
  // [A] Тип чека
  // [B] Смена (дата)
  // [C] Смена (номер)
  // [D] Номер чека время создания
  // [E] Кассир
  // [F] Официант
  // [G] Наименование
  // [H] Комментарий
  // [I] Время приготовления
  // [J] Себестоимость
  // [K] Цена
  // [L] Скидка, руб.
  // [M] Скидка, %
  // [N] Задача произведения
  // [O] Использована не бонус
  // [P] Количество
  // [Q] Цена за заказа произведения
  // [R] Источник
  // (S — Марка товара; если нужно — добавить)

  const rows: ParsedSalesPositionFullRow[] = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const parseNum = (v: any) => {
      const n = typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : v;
      const num = Number(n);
      return isNaN(num) ? null : num;
    };
    rows.push({
      checkType: String(row[0] ?? '').trim(),
      shiftDate: String(row[1] ?? '').trim(),
      shiftNumber: String(row[2] ?? '').trim(),
      checkNumberTime: String(row[3] ?? '').trim(),
      cashier: String(row[4] ?? '').trim(),
      waiter: String(row[5] ?? '').trim(),
      item: String(row[6] ?? '').trim(),
      comment: String(row[7] ?? '').trim(),
      prepTime: String(row[8] ?? '').trim(),
      cost: parseNum(row[9]),
      price: parseNum(row[10]),
      discountRub: parseNum(row[11]),
      discountPct: parseNum(row[12]),
      productionTask: String(row[13] ?? '').trim(),
      notBonusUsed: String(row[14] ?? '').trim(),
      qty: parseNum(row[15]),
      productionPrice: parseNum(row[16]),
      source: String(row[17] ?? '').trim(),
      itemMark: String(row[18] ?? '').trim(),
    });
  }

  return {
    rows,
    columnsDetected: relevantCols,
  };
}
