import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import * as pdfParse from 'pdf-parse';
import { COLUMN_MAPPINGS as BASE_COLUMN_MAPPINGS } from '@shared/schema';

const COLUMN_MAPPINGS = {
  ...BASE_COLUMN_MAPPINGS,
  month: [
    ...BASE_COLUMN_MAPPINGS.month,
    'месяц(указан номер месяца)',
    'месяц (указан номер месяца)',
  ],
  amount: [
    ...BASE_COLUMN_MAPPINGS.amount,
    'выручка за день',
  ],
  cashPayment: [
    ...BASE_COLUMN_MAPPINGS.cashPayment,
    'оплата наличными',
  ],
  terminalPayment: [
    ...BASE_COLUMN_MAPPINGS.terminalPayment,
    'оплата по терминалу',
  ],
  qrPayment: [
    ...BASE_COLUMN_MAPPINGS.qrPayment,
    'оплата по qr-коду/сбп',
    'оплата по qr коду/сбп',
  ],
};

export interface ParsedRow {
  date: Date;
  year?: number;
  month?: number;
  amount: number;
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

export interface ParseResult {
  rows: ParsedRow[];
  columnsDetected: {
    date: string;
    year?: string;
    month?: string;
    amount: string;
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
}

function normalizeColumnName(name: string): string {
  // Remove BOM, normalize spaces, convert to lowercase
  return name
    .replace(/^\uFEFF/, '') // Remove BOM
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Normalize multiple spaces to single space
}

function detectColumn(headers: string[], mappings: readonly string[]): string | undefined {
  const normalizedHeaders = headers.map(h => ({ original: h, normalized: normalizeColumnName(h) }));
  
  // Filter out correction columns (чеки коррекции, коррекции прихода, etc.)
  const filteredHeaders = normalizedHeaders.filter(h => !h.normalized.includes('коррекц'));
  
  // First pass: exact phrase match (for multi-word mappings)
  for (const mapping of mappings) {
    if (mapping.includes(' ')) {
      // Multi-word mapping: check if header contains the entire phrase
      const found = filteredHeaders.find(h => h.normalized.includes(mapping));
      if (found) {
        return found.original;
      }
    }
  }
  
  // Second pass: exact word matches (for single-word mappings)
  for (const mapping of mappings) {
    const found = filteredHeaders.find(h => {
      const words = h.normalized.split(/\s+/);
      return words.some(word => word === mapping);
    });
    
    if (found) {
      return found.original;
    }
  }
  
  // Third pass: substring matches (most lenient, only for single-word mappings)
  for (const mapping of mappings) {
    if (!mapping.includes(' ')) {
      const found = filteredHeaders.find(h => {
        const words = h.normalized.split(/\s+/);
        return words.some(word => word.includes(mapping));
      });
      
      if (found) {
        return found.original;
      }
    }
  }
  
  return undefined;
}

function parseDate(value: any): Date | null {
  if (value === null || value === undefined) return null;

  // Excel serial date number
  if (typeof value === 'number' && isFinite(value)) {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  // Already a Date instance
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const s = value.trim().replace(/\u00A0/g, ' ');
    if (!s) return null;

    // Common RU formats: DD.MM.YYYY[ HH:MM[:SS]]
    const ruMatch = s.match(/^(\d{1,2})[.](\d{1,2})[.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (ruMatch) {
      const day = parseInt(ruMatch[1], 10);
      const month = parseInt(ruMatch[2], 10) - 1;
      const year = parseInt(ruMatch[3], 10);
      const hours = ruMatch[4] ? parseInt(ruMatch[4], 10) : 0;
      const minutes = ruMatch[5] ? parseInt(ruMatch[5], 10) : 0;
      const seconds = ruMatch[6] ? parseInt(ruMatch[6], 10) : 0;
      const d = new Date(year, month, day, hours, minutes, seconds);
      return isNaN(d.getTime()) ? null : d;
    }

    // Alternate: DD/MM/YYYY
    const slMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slMatch) {
      const day = parseInt(slMatch[1], 10);
      const month = parseInt(slMatch[2], 10) - 1;
      const year = parseInt(slMatch[3], 10);
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }

    // ISO-like: YYYY-MM-DD[THH:MM[:SS]]
    const iso = new Date(s);
    if (!isNaN(iso.getTime())) return iso;

    // Excel serial number encoded as string
    const numeric = Number(s);
    if (!isNaN(numeric) && isFinite(numeric)) {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + numeric * 86400000);
      return isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

function parseAmount(value: any): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;

  if (typeof value === 'string') {
    let s = value.trim();
    if (!s) return null;

    // Normalize minus variations and NBSP/thin spaces
    s = s
      .replace(/[\u00A0\u202F\s]/g, '') // remove spaces & NBSP
      .replace(/[–—−]/g, '-') // dashes to minus
      .replace(/^\((.*)\)$/, '-$1'); // (123) -> -123

    // Keep only digits, dots and commas and leading minus
    const sign = s.startsWith('-') ? -1 : 1;
    s = s.replace(/^-/, '');
    s = s.replace(/[^0-9.,]/g, '');

    if (!s) return null;

    // Determine decimal separator as the last occurrence of dot or comma
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    const decSep = Math.max(lastDot, lastComma) === -1 ? null : (lastDot > lastComma ? '.' : ',');

    if (decSep) {
      // Remove all thousand separators (the other char) and replace decimal with '.'
      const thouSep = decSep === '.' ? ',' : '.';
      s = s.split(thouSep).join('');
      s = s.replace(decSep, '.');
    } else {
      // No decimal sep, just remove all separators
      s = s.replace(/[.,]/g, '');
    }

    const num = parseFloat(s);
    return isNaN(num) ? null : sign * num;
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
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  if (data.length < 2) {
    throw new Error('Файл должен содержать заголовки и хотя бы одну строку данных');
  }
  
  // Find the header row (first row with column names like "дата", "сумма", etc.)
  let headerRowIndex = -1;
  let headers: string[] = [];
  
  for (let i = 0; i < Math.min(15, data.length); i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    // Check if this row contains expected column names
    const rowAsStrings = row.map(cell => String(cell || '').toLowerCase());
    
    // Skip rows that look like warnings or disclaimers
    const isWarningRow = rowAsStrings.some(cell => 
      cell.includes('не предназначены') || 
      cell.includes('бухгалтерской') ||
      cell.includes('отчетности') ||
      cell.includes('полные данные') ||
      cell.includes('личного кабинета') ||
      cell.includes('офд') ||
      cell.includes('кассового аппарата') ||
      cell.length > 100 // Very long text is likely a warning
    );
    
    if (isWarningRow) continue;
    
    const hasDate = rowAsStrings.some(cell => 
      COLUMN_MAPPINGS.date.some(mapping => cell.includes(mapping))
    );
    const hasAmount = rowAsStrings.some(cell => 
      COLUMN_MAPPINGS.amount.some(mapping => cell.includes(mapping)) ||
      COLUMN_MAPPINGS.cashPayment.some(mapping => cell.includes(mapping)) ||
      COLUMN_MAPPINGS.terminalPayment.some(mapping => cell.includes(mapping)) ||
      COLUMN_MAPPINGS.qrPayment.some(mapping => cell.includes(mapping)) ||
      COLUMN_MAPPINGS.sbpPayment.some(mapping => cell.includes(mapping))
    );
    
    if (hasDate && hasAmount) {
      headerRowIndex = i;
      headers = row.map(cell => String(cell || ''));
      break;
    }
  }
  
  if (headerRowIndex === -1) {
    throw new Error('Не удалось найти строку заголовков. Убедитесь, что файл содержит колонки "Дата" и "Сумма".');
  }
  
  // Detect columns (detect refunds first to avoid conflicts with income columns)
  const dateCol = detectColumn(headers, COLUMN_MAPPINGS.date);
  const yearCol = detectColumn(headers, COLUMN_MAPPINGS.year);
  const monthCol = detectColumn(headers, COLUMN_MAPPINGS.month);
  const amountCol = detectColumn(headers, COLUMN_MAPPINGS.amount);
  
  // Detect refund columns first (more specific)
  const refundChecksCountCol = detectColumn(headers, COLUMN_MAPPINGS.refundChecksCount);
  const refundCashPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundCashPayment);
  const refundTerminalPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundTerminalPayment);
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
  const usePaymentColumns = !amountCol && (cashPaymentCol || terminalPaymentCol || qrPaymentCol || sbpPaymentCol);
  
  if (!dateCol || (!amountCol && !usePaymentColumns)) {
    throw new Error('Не удалось определить колонки "Дата" и "Сумма". Убедитесь, что они присутствуют в файле.');
  }
  
  const dateIndex = headers.indexOf(dateCol);
  const yearIndex = yearCol ? headers.indexOf(yearCol) : -1;
  const monthIndex = monthCol ? headers.indexOf(monthCol) : -1;
  const amountIndex = amountCol ? headers.indexOf(amountCol) : -1;
  const checksCountIndex = checksCountCol ? headers.indexOf(checksCountCol) : -1;
  const cashPaymentIndex = cashPaymentCol ? headers.indexOf(cashPaymentCol) : -1;
  const terminalPaymentIndex = terminalPaymentCol ? headers.indexOf(terminalPaymentCol) : -1;
  const qrPaymentIndex = qrPaymentCol ? headers.indexOf(qrPaymentCol) : -1;
  const sbpPaymentIndex = sbpPaymentCol ? headers.indexOf(sbpPaymentCol) : -1;
  const refundChecksCountIndex = refundChecksCountCol ? headers.indexOf(refundChecksCountCol) : -1;
  const refundCashPaymentIndex = refundCashPaymentCol ? headers.indexOf(refundCashPaymentCol) : -1;
  const refundTerminalPaymentIndex = refundTerminalPaymentCol ? headers.indexOf(refundTerminalPaymentCol) : -1;
  const refundQrPaymentIndex = refundQrPaymentCol ? headers.indexOf(refundQrPaymentCol) : -1;
  const refundSbpPaymentIndex = refundSbpPaymentCol ? headers.indexOf(refundSbpPaymentCol) : -1;
  const categoryIndex = categoryCol ? headers.indexOf(categoryCol) : -1;
  const employeeIndex = employeeCol ? headers.indexOf(employeeCol) : -1;
  
  const rows: ParsedRow[] = [];
  
  // Start from the row after headers
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const date = parseDate(row[dateIndex]);
    const year = yearIndex >= 0 ? parseInteger(row[yearIndex]) : undefined;
    const month = monthIndex >= 0 ? parseInteger(row[monthIndex]) : undefined;
    
    // Parse payment columns
    const checksCount = checksCountIndex >= 0 ? parseInteger(row[checksCountIndex]) : undefined;
    const cashPayment = cashPaymentIndex >= 0 ? parseAmount(row[cashPaymentIndex]) : undefined;
    const terminalPayment = terminalPaymentIndex >= 0 ? parseAmount(row[terminalPaymentIndex]) : undefined;
    const qrPayment = qrPaymentIndex >= 0 ? parseAmount(row[qrPaymentIndex]) : undefined;
    const sbpPayment = sbpPaymentIndex >= 0 ? parseAmount(row[sbpPaymentIndex]) : undefined;
    
    // Parse refund columns
    const refundChecksCount = refundChecksCountIndex >= 0 ? parseInteger(row[refundChecksCountIndex]) : undefined;
    const refundCashPayment = refundCashPaymentIndex >= 0 ? parseAmount(row[refundCashPaymentIndex]) : undefined;
    const refundTerminalPayment = refundTerminalPaymentIndex >= 0 ? parseAmount(row[refundTerminalPaymentIndex]) : undefined;
    const refundQrPayment = refundQrPaymentIndex >= 0 ? parseAmount(row[refundQrPaymentIndex]) : undefined;
    const refundSbpPayment = refundSbpPaymentIndex >= 0 ? parseAmount(row[refundSbpPaymentIndex]) : undefined;
    
    // Calculate net amount: (income - refunds)
    let amount: number | null = null;
    if (amountIndex >= 0) {
      amount = parseAmount(row[amountIndex]);
    } else if (usePaymentColumns) {
      const totalIncome = (cashPayment || 0) + (terminalPayment || 0) + (qrPayment || 0) + (sbpPayment || 0);
      const totalRefunds = (refundCashPayment || 0) + (refundTerminalPayment || 0) + (refundQrPayment || 0) + (refundSbpPayment || 0);
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
        cashPayment: cashPayment !== null ? cashPayment : undefined,
        terminalPayment: terminalPayment !== null ? terminalPayment : undefined,
        qrPayment: qrPayment !== null ? qrPayment : undefined,
        sbpPayment: sbpPayment !== null ? sbpPayment : undefined,
        refundChecksCount: refundChecksCount !== null ? refundChecksCount : undefined,
        refundCashPayment: refundCashPayment !== null ? refundCashPayment : undefined,
        refundTerminalPayment: refundTerminalPayment !== null ? refundTerminalPayment : undefined,
        refundQrPayment: refundQrPayment !== null ? refundQrPayment : undefined,
        refundSbpPayment: refundSbpPayment !== null ? refundSbpPayment : undefined,
        category: categoryIndex >= 0 ? row[categoryIndex]?.toString() : undefined,
        employee: employeeIndex >= 0 ? row[employeeIndex]?.toString() : undefined,
      });
    }
  }
  
  return {
    rows,
    columnsDetected: {
      date: dateCol,
      year: yearCol,
      month: monthCol,
      amount: amountCol || 'Calculated from payment columns',
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
  };
}

export async function parseCSVFile(buffer: Buffer): Promise<ParseResult> {
  // Remove BOM if present
  let csvText = buffer.toString('utf-8');
  if (csvText.charCodeAt(0) === 0xFEFF) {
    csvText = csvText.slice(1);
  }
  
  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          if (!results.data || results.data.length === 0) {
            throw new Error('CSV файл пуст');
          }
          
          const headers = results.meta.fields || [];
          
          // Detect columns (detect refunds first to avoid conflicts with income columns)
          const dateCol = detectColumn(headers, COLUMN_MAPPINGS.date);
          const yearCol = detectColumn(headers, COLUMN_MAPPINGS.year);
          const monthCol = detectColumn(headers, COLUMN_MAPPINGS.month);
          const amountCol = detectColumn(headers, COLUMN_MAPPINGS.amount);
          
          // Detect refund columns first (more specific)
          const refundChecksCountCol = detectColumn(headers, COLUMN_MAPPINGS.refundChecksCount);
          const refundCashPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundCashPayment);
          const refundTerminalPaymentCol = detectColumn(headers, COLUMN_MAPPINGS.refundTerminalPayment);
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
          const usePaymentColumns = !amountCol && (cashPaymentCol || terminalPaymentCol || qrPaymentCol || sbpPaymentCol);
          
          if (!dateCol || (!amountCol && !usePaymentColumns)) {
            throw new Error('Не удалось определить колонки "Дата" и "Сумма". Убедитесь, что они присутствуют в файле.');
          }
          
          const rows: ParsedRow[] = [];
          
          for (const row of results.data as any[]) {
            const date = parseDate(row[dateCol]);
            const year = yearCol ? parseInteger(row[yearCol]) : undefined;
            const month = monthCol ? parseInteger(row[monthCol]) : undefined;
            
            // Parse payment columns
            const checksCount = checksCountCol ? parseInteger(row[checksCountCol]) : undefined;
            const cashPayment = cashPaymentCol ? parseAmount(row[cashPaymentCol]) : undefined;
            const terminalPayment = terminalPaymentCol ? parseAmount(row[terminalPaymentCol]) : undefined;
            const qrPayment = qrPaymentCol ? parseAmount(row[qrPaymentCol]) : undefined;
            const sbpPayment = sbpPaymentCol ? parseAmount(row[sbpPaymentCol]) : undefined;
            
            // Parse refund columns
            const refundChecksCount = refundChecksCountCol ? parseInteger(row[refundChecksCountCol]) : undefined;
            const refundCashPayment = refundCashPaymentCol ? parseAmount(row[refundCashPaymentCol]) : undefined;
            const refundTerminalPayment = refundTerminalPaymentCol ? parseAmount(row[refundTerminalPaymentCol]) : undefined;
            const refundQrPayment = refundQrPaymentCol ? parseAmount(row[refundQrPaymentCol]) : undefined;
            const refundSbpPayment = refundSbpPaymentCol ? parseAmount(row[refundSbpPaymentCol]) : undefined;
            
            // Calculate net amount: (income - refunds)
            let amount: number | null = null;
            if (amountCol) {
              amount = parseAmount(row[amountCol]);
            } else if (usePaymentColumns) {
              const totalIncome = (cashPayment || 0) + (terminalPayment || 0) + (qrPayment || 0) + (sbpPayment || 0);
              const totalRefunds = (refundCashPayment || 0) + (refundTerminalPayment || 0) + (refundQrPayment || 0) + (refundSbpPayment || 0);
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
                cashPayment: cashPayment !== null ? cashPayment : undefined,
                terminalPayment: terminalPayment !== null ? terminalPayment : undefined,
                qrPayment: qrPayment !== null ? qrPayment : undefined,
                sbpPayment: sbpPayment !== null ? sbpPayment : undefined,
                refundChecksCount: refundChecksCount !== null ? refundChecksCount : undefined,
                refundCashPayment: refundCashPayment !== null ? refundCashPayment : undefined,
                refundTerminalPayment: refundTerminalPayment !== null ? refundTerminalPayment : undefined,
                refundQrPayment: refundQrPayment !== null ? refundQrPayment : undefined,
                refundSbpPayment: refundSbpPayment !== null ? refundSbpPayment : undefined,
                category: categoryCol ? row[categoryCol]?.toString() : undefined,
                employee: employeeCol ? row[employeeCol]?.toString() : undefined,
              });
            }
          }
          
          resolve({
            rows,
            columnsDetected: {
              date: dateCol,
              year: yearCol,
              month: monthCol,
              amount: amountCol || 'Calculated from payment columns',
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
  // Use PDFParse from the pdf-parse module
  const { PDFParse } = pdfParse as any;
  const parser = new PDFParse({ data: buffer });
  
  const result = await parser.getText();
  const text = result.text;
  
  // Clean up
  await parser.destroy();
  
  // Split text into lines
  const lines = text.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
  
  // First pass: extract rows with dates and cash amounts
  // Format: DD.MM.YYYY HH:MM:SS Number Checks CashAmount
  const datePattern = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(\d+)\s+(\d+)/;
  
  const cashRows: Array<{ date: Date; year: number; month: number; cash: number; checksCount: number; dateKey: string }> = [];
  
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
    throw new Error('Не удалось извлечь данные из PDF файла. Убедитесь, что файл содержит данные в правильном формате.');
  }
  
  // Sort by date descending (most recent first)
  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  
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
  };
}
