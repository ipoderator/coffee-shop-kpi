import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseExcelFile } from '../server/utils/fileParser';
import type { Transaction } from '@shared/schema';
import { engineerDailyFeatures } from '../server/utils/salesFeatures';
import { SALES_MODEL_VERSION, type SalesModel } from '../server/utils/analytics';

interface ParsedArgs {
  inputPath: string;
  outputPath?: string;
  lambda: number;
}

interface TrainingResult {
  model: SalesModel;
  metrics: {
    samples: number;
    features: number;
    mae: number;
    rmse: number;
    r2: number;
  };
}

function computeMean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function computeStd(values: number[], mean: number = computeMean(values)): number {
  if (values.length <= 1) {
    return 0;
  }

  const variance =
    values.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / values.length;

  return Math.sqrt(Math.max(variance, 0));
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(
      [
        'Usage: tsx scripts/trainSalesModel.ts <input-file> [--output <output-file>] [--lambda <value>]',
        '',
        'Options:',
        '  --output <path>   Where to write the trained model (default: server/models/salesModel.json)',
        '  --lambda <value>  Ridge regularization strength (default: 1e-4)',
      ].join('\n'),
    );
    process.exit(0);
  }

  const args: ParsedArgs = {
    inputPath: argv[0],
    lambda: 1e-4,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --output option.');
      }
      args.outputPath = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      args.outputPath = arg.split('=')[1];
      continue;
    }

    if (arg === '--lambda') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --lambda option.');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Regularization strength must be a positive number.');
      }
      args.lambda = parsed;
      i += 1;
      continue;
    }

    if (arg.startsWith('--lambda=')) {
      const parsed = Number(arg.split('=')[1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Regularization strength must be a positive number.');
      }
      args.lambda = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function buildTransactions(
  rows: Awaited<ReturnType<typeof parseExcelFile>>['rows'],
): Transaction[] {
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
      id: `training-${index}`,
      date,
      year: row.year ?? date.getFullYear(),
      month: row.month ?? date.getMonth() + 1,
      amount,
      costOfGoods: row.costOfGoods ?? null,
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
      uploadId: 'training',
    });
  });

  return transactions;
}

function computeFeatureStatistics(featureMaps: Record<string, number>[]): {
  featureNames: string[];
  means: Record<string, number>;
  stds: Record<string, number>;
} {
  const sums = new Map<string, number>();
  const sumsOfSquares = new Map<string, number>();
  const counts = new Map<string, number>();

  featureMaps.forEach((map) => {
    Object.entries(map).forEach(([key, value]) => {
      const numericValue = Number.isFinite(value) ? value : 0;
      sums.set(key, (sums.get(key) ?? 0) + numericValue);
      sumsOfSquares.set(key, (sumsOfSquares.get(key) ?? 0) + numericValue * numericValue);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  });

  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  const featureNames: string[] = [];

  sums.forEach((sum, key) => {
    const count = counts.get(key) ?? 1;
    if (count === 0) {
      return;
    }

    const mean = sum / count;
    const sumSq = sumsOfSquares.get(key) ?? 0;
    const variance = Math.max(sumSq / count - mean * mean, 0);
    const std = Math.sqrt(variance);

    // Фильтруем константные признаки, чтобы избежать вырождения матрицы
    if (std <= 1e-8) {
      return;
    }

    means[key] = mean;
    stds[key] = std;
    featureNames.push(key);
  });

  return { featureNames, means, stds };
}

function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0) {
    return [];
  }

  const rows = matrix.length;
  const cols = matrix[0].length;
  const transposed: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0));

  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      transposed[j][i] = matrix[i][j];
    }
  }

  return transposed;
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  if (a.length === 0 || b.length === 0) {
    return [];
  }

  const aRows = a.length;
  const aCols = a[0].length;
  const bRows = b.length;
  const bCols = b[0].length;

  if (aCols !== bRows) {
    throw new Error('Matrix dimensions do not match for multiplication.');
  }

  const result: number[][] = Array.from({ length: aRows }, () => Array(bCols).fill(0));

  for (let i = 0; i < aRows; i += 1) {
    for (let k = 0; k < aCols; k += 1) {
      const value = a[i][k];
      if (value === 0) continue;
      for (let j = 0; j < bCols; j += 1) {
        result[i][j] += value * b[k][j];
      }
    }
  }

  return result;
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < size; col += 1) {
    // Partial pivoting for numerical stability
    let pivotRow = col;
    let maxValue = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < size; row += 1) {
      const value = Math.abs(augmented[row][col]);
      if (value > maxValue) {
        maxValue = value;
        pivotRow = row;
      }
    }

    if (maxValue <= 1e-12) {
      throw new Error('Matrix is singular or ill-conditioned.');
    }

    if (pivotRow !== col) {
      const temp = augmented[col];
      augmented[col] = augmented[pivotRow];
      augmented[pivotRow] = temp;
    }

    const pivot = augmented[col][col];
    for (let j = col; j <= size; j += 1) {
      augmented[col][j] /= pivot;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (factor === 0) continue;
      for (let j = col; j <= size; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function trainModel(
  featureMaps: Record<string, number>[],
  targets: number[],
  lambda: number,
): TrainingResult {
  if (featureMaps.length === 0) {
    throw new Error('No data available for training.');
  }

  if (featureMaps.length !== targets.length) {
    throw new Error('Feature matrix and target vector size mismatch.');
  }

  const { featureNames, means, stds } = computeFeatureStatistics(featureMaps);

  if (featureNames.length === 0) {
    const meanTarget = targets.reduce((sum, value) => sum + value, 0) / targets.length;
    const model: SalesModel = {
      intercept: meanTarget,
      coefficients: {},
      featureOrder: [],
      normalization: {
        mean: {},
        std: {},
      },
    };

    return {
      model,
      metrics: {
        samples: targets.length,
        features: 0,
        mae: 0,
        rmse: 0,
        r2: 0,
      },
    };
  }

  const designMatrix = featureMaps.map((map) => {
    return featureNames.map((name) => {
      const value = map[name] ?? 0;
      const mean = means[name] ?? 0;
      const stdCandidate = stds[name];
      const std =
        typeof stdCandidate === 'number' && Number.isFinite(stdCandidate) ? stdCandidate : 1;
      const safeStd = std > 1e-6 ? std : 1e-6;
      return (value - mean) / safeStd;
    });
  });

  const interceptColumn = designMatrix.map(() => 1);
  const extendedMatrix = designMatrix.map((row, index) => [interceptColumn[index], ...row]);

  const xt = transpose(extendedMatrix);
  const xtx = multiplyMatrices(xt, extendedMatrix);

  // Ridge regularization (skip intercept term)
  for (let i = 1; i < xtx.length; i += 1) {
    xtx[i][i] += lambda;
  }

  const xty = multiplyMatrixVector(xt, targets);
  const beta = solveLinearSystem(xtx, xty);

  const intercept = beta[0] ?? 0;
  const coefficients: Record<string, number> = {};

  featureNames.forEach((name, index) => {
    coefficients[name] = beta[index + 1] ?? 0;
  });

  const predictions = featureMaps.map((map) => {
    let prediction = intercept;
    featureNames.forEach((name) => {
      const coefficient = coefficients[name] ?? 0;
      const mean = means[name] ?? 0;
      const stdCandidate = stds[name];
      const std =
        typeof stdCandidate === 'number' && Number.isFinite(stdCandidate) ? stdCandidate : 1;
      const safeStd = std > 1e-6 ? std : 1e-6;
      const value = map[name] ?? 0;
      const normalized = (value - mean) / safeStd;
      prediction += coefficient * normalized;
    });
    return prediction;
  });

  const residuals = predictions.map((prediction, index) => prediction - targets[index]);
  const mae =
    residuals.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(residuals.length, 1);
  const mse =
    residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(residuals.length, 1);
  const rmse = Math.sqrt(mse);

  const targetMean = targets.reduce((sum, value) => sum + value, 0) / targets.length;
  const sst = targets.reduce((sum, value) => sum + (value - targetMean) ** 2, 0);
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const r2 = sst > 0 ? Math.max(0, 1 - sse / sst) : 0;

  const model: SalesModel = {
    intercept,
    coefficients,
    featureOrder: featureNames,
    normalization: {
      mean: means,
      std: stds,
    },
  };

  return {
    model,
    metrics: {
      samples: targets.length,
      features: featureNames.length,
      mae,
      rmse,
      r2,
    },
  };
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.resolve(__dirname, '..');

    const inputPath = path.resolve(process.cwd(), args.inputPath);
    const outputPath = path.resolve(
      args.outputPath
        ? path.resolve(process.cwd(), args.outputPath)
        : path.join(projectRoot, 'server', 'models', 'salesModel.json'),
    );

    const buffer = await readFile(inputPath);
    const parseResult = await parseExcelFile(buffer);

    if (parseResult.rows.length === 0) {
      throw new Error('Parsed file does not contain any valid rows.');
    }

    const transactions = buildTransactions(parseResult.rows);
    if (transactions.length === 0) {
      throw new Error('No valid transactions found in the provided file.');
    }

    const featureEngineering = engineerDailyFeatures(transactions);

    if (featureEngineering.featureMaps.length === 0 || featureEngineering.targets.length === 0) {
      throw new Error('Недостаточно ежедневных записей для обучения модели после агрегации.');
    }

    const { model, metrics } = trainModel(
      featureEngineering.featureMaps,
      featureEngineering.targets,
      args.lambda,
    );

    const targetMean = computeMean(featureEngineering.targets);
    const computedTargetStd = computeStd(featureEngineering.targets, targetMean);
    const targetStd = computedTargetStd > 1e-6 ? computedTargetStd : 1e-6;
    const checksMean = computeMean(
      featureEngineering.aggregates.map((record) => record.checksCount ?? 0),
    );

    const enhancedModel: SalesModel = {
      ...model,
      metadata: {
        version: SALES_MODEL_VERSION,
        trainedAt: new Date().toISOString(),
        trainingSamples: metrics.samples,
        featuresUsed: metrics.features,
        lambda: args.lambda,
        targetMean,
        targetStd,
        checksMean,
        metrics: {
          mae: metrics.mae,
          rmse: metrics.rmse,
          r2: metrics.r2,
        },
      },
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(enhancedModel, null, 2), 'utf-8');

    console.log('Sales model training complete.');
    console.log(`Daily samples used: ${metrics.samples}`);
    console.log(`Features used: ${metrics.features}`);
    console.log(`MAE: ${metrics.mae.toFixed(2)}`);
    console.log(`RMSE: ${metrics.rmse.toFixed(2)}`);
    console.log(`R²: ${metrics.r2.toFixed(4)}`);
    if (Number.isFinite(targetMean)) {
      console.log(`Target mean: ${targetMean.toFixed(2)}`);
    }
    console.log(`Model saved to: ${outputPath}`);
  } catch (error) {
    console.error('Failed to train sales model.');
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

void main();
