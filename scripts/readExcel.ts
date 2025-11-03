import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';

const filePath = 'attached_assets/Z-отчеты_1762175853535.xlsx';
const buffer = readFileSync(filePath);
const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: false });

console.log('Sheet Names:', workbook.SheetNames);
console.log('');

const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

console.log('Sheet Range:', sheet['!ref']);
console.log('');

const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
  header: 1,
  defval: null,
  blankrows: false,
  raw: false,
});

console.log('Total rows:', data.length);
console.log('');

console.log('First 15 rows:');
data.slice(0, 15).forEach((row, i) => {
  console.log(`Row ${i}:`, JSON.stringify(row));
});

console.log('');
console.log('Columns in header row (if row 2 is header):');
if (data.length > 2 && data[2]) {
  data[2].forEach((header, idx) => {
    const letter = String.fromCharCode(65 + idx);
    console.log(`  ${letter} (col ${idx}): ${header}`);
  });
}
