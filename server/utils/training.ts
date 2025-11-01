import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearSalesModelCache } from './analytics';
import { parseExcelFile, type ParsedRow } from './fileParser';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');
const trainingDataDir = path.resolve(projectRoot, 'server', 'data', 'training');
const salesModelPath = path.resolve(projectRoot, 'server', 'models', 'salesModel.json');
const TRAINING_FILE_FIELD = 'file';

export const MIN_DAILY_RECORDS = 90;

export class TrainingError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'TrainingError';
    this.status = status;
  }
}

export function getTrainingFileFieldName(): string {
  return TRAINING_FILE_FIELD;
}

function sanitizeFileName(originalName: string): string {
  const extension = path.extname(originalName).toLowerCase();
  const base = path.basename(originalName, extension).toLowerCase();
  const safeBase = base
    .replace(/[^a-z0-9-_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const truncated = safeBase.slice(0, 80) || 'dataset';
  return `${truncated}${extension}`;
}

function validateTrainingDataset(rows: ParsedRow[]): string | null {
  if (!rows || rows.length === 0) {
    return 'Файл не содержит валидных строк с данными.';
  }

  const dateStrings = rows
    .map((row) => {
      const rawDate = row.date instanceof Date ? row.date : new Date(row.date);
      if (!rawDate || Number.isNaN(rawDate.getTime())) {
        return null;
      }
      const utcDate = new Date(
        Date.UTC(rawDate.getFullYear(), rawDate.getMonth(), rawDate.getDate()),
      );
      return utcDate.toISOString().slice(0, 10);
    })
    .filter(Boolean) as string[];

  const uniqueDates = new Set(dateStrings);

  if (uniqueDates.size < MIN_DAILY_RECORDS) {
    return `Файл должен содержать как минимум ${MIN_DAILY_RECORDS} ежедневных записей (≈3 месяца данных).`;
  }

  const sortedDates = Array.from(uniqueDates)
    .map((dateStr) => new Date(dateStr))
    .sort((a, b) => a.getTime() - b.getTime());

  if (sortedDates.length === 0) {
    return 'Не удалось определить период данных в файле.';
  }

  const coverageDays =
    Math.floor(
      (sortedDates[sortedDates.length - 1].getTime() - sortedDates[0].getTime()) /
        (1000 * 60 * 60 * 24),
    ) + 1;

  if (coverageDays < MIN_DAILY_RECORDS) {
    return 'Диапазон дат слишком короткий: требуется минимум 3 месяца ежедневных данных.';
  }

  return null;
}

async function runTraining(filePath: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/trainSalesModel.ts', filePath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Training script exited with code ${code}.`);
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      }
    });
  });
}

export async function trainSalesModelFromExcel(
  buffer: Buffer,
  originalName: string,
): Promise<{ message: string; filePath: string }> {
  let parseResult;

  try {
    parseResult = await parseExcelFile(buffer);
  } catch (parseError) {
    console.error('Training data parse error:', parseError);
    const message =
      parseError instanceof Error
        ? parseError.message
        : 'Не удалось обработать файл. Убедитесь, что в нём есть ежедневные данные.';
    throw new TrainingError(message, 400);
  }

  const datasetValidationError = validateTrainingDataset(parseResult.rows);
  if (datasetValidationError) {
    throw new TrainingError(datasetValidationError, 400);
  }

  await fs.mkdir(trainingDataDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeFileName(originalName);
  const filePath = path.join(trainingDataDir, `${timestamp}_${safeName}`);

  await fs.writeFile(filePath, buffer);
  console.log(`[ML][train-sales-model] Файл сохранён: ${filePath}`);

  let trainingLogs: { stdout: string; stderr: string };
  try {
    trainingLogs = await runTraining(filePath);
  } catch (trainingError) {
    const stdout = (trainingError as any)?.stdout as string | undefined;
    const stderr = (trainingError as any)?.stderr as string | undefined;

    if (stdout) {
      console.log('[ML][train-sales-model] stdout:', stdout.trim());
    }

    if (stderr) {
      console.error('[ML][train-sales-model] stderr:', stderr.trim());
    }

    console.error('Training script error:', trainingError);
    throw new TrainingError(
      'Ошибка при обучении модели. Проверьте корректность данных и повторите попытку.',
    );
  }

  if (trainingLogs.stdout.trim().length > 0) {
    console.log('[ML][train-sales-model] stdout:', trainingLogs.stdout.trim());
  }
  if (trainingLogs.stderr.trim().length > 0) {
    console.warn('[ML][train-sales-model] stderr:', trainingLogs.stderr.trim());
  }

  try {
    const modelContent = await fs.readFile(salesModelPath, 'utf-8');
    JSON.parse(modelContent);
  } catch (modelError) {
    console.error('Model validation error:', modelError);
    throw new TrainingError('Модель не была обновлена. Проверьте логи обучения.');
  }

  clearSalesModelCache();

  return {
    message: 'Модель успешно обучена и сохранена.',
    filePath,
  };
}
