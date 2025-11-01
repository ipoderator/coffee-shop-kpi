import { mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

function generateDailyRows(): Array<Record<string, number | string>> {
  const rows: Array<Record<string, number | string>> = [];
  const today = new Date();

  // three full months back from today (≈90 дней)
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 3);

  for (let cursor = new Date(startDate); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const cash = Math.round(5000 + Math.random() * 5000);
    const terminal = Math.round(6000 + Math.random() * 6000);
    const qr = Math.round(1500 + Math.random() * 1500);
    const amount = cash + terminal + qr;

    rows.push({
      Дата: cursor.toISOString().slice(0, 10),
      'Выручка за день': amount,
      'Оплата наличными': cash,
      'Оплата по терминалу': terminal,
      'Оплата по QR/SBP': qr,
      'Количество чеков': Math.round(amount / 450),
    });
  }

  return rows;
}

function main(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..');
  const outputDir = path.join(projectRoot, 'server', 'data', 'training');
  const outputFile = path.join(outputDir, 'sample_training.xlsx');

  mkdirSync(outputDir, { recursive: true });

  const workbook = XLSX.utils.book_new();
  const sheetData = generateDailyRows();
  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'training');
  XLSX.writeFile(workbook, outputFile);

  console.log(`Sample training dataset generated: ${outputFile}`);
  console.log(`Rows count: ${sheetData.length}`);
}

main();
