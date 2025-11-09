import type { Transaction, ForecastPrediction, ModelAccuracyMetric } from '@shared/schema';
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
 * Валидирует метрики прогноза на предмет ошибок
 * @returns true если метрики валидны, false если есть подозрения на ошибки
 */
export function validateForecastMetrics(
  predicted: number,
  actual: number,
  mape: number | null,
  mae: number | null,
  rmse: number | null,
): { isValid: boolean; reason?: string } {
  // Проверка 1: actualRevenue не должен быть равен predictedRevenue (подозрение на использование прогноза как реальных данных)
  const relativeDiff = actual > 0 ? Math.abs(predicted - actual) / actual : Math.abs(predicted - actual);
  if (relativeDiff < 0.001) {
    return {
      isValid: false,
      reason: 'actualRevenue слишком близок к predictedRevenue (возможно, используется прогноз как реальные данные)',
    };
  }

  // Проверка 2: MAPE должен быть разумным (< 1000%)
  if (mape !== null && (mape < 0 || mape > 1000)) {
    return {
      isValid: false,
      reason: `MAPE вне разумных пределов: ${mape}%`,
    };
  }

  // Проверка 3: MAE должен быть положительным
  if (mae !== null && mae < 0) {
    return {
      isValid: false,
      reason: `MAE отрицательный: ${mae}`,
    };
  }

  // Проверка 4: RMSE должен быть положительным
  if (rmse !== null && rmse < 0) {
    return {
      isValid: false,
      reason: `RMSE отрицательный: ${rmse}`,
    };
  }

  // Проверка 5: actualRevenue должен быть положительным (реальные продажи не могут быть отрицательными)
  if (actual < 0) {
    return {
      isValid: false,
      reason: `actualRevenue отрицательный: ${actual}`,
    };
  }

  // Проверка 6: predictedRevenue должен быть неотрицательным
  if (predicted < 0) {
    return {
      isValid: false,
      reason: `predictedRevenue отрицательный: ${predicted}`,
    };
  }

  return { isValid: true };
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

          // Валидируем метрики перед сохранением
          const validation = validateForecastMetrics(
            prediction.predictedRevenue,
            actualRevenue,
            metrics.mape,
            metrics.mae,
            metrics.rmse,
          );

          if (!validation.isValid) {
            console.warn(
              `[ForecastFeedback] Пропущен некорректный прогноз ${prediction.id}: ${validation.reason}`,
            );
            matched++;
            errors++;
            continue;
          }

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

    // Вычисляем средние метрики и сохраняем (с фильтрацией аномалий)
    let skippedMetrics = 0;
    for (const metric of metricsMap.values()) {
      // Фильтруем аномальные значения (используем медиану вместо среднего для устойчивости)
      const validMape = metric.mape.filter((m) => m >= 0 && m <= 1000);
      const validMae = metric.mae.filter((m) => m >= 0);
      const validRmse = metric.rmse.filter((m) => m >= 0);

      if (validMape.length === 0 || validMae.length === 0 || validRmse.length === 0) {
        skippedMetrics++;
        continue;
      }

      // Используем медиану для устойчивости к выбросам
      const sortedMape = [...validMape].sort((a, b) => a - b);
      const sortedMae = [...validMae].sort((a, b) => a - b);
      const sortedRmse = [...validRmse].sort((a, b) => a - b);

      const medianMape = sortedMape[Math.floor(sortedMape.length / 2)];
      const medianMae = sortedMae[Math.floor(sortedMae.length / 2)];
      const medianRmse = sortedRmse[Math.floor(sortedRmse.length / 2)];

      // Требуем минимум 5 образцов для надежной метрики
      if (validMape.length < 5) {
        skippedMetrics++;
        continue;
      }

      await storage.upsertModelAccuracyMetric({
        modelName: metric.modelName,
        dayOfWeek: metric.dayOfWeek,
        horizon: metric.horizon,
        mape: medianMape,
        mae: medianMae,
        rmse: medianRmse,
        sampleSize: validMape.length,
      });
    }

    if (skippedMetrics > 0) {
      console.log(`[ForecastFeedback] Пропущено ${skippedMetrics} метрик из-за недостаточного размера выборки или аномалий`);
    }

    console.log(`[ForecastFeedback] Обновлено ${metricsMap.size} метрик точности моделей`);

    // Периодически очищаем аномальные метрики (каждое 10-е обновление)
    // Это можно сделать более умно, но для простоты делаем случайную проверку
    if (Math.random() < 0.1) {
      try {
        const removedCount = await cleanAnomalousMetrics(storage);
        if (removedCount > 0) {
          console.log(`[ForecastFeedback] Автоматически удалено ${removedCount} аномальных метрик`);
        }
      } catch (error) {
        console.warn('[ForecastFeedback] Ошибка при автоматической очистке метрик:', error);
      }
    }
  } catch (error) {
    console.error('[ForecastFeedback] Ошибка при обновлении метрик точности:', error);
    throw error;
  }
}

/**
 * Получает метрики точности модели из хранилища с валидацией
 * @param modelName - название модели (ARIMA, Prophet, LSTM, GRU, NHITS, LLM и т.д.)
 * @param storage - хранилище для получения метрик (опционально, если не передано, вернет пустой массив)
 * @param minSampleSize - минимальный размер выборки для использования метрики (по умолчанию 10)
 */
export async function getModelMetrics(
  modelName: string,
  storage?: IStorage,
  minSampleSize: number = 10,
): Promise<ModelAccuracyMetric[]> {
  try {
    if (!storage) {
      console.warn(`[ForecastFeedback] Storage недоступен для получения метрик модели ${modelName}`);
      return [];
    }

    const metrics = await storage.getModelAccuracyMetricsByModel(modelName);
    if (!metrics || metrics.length === 0) {
      return [];
    }

    // Фильтруем метрики: только валидные и с достаточным размером выборки
    const validMetrics = metrics.filter((m) => {
      // Проверка размера выборки
      if (m.sampleSize === null || m.sampleSize < minSampleSize) {
        return false;
      }

      // Проверка разумности MAPE (0-1000%)
      if (m.mape === null || m.mape < 0 || m.mape > 1000) {
        return false;
      }

      // Проверка разумности MAE и RMSE (неотрицательные)
      if (m.mae !== null && m.mae < 0) {
        return false;
      }
      if (m.rmse !== null && m.rmse < 0) {
        return false;
      }

      return true;
    });

    return validMetrics;
  } catch (error) {
    console.warn(`[ForecastFeedback] Ошибка при получении метрик модели ${modelName}:`, error);
    return [];
  }
}

/**
 * Очищает аномальные метрики из хранилища
 * @param storage - хранилище для очистки
 * @returns количество удаленных метрик
 */
export async function cleanAnomalousMetrics(storage: IStorage): Promise<number> {
  try {
    const allMetrics = await storage.getAllModelAccuracyMetrics();
    let removedCount = 0;

    for (const metric of allMetrics) {
      let shouldRemove = false;

      // Удаляем метрики с недостаточным размером выборки
      if (metric.sampleSize === null || metric.sampleSize < 5) {
        shouldRemove = true;
      }

      // Удаляем метрики с невалидным MAPE
      if (metric.mape === null || metric.mape < 0 || metric.mape > 1000) {
        shouldRemove = true;
      }

      // Удаляем метрики с отрицательными MAE или RMSE
      if (metric.mae !== null && metric.mae < 0) {
        shouldRemove = true;
      }
      if (metric.rmse !== null && metric.rmse < 0) {
        shouldRemove = true;
      }

      if (shouldRemove && metric.id) {
        try {
          await storage.deleteModelAccuracyMetric(metric.id);
          removedCount++;
        } catch (error) {
          console.warn(`[ForecastFeedback] Не удалось удалить метрику ${metric.id}:`, error);
        }
      }
    }

    console.log(`[ForecastFeedback] Удалено ${removedCount} аномальных метрик`);
    return removedCount;
  } catch (error) {
    console.error('[ForecastFeedback] Ошибка при очистке аномальных метрик:', error);
    throw error;
  }
}

