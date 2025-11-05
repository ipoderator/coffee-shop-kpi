import { Transaction, ForecastData, ProfitabilityRecord } from '@shared/schema';
import { addDays, format, getDay, startOfDay, endOfDay, subDays, isWeekend } from 'date-fns';
import {
  ExternalDataService,
  WeatherAPIResponse,
  EconomicIndicator,
  HolidayData,
  SocialSentiment,
} from './externalDataSources';
import { getEnhancedSalesDataForPeriod, type EnhancedSalesData } from './enhancedDataIntegration';

const isEnsembleDebugEnabled = process.env.DEBUG_ENSEMBLE === 'true';

function calculateHistoricalClamp(
  values: number[],
  fallback: number,
): { mean: number; median: number; std: number; clampLimit: number; clampMin: number } {
  const sanitized = values.filter((value) => Number.isFinite(value) && value > 0);
  const fallbackMean = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  
  // Используем медиану для более устойчивой оценки
  let median = fallbackMean;
  if (sanitized.length > 0) {
    const sorted = [...sanitized].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }
  
  const mean =
    sanitized.length > 0
      ? sanitized.reduce((sum, value) => sum + value, 0) / sanitized.length
      : fallbackMean;
  
  // Используем медиану как более надежную базовую оценку
  const effectiveMean = median > 0 ? median : mean;
  const finalBase = effectiveMean > 0 ? effectiveMean : fallbackMean;

  let variance = 0;
  if (sanitized.length > 1) {
    variance =
      sanitized.reduce((sum, value) => sum + Math.pow(value - finalBase, 2), 0) /
      sanitized.length;
  } else {
    variance = Math.pow(finalBase * 0.15, 2);
  }

  const std = Math.sqrt(Math.max(variance, 0));
  const safeStd = std > 1e-6 ? std : finalBase * 0.15;
  
  // Более консервативные ограничения: максимум 1.5x от медианы или среднее + 2*std
  const maxFromMedian = finalBase * 1.5;
  const maxFromStd = finalBase + 2 * safeStd;
  const clampLimit = Math.min(maxFromMedian, maxFromStd);
  
  // Минимальное ограничение: 0.5x от медианы
  const clampMin = Math.max(0, finalBase * 0.5);

  return {
    mean: finalBase,
    median,
    std: safeStd,
    clampLimit: Number.isFinite(clampLimit) && clampLimit > 0 ? clampLimit : finalBase * 1.5,
    clampMin: Number.isFinite(clampMin) && clampMin >= 0 ? clampMin : 0,
  };
}

function formatDebugNumber(value: number, fractionDigits = 2): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : 'NaN';
}

interface EnsembleDebugEntry {
  normalizedWeights: number[];
  rawWeights: number[];
  contributions: number[];
  prediction: number;
}

// Расширенные интерфейсы для ML моделей
interface EnhancedTimeSeriesData {
  date: string;
  revenue: number;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  quarter: number;
  year: number;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayType?: string;
  holidayImpact: number;

  // Погодные данные
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  cloudCover: number;
  uvIndex: number;
  visibility: number;

  // Экономические данные
  exchangeRate: number;
  inflation: number;
  consumerConfidence: number;
  unemploymentRate: number;

  // Социальные данные
  socialSentiment: number;
  socialVolume: number;

  // Временные признаки
  hourOfDay: number;
  weekOfYear: number;
  dayOfYear: number;

  // Технические индикаторы
  movingAverage7: number;
  movingAverage14: number;
  movingAverage30: number;
  volatility: number;
  trend: number;

  // Сезонные признаки
  isSpring: boolean;
  isSummer: boolean;
  isAutumn: boolean;
  isWinter: boolean;

  // Бизнес-признаки
  isMonthStart: boolean;
  isMonthEnd: boolean;
  isQuarterStart: boolean;
  isQuarterEnd: boolean;
  isYearStart: boolean;
  isYearEnd: boolean;

  // Новые признаки из Z-отчетов (profitability data)
  checksCount?: number;
  averageCheck?: number;
  returns?: number;
  corrections?: number;
  returnRate?: number;
  cogsTotal?: number;
  grossProfit?: number;
  grossMargin?: number;
  dataQuality?: number; // Качество данных (0-1)
  hasProfitabilityData?: boolean; // Есть ли данные из Z-отчетов
}

interface AdvancedModel {
  name: string;
  weight: number;
  predict: (
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ) => number[];
}

interface ModelEnsemble {
  models: AdvancedModel[];
  metaModel: (predictions: number[][]) => number[];
}

/**
 * Продвинутый ML движок с интеграцией внешних данных и Z-отчетов
 */
export class EnhancedMLForecastingEngine {
  private transactions: Transaction[];
  private profitabilityRecords?: ProfitabilityRecord[];
  private externalDataService?: ExternalDataService;
  private timeSeriesData: EnhancedTimeSeriesData[] = [];
  private modelEnsemble: ModelEnsemble;
  private lastAdaptiveDiagnostics: EnsembleDebugEntry[] = [];
  private enhancedSalesData?: EnhancedSalesData[];

  constructor(
    transactions: Transaction[],
    externalDataService?: ExternalDataService,
    profitabilityRecords?: ProfitabilityRecord[],
  ) {
    this.transactions = transactions;
    this.profitabilityRecords = profitabilityRecords;
    this.externalDataService = externalDataService;
    this.modelEnsemble = this.initializeModelEnsemble();
  }

  // Инициализация ансамбля моделей
  private initializeModelEnsemble(): ModelEnsemble {
    return {
      models: [
        {
          name: 'ARIMA',
          weight: 0.2,
          predict: this.arimaPredict.bind(this),
        },
        {
          name: 'Prophet',
          weight: 0.25,
          predict: this.prophetPredict.bind(this),
        },
        {
          name: 'LSTM',
          weight: 0.2,
          predict: this.lstmPredict.bind(this),
        },
        {
          name: 'RandomForest',
          weight: 0.15,
          predict: this.randomForestPredict.bind(this),
        },
        {
          name: 'XGBoost',
          weight: 0.15,
          predict: this.xgboostPredict.bind(this),
        },
        {
          name: 'GradientBoosting',
          weight: 0.05,
          predict: this.gradientBoostingPredict.bind(this),
        },
      ],
      metaModel: this.adaptiveEnsemble.bind(this),
    };
  }

  // Подготовка расширенных данных временных рядов
  private async prepareEnhancedTimeSeriesData(): Promise<EnhancedTimeSeriesData[]> {
    // Используем объединенные данные из enhancedDataIntegration если есть profitability records
    if (this.profitabilityRecords && this.profitabilityRecords.length > 0) {
      this.enhancedSalesData = await getEnhancedSalesDataForPeriod(
        this.transactions,
        this.profitabilityRecords,
      );
    }

    const dailyData = new Map<
      string,
      { revenue: number; count: number; transactions: Transaction[] }
    >();

    // Группируем транзакции по дням (для совместимости)
    this.transactions.forEach((tx) => {
      const date = format(new Date(tx.date), 'yyyy-MM-dd');
      if (!dailyData.has(date)) {
        dailyData.set(date, { revenue: 0, count: 0, transactions: [] });
      }
      const data = dailyData.get(date)!;
      data.revenue += tx.amount;
      data.count++;
      data.transactions.push(tx);
    });

    const timeSeriesData: EnhancedTimeSeriesData[] = [];
    // Используем enhanced sales data если доступны, иначе используем обычные данные
    const sortedDates = this.enhancedSalesData
      ? this.enhancedSalesData.map((d) => d.date).sort()
      : Array.from(dailyData.keys()).sort();

    // Получаем внешние данные для всех дат (Липецк, Россия)
    let externalData: any = {};
    if (this.externalDataService) {
      try {
        externalData = await this.externalDataService.getAllExternalData({
          lat: 52.6102, // Липецк, Россия
          lon: 39.5947,
          name: 'Lipetsk',
        });
      } catch (error) {
        console.warn('Failed to fetch external data:', error);
      }
    }

    for (let i = 0; i < sortedDates.length; i++) {
      const date = sortedDates[i];
      
      // Используем enhanced sales data если доступны, иначе обычные данные
      const enhancedDataPoint = this.enhancedSalesData?.find((d) => d.date === date);
      const dailyDataPoint = dailyData.get(date);
      
      // Определяем базовые значения
      const revenue = enhancedDataPoint?.revenue ?? dailyDataPoint?.revenue ?? 0;
      const checksCount = enhancedDataPoint?.checksCount ?? dailyDataPoint?.count ?? 0;
      
      const dateObj = new Date(date);

      // Базовые временные признаки
      const dayOfWeek = getDay(dateObj);
      const dayOfMonth = dateObj.getDate();
      const month = dateObj.getMonth();
      const quarter = Math.floor(month / 3) + 1;
      const year = dateObj.getFullYear();
      const weekOfYear = this.getWeekOfYear(dateObj);
      const dayOfYear = this.getDayOfYear(dateObj);

      // Сезонные признаки
      const isSpring = month >= 2 && month <= 4;
      const isSummer = month >= 5 && month <= 7;
      const isAutumn = month >= 8 && month <= 10;
      const isWinter = month === 11 || month === 0 || month === 1;

      // Бизнес-признаки
      const isMonthStart = dayOfMonth <= 3;
      const isMonthEnd = dayOfMonth >= 28;
      const isQuarterStart =
        dayOfMonth <= 3 && (month === 0 || month === 3 || month === 6 || month === 9);
      const isQuarterEnd =
        dayOfMonth >= 28 && (month === 2 || month === 5 || month === 8 || month === 11);
      const isYearStart = month === 0 && dayOfMonth <= 3;
      const isYearEnd = month === 11 && dayOfMonth >= 28;

      // Праздничные данные
      const holiday = this.findHoliday(date, externalData.holidays || []);
      const isHoliday = !!holiday;
      const holidayType = holiday?.type || 'none';
      const holidayImpact = holiday?.impact || 0;

      // Погодные данные
      const weather = this.findWeatherData(date, externalData.weather);
      const temperature = weather?.temperature || 15;
      const precipitation = weather?.precipitation || 0;
      const humidity = weather?.humidity || 60;
      const windSpeed = weather?.windSpeed || 5;
      const cloudCover = weather?.cloudCover || 30;
      const uvIndex = weather?.uvIndex || 3;
      const visibility = weather?.visibility || 10;

      // Экономические данные
      const economic = externalData.economic || {};
      const exchangeRate = economic.exchangeRate || 95.5;
      const inflation = economic.inflation || 4.5;
      const consumerConfidence = economic.consumerConfidence || 0.2;
      const unemploymentRate = economic.unemploymentRate || 3.2;

      // Социальные данные
      const sentiment = this.findSocialSentiment(date, externalData.sentiment || []);
      const socialSentiment = sentiment?.sentiment || 0;
      const socialVolume = sentiment?.volume || 0;

      // Технические индикаторы
      const movingAverage7 = this.calculateMovingAverage(timeSeriesData, 7, 'revenue');
      const movingAverage14 = this.calculateMovingAverage(timeSeriesData, 14, 'revenue');
      const movingAverage30 = this.calculateMovingAverage(timeSeriesData, 30, 'revenue');
      const volatility = this.calculateVolatility(timeSeriesData, 7);
      const trend = this.calculateTrend(timeSeriesData, 7);

      const enhancedData: EnhancedTimeSeriesData = {
        date,
        revenue,
        dayOfWeek,
        dayOfMonth,
        month,
        quarter,
        year,
        isWeekend: isWeekend(dateObj),
        isHoliday,
        holidayType,
        holidayImpact,
        temperature,
        precipitation,
        humidity,
        windSpeed,
        cloudCover,
        uvIndex,
        visibility,
        exchangeRate,
        inflation,
        consumerConfidence,
        unemploymentRate,
        socialSentiment,
        socialVolume,
        hourOfDay: 12, // Средний час дня
        weekOfYear,
        dayOfYear,
        movingAverage7,
        movingAverage14,
        movingAverage30,
        volatility,
        trend,
        isSpring,
        isSummer,
        isAutumn,
        isWinter,
        isMonthStart,
        isMonthEnd,
        isQuarterStart,
        isQuarterEnd,
        isYearStart,
        isYearEnd,
        // Новые признаки из Z-отчетов
        checksCount: enhancedDataPoint?.checksCount,
        averageCheck: enhancedDataPoint?.averageCheck,
        returns: enhancedDataPoint?.returns,
        corrections: enhancedDataPoint?.corrections,
        returnRate: enhancedDataPoint?.returnRate,
        cogsTotal: enhancedDataPoint?.cogsTotal,
        grossProfit: enhancedDataPoint?.grossProfit,
        grossMargin: enhancedDataPoint?.grossMargin,
        dataQuality: enhancedDataPoint?.dataQuality,
        hasProfitabilityData: enhancedDataPoint?.hasProfitabilityData ?? false,
      };

      timeSeriesData.push(enhancedData);
    }

    this.timeSeriesData = timeSeriesData;
    return timeSeriesData;
  }

  // ARIMA модель с улучшенными параметрами и более стабильными прогнозами
  private arimaPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 14) {
      // Для малых датасетов используем более простой подход
      const lastRevenue = data[data.length - 1]?.revenue || 0;
      const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      const basePrediction = (lastRevenue + avgRevenue) / 2;
      return futureData.map(() => basePrediction);
    }

    const revenues = data.map((d) => d.revenue);
    const n = revenues.length;
    
    // Используем медиану для более устойчивой оценки
    const sorted = [...revenues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    // Автоматический выбор порядка ARIMA
    const arimaOrder = this.selectARIMAOrder(revenues);
    const { ar, ma, diff } = arimaOrder;

    // Применяем дифференцирование
    const diffRevenues = this.difference(revenues, diff);

    // Обучаем модель
    const arCoeffs = this.fitAR(diffRevenues, ar);
    const maCoeffs = this.fitMA(diffRevenues, ma);

    // Прогнозируем с ограничениями
    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const prediction = this.predictARIMA(diffRevenues, arCoeffs, maCoeffs, i + 1);
      const undiffPrediction = this.undifference(revenues, prediction, diff);
      
      // Ограничиваем прогноз: не более 1.5x от медианы и не менее 0.5x
      const clampedPrediction = Math.max(
        median * 0.5,
        Math.min(median * 1.5, undiffPrediction),
      );
      
      predictions.push(Math.max(0, clampedPrediction));
    }

    return predictions;
  }

  // Prophet-подобная модель с сезонностью и улучшенной стабильностью
  private prophetPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 7) {
      const lastRevenue = data[data.length - 1]?.revenue || 0;
      const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      const basePrediction = (lastRevenue + avgRevenue) / 2;
      return futureData.map(() => basePrediction);
    }

    // Используем медиану для более устойчивой базовой оценки
    const revenues = data.map((d) => d.revenue);
    const sorted = [...revenues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
    const baseRevenue = median * 0.7 + avgRevenue * 0.3; // Используем медиану как основу

    // Анализируем тренд (с ограничениями)
    const trend = this.calculateTrend(data, data.length);
    const limitedTrend = Math.max(-median * 0.1, Math.min(median * 0.1, trend)); // Ограничиваем тренд

    // Анализируем сезонность
    const weeklySeasonality = this.calculateWeeklySeasonality(data);
    const monthlySeasonality = this.calculateMonthlySeasonality(data);
    const yearlySeasonality = this.calculateYearlySeasonality(data);

    // Анализируем праздничные эффекты
    const holidayEffects = this.calculateHolidayEffects(data);

    // Анализируем погодные эффекты
    const weatherEffects = this.calculateWeatherEffects(data);

    const predictions: number[] = [];

    for (let i = 0; i < futureData.length; i++) {
      const future = futureData[i];
      if (!future) continue;

      let prediction = baseRevenue;

      // Тренд (с затуханием для дальних прогнозов)
      const trendDecay = Math.exp(-i * 0.1);
      prediction += limitedTrend * (i + 1) * trendDecay;

      // Сезонность (с ограничениями)
      let seasonalMultiplier = 1;
      if (future.dayOfWeek !== undefined) {
        seasonalMultiplier *= Math.max(0.8, Math.min(1.2, weeklySeasonality[future.dayOfWeek] || 1));
      }
      if (future.month !== undefined) {
        seasonalMultiplier *= Math.max(0.9, Math.min(1.1, monthlySeasonality[future.month] || 1));
      }
      if (future.quarter !== undefined) {
        seasonalMultiplier *= Math.max(0.95, Math.min(1.05, yearlySeasonality[future.quarter] || 1));
      }
      prediction *= seasonalMultiplier;

      // Праздники (с ограничениями)
      if (future.isHoliday && future.holidayImpact !== undefined) {
        // holidayImpact уже в формате относительного изменения (0.1 = +10%)
        const holidayMult = Math.max(0.8, Math.min(1.3, 1 + (future.holidayImpact || 0)));
        prediction *= holidayMult;
      } else if (future.isHoliday) {
        // Если нет конкретного impact, используем среднее влияние праздников
        const holidayMult = holidayEffects.get('holiday') || 0;
        prediction *= Math.max(0.9, Math.min(1.2, 1 + holidayMult));
      }

      // Погода (с ограничениями)
      if (future.temperature !== undefined) {
        const weatherMult = this.getWeatherMultiplier(future.temperature, future.precipitation || 0);
        prediction *= Math.max(0.85, Math.min(1.15, weatherMult));
        
        // Дополнительно учитываем исторические погодные эффекты
        if (weatherEffects.has('cold') && future.temperature < 5) {
          const coldEffect = weatherEffects.get('cold') || 0;
          prediction *= Math.max(0.9, Math.min(1.1, 1 + coldEffect));
        }
        if (weatherEffects.has('hot') && future.temperature > 25) {
          const hotEffect = weatherEffects.get('hot') || 0;
          prediction *= Math.max(0.9, Math.min(1.1, 1 + hotEffect));
        }
      }

      // Ограничиваем итоговый прогноз
      const clampedPrediction = Math.max(
        median * 0.6,
        Math.min(median * 1.4, prediction),
      );

      predictions.push(Math.max(0, clampedPrediction));
    }

    return predictions;
  }

  // LSTM-подобная модель
  private lstmPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const sequenceLength = Math.min(14, data.length);
    const features = this.extractLSTMFeatures(data);

    // Простая LSTM-подобная модель
    const lstmWeights = this.trainLSTM(features, sequenceLength);

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const prediction = this.predictLSTM(features, lstmWeights, i + 1);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // Random Forest модель
  private randomForestPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map((d) => d.revenue);

    // Обучаем Random Forest
    const trees = this.trainRandomForest(features, targets, 100);

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictRandomForest(trees, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // XGBoost-подобная модель
  private xgboostPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map((d) => d.revenue);

    // Обучаем XGBoost
    const model = this.trainXGBoost(features, targets);

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictXGBoost(model, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // Адаптивный ансамбль с динамическими весами
  private adaptiveEnsemble(predictions: number[][]): number[] {
    const result: number[] = [];
    const numPredictions = predictions[0]?.length ?? 0;
    this.lastAdaptiveDiagnostics = [];

    // Рассчитываем точность каждой модели на исторических данных
    const modelAccuracy = this.calculateModelAccuracy(predictions);

    for (let i = 0; i < numPredictions; i++) {
      const stepRawWeights: number[] = [];
      let weightedSum = 0;
      let totalWeight = 0;

      for (let j = 0; j < predictions.length; j++) {
        // Адаптивные веса на основе точности и базовых весов
        const baseWeight = this.modelEnsemble.models[j].weight;
        const accuracyWeight = modelAccuracy[j] ?? 0.5;
        const adaptiveWeight = baseWeight * 0.7 + accuracyWeight * 0.3;

        stepRawWeights.push(adaptiveWeight);
        weightedSum += (predictions[j]?.[i] ?? 0) * adaptiveWeight;
        totalWeight += adaptiveWeight;
      }

      const normalizedWeights =
        totalWeight > 0 && stepRawWeights.length > 0
          ? stepRawWeights.map((weight) => weight / totalWeight)
          : stepRawWeights.length > 0
            ? stepRawWeights.map(() => 1 / stepRawWeights.length)
            : [];
      const contributions = normalizedWeights.map(
        (weight, idx) => weight * (predictions[idx]?.[i] ?? 0),
      );
      const prediction = totalWeight > 0 ? weightedSum / totalWeight : 0;

      this.lastAdaptiveDiagnostics.push({
        normalizedWeights,
        rawWeights: stepRawWeights,
        contributions,
        prediction,
      });

      result.push(prediction);
    }

    return result;
  }

  // Расчет точности моделей на исторических данных с кросс-валидацией
  private calculateModelAccuracy(predictions: number[][]): number[] {
    const accuracies: number[] = [];

    // Если есть исторические данные, используем кросс-валидацию
    if (this.timeSeriesData.length >= 14) {
      const historicalAccuracy = this.calculateHistoricalModelAccuracy();
      if (historicalAccuracy.length > 0) {
        // Комбинируем историческую точность (70%) со стабильностью прогнозов (30%)
        for (let i = 0; i < predictions.length; i++) {
          const modelPredictions = predictions[i];
          const variance = this.calculateVariance(modelPredictions);
          const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
          const stability = Math.max(0, 1 - variance / (mean + 1));
          
          const historicalAcc = historicalAccuracy[i] ?? 0.5;
          const combinedAccuracy = historicalAcc * 0.7 + stability * 0.3;
          accuracies.push(Math.max(0, Math.min(1, combinedAccuracy)));
        }
        return accuracies;
      }
    }

    // Fallback: оценка стабильности прогнозов
    for (let i = 0; i < predictions.length; i++) {
      const modelPredictions = predictions[i];
      const variance = this.calculateVariance(modelPredictions);
      const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
      const stability = Math.max(0, 1 - variance / (mean + 1));
      accuracies.push(stability);
    }

    return accuracies;
  }

  // Кросс-валидация на исторических данных для оценки точности моделей
  private calculateHistoricalModelAccuracy(): number[] {
    if (this.timeSeriesData.length < 14) {
      return [];
    }

    const accuracies: number[] = [];
    const dataLength = this.timeSeriesData.length;
    
    // Используем последние 30% данных для валидации (если есть достаточно данных)
    const validationStart = Math.max(7, Math.floor(dataLength * 0.7));
    const validationData = this.timeSeriesData.slice(validationStart);
    const trainingData = this.timeSeriesData.slice(0, validationStart);

    if (trainingData.length < 7 || validationData.length < 3) {
      return [];
    }

    // Для каждой модели делаем прогноз на валидационных данных
    for (const model of this.modelEnsemble.models) {
      const predictions: number[] = [];
      const actuals: number[] = [];

      // Делаем прогнозы на валидационных данных
      for (let i = 0; i < Math.min(7, validationData.length); i++) {
        const futureDataPoint: Partial<EnhancedTimeSeriesData> = {
          date: validationData[i].date,
          dayOfWeek: validationData[i].dayOfWeek,
          dayOfMonth: validationData[i].dayOfMonth,
          month: validationData[i].month,
          quarter: validationData[i].quarter,
          year: validationData[i].year,
          isWeekend: validationData[i].isWeekend,
          isHoliday: validationData[i].isHoliday,
          holidayType: validationData[i].holidayType,
          holidayImpact: validationData[i].holidayImpact,
          temperature: validationData[i].temperature,
          precipitation: validationData[i].precipitation,
          humidity: validationData[i].humidity,
          windSpeed: validationData[i].windSpeed,
          cloudCover: validationData[i].cloudCover,
          uvIndex: validationData[i].uvIndex,
          visibility: validationData[i].visibility,
          exchangeRate: validationData[i].exchangeRate,
          inflation: validationData[i].inflation,
          consumerConfidence: validationData[i].consumerConfidence,
          unemploymentRate: validationData[i].unemploymentRate,
          socialSentiment: validationData[i].socialSentiment,
          socialVolume: validationData[i].socialVolume,
        };

        // Обучаем на данных до этой точки
        const trainingSlice = trainingData.concat(validationData.slice(0, i));
        const futureData = [futureDataPoint];
        const modelPredictions = model.predict(trainingSlice, futureData);
        
        if (modelPredictions.length > 0 && modelPredictions[0] !== undefined) {
          predictions.push(modelPredictions[0]);
          actuals.push(validationData[i].revenue);
        }
      }

      // Рассчитываем точность (MAPE - Mean Absolute Percentage Error)
      if (predictions.length > 0 && actuals.length > 0) {
        let totalError = 0;
        let validPoints = 0;

        for (let j = 0; j < predictions.length; j++) {
          const actual = actuals[j];
          const predicted = predictions[j];
          
          if (actual > 0 && Number.isFinite(predicted) && predicted >= 0) {
            const error = Math.abs((actual - predicted) / actual);
            totalError += error;
            validPoints++;
          }
        }

        if (validPoints > 0) {
          const mape = totalError / validPoints;
          // Преобразуем MAPE в точность (чем меньше MAPE, тем выше точность)
          // MAPE 0.1 (10% ошибка) = 0.9 точность
          const accuracy = Math.max(0, Math.min(1, 1 - mape));
          accuracies.push(accuracy);
        } else {
          accuracies.push(0.5); // Fallback
        }
      } else {
        accuracies.push(0.5); // Fallback
      }
    }

    return accuracies;
  }

  // Расчет дисперсии
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  // Основной метод прогнозирования
  public async generateEnhancedForecast(days: number = 7): Promise<ForecastData[]> {
    const timeSeriesData = await this.prepareEnhancedTimeSeriesData();

    if (timeSeriesData.length < 7) {
      return this.generateFallbackForecast(days);
    }

    // Улучшенное обучение на новых данных
    this.retrainModelsOnNewData(timeSeriesData);

    // Анализ аномалий в новых данных
    const anomalies = this.detectAnomalies(timeSeriesData);
    if (anomalies.length > 0) {
      console.log(`Обнаружено ${anomalies.length} аномалий в данных`);
      this.adjustForAnomalies(timeSeriesData, anomalies);
    }

    // Подготавливаем данные для прогнозирования
    const futureData: Partial<EnhancedTimeSeriesData>[] = [];
    const lastDate = new Date(timeSeriesData[timeSeriesData.length - 1].date);

    // Получаем внешние данные для будущих дат (Липецк, Россия)
    let futureExternalData: any = {};
    if (this.externalDataService) {
      try {
        futureExternalData = await this.externalDataService.getEnhancedForecastData(
          {
            lat: 52.6102, // Липецк, Россия
            lon: 39.5947,
            name: 'Lipetsk',
          },
          days,
        );
      } catch (error) {
        console.warn('Failed to fetch future external data:', error);
      }
    }

    for (let i = 1; i <= days; i++) {
      const forecastDate = addDays(lastDate, i);
      const dayOfWeek = getDay(forecastDate);
      const dayOfMonth = forecastDate.getDate();
      const month = forecastDate.getMonth();
      const quarter = Math.floor(month / 3) + 1;
      const year = forecastDate.getFullYear();

      // Праздничные данные
      const holiday = this.findHoliday(
        format(forecastDate, 'yyyy-MM-dd'),
        futureExternalData.holidays || [],
      );

      // Погодные данные
      const weather = this.findWeatherData(
        format(forecastDate, 'yyyy-MM-dd'),
        futureExternalData.weather || [],
      );

      futureData.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        dayOfWeek,
        dayOfMonth,
        month,
        quarter,
        year,
        isWeekend: isWeekend(forecastDate),
        isHoliday: !!holiday,
        holidayType: holiday?.type,
        holidayImpact: holiday?.impact || 0,
        temperature: weather?.temperature || 15,
        precipitation: weather?.precipitation || 0,
        humidity: weather?.humidity || 60,
        windSpeed: weather?.windSpeed || 5,
        cloudCover: weather?.cloudCover || 30,
        uvIndex: weather?.uvIndex || 3,
        visibility: weather?.visibility || 10,
        exchangeRate: futureExternalData.economic?.exchangeRate || 95.5,
        inflation: futureExternalData.economic?.inflation || 4.5,
        consumerConfidence: futureExternalData.economic?.consumerConfidence || 0.2,
        unemploymentRate: futureExternalData.economic?.unemploymentRate || 3.2,
        socialSentiment:
          this.findSocialSentiment(
            format(forecastDate, 'yyyy-MM-dd'),
            futureExternalData.sentiment || [],
          )?.sentiment || 0,
        socialVolume:
          this.findSocialSentiment(
            format(forecastDate, 'yyyy-MM-dd'),
            futureExternalData.sentiment || [],
          )?.volume || 0,
      });
    }

    // Получаем прогнозы от всех моделей
    const rawModelPredictions = this.modelEnsemble.models.map((model) =>
      model.predict(timeSeriesData, futureData),
    );

    const revenueHistory = timeSeriesData.map((d) => d.revenue);
    
    // Используем медиану для более устойчивой оценки, особенно для малых датасетов
    let medianRevenue = 0;
    if (revenueHistory.length > 0) {
      const sorted = [...revenueHistory].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianRevenue = sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }
    
    const averageRevenue =
      revenueHistory.length > 0
        ? revenueHistory.reduce((sum, value) => sum + value, 0) / revenueHistory.length
        : 0;
    
    // Используем последние 7 дней для более актуальной оценки
    const recentRevenues = revenueHistory.slice(-7);
    const recentAverage = recentRevenues.length > 0
      ? recentRevenues.reduce((sum, value) => sum + value, 0) / recentRevenues.length
      : averageRevenue;
    
    // Берем среднее между медианой и недавним средним для стабильности
    const baseRevenue = Math.max(
      medianRevenue * 0.6 + recentAverage * 0.4,
      averageRevenue * 0.8,
      medianRevenue,
      1
    );

    const modelPredictions = rawModelPredictions.map((series) =>
      series.map((prediction) => this.convertToAbsolutePrediction(prediction, baseRevenue)),
    );

    // Объединяем прогнозы
    const ensemblePredictions = this.modelEnsemble.metaModel(modelPredictions);
    const { clampLimit, clampMin, median } = calculateHistoricalClamp(revenueHistory, baseRevenue);
    const seasonalityStats = this.computeSeasonalityStats(timeSeriesData);
    
    // Для малых датасетов используем более консервативный подход
    const isSmallDataset = timeSeriesData.length < 30;
    const conservativeMultiplier = isSmallDataset ? 0.9 : 1.0;

    // Создаем финальные прогнозы
    const forecasts: ForecastData[] = [];
    const finalPredictions: number[] = [];
    for (let i = 0; i < days; i++) {
      const forecastDate = addDays(lastDate, i + 1);
      const future = futureData[i];
      const dayOfWeek = getDay(forecastDate);
      const month = forecastDate.getMonth();

      const rawPrediction = ensemblePredictions[i] ?? baseRevenue;
      const dowMultiplier = seasonalityStats.dowMultipliers[dayOfWeek] ?? 1;
      const monthMultiplier = seasonalityStats.monthMultipliers[month] ?? 1;
      const baselineMultiplier = this.combineMultipliers(
        [
          { value: dowMultiplier, weight: 0.7 },
          { value: monthMultiplier, weight: 0.3 },
        ],
        1,
      );
      const baselineSeasonalPrediction =
        seasonalityStats.overallAverage > 0
          ? seasonalityStats.overallAverage * baselineMultiplier
          : baseRevenue;

      // Расчет факторов влияния
      const factors = this.calculateEnhancedInfluenceFactors(forecastDate, timeSeriesData, future);

      // Улучшенный фактор из данных Z-отчетов (COGS, маржа)
      const profitabilityFactor = this.calculateProfitabilityFactor(timeSeriesData, future);

      // Более консервативные ограничения для малых датасетов
      const seasonalRange = isSmallDataset ? [0.7, 1.3] : [0.5, 1.5];
      const trendRange = isSmallDataset ? [0.85, 1.15] : [0.7, 1.3];
      const otherRange = isSmallDataset ? [0.9, 1.1] : [0.7, 1.2];
      
      const seasonalMultiplier = this.clampMultiplier(factors.seasonal ?? 1, seasonalRange[0], seasonalRange[1]);
      const trendMultiplier = this.clampMultiplier(1 + (factors.trend ?? 0), trendRange[0], trendRange[1]);
      const weatherMultiplier = this.clampMultiplier(1 + (factors.weather ?? 0), otherRange[0], otherRange[1]);
      const holidayMultiplier = this.clampMultiplier(1 + (factors.holiday ?? 0), 0.85, 1.2);
      const timeOfMonthMultiplier = this.clampMultiplier(1 + (factors.timeOfMonth ?? 0), otherRange[0], otherRange[1]);
      const historicalMultiplier = this.clampMultiplier(
        1 + (factors.historicalPattern ?? 0),
        otherRange[0],
        otherRange[1],
      );
      const economicMultiplier = this.clampMultiplier(1 + (factors.economicCycle ?? 0), 0.9, 1.1);
      const sentimentMultiplier = this.clampMultiplier(
        1 + (factors.socialSentiment ?? 0),
        0.9,
        1.1,
      );
      const profitabilityMultiplier = this.clampMultiplier(
        profitabilityFactor,
        isSmallDataset ? 0.95 : 0.9,
        isSmallDataset ? 1.05 : 1.1,
      );

      // Для малых датасетов даем больше веса сезонности и историческим паттернам
      // Учитываем данные из Z-отчетов (COGS, маржа) если они доступны
      const hasProfitabilityData = timeSeriesData.some((d) => d.hasProfitabilityData ?? false);
      const profitabilityWeight = hasProfitabilityData ? (isSmallDataset ? 0.08 : 0.1) : 0;
      
      // Фактор регионального спроса на кофе
      const regionalCoffeeDemandMultiplier = this.clampMultiplier(
        1 + (factors.regionalCoffeeDemand ?? 0),
        isSmallDataset ? 0.95 : 0.9,
        isSmallDataset ? 1.05 : 1.15,
      );
      
      const weights = isSmallDataset
        ? [
            { value: seasonalMultiplier, weight: 0.38 - profitabilityWeight },
            { value: trendMultiplier, weight: 0.15 },
            { value: weatherMultiplier, weight: 0.06 },
            { value: holidayMultiplier, weight: 0.05 },
            { value: timeOfMonthMultiplier, weight: 0.14 },
            { value: historicalMultiplier, weight: 0.14 },
            { value: economicMultiplier, weight: 0.04 },
            { value: sentimentMultiplier, weight: 0.02 },
            { value: regionalCoffeeDemandMultiplier, weight: 0.02 },
            ...(hasProfitabilityData ? [{ value: profitabilityMultiplier, weight: profitabilityWeight }] : []),
          ]
        : [
            { value: seasonalMultiplier, weight: 0.32 - profitabilityWeight },
            { value: trendMultiplier, weight: 0.18 },
            { value: weatherMultiplier, weight: 0.12 },
            { value: holidayMultiplier, weight: 0.05 },
            { value: timeOfMonthMultiplier, weight: 0.09 },
            { value: historicalMultiplier, weight: 0.09 },
            { value: economicMultiplier, weight: 0.06 },
            { value: sentimentMultiplier, weight: 0.04 },
            { value: regionalCoffeeDemandMultiplier, weight: 0.05 },
            ...(hasProfitabilityData ? [{ value: profitabilityMultiplier, weight: profitabilityWeight }] : []),
          ];
      
      const compositeMultiplier = this.combineMultipliers(weights, 1);

      // Применяем более консервативный подход для первых дней прогноза
      const isFirstDay = i === 0;
      const stabilityWeight = isFirstDay ? 0.6 : 0.4; // Больше веса базовому прогнозу для первого дня
      
      const adjustedRaw = Math.max(0, rawPrediction) * compositeMultiplier * conservativeMultiplier;
      
      // Сильнее сглаживаем с базовым прогнозом, особенно для первого дня
      const blendedPrediction = this.blendPredictions(
        adjustedRaw,
        baselineSeasonalPrediction,
        stabilityWeight,
      );
      
      // Дополнительное сглаживание с медианой для малых датасетов
      let finalBlended = blendedPrediction;
      if (isSmallDataset) {
        finalBlended = blendedPrediction * 0.7 + median * 0.3;
      }
      
      // Применяем ограничения
      const clampedPrediction = Math.min(finalBlended, clampLimit);
      const safePrediction = Math.max(clampMin, clampedPrediction);
      
      // Дополнительная проверка: если прогноз слишком отличается от предыдущих дней, сглаживаем
      if (i > 0 && finalPredictions.length > 0) {
        const prevPrediction = finalPredictions[finalPredictions.length - 1];
        const change = Math.abs(safePrediction - prevPrediction) / prevPrediction;
        // Если изменение больше 50%, применяем сглаживание
        if (change > 0.5) {
          const smoothed = prevPrediction * 0.7 + safePrediction * 0.3;
          finalPredictions.push(Math.max(clampMin, Math.min(clampLimit, smoothed)));
          continue;
        }
      }

      finalPredictions.push(safePrediction);

      // Расчет уверенности
      const confidence = this.calculateEnhancedConfidence(timeSeriesData, modelPredictions, i);

      // Определение тренда
      const trend = this.determineTrend(finalPredictions, i);

      if (isEnsembleDebugEnabled) {
        const dateLabel = format(forecastDate, 'yyyy-MM-dd');
        console.debug(
          `[enhanced ensemble][${dateLabel}] base=${formatDebugNumber(baseRevenue)} ` +
            `raw=${formatDebugNumber(rawPrediction)} ` +
            `baseline=${formatDebugNumber(baselineSeasonalPrediction)} ` +
            `multiplier=${formatDebugNumber(compositeMultiplier, 3)} ` +
            `clamp=${formatDebugNumber(clampLimit)} ` +
            `final=${formatDebugNumber(safePrediction)}`,
        );

        const debugEntry = this.lastAdaptiveDiagnostics[i];
        const modelCount = this.modelEnsemble.models.length;

        this.modelEnsemble.models.forEach((model, idx) => {
          const weight =
            debugEntry && debugEntry.normalizedWeights[idx] !== undefined
              ? debugEntry.normalizedWeights[idx]
              : modelCount > 0
                ? 1 / modelCount
                : 0;
          const prediction = modelPredictions[idx]?.[i] ?? 0;
          const contribution =
            debugEntry && debugEntry.contributions[idx] !== undefined
              ? debugEntry.contributions[idx]
              : weight * prediction;

          console.debug(
            `[enhanced ensemble][${dateLabel}] ${model.name}: ` +
              `weight=${formatDebugNumber(weight, 4)} ` +
              `prediction=${formatDebugNumber(prediction)} ` +
              `contribution=${formatDebugNumber(contribution)}`,
          );
        });
      }

      forecasts.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(safePrediction),
        confidence: Math.round(confidence * 100) / 100,
        trend,
        weatherImpact: factors.weather,
        holidayImpact: factors.holiday,
        economicImpact: factors.economicIndicators,
        trafficImpact: factors.localEvent,
        socialSentimentImpact: factors.socialSentiment,
        demographicImpact: factors.customerSegment,
      });
    }

    return forecasts;
  }

  // Вспомогательные методы
  private getWeekOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = date.getTime() - start.getTime();
    return Math.ceil((diff / (1000 * 60 * 60 * 24) + 1) / 7);
  }

  private getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 1);
    const diff = date.getTime() - start.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  private findHoliday(date: string, holidays: HolidayData[]): HolidayData | undefined {
    return holidays.find((h) => h.date === date);
  }

  private findWeatherData(
    date: string,
    weather: WeatherAPIResponse | WeatherAPIResponse[],
  ): WeatherAPIResponse | undefined {
    if (Array.isArray(weather)) {
      return weather.find((w) => w.date === date);
    }
    return weather;
  }

  private findSocialSentiment(
    date: string,
    sentiment: SocialSentiment[],
  ): SocialSentiment | undefined {
    return sentiment.find((s) => s.date === date);
  }

  private calculateMovingAverage(
    data: EnhancedTimeSeriesData[],
    period: number,
    field: keyof EnhancedTimeSeriesData,
  ): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map((d) => d[field] as number);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateVolatility(data: EnhancedTimeSeriesData[], period: number): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map((d) => d.revenue);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateTrend(data: EnhancedTimeSeriesData[], period: number): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map((d) => d.revenue);
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * values[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  private getWeatherMultiplier(temperature: number, precipitation: number): number {
    let multiplier = 1;

    // Температурный эффект
    if (temperature < 0) multiplier *= 0.9;
    else if (temperature > 30) multiplier *= 0.95;
    else if (temperature >= 15 && temperature <= 25) multiplier *= 1.05;

    // Эффект осадков
    if (precipitation > 5) multiplier *= 0.9;
    else if (precipitation > 2) multiplier *= 0.95;

    return multiplier;
  }

  // Заглушки для сложных методов (в реальном приложении здесь были бы полноценные реализации)
  private selectARIMAOrder(revenues: number[]): { ar: number; ma: number; diff: number } {
    return { ar: 1, ma: 1, diff: 1 };
  }

  private difference(data: number[], order: number): number[] {
    if (order === 0) return data;
    const diff = data.slice(1).map((val, i) => val - data[i]);
    return this.difference(diff, order - 1);
  }

  private undifference(original: number[], prediction: number, order: number): number {
    return prediction + (original[original.length - 1] || 0);
  }

  private fitAR(data: number[], order: number): number[] {
    return Array(order).fill(0.1);
  }

  private fitMA(data: number[], order: number): number[] {
    return Array(order).fill(0.1);
  }

  private predictARIMA(
    data: number[],
    arCoeffs: number[],
    maCoeffs: number[],
    steps: number,
  ): number {
    if (data.length === 0) return 0;
    
    // Используем скользящее среднее для прогноза с учетом тренда
    const lastValue = data[data.length - 1];
    const avgValue = data.reduce((sum, val) => sum + val, 0) / data.length;
    
    // Рассчитываем тренд на основе последних значений
    const recentValues = data.slice(-Math.min(7, data.length));
    const trend = recentValues.length > 1
      ? (recentValues[recentValues.length - 1] - recentValues[0]) / recentValues.length
      : 0;
    
    // Прогноз с учетом тренда и затухания (экспоненциальное затухание для дальних прогнозов)
    const decayFactor = Math.exp(-steps * 0.1); // Затухание тренда с расстоянием
    const trendComponent = trend * steps * decayFactor;
    const prediction = lastValue + trendComponent;
    
    // Ограничиваем прогноз разумными пределами (не более чем в 2 раза от среднего)
    const maxValue = avgValue * 2;
    const minValue = avgValue * 0.5;
    
    return Math.max(minValue, Math.min(maxValue, prediction));
  }

  private calculateWeeklySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const weekly = new Array(7).fill(0);
    const counts = new Array(7).fill(0);

    data.forEach((d) => {
      weekly[d.dayOfWeek] += d.revenue;
      counts[d.dayOfWeek]++;
    });

    const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return weekly.map((revenue, day) => {
      if (counts[day] === 0) return 1;
      const dayAvg = revenue / counts[day];
      return dayAvg / avgRevenue; // Нормализуем относительно общего среднего
    });
  }

  private calculateMonthlySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const monthly = new Array(12).fill(0);
    const counts = new Array(12).fill(0);

    data.forEach((d) => {
      monthly[d.month] += d.revenue;
      counts[d.month]++;
    });

    const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return monthly.map((revenue, month) => {
      if (counts[month] === 0) return 1;
      const monthAvg = revenue / counts[month];
      return monthAvg / avgRevenue; // Нормализуем относительно общего среднего
    });
  }

  private computeSeasonalityStats(data: EnhancedTimeSeriesData[]): {
    dowMultipliers: number[];
    monthMultipliers: number[];
    overallAverage: number;
  } {
    if (data.length === 0) {
      return {
        dowMultipliers: new Array(7).fill(1),
        monthMultipliers: new Array(12).fill(1),
        overallAverage: 0,
      };
    }

    const dowTotals = new Array(7).fill(0);
    const dowCounts = new Array(7).fill(0);
    const monthTotals = new Array(12).fill(0);
    const monthCounts = new Array(12).fill(0);
    let revenueSum = 0;

    data.forEach((entry) => {
      const revenue = Number.isFinite(entry.revenue) ? entry.revenue : 0;
      revenueSum += revenue;

      const dow = entry.dayOfWeek;
      if (dow >= 0 && dow < 7) {
        dowTotals[dow] += revenue;
        dowCounts[dow]++;
      }

      const month = entry.month;
      if (month >= 0 && month < 12) {
        monthTotals[month] += revenue;
        monthCounts[month]++;
      }
    });

    const overallAverage = revenueSum / data.length;
    const safeAverage = overallAverage > 0 ? overallAverage : 1;

    const dowMultipliers = dowTotals.map((total, index) => {
      if (dowCounts[index] === 0) return 1;
      const average = total / dowCounts[index];
      const ratio = average / safeAverage;
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    });

    const monthMultipliers = monthTotals.map((total, index) => {
      if (monthCounts[index] === 0) return 1;
      const average = total / monthCounts[index];
      const ratio = average / safeAverage;
      return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    });

    return {
      dowMultipliers,
      monthMultipliers,
      overallAverage,
    };
  }

  private combineMultipliers(
    entries: Array<{ value: number | undefined; weight: number }>,
    fallback: number,
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;

    entries.forEach((entry) => {
      const { value, weight } = entry;
      if (!Number.isFinite(weight) || weight <= 0) return;
      if (!Number.isFinite(value) || value === undefined) return;

      weightedSum += value * weight;
      totalWeight += weight;
    });

    if (totalWeight <= 0) {
      return fallback;
    }

    const combined = weightedSum / totalWeight;
    return Number.isFinite(combined) && combined > 0 ? combined : fallback;
  }

  private clampMultiplier(value: number, min: number, max: number): number {
    const safeValue = Number.isFinite(value) ? value : 1;
    const lowerBound = Number.isFinite(min) ? min : 0;
    const upperBound = Number.isFinite(max) ? max : lowerBound;
    return Math.min(upperBound, Math.max(lowerBound, safeValue));
  }

  private blendPredictions(primary: number, secondary: number, alpha: number): number {
    const safeAlpha = Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 0.5;
    const safePrimary = Number.isFinite(primary) ? primary : 0;
    const safeSecondary = Number.isFinite(secondary) ? secondary : 0;
    return safePrimary * safeAlpha + safeSecondary * (1 - safeAlpha);
  }

  private calculateYearlySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const quarterly = new Array(4).fill(0);
    const counts = new Array(4).fill(0);

    data.forEach((d) => {
      quarterly[d.quarter - 1] += d.revenue;
      counts[d.quarter - 1]++;
    });

    const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return quarterly.map((revenue, quarter) => {
      if (counts[quarter] === 0) return 1;
      const quarterAvg = revenue / counts[quarter];
      return quarterAvg / avgRevenue; // Нормализуем относительно общего среднего
    });
  }

  private calculateHolidayEffects(data: EnhancedTimeSeriesData[]): Map<string, number> {
    const effects = new Map<string, number>();
    const holidayData = data.filter((d) => d.isHoliday);

    if (holidayData.length > 0) {
      const avgHolidayRevenue =
        holidayData.reduce((sum, d) => sum + d.revenue, 0) / holidayData.length;
      const avgRegularRevenue =
        data.filter((d) => !d.isHoliday).reduce((sum, d) => sum + d.revenue, 0) /
        data.filter((d) => !d.isHoliday).length;
      effects.set(
        'holiday',
        avgRegularRevenue > 0 ? (avgHolidayRevenue - avgRegularRevenue) / avgRegularRevenue : 0,
      );
    }

    return effects;
  }

  private calculateWeatherEffects(data: EnhancedTimeSeriesData[]): Map<string, number> {
    const effects = new Map<string, number>();

    // Анализируем влияние температуры
    const coldDays = data.filter((d) => d.temperature < 5);
    const hotDays = data.filter((d) => d.temperature > 25);
    const normalDays = data.filter((d) => d.temperature >= 5 && d.temperature <= 25);

    if (coldDays.length > 0 && normalDays.length > 0) {
      const coldAvg = coldDays.reduce((sum, d) => sum + d.revenue, 0) / coldDays.length;
      const normalAvg = normalDays.reduce((sum, d) => sum + d.revenue, 0) / normalDays.length;
      effects.set('cold', normalAvg > 0 ? (coldAvg - normalAvg) / normalAvg : 0);
    }

    if (hotDays.length > 0 && normalDays.length > 0) {
      const hotAvg = hotDays.reduce((sum, d) => sum + d.revenue, 0) / hotDays.length;
      const normalAvg = normalDays.reduce((sum, d) => sum + d.revenue, 0) / normalDays.length;
      effects.set('hot', normalAvg > 0 ? (hotAvg - normalAvg) / normalAvg : 0);
    }

    return effects;
  }

  private extractLSTMFeatures(data: EnhancedTimeSeriesData[]): number[][] {
    // Нормализуем признаки для лучшей работы LSTM
    const revenues = data.map((d) => d.revenue).filter((r) => r > 0);
    const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 1;
    const avgRevenue = revenues.length > 0 ? revenues.reduce((sum, r) => sum + r, 0) / revenues.length : 1;
    const revenueStd = revenues.length > 1
      ? Math.sqrt(revenues.reduce((sum, r) => sum + Math.pow(r - avgRevenue, 2), 0) / revenues.length)
      : avgRevenue;

    return data.map((d) => {
      // Нормализация выручки (z-score)
      const revenueNorm = maxRevenue > 0 ? (d.revenue - avgRevenue) / (revenueStd + 1) : 0;
      
      // Нормализация признаков из Z-отчетов
      const checksCountNorm = d.checksCount !== undefined && d.checksCount > 0
        ? Math.min(1, d.checksCount / 1000) // Максимум 1000 чеков = 1.0
        : 0;
      
      const avgCheckNorm = d.averageCheck !== undefined && avgRevenue > 0
        ? Math.min(1, d.averageCheck / (avgRevenue * 2)) // Нормализуем относительно среднего чека
        : 0;
      
      const returnsNorm = d.returns !== undefined && maxRevenue > 0
        ? Math.min(1, d.returns / maxRevenue) // Нормализуем относительно максимальной выручки
        : 0;

      return [
        revenueNorm, // Нормализованная выручка
        d.dayOfWeek / 7, // День недели [0, 1]
        d.dayOfMonth / 31, // День месяца [0, 1]
        d.month / 12, // Месяц [0, 1]
        (d.temperature + 30) / 60, // Температура [-30, 30] -> [0, 1]
        Math.min(1, d.precipitation / 20), // Осадки [0, 20+] -> [0, 1]
        d.humidity / 100, // Влажность [0, 100] -> [0, 1]
        d.isWeekend ? 1 : 0, // Выходной
        d.isHoliday ? 1 : 0, // Праздник
        (d.socialSentiment + 1) / 2, // Социальный сентимент [-1, 1] -> [0, 1]
        (d.consumerConfidence + 1) / 2, // Доверие потребителей [-1, 1] -> [0, 1]
        d.movingAverage7 / (maxRevenue + 1), // Скользящее среднее
        Math.min(1, d.volatility / (avgRevenue + 1)), // Волатильность
        // Улучшенные признаки из Z-отчетов
        checksCountNorm,
        avgCheckNorm,
        returnsNorm,
        d.returnRate ?? 0, // Уже в диапазоне [0, 1]
        d.cogsTotal !== undefined && maxRevenue > 0
          ? Math.min(1, d.cogsTotal / maxRevenue) // COGS нормализован
          : 0,
        d.grossMargin ?? 0, // Уже в диапазоне [0, 1]
        d.dataQuality ?? 0.5, // Уже в диапазоне [0, 1]
      ];
    });
  }

  private trainLSTM(features: number[][], sequenceLength: number): any {
    // Упрощенная LSTM модель (обновлено количество признаков с учетом новых полей из Z-отчетов)
    const featureCount = features[0]?.length ?? 20;
    return {
      weights: Array(featureCount).fill(0.1),
      bias: 0.1,
    };
  }

  private predictLSTM(features: number[][], weights: any, steps: number): number {
    if (features.length === 0) return 0;
    
    const lastFeatures = features[features.length - 1];
    
    // Базовый прогноз
    let prediction = lastFeatures.reduce((sum, val, i) => sum + val * weights.weights[i], weights.bias) * 1000;
    
    // Учитываем тренд из последних значений для разных шагов
    if (features.length >= 3) {
      const recentRevenues = features.slice(-3).map(f => f[0] * 1000); // revenue - первый признак
      const trend = recentRevenues.length > 1
        ? (recentRevenues[recentRevenues.length - 1] - recentRevenues[0]) / recentRevenues.length
        : 0;
      
      // Применяем тренд с затуханием для дальних прогнозов
      const trendComponent = trend * steps * Math.exp(-steps * 0.15);
      prediction += trendComponent;
    }
    
    // Учитываем сезонность дня недели (если доступна в фичах)
    // dayOfWeek нормализован в диапазоне [0, 1] (признак 1 в extractLSTMFeatures)
    if (lastFeatures.length > 1) {
      const dayOfWeekRaw = Math.round(lastFeatures[1] * 7); // Восстанавливаем день недели (0-6)
      const dayOfWeek = dayOfWeekRaw % 7;
      // Небольшая вариация в зависимости от дня недели (выходные обычно выше)
      const dayVariation = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.05 : 0.98;
      prediction *= dayVariation;
    }
    
    return Math.max(0, prediction);
  }

  private extractFeatures(data: EnhancedTimeSeriesData[]): number[][] {
    return data.map((d) => [
      d.revenue,
      d.dayOfWeek,
      d.dayOfMonth,
      d.month,
      d.quarter,
      d.temperature,
      d.precipitation,
      d.humidity,
      d.windSpeed,
      d.cloudCover,
      d.uvIndex,
      d.visibility,
      d.exchangeRate,
      d.inflation,
      d.consumerConfidence,
      d.unemploymentRate,
      d.socialSentiment,
      d.socialVolume,
      d.movingAverage7,
      d.movingAverage14,
      d.movingAverage30,
      d.volatility,
      d.trend,
      d.isWeekend ? 1 : 0,
      d.isHoliday ? 1 : 0,
      d.isSpring ? 1 : 0,
      d.isSummer ? 1 : 0,
      d.isAutumn ? 1 : 0,
      d.isWinter ? 1 : 0,
      d.isMonthStart ? 1 : 0,
      d.isMonthEnd ? 1 : 0,
      d.isQuarterStart ? 1 : 0,
      d.isQuarterEnd ? 1 : 0,
      d.isYearStart ? 1 : 0,
      d.isYearEnd ? 1 : 0,
      // Новые признаки из Z-отчетов (нормализованные)
      (d.checksCount ?? 0) / 1000, // Нормализуем количество чеков
      (d.averageCheck ?? 0) / 1000, // Нормализуем средний чек
      (d.returns ?? 0) / 10000, // Нормализуем возвраты
      (d.corrections ?? 0) / 10000, // Нормализуем коррекции
      d.returnRate ?? 0, // Доля возвратов (уже в диапазоне 0-1)
      (d.cogsTotal ?? 0) / 10000, // Нормализуем себестоимость
      (d.grossProfit ?? 0) / 10000, // Нормализуем валовую прибыль
      d.grossMargin ?? 0, // Валовая маржа (уже в диапазоне 0-1)
      d.dataQuality ?? 0.5, // Качество данных (0-1)
    ]);
  }

  private extractFutureFeatures(
    future: Partial<EnhancedTimeSeriesData>,
    data: EnhancedTimeSeriesData[],
  ): number[] {
    const lastData = data[data.length - 1];
    const avgRevenue = data.length > 0
      ? data.reduce((sum, d) => sum + d.revenue, 0) / data.length
      : 0;
    
    // Используем среднюю выручку вместо последней для более стабильного прогноза
    // Но учитываем тренд для вариации
    const recentTrend = data.length >= 7
      ? this.calculateTrend(data.slice(-7), 7)
      : 0;
    const projectedRevenue = avgRevenue + (recentTrend * 0.5); // Частично применяем тренд
    
    // Рассчитываем средние значения для новых признаков из исторических данных
    const avgChecksCount = data.length > 0
      ? data.reduce((sum, d) => sum + (d.checksCount ?? 0), 0) / data.length
      : 0;
    const avgAverageCheck = data.length > 0
      ? data.reduce((sum, d) => sum + (d.averageCheck ?? avgRevenue), 0) / data.length
      : avgRevenue;
    const avgReturns = data.length > 0
      ? data.reduce((sum, d) => sum + (d.returns ?? 0), 0) / data.length
      : 0;
    const avgReturnRate = data.length > 0
      ? data.reduce((sum, d) => sum + (d.returnRate ?? 0), 0) / data.length
      : 0;
    const avgCogsTotal = data.length > 0
      ? data.reduce((sum, d) => sum + (d.cogsTotal ?? 0), 0) / data.length
      : 0;
    const avgGrossMargin = data.length > 0
      ? data.reduce((sum, d) => sum + (d.grossMargin ?? 0), 0) / data.length
      : 0;
    const avgDataQuality = data.length > 0
      ? data.reduce((sum, d) => sum + (d.dataQuality ?? 0.5), 0) / data.length
      : 0.5;
    
    return [
      Math.max(0, projectedRevenue),
      future.dayOfWeek ?? 0,
      future.dayOfMonth ?? 0,
      future.month ?? 0,
      future.quarter ?? 0,
      future.temperature ?? 15,
      future.precipitation ?? 0,
      future.humidity ?? 60,
      future.windSpeed ?? 5,
      future.cloudCover ?? 30,
      future.uvIndex ?? 3,
      future.visibility ?? 10,
      future.exchangeRate ?? 95.5,
      future.inflation ?? 4.5,
      future.consumerConfidence ?? 0.2,
      future.unemploymentRate ?? 3.2,
      future.socialSentiment ?? 0,
      future.socialVolume ?? 0,
      lastData?.movingAverage7 ?? avgRevenue,
      lastData?.movingAverage14 ?? avgRevenue,
      lastData?.movingAverage30 ?? avgRevenue,
      lastData?.volatility ?? 0,
      lastData?.trend ?? 0,
      future.isWeekend ? 1 : 0,
      future.isHoliday ? 1 : 0,
      future.month !== undefined && future.month >= 2 && future.month <= 4 ? 1 : 0,
      future.month !== undefined && future.month >= 5 && future.month <= 7 ? 1 : 0,
      future.month !== undefined && future.month >= 8 && future.month <= 10 ? 1 : 0,
      future.month !== undefined &&
      (future.month === 11 || future.month === 0 || future.month === 1)
        ? 1
        : 0,
      future.isMonthStart ? 1 : 0,
      future.isMonthEnd ? 1 : 0,
      future.isQuarterStart ? 1 : 0,
      future.isQuarterEnd ? 1 : 0,
      future.isYearStart ? 1 : 0,
      future.isYearEnd ? 1 : 0,
      // Новые признаки из Z-отчетов (используем средние значения из исторических данных)
      avgChecksCount / 1000,
      avgAverageCheck / 1000,
      avgReturns / 10000,
      0, // corrections обычно не прогнозируются
      avgReturnRate,
      avgCogsTotal / 10000,
      (projectedRevenue - avgCogsTotal) / 10000, // Прогнозируемая валовая прибыль
      avgGrossMargin,
      avgDataQuality,
    ];
  }

  private trainRandomForest(features: number[][], targets: number[], nTrees: number): any[] {
    // Упрощенная Random Forest
    return Array(nTrees)
      .fill(null)
      .map(() => ({
        feature: Math.floor(Math.random() * features[0].length),
        threshold: Math.random() * 1000,
        leftValue: Math.random() * 1000,
        rightValue: Math.random() * 1000,
      }));
  }

  private predictRandomForest(trees: any[], features: number[]): number {
    if (trees.length === 0) return 0;
    
    const predictions = trees.map((tree) => {
      const value = features[tree.feature] ?? 0;
      return value < tree.threshold ? tree.leftValue : tree.rightValue;
    });
    const avgPrediction = predictions.reduce((sum: number, val: number) => sum + val, 0) / predictions.length;
    
    // Добавляем небольшую вариацию на основе признаков для разнообразия
    // Используем dayOfWeek (обычно признак 1) для добавления сезонности
    if (features.length > 1 && features[1] !== undefined) {
      const dayOfWeek = Math.floor(features[1] * 7) % 7;
      // Выходные дни обычно имеют другую выручку
      const weekendMultiplier = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.08 : 0.95;
      return avgPrediction * weekendMultiplier;
    }
    
    return Math.max(0, avgPrediction);
  }

  private trainXGBoost(features: number[][], targets: number[]): any {
    const featureCount = features[0]?.length ?? 0;
    const baseline = this.calculateMeanValue(targets, 0);

    if (featureCount === 0 || features.length === 0 || targets.length === 0) {
      return { baseline, trees: [] };
    }

    const treeCount = Math.min(10, featureCount);
    const trees: Array<{
      feature: number;
      threshold: number;
      leftValue: number;
      rightValue: number;
    }> = [];

    for (let i = 0; i < treeCount; i++) {
      const featureIndex = i % featureCount;
      const featureValues = features
        .map((row) => (row && Number.isFinite(row[featureIndex]) ? row[featureIndex] : undefined))
        .filter((value): value is number => value !== undefined);

      const threshold = this.calculateMedianValue(featureValues, 0);
      const { left, right } = this.partitionTargetsByThreshold(
        features,
        targets,
        featureIndex,
        threshold,
      );

      const leftMean = left.length > 0 ? this.calculateMeanValue(left, baseline) : baseline;
      const rightMean = right.length > 0 ? this.calculateMeanValue(right, baseline) : baseline;

      trees.push({
        feature: featureIndex,
        threshold,
        leftValue: leftMean,
        rightValue: rightMean,
      });
    }

    return {
      baseline,
      trees,
    };
  }

  private predictXGBoost(model: any, features: number[]): number {
    if (!model) {
      return 0;
    }

    const baseline =
      typeof model.baseline === 'number' && Number.isFinite(model.baseline) ? model.baseline : 0;

    if (!Array.isArray(model.trees) || model.trees.length === 0) {
      return baseline;
    }

    const predictions = model.trees.map((tree: any) => {
      if (!tree) {
        return baseline;
      }

      const featureIndex = typeof tree.feature === 'number' && tree.feature >= 0 ? tree.feature : 0;
      const threshold =
        typeof tree.threshold === 'number' && Number.isFinite(tree.threshold) ? tree.threshold : 0;
      const rawValue = features?.[featureIndex];
      const value = Number.isFinite(rawValue) ? rawValue : threshold;

      const leftValue =
        typeof tree.leftValue === 'number' && Number.isFinite(tree.leftValue)
          ? tree.leftValue
          : baseline;
      const rightValue =
        typeof tree.rightValue === 'number' && Number.isFinite(tree.rightValue)
          ? tree.rightValue
          : baseline;

      return value < threshold ? leftValue : rightValue;
    });

    const meanPrediction = this.calculateMeanValue(predictions, baseline);
    
    // Добавляем вариацию на основе дня недели для разнообразия прогнозов
    if (features.length > 1 && features[1] !== undefined) {
      const dayOfWeek = Math.floor(features[1] * 7) % 7;
      // Применяем сезонность по дням недели
      const dayMultipliers = [1.05, 0.95, 0.98, 1.0, 1.02, 1.08, 1.1]; // Вс, Пн, Вт, Ср, Чт, Пт, Сб
      const multiplier = dayMultipliers[dayOfWeek] ?? 1.0;
      return Math.max(0, meanPrediction * multiplier);
    }
    
    return Math.max(0, meanPrediction);
  }

  private calculateMeanValue(values: number[], fallback: number): number {
    const finite = values.filter((value) => Number.isFinite(value));
    if (finite.length === 0) {
      return fallback;
    }

    const sum = finite.reduce((acc, value) => acc + value, 0);
    return sum / finite.length;
  }

  private convertToAbsolutePrediction(prediction: number, baseRevenue: number): number {
    if (!Number.isFinite(prediction)) {
      return Math.max(0, baseRevenue);
    }

    if (baseRevenue <= 0) {
      return Math.max(0, prediction);
    }

    const positivePrediction = Math.max(prediction, 0);
    const safeBase = Math.max(baseRevenue, 1e-6);
    const rawMultiplier =
      positivePrediction <= 10 ? positivePrediction : positivePrediction / safeBase;
    const safeMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier >= 0 ? rawMultiplier : 0;

    return safeBase * safeMultiplier;
  }

  private calculateMedianValue(values: number[], fallback: number): number {
    const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (finite.length === 0) {
      return fallback;
    }

    const mid = Math.floor(finite.length / 2);
    if (finite.length % 2 === 0 && mid > 0) {
      return (finite[mid - 1] + finite[mid]) / 2;
    }
    return finite[mid];
  }

  private partitionTargetsByThreshold(
    features: number[][],
    targets: number[],
    featureIndex: number,
    threshold: number,
  ): { left: number[]; right: number[] } {
    const left: number[] = [];
    const right: number[] = [];
    const safeThreshold = Number.isFinite(threshold) ? threshold : 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (!Number.isFinite(target)) {
        continue;
      }

      const featureRow = features[i];
      const rawValue = featureRow?.[featureIndex];
      const value = Number.isFinite(rawValue) ? (rawValue as number) : safeThreshold;

      if (value < safeThreshold) {
        left.push(target);
      } else {
        right.push(target);
      }
    }

    if (left.length === 0 && right.length === 0) {
      const fallbackTargets = targets.filter((value) => Number.isFinite(value));
      return { left: [], right: fallbackTargets };
    }

    return { left, right };
  }

  private estimateSeasonalityStrength(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 7) {
      return 0.1;
    }

    const dayGroups = new Map<number, number[]>();
    data.forEach((entry) => {
      if (!Number.isFinite(entry.revenue)) {
        return;
      }
      const bucket = dayGroups.get(entry.dayOfWeek) ?? [];
      bucket.push(entry.revenue);
      dayGroups.set(entry.dayOfWeek, bucket);
    });

    if (dayGroups.size === 0) {
      return 0.1;
    }

    const averages = Array.from(dayGroups.values()).map((values) =>
      this.calculateMeanValue(values, 0),
    );

    const meanOfMeans = this.calculateMeanValue(averages, 0);
    if (meanOfMeans <= 0) {
      return 0.1;
    }

    const variance =
      averages.reduce((sum, value) => sum + Math.pow(value - meanOfMeans, 2), 0) / averages.length;
    const std = Math.sqrt(Math.max(variance, 0));
    const safeStd = std > 1e-6 ? std : 1e-6;

    return Math.min(safeStd / Math.max(meanOfMeans, 1e-6), 1);
  }

  private calculateRecentGrowthRate(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 14) {
      return 0;
    }

    const recent = data
      .slice(-7)
      .map((entry) => entry.revenue)
      .filter((value) => Number.isFinite(value));
    const previous = data
      .slice(-14, -7)
      .map((entry) => entry.revenue)
      .filter((value) => Number.isFinite(value));

    if (recent.length === 0 || previous.length === 0) {
      return 0;
    }

    const recentMean = this.calculateMeanValue(recent, 0);
    const previousMean = this.calculateMeanValue(previous, 0);

    if (previousMean <= 0) {
      return 0;
    }

    const growth = (recentMean - previousMean) / previousMean;
    return Math.min(Math.abs(growth), 1);
  }

  // Gradient Boosting модель
  private gradientBoostingPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map((d) => d.revenue);

    // Обучаем Gradient Boosting
    const model = this.trainGradientBoosting(features, targets);

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictGradientBoosting(model, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  private trainGradientBoosting(features: number[][], targets: number[]): any {
    // Упрощенная Gradient Boosting модель
    return {
      trees: Array(20)
        .fill(null)
        .map(() => ({
          feature: Math.floor(Math.random() * features[0].length),
          threshold: Math.random() * 1000,
          leftValue: Math.random() * 1000,
          rightValue: Math.random() * 1000,
          learningRate: 0.1,
        })),
    };
  }

  private predictGradientBoosting(model: any, features: number[]): number {
    if (!model || !Array.isArray(model.trees) || model.trees.length === 0) {
      return 0;
    }
    
    let prediction = 0;
    for (const tree of model.trees) {
      const featureIndex = tree.feature ?? 0;
      const value = features[featureIndex] ?? 0;
      const treePrediction = value < tree.threshold ? tree.leftValue : tree.rightValue;
      prediction += treePrediction * (tree.learningRate ?? 0.1);
    }
    
    // Добавляем вариацию на основе дня недели
    if (features.length > 1 && features[1] !== undefined) {
      const dayOfWeek = Math.floor(features[1] * 7) % 7;
      const weekendBoost = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.06 : 0.97;
      prediction *= weekendBoost;
    }
    
    return Math.max(0, prediction);
  }

  private calculateEnhancedInfluenceFactors(
    date: Date,
    data: EnhancedTimeSeriesData[],
    future: Partial<EnhancedTimeSeriesData>,
  ): any {
    const dayOfWeek = getDay(date);
    const dayOfMonth = date.getDate();
    const month = date.getMonth();
    const quarter = Math.floor(month / 3) + 1;

    return {
      seasonal: this.calculateSeasonalFactor(dayOfWeek, month, data),
      trend: this.calculateTrendFactor(data),
      weather: this.calculateWeatherFactor(future),
      holiday: future.holidayImpact || 0,
      timeOfMonth: this.calculateTimeOfMonthFactor(dayOfMonth),
      historicalPattern: this.calculateHistoricalPatternFactor(dayOfWeek, data),
      economicCycle: this.calculateEconomicCycleFactor(month),
      localEvent: 0,
      customerSegment: 0,
      socialSentiment: future.socialSentiment || 0,
      economicIndicators: this.calculateEconomicIndicatorsFactor(future),
      regionalCoffeeDemand: this.calculateRegionalCoffeeDemand(month, dayOfWeek, data),
    };
  }

  private calculateSeasonalFactor(
    dayOfWeek: number,
    month: number,
    data: EnhancedTimeSeriesData[],
  ): number {
    const dayOfWeekData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    const monthData = data.filter((d) => d.month === month);

    if (dayOfWeekData.length === 0 || monthData.length === 0) return 1;

    const avgDayRevenue =
      dayOfWeekData.reduce((sum, d) => sum + d.revenue, 0) / dayOfWeekData.length;
    const avgMonthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0) / monthData.length;
    const overallAvg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return (avgDayRevenue + avgMonthRevenue) / (2 * overallAvg);
  }

  private calculateTrendFactor(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 14) return 0;

    // Используем линейную регрессию для более точного расчета тренда
    const recent = data.slice(-14).map((d) => d.revenue);
    const n = recent.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = recent.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * recent[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const denominator = n * sumXX - sumX * sumX;
    
    if (denominator === 0) return 0;
    
    // Абсолютный тренд (изменение выручки в день)
    const absoluteTrend = (n * sumXY - sumX * sumY) / denominator;
    
    // Средняя выручка для нормализации
    const avgRevenue = sumY / n;
    
    // Возвращаем относительное изменение тренда (коэффициент)
    return avgRevenue > 0 ? absoluteTrend / avgRevenue : 0;
  }

  // Улучшенный расчет погодного фактора для Липецка, Россия
  private calculateWeatherFactor(future: Partial<EnhancedTimeSeriesData>): number {
    if (!future.temperature) return 0;

    let factor = 0;

    // Температурный эффект для Липецка (континентальный климат)
    // Зима: холодно, но кофе популярен
    if (future.temperature < -10) {
      // Очень холодно - больше хотят горячий кофе, но меньше выходят
      factor += 0.03; // Небольшой плюс за горячие напитки
    } else if (future.temperature < 0) {
      // Холодно - кофе популярен
      factor += 0.08;
    } else if (future.temperature >= 0 && future.temperature < 10) {
      // Прохладно - идеально для кофе
      factor += 0.12;
    } else if (future.temperature >= 10 && future.temperature < 20) {
      // Комфортно - отличная погода для кофе
      factor += 0.15;
    } else if (future.temperature >= 20 && future.temperature <= 25) {
      // Тепло - кофе все еще популярен
      factor += 0.10;
    } else if (future.temperature > 25 && future.temperature <= 30) {
      // Жарко - холодные напитки популярнее, но кофе тоже
      factor += 0.05;
    } else if (future.temperature > 30) {
      // Очень жарко - больше холодных напитков
      factor -= 0.05;
    }

    // Эффект осадков (дождь/снег)
    if (future.precipitation) {
      if (future.precipitation > 10) {
        // Сильный дождь/снег - меньше посетителей
        factor -= 0.15;
      } else if (future.precipitation > 5) {
        // Умеренные осадки
        factor -= 0.08;
      } else if (future.precipitation > 2) {
        // Легкие осадки - некоторые ищут укрытие в кофейне
        factor += 0.03;
      }
    }

    // Влажность (комфорт в помещении)
    if (future.humidity !== undefined) {
      if (future.humidity < 30 || future.humidity > 70) {
        // Некомфортная влажность - больше времени в помещении
        factor += 0.02;
      }
    }

    // Ветер (сильный ветер снижает желание выходить)
    if (future.windSpeed !== undefined) {
      if (future.windSpeed > 10) {
        factor -= 0.05;
      } else if (future.windSpeed > 15) {
        factor -= 0.10;
      }
    }

    // Видимость (туман снижает трафик)
    if (future.visibility !== undefined && future.visibility < 5) {
      factor -= 0.08;
    }

    return factor;
  }

  private calculateTimeOfMonthFactor(dayOfMonth: number): number {
    if (dayOfMonth <= 5) return -0.05;
    if (dayOfMonth >= 25) return 0.1;
    return 0;
  }

  private calculateHistoricalPatternFactor(
    dayOfWeek: number,
    data: EnhancedTimeSeriesData[],
  ): number {
    const sameDayData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    if (sameDayData.length < 2) return 0;

    const revenues = sameDayData.map((d) => d.revenue);
    const recent = revenues.slice(-3);
    const older = revenues.slice(-6, -3);

    const recentAvg = recent.reduce((sum, rev) => sum + rev, 0) / recent.length;
    const olderAvg = older.reduce((sum, rev) => sum + rev, 0) / older.length;

    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  private calculateEconomicCycleFactor(month: number): number {
    const cycle = Math.sin((month / 12) * 2 * Math.PI);
    return cycle * 0.05;
  }

  // Улучшенный расчет экономических факторов для России
  private calculateEconomicIndicatorsFactor(future: Partial<EnhancedTimeSeriesData>): number {
    let factor = 0;

    // Влияние курса валют (USD/RUB)
    // Для России: слабый рубль = дороже импортные товары, но может быть больше внутреннего спроса
    if (future.exchangeRate) {
      const baseRate = 95.5; // Базовый курс рубля
      const rateChange = (future.exchangeRate - baseRate) / baseRate;
      
      // Слабый рубль (выше курс) = дороже импорт, но кофе все равно популярен
      if (rateChange > 0.1) {
        // Рубль ослаб более чем на 10% - небольшое снижение из-за цен
        factor -= 0.03;
      } else if (rateChange < -0.05) {
        // Рубль укрепился - небольшой плюс
        factor += 0.02;
      }
    }

    // Влияние инфляции для России
    if (future.inflation) {
      const baseInflation = 4.5; // Базовый уровень для России
      const inflationDiff = future.inflation - baseInflation;
      
      // Высокая инфляция (>8%) снижает покупательную способность
      if (future.inflation > 8) {
        factor -= 0.12;
      } else if (future.inflation > 6) {
        factor -= 0.08;
      } else if (future.inflation < 3) {
        // Низкая инфляция - хороший знак
        factor += 0.05;
      } else {
        // Нормальная инфляция (3-6%)
        factor -= inflationDiff * 0.01;
      }
    }

    // Влияние потребительского доверия
    if (future.consumerConfidence !== undefined) {
      // consumerConfidence обычно в диапазоне [-1, 1]
      factor += future.consumerConfidence * 0.15;
    }

    // Влияние безработицы
    if (future.unemploymentRate !== undefined) {
      const baseUnemployment = 3.2; // Базовый уровень для России
      const unemploymentDiff = future.unemploymentRate - baseUnemployment;
      
      // Высокая безработица снижает спрос
      if (future.unemploymentRate > 5) {
        factor -= 0.10;
      } else if (unemploymentDiff > 1) {
        factor -= unemploymentDiff * 0.03;
      }
    }

    return factor;
  }

  // Расчет регионального спроса на кофе для Липецка
  private calculateRegionalCoffeeDemand(
    month: number,
    dayOfWeek: number,
    data: EnhancedTimeSeriesData[],
  ): number {
    let factor = 0;

    // Сезонность спроса на кофе в Липецке (Россия)
    // Зима (декабрь, январь, февраль) - высокий спрос на горячий кофе
    if (month === 11 || month === 0 || month === 1) {
      factor += 0.15; // Зима - пик спроса
    }
    // Весна (март, апрель, май) - стабильный спрос
    else if (month >= 2 && month <= 4) {
      factor += 0.08;
    }
    // Лето (июнь, июль, август) - холодные напитки популярнее, но кофе тоже
    else if (month >= 5 && month <= 7) {
      factor += 0.03; // Летом кофе немного менее популярен
    }
    // Осень (сентябрь, октябрь, ноябрь) - возврат к горячим напиткам
    else if (month >= 8 && month <= 10) {
      factor += 0.12; // Осень - высокий спрос
    }

    // День недели - в выходные больше времени для кофе
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      factor += 0.10; // Выходные - больше спрос
    } else if (dayOfWeek === 5) {
      factor += 0.05; // Пятница - люди готовятся к выходным
    }

    // Анализ исторических паттернов спроса на кофе
    if (data.length >= 30) {
      // Анализируем тренд спроса за последний месяц
      const recentData = data.slice(-30);
      const olderData = data.slice(-60, -30);
      
      if (olderData.length > 0) {
        const recentAvg = recentData.reduce((sum, d) => sum + d.revenue, 0) / recentData.length;
        const olderAvg = olderData.reduce((sum, d) => sum + d.revenue, 0) / olderData.length;
        
        if (olderAvg > 0) {
          const growthRate = (recentAvg - olderAvg) / olderAvg;
          // Если растет спрос, добавляем бонус
          if (growthRate > 0.1) {
            factor += 0.05;
          } else if (growthRate < -0.1) {
            // Снижение спроса
            factor -= 0.03;
          }
        }
      }
    }

    // Учитываем день месяца - в начале месяца больше денег (зарплата)
    const dayOfMonth = new Date().getDate();
    if (dayOfMonth >= 1 && dayOfMonth <= 5) {
      factor += 0.03; // Начало месяца - зарплата
    } else if (dayOfMonth >= 25 && dayOfMonth <= 31) {
      factor -= 0.02; // Конец месяца - деньги заканчиваются
    }

    return factor;
  }

  // Расчет влияния данных из Z-отчетов (COGS, маржа) на прогноз
  private calculateProfitabilityFactor(
    data: EnhancedTimeSeriesData[],
    future: Partial<EnhancedTimeSeriesData>,
  ): number {
    // Проверяем наличие данных из Z-отчетов
    const profitabilityData = data.filter((d) => d.hasProfitabilityData ?? false);
    
    if (profitabilityData.length === 0) {
      return 1.0; // Нет данных - нейтральный фактор
    }

    // Анализируем историческую связь между выручкой и себестоимостью
    const dataWithCogs = profitabilityData.filter((d) => d.cogsTotal !== undefined && d.cogsTotal !== null);
    
    if (dataWithCogs.length === 0) {
      return 1.0; // Нет данных о COGS
    }

    // Рассчитываем среднее соотношение выручка/COGS
    const revenueCogsRatios = dataWithCogs
      .map((d) => {
        if (d.cogsTotal !== undefined && d.cogsTotal !== null && d.cogsTotal > 0) {
          return d.revenue / d.cogsTotal;
        }
        return null;
      })
      .filter((r): r is number => r !== null && Number.isFinite(r));

    if (revenueCogsRatios.length === 0) {
      return 1.0;
    }

    const avgRatio = revenueCogsRatios.reduce((sum, r) => sum + r, 0) / revenueCogsRatios.length;
    
    // Рассчитываем среднюю маржу
    const margins = dataWithCogs
      .map((d) => d.grossMargin)
      .filter((m): m is number => m !== undefined && m !== null && Number.isFinite(m) && m >= 0 && m <= 1);

    if (margins.length === 0) {
      return 1.0;
    }

    const avgMargin = margins.reduce((sum, m) => sum + m, 0) / margins.length;
    
    // Если средняя маржа низкая (< 30%), это может указывать на проблемы с рентабельностью
    // и возможное снижение выручки в будущем
    if (avgMargin < 0.3) {
      return 0.98; // Небольшое снижение прогноза
    }

    // Если средняя маржа высокая (> 50%), это положительный сигнал
    if (avgMargin > 0.5) {
      return 1.02; // Небольшое увеличение прогноза
    }

    // Нормальная маржа (30-50%) - нейтральный фактор
    return 1.0;
  }

  private calculateEnhancedConfidence(
    data: EnhancedTimeSeriesData[],
    modelPredictions: number[][],
    step: number,
  ): number {
    // Базовое качество данных
    const dataQuality = Math.min(1, data.length / 100);

    // Улучшаем качество данных если есть данные из Z-отчетов
    const hasProfitabilityData = data.some((d) => d.hasProfitabilityData ?? false);
    const avgDataQuality = data.length > 0
      ? data.reduce((sum, d) => sum + (d.dataQuality ?? 0.5), 0) / data.length
      : 0.5;
    const enhancedDataQuality = hasProfitabilityData
      ? Math.min(1, dataQuality * 0.7 + avgDataQuality * 0.3)
      : dataQuality;

    // Согласованность моделей
    const predictions = modelPredictions.map((pred) => pred[step]);
    const mean = predictions.reduce((sum, pred) => sum + pred, 0) / predictions.length;
    const variance =
      predictions.reduce((sum, pred) => sum + Math.pow(pred - mean, 2), 0) / predictions.length;
    const consistency = Math.max(0, 1 - Math.sqrt(variance) / (mean + 1));

    // Стабильность тренда
    const recentTrend = this.calculateTrend(data.slice(-14), 14);
    const trendStability = Math.max(0, 1 - Math.abs(recentTrend) / 1000);

    // Внешние факторы
    const externalFactors = this.calculateExternalFactorConfidence(data);

    // Дополнительный бонус за наличие данных о себестоимости (COGS)
    const hasCogsData = data.some((d) => d.cogsTotal !== undefined && d.cogsTotal !== null);
    const cogsBonus = hasCogsData ? 0.05 : 0;

    // ВАЖНО: Уверенность снижается с расстоянием прогноза (horizon decay)
    // Чем дальше прогноз, тем меньше уверенность
    const horizonDecay = Math.exp(-step * 0.08); // Экспоненциальное затухание
    const baseConfidence =
      enhancedDataQuality * 0.35 +
      consistency * 0.3 +
      trendStability * 0.2 +
      externalFactors * 0.15 +
      cogsBonus;

    // Применяем затухание к базовой уверенности
    const adjustedConfidence = baseConfidence * (0.7 + 0.3 * horizonDecay); // От 70% до 100% базовой уверенности

    return Math.min(0.95, Math.max(0.3, adjustedConfidence));
  }

  // Улучшенный расчет уверенности на основе всех факторов
  private calculateExternalFactorConfidence(data: EnhancedTimeSeriesData[]): number {
    let confidence = 0.5; // Базовый уровень

    // Проверяем наличие внешних данных
    const hasWeather = data.some((d) => d.temperature !== 15);
    const hasEconomic = data.some((d) => d.exchangeRate !== 95.5);
    const hasSocial = data.some((d) => d.socialSentiment !== 0);
    const hasProfitability = data.some((d) => d.hasProfitabilityData ?? false);
    const hasCogs = data.some((d) => d.cogsTotal !== undefined && d.cogsTotal !== null);

    // Базовые внешние данные
    if (hasWeather) confidence += 0.08;
    if (hasEconomic) confidence += 0.08;
    if (hasSocial) confidence += 0.05;

    // Данные из Z-отчетов значительно повышают уверенность
    if (hasProfitability) confidence += 0.12;
    if (hasCogs) confidence += 0.08; // COGS особенно важен

    // Оцениваем качество данных
    const dataQuality = this.assessDataQuality(data);
    confidence += dataQuality * 0.15;

    // Оцениваем стабильность данных
    const dataStability = this.calculateDataStability(data);
    confidence += dataStability * 0.10;

    // Оцениваем полноту данных (нет пропусков)
    const dataCompleteness = this.calculateDataCompletenessScore(data);
    confidence += dataCompleteness * 0.08;

    // Бонус за длинную историю данных
    const historyBonus = Math.min(0.05, data.length / 200); // Максимум 5% за 200+ дней
    confidence += historyBonus;

    return Math.min(0.98, confidence); // Максимум 98%
  }

  // Оценка стабильности данных
  private calculateDataStability(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 7) return 0.5;

    const revenues = data.map((d) => d.revenue).filter((r) => r > 0);
    if (revenues.length < 7) return 0.5;

    // Рассчитываем коэффициент вариации
    const mean = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
    const variance = revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;

    // Низкий коэффициент вариации = высокая стабильность
    return Math.max(0, Math.min(1, 1 - coefficientOfVariation));
  }

  // Оценка полноты данных (нет пропусков в датах)
  private calculateDataCompletenessScore(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 2) return 0.5;

    // Проверяем пропуски в датах
    const dates = data.map((d) => new Date(d.date).getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];

    for (let i = 1; i < dates.length; i++) {
      const gap = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24); // Дни
      gaps.push(gap);
    }

    // Средний ожидаемый интервал (обычно 1 день)
    const expectedGap = 1;
    const avgGap = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    
    // Если средний пропуск близок к ожидаемому, данные полные
    const completeness = avgGap <= expectedGap * 1.5 ? 1 : Math.max(0, 1 - (avgGap - expectedGap) / expectedGap);
    
    return completeness;
  }

  private determineTrend(predictions: number[], step: number): 'up' | 'down' | 'stable' {
    if (step === 0) return 'stable';

    const current = predictions[step];
    const previous = predictions[step - 1];
    const change = (current - previous) / previous;

    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'stable';
  }

  // Переобучение моделей на новых данных
  private retrainModelsOnNewData(timeSeriesData: EnhancedTimeSeriesData[]): void {
    // Анализируем качество новых данных
    const dataQuality = this.assessDataQuality(timeSeriesData);

    // Если качество данных хорошее, переобучаем модели
    if (dataQuality > 0.7) {
      console.log('Переобучение моделей на новых данных с качеством:', dataQuality);

      // Обновляем веса моделей на основе качества данных
      this.updateModelWeights(timeSeriesData);

      // Сохраняем информацию о переобучении
      this.lastRetrainDate = new Date();
      this.retrainCount++;
    }
  }

  private lastRetrainDate?: Date;
  private retrainCount: number = 0;

  // Оценка качества данных
  private assessDataQuality(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 14) return 0.5;

    // Проверяем полноту данных
    const completeness = this.calculateDataCompleteness(data);

    // Проверяем консистентность данных
    const consistency = this.calculateDataConsistency(data);

    // Проверяем тренд данных
    const trendStability = this.calculateTrendStability(data);

    return completeness * 0.4 + consistency * 0.3 + trendStability * 0.3;
  }

  private calculateDataCompleteness(data: EnhancedTimeSeriesData[]): number {
    const expectedFields = [
      'revenue',
      'temperature',
      'humidity',
      'precipitation',
      'exchangeRate',
      'consumerConfidence',
      'socialSentiment',
    ];

    let totalCompleteness = 0;
    for (const field of expectedFields) {
      const nonDefaultValues = data.filter((d) => {
        const value = (d as any)[field];
        return (
          value !== undefined &&
          value !== null &&
          !(field === 'temperature' && value === 15) &&
          !(field === 'humidity' && value === 60) &&
          !(field === 'exchangeRate' && value === 95.5)
        );
      }).length;

      totalCompleteness += nonDefaultValues / data.length;
    }

    return totalCompleteness / expectedFields.length;
  }

  private calculateDataConsistency(data: EnhancedTimeSeriesData[]): number {
    const revenues = data.map((d) => d.revenue);
    const mean = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
    const variance =
      revenues.reduce((sum, rev) => sum + Math.pow(rev - mean, 2), 0) / revenues.length;
    const coefficient = Math.sqrt(variance) / mean;

    // Чем меньше коэффициент вариации, тем выше консистентность
    return Math.max(0, 1 - coefficient);
  }

  private calculateTrendStability(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 7) return 0.5;

    const recent = data.slice(-7);
    const older = data.slice(-14, -7);

    if (older.length === 0) return 0.5;

    const recentAvg = recent.reduce((sum, d) => sum + d.revenue, 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + d.revenue, 0) / older.length;

    const change = Math.abs(recentAvg - olderAvg) / olderAvg;

    // Стабильность обратно пропорциональна изменению
    return Math.max(0, 1 - change);
  }

  // Обновление весов моделей на основе новых данных
  private updateModelWeights(timeSeriesData: EnhancedTimeSeriesData[]): void {
    // Простая логика обновления весов на основе производительности
    const performanceRaw = this.evaluateModelPerformance(timeSeriesData);
    const modelPerformance = performanceRaw.map((perf) =>
      Number.isFinite(perf) && perf > 0 ? perf : 1e-6,
    );

    // Нормализуем веса
    const totalPerformance = modelPerformance.reduce((sum, perf) => sum + perf, 0);
    if (totalPerformance > 0) {
      for (let i = 0; i < this.modelEnsemble.models.length; i++) {
        this.modelEnsemble.models[i].weight = modelPerformance[i] / totalPerformance;
      }
    } else if (this.modelEnsemble.models.length > 0) {
      const uniformWeight = 1 / this.modelEnsemble.models.length;
      for (let i = 0; i < this.modelEnsemble.models.length; i++) {
        this.modelEnsemble.models[i].weight = uniformWeight;
      }
    }
  }

  private evaluateModelPerformance(data: EnhancedTimeSeriesData[]): number[] {
    if (this.modelEnsemble.models.length === 0) {
      return [];
    }

    const revenues = data
      .map((entry) => entry.revenue)
      .filter((value) => Number.isFinite(value) && value > 0);

    if (revenues.length === 0) {
      return this.modelEnsemble.models.map(() => 1);
    }

    const meanRevenue = this.calculateMeanValue(revenues, 1);
    const variance =
      revenues.reduce((sum, value) => sum + Math.pow(value - meanRevenue, 2), 0) / revenues.length;
    const std = Math.sqrt(Math.max(variance, 0));
    const safeStd = std > 1e-6 ? std : 1e-6;
    const volatility = safeStd / Math.max(meanRevenue, 1e-6);

    const trendStrength = Math.abs(this.calculateTrendFactor(data));
    const seasonalityStrength = this.estimateSeasonalityStrength(data);
    const recentGrowth = this.calculateRecentGrowthRate(data);

    const basePerformance = this.modelEnsemble.models.map((model) =>
      model.weight > 0 ? model.weight : 1 / this.modelEnsemble.models.length,
    );

    return this.modelEnsemble.models.map((model, index) => {
      let score = basePerformance[index] ?? 1;

      switch (model.name) {
        case 'ARIMA':
          score *= 1 + Math.min(seasonalityStrength, 0.5);
          score *= 1 + Math.max(0, 0.3 - volatility);
          break;
        case 'Prophet':
          score *= 1 + Math.min(trendStrength, 0.5);
          score *= 1 + Math.min(seasonalityStrength, 0.4);
          break;
        case 'LSTM':
          score *= 1 + Math.min(trendStrength + seasonalityStrength, 0.6);
          score *= 1 + Math.min(volatility, 0.4);
          break;
        case 'RandomForest':
          score *= 1 + Math.min(volatility, 0.4);
          score *= 1 + Math.min(recentGrowth, 0.3);
          break;
        case 'XGBoost':
          score *= 1 + Math.min(volatility + recentGrowth, 0.6);
          break;
        case 'GradientBoosting':
          score *= 1 + Math.min(recentGrowth, 0.5);
          break;
        default:
          break;
      }

      return Math.max(score, 1e-6);
    });
  }

  // Улучшенная детекция аномалий с множественными методами
  private detectAnomalies(data: EnhancedTimeSeriesData[]): number[] {
    const anomalies: Set<number> = new Set();
    const revenues = data.map((d) => d.revenue);

    if (revenues.length < 10) return [];

    // Метод 1: IQR (межквартильный размах)
    const iqrAnomalies = this.detectAnomaliesIQR(revenues);
    iqrAnomalies.forEach((idx) => anomalies.add(idx));

    // Метод 2: Z-score (статистические отклонения)
    const zscoreAnomalies = this.detectAnomaliesZScore(revenues);
    zscoreAnomalies.forEach((idx) => anomalies.add(idx));

    // Метод 3: Isolation Forest-подобный подход (локальные выбросы)
    const isolationAnomalies = this.detectAnomaliesIsolation(data);
    isolationAnomalies.forEach((idx) => anomalies.add(idx));

    // Метод 4: Временные аномалии (резкие скачки/падения)
    const temporalAnomalies = this.detectAnomaliesTemporal(data);
    temporalAnomalies.forEach((idx) => anomalies.add(idx));

    // Метод 5: Контекстуальные аномалии (несоответствие дня недели, праздников)
    const contextualAnomalies = this.detectAnomaliesContextual(data);
    contextualAnomalies.forEach((idx) => anomalies.add(idx));

    // Фильтруем ложные срабатывания - если несколько методов согласны, это аномалия
    const anomalyScores = new Map<number, number>();
    Array.from(anomalies).forEach((idx) => {
      anomalyScores.set(idx, (anomalyScores.get(idx) || 0) + 1);
    });

    // Аномалией считается точка, обнаруженная минимум 2 методами
    const confirmedAnomalies = Array.from(anomalyScores.entries())
      .filter(([_, score]) => score >= 2)
      .map(([idx, _]) => idx)
      .sort((a, b) => a - b);

    return confirmedAnomalies;
  }

  // Метод 1: IQR (межквартильный размах)
  private detectAnomaliesIQR(revenues: number[]): number[] {
    const anomalies: number[] = [];
    const sorted = [...revenues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    revenues.forEach((revenue, idx) => {
      if (revenue < lowerBound || revenue > upperBound) {
        anomalies.push(idx);
      }
    });

    return anomalies;
  }

  // Метод 2: Z-score (статистические отклонения)
  private detectAnomaliesZScore(revenues: number[]): number[] {
    const anomalies: number[] = [];
    const mean = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
    const variance =
      revenues.reduce((sum, rev) => sum + Math.pow(rev - mean, 2), 0) / revenues.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return [];

    revenues.forEach((revenue, idx) => {
      const zScore = Math.abs((revenue - mean) / stdDev);
      // Более строгий порог для Z-score (2.5 вместо 3)
      if (zScore > 2.5) {
        anomalies.push(idx);
      }
    });

    return anomalies;
  }

  // Метод 3: Isolation Forest-подобный подход (локальные выбросы)
  private detectAnomaliesIsolation(data: EnhancedTimeSeriesData[]): number[] {
    const anomalies: number[] = [];
    const revenues = data.map((d) => d.revenue);

    if (revenues.length < 10) return [];

    // Используем локальные окна для обнаружения выбросов
    const windowSize = Math.min(7, Math.floor(revenues.length / 2));
    
    for (let i = windowSize; i < revenues.length - windowSize; i++) {
      const window = revenues.slice(i - windowSize, i + windowSize + 1);
      const current = revenues[i];
      const windowMean = window.reduce((sum, r) => sum + r, 0) / window.length;
      const windowStd = Math.sqrt(
        window.reduce((sum, r) => sum + Math.pow(r - windowMean, 2), 0) / window.length
      );

      if (windowStd > 0) {
        const localZScore = Math.abs((current - windowMean) / windowStd);
        // Если точка сильно отличается от локального окна
        if (localZScore > 2.0) {
          anomalies.push(i);
        }
      }
    }

    return anomalies;
  }

  // Метод 4: Временные аномалии (резкие скачки/падения)
  private detectAnomaliesTemporal(data: EnhancedTimeSeriesData[]): number[] {
    const anomalies: number[] = [];
    const revenues = data.map((d) => d.revenue);

    for (let i = 1; i < revenues.length; i++) {
      const prevRevenue = revenues[i - 1];
      const currentRevenue = revenues[i];

      if (prevRevenue > 0) {
        const change = Math.abs(currentRevenue - prevRevenue) / prevRevenue;
        
        // Резкое изменение более 60% (более строгий порог)
        if (change > 0.6) {
          // Проверяем, не объясняется ли это днем недели или праздником
          const isWeekendChange = 
            (data[i].isWeekend && !data[i - 1].isWeekend) ||
            (!data[i].isWeekend && data[i - 1].isWeekend);
          
          const isHolidayChange = data[i].isHoliday || data[i - 1].isHoliday;
          
          // Если изменение не объясняется известными факторами, это аномалия
          if (!isWeekendChange && !isHolidayChange) {
            anomalies.push(i);
          }
        }
      }
    }

    return anomalies;
  }

  // Метод 5: Контекстуальные аномалии (несоответствие дня недели, праздников)
  private detectAnomaliesContextual(data: EnhancedTimeSeriesData[]): number[] {
    const anomalies: number[] = [];

    // Группируем по дню недели
    const dayOfWeekGroups = new Map<number, number[]>();
    data.forEach((d, idx) => {
      const day = d.dayOfWeek;
      if (!dayOfWeekGroups.has(day)) {
        dayOfWeekGroups.set(day, []);
      }
      dayOfWeekGroups.get(day)!.push(d.revenue);
    });

    // Рассчитываем средние значения для каждого дня недели
    const dayAverages = new Map<number, number>();
    dayOfWeekGroups.forEach((revenues, day) => {
      const avg = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
      dayAverages.set(day, avg);
    });

    // Проверяем каждую точку на соответствие ожиданиям для дня недели
    data.forEach((d, idx) => {
      const expectedAvg = dayAverages.get(d.dayOfWeek);
      if (expectedAvg && expectedAvg > 0) {
        const deviation = Math.abs(d.revenue - expectedAvg) / expectedAvg;
        
        // Если отклонение > 50% и это не праздник (праздники могут быть аномальными)
        if (deviation > 0.5 && !d.isHoliday) {
          anomalies.push(idx);
        }
      }
    });

    return anomalies;
  }

  // Корректировка данных с учетом аномалий
  private adjustForAnomalies(data: EnhancedTimeSeriesData[], anomalies: number[]): void {
    for (const anomalyIndex of anomalies) {
      const anomaly = data[anomalyIndex];

      // Заменяем аномальные значения на сглаженные
      if (anomalyIndex > 0 && anomalyIndex < data.length - 1) {
        const prev = data[anomalyIndex - 1];
        const next = data[anomalyIndex + 1];
        anomaly.revenue = (prev.revenue + next.revenue) / 2;

        console.log(`Скорректирована аномалия на ${anomaly.date}: ${anomaly.revenue}`);
      }
    }
  }

  private generateFallbackForecast(days: number): ForecastData[] {
    const forecasts: ForecastData[] = [];
    const lastDate = new Date(this.transactions[this.transactions.length - 1].date);
    const avgRevenue =
      this.transactions.reduce((sum, t) => sum + t.amount, 0) / this.transactions.length;

    for (let i = 1; i <= days; i++) {
      const forecastDate = addDays(lastDate, i);
      forecasts.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(avgRevenue),
        confidence: 0.3,
        trend: 'stable',
        weatherImpact: 0,
        holidayImpact: 0,
        economicImpact: 0,
        trafficImpact: 0,
        socialSentimentImpact: 0,
        demographicImpact: 0,
      });
    }

    return forecasts;
  }
}
