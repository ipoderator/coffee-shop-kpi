import type { Anomaly, ForecastData, PeriodData, RevenueForecast } from '@shared/schema';

/**
 * Интерфейс для метрик выручки с учетом ML и аномалий
 */
export interface MLAdjustedRevenueMetrics {
  maxRevenue: {
    actual: number;
    expected: number;
    date: string;
    isAnomaly: boolean;
    anomaly?: Anomaly;
    deviation: number;
  };
  minRevenue: {
    actual: number;
    expected: number;
    date: string;
    isAnomaly: boolean;
    anomaly?: Anomaly;
    deviation: number;
  };
  avgRevenue: {
    actual: number;
    expected: number;
    deviation: number;
    confidence?: number;
  };
}

/**
 * Интерфейс для метрик чеков с учетом ML
 */
export interface MLAdjustedChecksMetrics {
  totalChecks: number;
  avgCheck: {
    actual: number;
    expected: number;
    deviation: number;
  };
  maxCheck: {
    actual: number;
    expected: number;
    date: string;
  };
  minCheck: {
    actual: number;
    expected: number;
    date: string;
  };
  avgChecksPerPeriod: number;
}

/**
 * Фильтрует аномалии по типу и серьезности
 */
export function filterAnomalies(
  anomalies: Anomaly[] | undefined,
  options: {
    type?: Anomaly['type'];
    minSeverity?: Anomaly['severity'];
  } = {},
): Anomaly[] {
  if (!anomalies || anomalies.length === 0) {
    return [];
  }

  const severityOrder: Record<Anomaly['severity'], number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };

  return anomalies.filter((anomaly) => {
    if (options.type && anomaly.type !== options.type) {
      return false;
    }

    if (options.minSeverity) {
      const anomalySeverity = severityOrder[anomaly.severity];
      const minSeverity = severityOrder[options.minSeverity];
      if (anomalySeverity < minSeverity) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Получает ожидаемое значение выручки из ML-прогноза для конкретной даты
 */
export function getExpectedRevenueFromML(
  forecast: RevenueForecast | undefined,
  date: string,
): number | null {
  if (!forecast) {
    return null;
  }

  // Ищем в dailyForecast из extendedForecast или nextMonth
  const dailyForecast =
    forecast.extendedForecast?.dailyForecast || forecast.nextMonth?.dailyForecast || [];

  const forecastData = dailyForecast.find((f) => f.date === date);
  return forecastData ? forecastData.predictedRevenue : null;
}

/**
 * Получает ожидаемое значение выручки для исторических данных
 * Использует аномалии или статистические методы вместо прогнозов для будущих дат
 */
export function getExpectedRevenueForPeriod(
  forecast: RevenueForecast | undefined,
  periodData: PeriodData[],
  anomalies: Anomaly[] | undefined,
): Map<string, number> {
  const expectedMap = new Map<string, number>();

  // Создаем карту ожидаемых значений из аномалий
  const anomalyExpectedMap = new Map<string, number>();
  if (anomalies) {
    anomalies.forEach((anomaly) => {
      const date = anomaly.date.split('T')[0];
      anomalyExpectedMap.set(date, anomaly.expectedValue);
    });
  }

  // Рассчитываем статистические метрики из исторических данных
  const revenues = periodData.map((d) => d.revenue).filter((r) => r > 0);
  if (revenues.length === 0) {
    return expectedMap;
  }

  // Используем медиану как более устойчивую оценку
  const sortedRevenues = [...revenues].sort((a, b) => a - b);
  const median =
    sortedRevenues.length % 2 === 0
      ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
      : sortedRevenues[Math.floor(sortedRevenues.length / 2)];

  // Рассчитываем скользящее среднее (если достаточно данных)
  let movingAverage = median;
  if (revenues.length >= 3) {
    const recentRevenues = revenues.slice(-Math.min(7, revenues.length));
    movingAverage = recentRevenues.reduce((sum, r) => sum + r, 0) / recentRevenues.length;
  }

  // Используем среднее между медианой и скользящим средним
  const statisticalExpected = (median * 0.6 + movingAverage * 0.4);

  // Для каждого периода определяем ожидаемое значение
  periodData.forEach((period) => {
    const periodDate = period.period.split('T')[0];
    
    // Приоритет 1: ожидаемое значение из аномалии
    if (anomalyExpectedMap.has(periodDate)) {
      expectedMap.set(period.period, anomalyExpectedMap.get(periodDate)!);
    } else {
      // Приоритет 2: статистическое ожидаемое значение
      expectedMap.set(period.period, statisticalExpected);
    }
  });

  return expectedMap;
}

/**
 * Находит аномалию для конкретной даты
 */
export function findAnomalyForDate(anomalies: Anomaly[] | undefined, date: string): Anomaly | null {
  if (!anomalies || anomalies.length === 0) {
    return null;
  }

  // Нормализуем дату для сравнения (убираем время)
  const normalizedDate = date.split('T')[0];

  return (
    anomalies.find((anomaly) => {
      const anomalyDate = anomaly.date.split('T')[0];
      return anomalyDate === normalizedDate;
    }) || null
  );
}

/**
 * Рассчитывает метрики выручки с учетом ML и аномалий
 */
export function calculateMLAdjustedRevenueMetrics(
  periodData: PeriodData[],
  forecast: RevenueForecast | undefined,
  anomalies: Anomaly[] | undefined,
): MLAdjustedRevenueMetrics {
  if (periodData.length === 0) {
    return {
      maxRevenue: {
        actual: 0,
        expected: 0,
        date: '',
        isAnomaly: false,
        deviation: 0,
      },
      minRevenue: {
        actual: 0,
        expected: 0,
        date: '',
        isAnomaly: false,
        deviation: 0,
      },
      avgRevenue: {
        actual: 0,
        expected: 0,
        deviation: 0,
      },
    };
  }

  // Фильтруем аномалии типа revenue с высокой серьезностью
  const revenueAnomalies = filterAnomalies(anomalies, {
    type: 'revenue',
    minSeverity: 'high',
  });

  // Создаем Set дат с аномалиями для быстрого поиска
  const anomalyDates = new Set(
    revenueAnomalies.map((a) => {
      const date = a.date.split('T')[0];
      return date;
    }),
  );

  // Получаем ожидаемые значения для исторических данных
  const expectedMap = getExpectedRevenueForPeriod(forecast, periodData, anomalies);

  // Фильтруем данные, исключая аномалии для расчета max/min
  const filteredData = periodData.filter((d) => {
    const periodDate = d.period.split('T')[0];
    return !anomalyDates.has(periodDate);
  });

  // Если все данные были аномалиями, используем все данные
  const dataForMaxMin = filteredData.length > 0 ? filteredData : periodData;

  // Находим максимальную выручку
  const maxData = dataForMaxMin.reduce((max, current) =>
    current.revenue > max.revenue ? current : max,
  );
  const maxAnomaly = findAnomalyForDate(anomalies, maxData.period);
  // Используем ожидаемое значение из аномалии или статистическое
  const maxExpected = expectedMap.get(maxData.period) || maxData.revenue;

  // Находим минимальную выручку
  const minData = dataForMaxMin.reduce((min, current) =>
    current.revenue < min.revenue ? current : min,
  );
  const minAnomaly = findAnomalyForDate(anomalies, minData.period);
  // Используем ожидаемое значение из аномалии или статистическое
  const minExpected = expectedMap.get(minData.period) || minData.revenue;

  // Рассчитываем среднюю выручку
  const actualAvg =
    periodData.reduce((sum, d) => sum + d.revenue, 0) / periodData.length;

  // Рассчитываем ожидаемую среднюю из статистических данных
  // Используем медиану и скользящее среднее вместо прогнозов для будущих дат
  const revenues = periodData.map((d) => d.revenue).filter((r) => r > 0);
  let expectedAvg = actualAvg;
  
  if (revenues.length > 0) {
    // Медиана
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const median =
      sortedRevenues.length % 2 === 0
        ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
        : sortedRevenues[Math.floor(sortedRevenues.length / 2)];

    // Скользящее среднее последних периодов
    const recentCount = Math.min(7, revenues.length);
    const recentRevenues = revenues.slice(-recentCount);
    const movingAvg = recentRevenues.reduce((sum, r) => sum + r, 0) / recentRevenues.length;

    // Используем среднее между медианой и скользящим средним
    expectedAvg = median * 0.6 + movingAvg * 0.4;
  }

  // Если есть ожидаемые значения из аномалий, используем их среднее
  if (expectedMap.size > 0) {
    const expectedValues = Array.from(expectedMap.values());
    const avgFromAnomalies = expectedValues.reduce((sum, val) => sum + val, 0) / expectedValues.length;
    // Комбинируем статистическое и из аномалий
    expectedAvg = expectedAvg * 0.7 + avgFromAnomalies * 0.3;
  }

  const avgDeviation = expectedAvg > 0 ? ((actualAvg - expectedAvg) / expectedAvg) * 100 : 0;

  // Рассчитываем отклонения с ограничением для нереалистичных значений
  const maxDeviation = maxExpected > 0 
    ? Math.min(200, Math.max(-200, ((maxData.revenue - maxExpected) / maxExpected) * 100))
    : 0;
  const minDeviation = minExpected > 0 
    ? Math.min(200, Math.max(-200, ((minData.revenue - minExpected) / minExpected) * 100))
    : 0;
  const avgDeviationCapped = Math.min(200, Math.max(-200, avgDeviation));

  return {
    maxRevenue: {
      actual: maxData.revenue,
      expected: maxExpected,
      date: maxData.period,
      isAnomaly: maxAnomaly !== null,
      anomaly: maxAnomaly || undefined,
      deviation: maxDeviation,
    },
    minRevenue: {
      actual: minData.revenue,
      expected: minExpected,
      date: minData.period,
      isAnomaly: minAnomaly !== null,
      anomaly: minAnomaly || undefined,
      deviation: minDeviation,
    },
    avgRevenue: {
      actual: actualAvg,
      expected: expectedAvg,
      deviation: avgDeviationCapped,
      confidence: forecast?.extendedForecast?.averageConfidence || forecast?.nextMonth?.confidence,
    },
  };
}

/**
 * Рассчитывает метрики чеков с учетом ML
 */
export function calculateMLAdjustedChecksMetrics(
  periodData: PeriodData[],
  forecast: RevenueForecast | undefined,
): MLAdjustedChecksMetrics {
  if (periodData.length === 0) {
    return {
      totalChecks: 0,
      avgCheck: {
        actual: 0,
        expected: 0,
        deviation: 0,
      },
      maxCheck: {
        actual: 0,
        expected: 0,
        date: '',
      },
      minCheck: {
        actual: 0,
        expected: 0,
        date: '',
      },
      avgChecksPerPeriod: 0,
    };
  }

  const totalChecks = periodData.reduce((sum, d) => sum + d.checks, 0);
  const totalRevenue = periodData.reduce((sum, d) => sum + d.revenue, 0);
  const actualAvgCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;

  // Рассчитываем ожидаемый средний чек из исторических данных
  // Используем статистические методы вместо прогнозов для будущих дат
  let expectedAvgCheck = actualAvgCheck;
  
  const avgChecks = periodData.length > 0 ? totalChecks / periodData.length : 0;
  if (avgChecks > 0 && periodData.length > 0) {
    // Рассчитываем медиану средних чеков
    const avgChecksArray = periodData.map((d) => d.averageCheck).filter((c) => c > 0);
    if (avgChecksArray.length > 0) {
      const sorted = [...avgChecksArray].sort((a, b) => a - b);
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

      // Скользящее среднее последних периодов
      const recentCount = Math.min(7, avgChecksArray.length);
      const recent = avgChecksArray.slice(-recentCount);
      const movingAvg = recent.reduce((sum, c) => sum + c, 0) / recent.length;

      // Используем среднее между медианой и скользящим средним
      expectedAvgCheck = median * 0.6 + movingAvg * 0.4;
    }
  }

  const maxCheckData = periodData.reduce((max, current) =>
    current.averageCheck > max.averageCheck ? current : max,
  );

  const minCheckData = periodData.reduce((min, current) =>
    current.averageCheck < min.averageCheck ? current : min,
  );

  const avgChecksPerPeriod = totalChecks / periodData.length;

  // Рассчитываем отклонение с ограничением
  const checkDeviation = expectedAvgCheck > 0 
    ? Math.min(200, Math.max(-200, ((actualAvgCheck - expectedAvgCheck) / expectedAvgCheck) * 100))
    : 0;

  return {
    totalChecks,
    avgCheck: {
      actual: actualAvgCheck,
      expected: expectedAvgCheck,
      deviation: checkDeviation,
    },
    maxCheck: {
      actual: maxCheckData.averageCheck,
      expected: expectedAvgCheck, // Используем ожидаемый средний как базовое значение
      date: maxCheckData.period,
    },
    minCheck: {
      actual: minCheckData.averageCheck,
      expected: expectedAvgCheck,
      date: minCheckData.period,
    },
    avgChecksPerPeriod,
  };
}

/**
 * Определяет цвет индикатора на основе отклонения и серьезности аномалии
 */
export function getAnomalyIndicatorColor(
  deviation: number,
  isAnomaly: boolean,
  severity?: Anomaly['severity'],
): 'default' | 'warning' | 'destructive' {
  if (isAnomaly) {
    if (severity === 'critical' || severity === 'high') {
      return 'destructive';
    }
    return 'warning';
  }

  // Если отклонение больше 20% в любую сторону, это предупреждение
  if (Math.abs(deviation) > 20) {
    return 'warning';
  }

  return 'default';
}

/**
 * Форматирует отклонение для отображения
 * Ограничивает отображение нереалистичных отклонений
 */
export function formatDeviation(deviation: number): string {
  // Если отклонение слишком большое (больше 200%), это указывает на проблему с данными
  // В таком случае показываем более разумное значение или предупреждение
  const absDeviation = Math.abs(deviation);
  
  if (absDeviation > 200) {
    // Для очень больших отклонений показываем ограниченное значение
    const cappedDeviation = deviation > 0 ? 200 : -200;
    return `${cappedDeviation > 0 ? '+' : ''}${cappedDeviation.toFixed(0)}%+`;
  }
  
  const sign = deviation >= 0 ? '+' : '';
  return `${sign}${deviation.toFixed(1)}%`;
}

/**
 * Проверяет, является ли отклонение реалистичным
 */
export function isRealisticDeviation(deviation: number): boolean {
  return Math.abs(deviation) <= 200;
}

