import path from 'node:path';
import type { Express } from 'express';
import multer from 'multer';
import { endOfDay, startOfDay, startOfMonth, startOfYear, subDays } from 'date-fns';
import { storage } from '../storage';
import { calculateAnalytics, forecastRevenueForTransactions } from '../utils/analytics';
import { parseExcelFile } from '../utils/fileParser';
import { requireAuthCookie } from '../utils/auth';
import {
  getTrainingFileFieldName,
  trainSalesModelFromExcel,
  TrainingError,
} from '../utils/training';
import type { Transaction } from '@shared/schema';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forecastUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const trainingUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

type DateFilterPreset = 'last7' | 'last28' | 'last90' | 'mtd' | 'ytd';

function isDateFilterPreset(value: string): value is DateFilterPreset {
  return (
    value === 'last7' ||
    value === 'last28' ||
    value === 'last90' ||
    value === 'mtd' ||
    value === 'ytd'
  );
}

function resolvePresetRange(
  preset: DateFilterPreset,
  datasetStart: Date,
  datasetEnd: Date,
): { from: Date; to: Date } {
  const clampedDatasetStart = startOfDay(datasetStart);
  const clampedDatasetEnd = endOfDay(datasetEnd);

  let rawFrom: Date;
  switch (preset) {
    case 'last7':
      rawFrom = startOfDay(subDays(clampedDatasetEnd, 6));
      break;
    case 'last28':
      rawFrom = startOfDay(subDays(clampedDatasetEnd, 27));
      break;
    case 'last90':
      rawFrom = startOfDay(subDays(clampedDatasetEnd, 89));
      break;
    case 'mtd':
      rawFrom = startOfDay(startOfMonth(clampedDatasetEnd));
      break;
    case 'ytd':
      rawFrom = startOfDay(startOfYear(clampedDatasetEnd));
      break;
    default:
      rawFrom = clampedDatasetStart;
      break;
  }

  const from = rawFrom.getTime() < clampedDatasetStart.getTime() ? clampedDatasetStart : rawFrom;

  return {
    from,
    to: clampedDatasetEnd,
  };
}

export function registerAnalyticsRoutes(app: Express): void {
  app.get('/api/analytics/:uploadId', async (req, res) => {
    try {
      const { uploadId } = req.params;

      if (!uuidRe.test(uploadId)) {
        return res.status(400).json({
          error: 'Неверный формат ID. Ожидается UUID.',
        });
      }

      const transactions = await storage.getTransactionsByUploadId(uploadId);

      if (transactions.length === 0) {
        return res.status(404).json({
          error: 'Данные не найдены. Пожалуйста, загрузите файл.',
        });
      }

      const sortedTransactions = [...transactions].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );

      const datasetStart = startOfDay(new Date(sortedTransactions[0].date));
      const datasetEnd = endOfDay(new Date(sortedTransactions[sortedTransactions.length - 1].date));

      const presetParamRaw = req.query.preset;
      const fromParamRaw = req.query.from;
      const toParamRaw = req.query.to;

      const presetParam = Array.isArray(presetParamRaw) ? presetParamRaw[0] : presetParamRaw;
      const fromParam = Array.isArray(fromParamRaw) ? fromParamRaw[0] : fromParamRaw;
      const toParam = Array.isArray(toParamRaw) ? toParamRaw[0] : toParamRaw;

      let filterFrom: Date | undefined;
      let filterTo: Date | undefined;
      let appliedPreset: DateFilterPreset | 'custom' | 'all' = 'all';

      if (typeof presetParam === 'string' && isDateFilterPreset(presetParam)) {
        appliedPreset = presetParam;
        const range = resolvePresetRange(presetParam, datasetStart, datasetEnd);
        filterFrom = range.from;
        filterTo = range.to;
      }

      const parseFromParam = () => {
        if (!fromParam || typeof fromParam !== 'string') {
          return undefined;
        }
        const parsed = startOfDay(new Date(fromParam));
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
      };

      const parseToParam = () => {
        if (!toParam || typeof toParam !== 'string') {
          return undefined;
        }
        const parsed = endOfDay(new Date(toParam));
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
      };

      if (presetParam === 'custom') {
        appliedPreset = 'custom';
        filterFrom = parseFromParam() ?? filterFrom;
        filterTo = parseToParam() ?? filterTo;
      }

      if (!filterFrom && !filterTo) {
        const parsedFrom = parseFromParam();
        const parsedTo = parseToParam();
        if (parsedFrom || parsedTo) {
          appliedPreset = 'custom';
          filterFrom = parsedFrom ?? filterFrom;
          filterTo = parsedTo ?? filterTo;
        }
      }

      if (filterFrom && filterTo && filterTo.getTime() < filterFrom.getTime()) {
        const temp = filterFrom;
        filterFrom = filterTo;
        filterTo = temp;
      }

      if (filterFrom && filterFrom.getTime() < datasetStart.getTime()) {
        filterFrom = datasetStart;
      }
      if (filterTo && filterTo.getTime() > datasetEnd.getTime()) {
        filterTo = datasetEnd;
      }

      const filteredTransactions =
        filterFrom || filterTo
          ? sortedTransactions.filter((transaction) => {
              const date = new Date(transaction.date);
              if (filterFrom && date.getTime() < filterFrom.getTime()) {
                return false;
              }
              if (filterTo && date.getTime() > filterTo.getTime()) {
                return false;
              }
              return true;
            })
          : sortedTransactions;

      const analytics = await calculateAnalytics(filteredTransactions);

      const period = {
        from: (filterFrom ?? datasetStart).toISOString(),
        to: (filterTo ?? datasetEnd).toISOString(),
        ...(appliedPreset !== 'all' ? { preset: appliedPreset } : {}),
      };

      res.json({
        ...analytics,
        period,
      });
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ошибка расчета аналитики',
      });
    }
  });

  app.post(
    '/api/ml/forecast-turnover',
    requireAuthCookie,
    forecastUpload.single('file'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: 'Файл не был загружен',
          });
        }

        const parseResult = await parseExcelFile(req.file.buffer);

        if (parseResult.rows.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Файл не содержит корректных данных',
          });
        }

        const transactions: Transaction[] = parseResult.rows.map((row, index) => {
          const date = row.date instanceof Date ? row.date : new Date(row.date);
          const year = row.year ?? date.getFullYear();
          const month = row.month ?? date.getMonth() + 1;

          return {
            id: `forecast-${index}`,
            date,
            year,
            month,
            amount: row.amount,
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
            uploadId: 'forecast',
          };
        });

        const predictions = forecastRevenueForTransactions(transactions);

        res.json({
          success: true,
          predictions,
        });
      } catch (error) {
        console.error('Forecast turnover error:', error);
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Ошибка расчета прогноза',
        });
      }
    },
  );

  app.post(
    '/api/ml/train-from-upload',
    requireAuthCookie,
    (req, res, next) => {
      trainingUpload.single(getTrainingFileFieldName())(req, res, (err) => {
        if (err) {
          console.error('Training upload error:', err);
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              success: false,
              message: 'Файл слишком большой. Максимальный размер — 15 МБ.',
            });
          }

          return res.status(400).json({
            success: false,
            message: 'Не удалось загрузить файл. Попробуйте ещё раз.',
          });
        }
        return next();
      });
    },
    async (req, res) => {
      const file = (req as typeof req & { file?: Express.Multer.File }).file;

      if (!file) {
        return res.status(400).json({
          success: false,
          message: 'Файл не был загружен.',
        });
      }

      const extension = path.extname(file.originalname).toLowerCase();
      if (!['.xlsx', '.xls'].includes(extension)) {
        return res.status(400).json({
          success: false,
          message: 'Неверный формат файла. Допустимы только .xlsx и .xls',
        });
      }

      try {
        const result = await trainSalesModelFromExcel(file.buffer, file.originalname);

        return res.json({
          success: true,
          message: result.message,
          modelUpdated: true,
        });
      } catch (error) {
        if (error instanceof TrainingError) {
          return res.status(error.status).json({
            success: false,
            message: error.message,
          });
        }

        console.error('train-from-upload error:', error);
        return res.status(500).json({
          success: false,
          message: 'Неожиданная ошибка при обработке файла.',
        });
      }
    },
  );
}
