import * as XLSX from 'xlsx';
import type { ProfitabilityCogsItem, ProfitabilityImportError } from '@shared/schema';

const COGS_COLUMNS = {
  date: ['дата', 'date', 'day'],
  total: ['себестоимость', 'cogs', 'cost', 'total cost', 'с/с'],
  sku: ['sku', 'артикул', 'код', 'product code'],
  name: ['наименование', 'название', 'product name', 'product'],
} as const;

type CogsColumnKey = keyof typeof COGS_COLUMNS;

const normalize = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
};

const HEADER_CONFIG: Record<CogsColumnKey, { canonical: string; aliases: string[] }> =
  Object.entries(COGS_COLUMNS).reduce(
    (acc, [key, values]) => {
      const [first, ...rest] = values;
      acc[key as CogsColumnKey] = {
        canonical: normalize(first),
        aliases: rest.map((alias) => normalize(alias)),
      };
      return acc;
    },
    {} as Record<CogsColumnKey, { canonical: string; aliases: string[] }>,
  );

const REQUIRED_COLUMNS: CogsColumnKey[] = ['date', 'total'];

interface ColumnMap {
  [key: string]: number | undefined;
}

const parseDate = (value: unknown): Date | null => {
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

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const excelEpoch = new Date(1899, 11, 30);
      const candidate = new Date(excelEpoch.getTime() + numeric * 86400000);
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }

    const isoCandidate = new Date(trimmed);
    if (!Number.isNaN(isoCandidate.getTime())) {
      return isoCandidate;
    }
  }

  return null;
};

const parseNumber = (value: unknown): number | null => {
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
};

const findHeaderRow = (
  rows: (string | number | null)[][],
): { index: number; headers: string[] } => {
  const limit = Math.min(rows.length, 30);

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) {
      continue;
    }

    const headers = row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
    const normalized = headers.map(normalize);

    const hasRequired = REQUIRED_COLUMNS.every((key) =>
      normalized.includes(HEADER_CONFIG[key].canonical),
    );

    if (hasRequired) {
      return { index: i, headers };
    }
  }

  throw new Error('Не удалось определить строку заголовков для файла себестоимости.');
};

const detectColumns = (headers: string[]): ColumnMap => {
  const normalized = headers.map(normalize);
  const map: ColumnMap = {};

  (Object.keys(COGS_COLUMNS) as CogsColumnKey[]).forEach((key) => {
    const config = HEADER_CONFIG[key];

    let index = normalized.findIndex((value) => value === config.canonical);
    if (index === -1) {
      for (const alias of config.aliases) {
        index = normalized.findIndex((value) => value === alias);
        if (index !== -1) {
          break;
        }
      }
    }

    if (index === -1) {
      index = normalized.findIndex((value) => config.canonical && value.includes(config.canonical));
    }

    if (index !== -1) {
      map[key] = index;
    }
  });

  return map;
};

export interface ParsedCogsResult {
  byDate: Record<string, { total: number; items?: ProfitabilityCogsItem[] }>;
  errors: ProfitabilityImportError[];
  warnings: string[];
  rowsProcessed: number;
  skippedRows: number;
}

export function parseCogsExcelFile(buffer: Buffer): ParsedCogsResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('Excel файл себестоимости не содержит листов');
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error('Не удалось прочитать лист себестоимости');
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  });

  if (rows.length === 0) {
    throw new Error('Файл себестоимости пуст');
  }

  const { index: headerRowIndex, headers } = findHeaderRow(rows);
  const columnMap = detectColumns(headers);

  const missing = REQUIRED_COLUMNS.filter((key) => columnMap[key] === undefined);
  if (missing.length > 0) {
    throw new Error('Не найдены обязательные колонки "Дата" и/или "Себестоимость".');
  }

  const hasSku = columnMap.sku !== undefined;
  const hasName = columnMap.name !== undefined;

  const byDateMap = new Map<string, { total: number; items: ProfitabilityCogsItem[] }>();
  const errors: ProfitabilityImportError[] = [];
  const warnings: string[] = [];

  let rowsProcessed = 0;
  let skippedRows = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.length === 0) {
      continue;
    }

    const excelRowNumber = rowIndex + 1;

    const rawDate = columnMap.date !== undefined ? row[columnMap.date] : undefined;
    const parsedDate = parseDate(rawDate);

    if (!parsedDate) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'reportDate',
        message: 'Не удалось распознать дату в файле себестоимости.',
        value: typeof rawDate === 'string' || typeof rawDate === 'number' ? rawDate : null,
      });
      skippedRows += 1;
      continue;
    }

    const rawAmount = columnMap.total !== undefined ? row[columnMap.total] : undefined;
    const amount = parseNumber(rawAmount);

    if (amount === null) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'cashIncome',
        message: 'Не удалось распознать значение себестоимости.',
        value: typeof rawAmount === 'string' || typeof rawAmount === 'number' ? rawAmount : null,
      });
      skippedRows += 1;
      continue;
    }

    if (amount < 0) {
      errors.push({
        rowNumber: excelRowNumber,
        field: 'cashIncome',
        message: 'Себестоимость не может быть отрицательной.',
        value: amount,
      });
      skippedRows += 1;
      continue;
    }

    const dateKey = parsedDate.toISOString().slice(0, 10);
    const entry = byDateMap.get(dateKey) ?? { total: 0, items: [] };
    entry.total += amount;

    if (hasSku || hasName) {
      const rawSku = hasSku && columnMap.sku !== undefined ? row[columnMap.sku] : undefined;
      const rawName = hasName && columnMap.name !== undefined ? row[columnMap.name] : undefined;
      const skuText = rawSku !== undefined && rawSku !== null ? String(rawSku).trim() : '';
      const nameText = rawName !== undefined && rawName !== null ? String(rawName).trim() : '';

      const item: ProfitabilityCogsItem = {
        sku: skuText || (nameText ? nameText : `SKU-${entry.items.length + 1}`),
        amount,
        name: nameText || undefined,
      };

      entry.items.push(item);
    }

    byDateMap.set(dateKey, entry);
    rowsProcessed += 1;
  }

  return {
    byDate: Object.fromEntries(
      Array.from(byDateMap.entries()).map(([date, value]) => [
        date,
        {
          total: value.total,
          items: value.items.length > 0 ? value.items : undefined,
        },
      ]),
    ),
    errors,
    warnings,
    rowsProcessed,
    skippedRows,
  };
}
