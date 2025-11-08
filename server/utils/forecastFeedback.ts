import type { Transaction, ForecastPrediction } from '@shared/schema';
import type { IStorage } from '../storage';
import { format, startOfDay, isBefore } from 'date-fns';

/**
 * Вычисляет метрики точности прогноза
 */
export function calculateForecastMetrics(
  predicted: number,
  actual: number,
): { mape: number; mae: number; rmse: number } {
  const mae = Math.abs(predicted - actual);
  const mape = actual !== 0 ? (mae / actual) * 100 : 0;
  const rmse = Math.sqrt(Math.pow(predicted - actual, 2));

  return {
    mape: Number.isFinite(mape) ? mape : 0,
    mae: Number.isFinite(mae) ? mae : 0,
    rmse: Number.isFinite(rmse) ? rmse : 0,
  };
}

/**
 * Сопоставляет прогнозы с реальными данными и обновляет метрики
 */
export async function matchForecastsWithActuals(
  storage: IStorage,
  uploadId: string,
  transactions: Transaction[],
): Promise<{ matched: number; updated: number; errors: number }> {
  try {
    // Получаем все прогнозы без реальных данных для этого uploadId
    const predictions = await storage.getForecastPredictionsByUploadId(uploadId);
    const predictionsWithoutActual = predictions.filter((p) => p.actualRevenue === null);

    if (predictionsWithoutActual.length === 0) {
      return { matched: 0, updated: 0, errors: 0 };
    }

    // Группируем транзакции по датам
    const dailyRevenue = new Map<string, number>();
    transactions.forEach((tx) => {
      const dateKey = format(startOfDay(new Date(tx.date)), 'yyyy-MM-dd');
      dailyRevenue.set(dateKey, (dailyRevenue.get(dateKey) || 0) + tx.amount);
    });

    const today = startOfDay(new Date());
    let matched = 0;
    let updated = 0;
    let errors = 0;

    // Обрабатываем каждый прогноз
    for (const prediction of predictionsWithoutActual) {
      try {
        const forecastDate = startOfDay(new Date(prediction.forecastDate));
        const actualDate = startOfDay(new Date(prediction.actualDate));

        // Пропускаем прогнозы на будущие даты
        if (isBefore(today, actualDate)) {
          continue;
        }

        // Ищем реальные данные для этой даты
        const dateKey = format(actualDate, 'yyyy-MM-dd');
        const actualRevenue = dailyRevenue.get(dateKey);

        if (actualRevenue !== undefined && prediction.predictedRevenue !== null) {
          // Вычисляем метрики
          const metrics = calculateForecastMetrics(prediction.predictedRevenue, actualRevenue);

          // Обновляем прогноз
          await storage.updateForecastPredictionWithActual(
            prediction.id,
            actualRevenue,
            metrics.mape,
            metrics.mae,
            metrics.rmse,
          );

          matched++;
          updated++;
        } else {
          matched++;
        }
      } catch (error) {
        console.error(`[ForecastFeedback] Ошибка при обработке прогноза ${prediction.id}:`, error);
        errors++;
      }
    }

    console.log(
      `[ForecastFeedback] Сопоставлено ${matched} прогнозов, обновлено ${updated}, ошибок: ${errors} для uploadId: ${uploadId}`,
    );

    return { matched, updated, errors };
  } catch (error) {
    console.error('[ForecastFeedback] Ошибка при сопоставлении прогнозов:', error);
    throw error;
  }
}

/**
 * Агрегирует метрики точности по моделям, дням недели и горизонтам
 */
export async function updateModelAccuracyMetrics(
  storage: IStorage,
  uploadId?: string,
): Promise<void> {
  try {
    // Получаем все прогнозы с реальными данными
    const allPredictions = uploadId
      ? await storage.getForecastPredictionsByUploadId(uploadId)
      : await storage.getAllForecastPredictions();

    // Фильтруем только прогнозы с реальными данными
    const predictionsWithActual = allPredictions.filter(
      (p) => p.actualRevenue !== null && p.mape !== null,
    );

    if (predictionsWithActual.length === 0) {
      console.log('[ForecastFeedback] Нет прогнозов с реальными данными для агрегации метрик');
      return;
    }

    // Группируем по модели, дню недели и горизонту
    const metricsMap = new Map<string, {
      modelName: string;
      dayOfWeek: number | null;
      horizon: number | null;
      mape: number[];
      mae: number[];
      rmse: number[];
    }>();

    predictionsWithActual.forEach((prediction) => {
      const key = `${prediction.modelName}_${prediction.dayOfWeek ?? 'null'}_${prediction.horizon ?? 'null'}`;
      
      if (!metricsMap.has(key)) {
        metricsMap.set(key, {
          modelName: prediction.modelName,
          dayOfWeek: prediction.dayOfWeek ?? null,
          horizon: prediction.horizon ?? null,
          mape: [],
          mae: [],
          rmse: [],
        });
      }

      const metric = metricsMap.get(key)!;
      if (prediction.mape !== null) metric.mape.push(prediction.mape);
      if (prediction.mae !== null) metric.mae.push(prediction.mae);
      if (prediction.rmse !== null) metric.rmse.push(prediction.rmse);
    });

    // Вычисляем средние метрики и сохраняем
    for (const metric of metricsMap.values()) {
      const avgMape = metric.mape.length > 0
        ? metric.mape.reduce((sum, val) => sum + val, 0) / metric.mape.length
        : 0;
      const avgMae = metric.mae.length > 0
        ? metric.mae.reduce((sum, val) => sum + val, 0) / metric.mae.length
        : 0;
      const avgRmse = metric.rmse.length > 0
        ? metric.rmse.reduce((sum, val) => sum + val, 0) / metric.rmse.length
        : 0;

      await storage.upsertModelAccuracyMetric({
        modelName: metric.modelName,
        dayOfWeek: metric.dayOfWeek,
        horizon: metric.horizon,
        mape: avgMape,
        mae: avgMae,
        rmse: avgRmse,
        sampleSize: metric.mape.length,
      });
    }

    console.log(`[ForecastFeedback] Обновлено ${metricsMap.size} метрик точности моделей`);
  } catch (error) {
    console.error('[ForecastFeedback] Ошибка при обновлении метрик точности:', error);
    throw error;
  }
}

