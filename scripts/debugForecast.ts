import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Transaction } from '@shared/schema';
import { parseExcelFile } from '../server/utils/fileParser';

interface CliArgs {
  inputPath: string;
  limit?: number;
  enableExternalData: boolean;
}

function printUsage(): void {
  console.log(
    [
      'Usage: tsx scripts/debugForecast.ts <input-file> [--limit <days>] [--enable-external]',
      '',
      'Options:',
      '  --limit <days>        Restrict debug run to the latest N transactions (after sorting by date)',
      '  --enable-external    Allow fetching external data sources (disabled by default for determinism)',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const args: CliArgs = {
    inputPath: '',
    enableExternalData: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--enable-external') {
      args.enableExternalData = true;
      continue;
    }

    if (token === '--limit') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --limit option.');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Limit must be a positive number.');
      }
      args.limit = parsed;
      i += 1;
      continue;
    }

    if (token.startsWith('--limit=')) {
      const parsed = Number(token.split('=')[1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Limit must be a positive number.');
      }
      args.limit = parsed;
      continue;
    }

    if (!token.startsWith('--') && !args.inputPath) {
      args.inputPath = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.inputPath) {
    throw new Error('Input file path is required.');
  }

  return args;
}

function buildTransactions(rows: Awaited<ReturnType<typeof parseExcelFile>>['rows']): Transaction[] {
  const transactions: Transaction[] = [];

  rows.forEach((row, index) => {
    const date = row.date instanceof Date ? row.date : new Date(row.date);
    if (!date || Number.isNaN(date.getTime())) {
      return;
    }

    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) {
      return;
    }

    transactions.push({
      id: `debug-${index}`,
      date,
      year: row.year ?? date.getFullYear(),
      month: row.month ?? date.getMonth() + 1,
      amount,
      checksCount: row.checksCount ?? 1,
      cashPayment: row.cashPayment ?? 0,
      terminalPayment: row.terminalPayment ?? 0,
      qrPayment: row.qrPayment ?? 0,
      sbpPayment: row.sbpPayment ?? 0,
      refundChecksCount: row.refundChecksCount ?? 0,
      refundCashPayment: row.refundCashPayment ?? 0,
      refundTerminalPayment: row.refundTerminalPayment ?? 0,
      refundQrPayment: row.refundQrPayment ?? 0,
      refundSbpPayment: row.refundSbpPayment ?? 0,
      category: row.category ?? null,
      employee: row.employee ?? null,
      uploadId: 'forecast-debug',
    });
  });

  return transactions;
}

function selectLatestTransactions(transactions: Transaction[], limit?: number): Transaction[] {
  if (!limit || limit <= 0 || transactions.length <= limit) {
    return [...transactions];
  }

  return transactions.slice(-limit);
}

async function loadTransactions(inputPath: string): Promise<Transaction[]> {
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  const buffer = await readFile(resolvedPath);
  const parseResult = await parseExcelFile(buffer);
  return buildTransactions(parseResult.rows);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const transactions = await loadTransactions(args.inputPath);

    if (transactions.length === 0) {
      throw new Error('No valid transactions found in the provided file.');
    }

    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const limitedTransactions = selectLatestTransactions(sortedTransactions, args.limit);

    process.env.DEBUG_ENSEMBLE = 'true';
    if (!args.enableExternalData) {
      process.env.DISABLE_EXTERNAL_DATA = 'true';
    }

    const analyticsModule = await import('../server/utils/analytics');
    const { calculateAnalytics } = analyticsModule;

    console.log('Running forecast debug...');
    const analytics = await calculateAnalytics(limitedTransactions);
    const forecast = analytics.forecast;

    if (!forecast) {
      console.log('Not enough data to build an ML forecast. Ensemble debug logs were not produced.');
      return;
    }

    const dailyForecast = forecast.nextMonth?.dailyForecast ?? forecast.extendedForecast?.dailyForecast ?? [];
    if (dailyForecast.length > 0) {
      console.log('Daily forecast preview (date -> revenue @ confidence):');
      dailyForecast.forEach(day => {
        const revenueLabel = Number.isFinite(day.predictedRevenue)
          ? day.predictedRevenue.toFixed(2)
          : 'NaN';
        const confidenceLabel = Number.isFinite(day.confidence)
          ? (day.confidence * 100).toFixed(1)
          : 'NaN';
        console.log(`  ${day.date}: ${revenueLabel} @ ${confidenceLabel}%`);
      });
    }

    console.log('');
    console.log(
      'Ensemble debug logs (base revenue, component weights, raw/clamped predictions) are emitted above via DEBUG_ENSEMBLE.',
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
