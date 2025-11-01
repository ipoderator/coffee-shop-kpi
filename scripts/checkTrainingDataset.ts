import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseExcelFile } from '../server/utils/fileParser';

async function main(): Promise<void> {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error('Usage: tsx scripts/checkTrainingDataset.ts <path-to-xlsx>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePathArg);
  const buffer = await readFile(resolvedPath);
  const parseResult = await parseExcelFile(buffer);

  console.log(`Parsed rows: ${parseResult.rows.length}`);
  console.log('Detected columns:', parseResult.columnsDetected);

  const sample = parseResult.rows.slice(0, 3).map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    amount: row.amount,
    cashPayment: row.cashPayment,
    terminalPayment: row.terminalPayment,
    qrPayment: row.qrPayment,
  }));

  console.log('Sample rows:', sample);
}

void main();
