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
import { analyticsCache } from '../utils/analyticsCache';
import type { Transaction } from '@shared/schema';
import { log } from '../vite';
import { matchForecastsWithActuals, updateModelAccuracyMetrics } from '../utils/forecastFeedback';

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
    const startTime = performance.now();
    const { uploadId } = req.params;
    
    try {
      if (!uuidRe.test(uploadId)) {
        return res.status(400).json({
          error: 'Неверный формат ID. Ожидается UUID.',
        });
      }

      const loadStartTime = performance.now();
      const transactions = await storage.getTransactionsByUploadId(uploadId);
      const loadTime = (performance.now() - loadStartTime).toFixed(2);

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

      // Проверяем параметр includeLLM (по умолчанию false для скорости)
      const includeLLMParamRaw = req.query.includeLLM;
      const includeLLM = includeLLMParamRaw === 'true' || includeLLMParamRaw === '1';

      // Проверяем кеш перед вычислением аналитики
      const baseCacheParams = {
        preset: appliedPreset !== 'all' ? appliedPreset : undefined,
        from: filterFrom?.toISOString(),
        to: filterTo?.toISOString(),
        includeLLM: false, // Базовая аналитика без LLM
      };
      
      const llmCacheParams = {
        ...baseCacheParams,
        includeLLM: true, // Аналитика с LLM
      };

      // Если запрошен LLM и он готов, возвращаем его
      if (includeLLM) {
        const llmAnalytics = analyticsCache.get(uploadId, llmCacheParams);
        const llmStatus = analyticsCache.getLLMStatus(uploadId, llmCacheParams);
        
        if (llmAnalytics && llmStatus?.status === 'completed') {
          const period = {
            from: (filterFrom ?? datasetStart).toISOString(),
            to: (filterTo ?? datasetEnd).toISOString(),
            ...(appliedPreset !== 'all' ? { preset: appliedPreset } : {}),
          };
          
          const totalTime = (performance.now() - startTime).toFixed(2);
          log(`📈 LLM аналитика из кеша для ${uploadId}: ${filteredTransactions.length} транзакций | Загрузка: ${loadTime}ms, Кеш: 0ms, Всего: ${totalTime}ms`, 'analytics');
          
          return res.json({
            ...llmAnalytics,
            period,
          });
        }
      }
      
      // Проверяем базовую аналитику (без LLM)
      let analytics = analyticsCache.get(uploadId, baseCacheParams);
      let calcTime = '0';
      
      if (!analytics) {
        // Вычисляем базовую аналитику (без LLM) для быстрого ответа
        const calcStartTime = performance.now();
        analytics = await calculateAnalytics(filteredTransactions, false, storage, uploadId);
        calcTime = (performance.now() - calcStartTime).toFixed(2);
        
        const period = {
          from: (filterFrom ?? datasetStart).toISOString(),
          to: (filterTo ?? datasetEnd).toISOString(),
          ...(appliedPreset !== 'all' ? { preset: appliedPreset } : {}),
        };

        // Сохраняем в кеш вместе с периодом
        const analyticsWithPeriod = {
          ...analytics,
          period,
        };
        
        analyticsCache.set(uploadId, baseCacheParams, analyticsWithPeriod);
        
        const totalTime = (performance.now() - startTime).toFixed(2);
        log(`📈 Аналитика рассчитана для ${uploadId}: ${filteredTransactions.length} транзакций | Загрузка: ${loadTime}ms, Расчет: ${calcTime}ms, Всего: ${totalTime}ms`, 'analytics');
        
        // Автоматически сопоставляем прогнозы с реальными данными в фоне
        setImmediate(async () => {
          try {
            await matchForecastsWithActuals(storage, uploadId, filteredTransactions);
            await updateModelAccuracyMetrics(storage, uploadId);
          } catch (error) {
            console.error('[Analytics] Ошибка при сопоставлении прогнозов:', error);
          }
        });
        
        res.json(analyticsWithPeriod);
      } else {
        // Используем данные из кеша, но обновляем период на основе текущих параметров
        const period = {
          from: (filterFrom ?? datasetStart).toISOString(),
          to: (filterTo ?? datasetEnd).toISOString(),
          ...(appliedPreset !== 'all' ? { preset: appliedPreset } : {}),
        };
        
        const totalTime = (performance.now() - startTime).toFixed(2);
        log(`📈 Аналитика из кеша для ${uploadId}: ${filteredTransactions.length} транзакций | Загрузка: ${loadTime}ms, Кеш: 0ms, Всего: ${totalTime}ms`, 'analytics');
        
        res.json({
          ...analytics,
          period,
        });
      }

      // Если запрошен LLM анализ, запускаем его асинхронно в фоне
      if (includeLLM) {
        const llmStatus = analyticsCache.getLLMStatus(uploadId, llmCacheParams);

        // Если LLM анализ еще не запущен или не завершен, запускаем его
        if (!llmStatus || (llmStatus.status !== 'completed' && llmStatus.status !== 'processing')) {
          // Создаем запись с базовыми данными и статусом "processing" для отслеживания
          const baseAnalytics = analyticsCache.get(uploadId, baseCacheParams);
          if (baseAnalytics) {
            // Сохраняем базовую аналитику с includeLLM: true и статусом "processing"
            // Это позволит отслеживать статус через getLLMStatus
            analyticsCache.set(uploadId, llmCacheParams, baseAnalytics);
            analyticsCache.updateLLMStatus(uploadId, 'processing', undefined, undefined, llmCacheParams);
          }

          // Запускаем LLM анализ в фоне
          setImmediate(async () => {
            const llmStartTime = performance.now();
            try {
              log(`🚀 Запуск LLM анализа для ${uploadId} (транзакций: ${filteredTransactions.length})`, 'analytics');
              
              // Проверяем наличие API ключа перед запуском
              // LLM всегда включен по умолчанию, если есть API ключ
              const hasApiKey = !!process.env.OPENAI_API_KEY;
              
              if (!hasApiKey) {
                log(`⚠️  LLM анализ пропущен: отсутствует OPENAI_API_KEY`, 'analytics');
                analyticsCache.updateLLMStatus(
                  uploadId,
                  'failed',
                  undefined,
                  'OpenAI API key not configured',
                  llmCacheParams
                );
                return;
              }
              
              const llmAnalytics = await calculateAnalytics(filteredTransactions, true, storage, uploadId);
              const llmDuration = performance.now() - llmStartTime;
              
              // Сохраняем LLM аналитику в кеш
              analyticsCache.set(uploadId, llmCacheParams, llmAnalytics);
              
              // Обновляем статус на "completed"
              analyticsCache.updateLLMStatus(uploadId, 'completed', llmAnalytics, undefined, llmCacheParams);
              
              log(`✅ LLM анализ завершен для ${uploadId} за ${llmDuration.toFixed(2)}ms`, 'analytics');
            } catch (error) {
              const llmDuration = performance.now() - llmStartTime;
              const errorMessage = error instanceof Error ? error.message : String(error);
              const errorStack = error instanceof Error ? error.stack : undefined;
              
              console.error(`❌ Ошибка LLM анализа для ${uploadId} (время: ${llmDuration.toFixed(2)}ms):`, errorMessage);
              if (errorStack) {
                console.error(`Стек ошибки:`, errorStack);
              }
              
              analyticsCache.updateLLMStatus(
                uploadId,
                'failed',
                undefined,
                error instanceof Error ? error.message : String(error),
                llmCacheParams
              );
            }
          });
        }
      }
    } catch (error) {
      const totalTime = (performance.now() - startTime).toFixed(2);
      console.error(`❌ Ошибка аналитики для ${uploadId} (время: ${totalTime}ms):`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ошибка расчета аналитики',
      });
    }
  });

  // Endpoint для проверки статуса LLM-анализа
  app.get('/api/analytics/:uploadId/llm-status', async (req, res) => {
    const { uploadId } = req.params;
    
    try {
      if (!uuidRe.test(uploadId)) {
        return res.status(400).json({
          error: 'Неверный формат ID. Ожидается UUID.',
        });
      }

      const transactions = await storage.getTransactionsByUploadId(uploadId);
      if (transactions.length === 0) {
        return res.status(404).json({
          error: 'Данные не найдены.',
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

      const cacheParams = {
        preset: appliedPreset !== 'all' ? appliedPreset : undefined,
        from: filterFrom?.toISOString(),
        to: filterTo?.toISOString(),
        includeLLM: true,
      };

      const llmStatus = analyticsCache.getLLMStatus(uploadId, cacheParams);

      if (!llmStatus) {
        return res.json({
          status: 'pending',
          message: 'LLM анализ еще не запущен',
        });
      }

      if (llmStatus.status === 'completed' && llmStatus.data) {
        const period = {
          from: (filterFrom ?? datasetStart).toISOString(),
          to: (filterTo ?? datasetEnd).toISOString(),
          ...(appliedPreset !== 'all' ? { preset: appliedPreset } : {}),
        };

        return res.json({
          status: 'completed',
          data: {
            ...llmStatus.data,
            period,
          },
        });
      }

      return res.json({
        status: llmStatus.status,
        error: llmStatus.error,
        message: llmStatus.status === 'processing' 
          ? 'LLM анализ выполняется...' 
          : llmStatus.status === 'failed'
          ? 'LLM анализ завершился с ошибкой'
          : 'LLM анализ в ожидании',
      });
    } catch (error) {
      console.error(`❌ Ошибка получения статуса LLM для ${uploadId}:`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ошибка получения статуса LLM',
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
