import { Transaction, ForecastData } from '@shared/schema';
import { addDays, format, getDay, startOfDay, endOfDay, subDays, isWeekend } from 'date-fns';
import { ExternalDataService, WeatherAPIResponse, EconomicIndicator, HolidayData, SocialSentiment } from './externalDataSources';

const isEnsembleDebugEnabled = process.env.DEBUG_ENSEMBLE === 'true';

function calculateHistoricalClamp(
  values: number[],
  fallback: number,
): { mean: number; std: number; clampLimit: number } {
  const sanitized = values.filter(value => Number.isFinite(value) && value > 0);
  const fallbackMean = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  const mean =
    sanitized.length > 0
      ? sanitized.reduce((sum, value) => sum + value, 0) / sanitized.length
      : fallbackMean;
  const effectiveMean = mean > 0 ? mean : fallbackMean;

  let variance = 0;
  if (sanitized.length > 1) {
    variance =
      sanitized.reduce((sum, value) => sum + Math.pow(value - effectiveMean, 2), 0) /
      sanitized.length;
  } else {
    variance = Math.pow(effectiveMean * 0.15, 2);
  }

  const std = Math.sqrt(Math.max(variance, 0));
  const safeStd = std > 1e-6 ? std : 1e-6;
  const limitBase = Math.max(effectiveMean * 3, effectiveMean + 3 * safeStd);
  const clampLimit = Number.isFinite(limitBase) && limitBase > 0 ? limitBase : effectiveMean * 3;

  return {
    mean: effectiveMean,
    std: safeStd,
    clampLimit,
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
}

interface AdvancedModel {
  name: string;
  weight: number;
  predict: (data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]) => number[];
}

interface ModelEnsemble {
  models: AdvancedModel[];
  metaModel: (predictions: number[][]) => number[];
}

/**
 * Продвинутый ML движок с интеграцией внешних данных
 */
export class EnhancedMLForecastingEngine {
  private transactions: Transaction[];
  private externalDataService?: ExternalDataService;
  private timeSeriesData: EnhancedTimeSeriesData[] = [];
  private modelEnsemble: ModelEnsemble;
  private lastAdaptiveDiagnostics: EnsembleDebugEntry[] = [];

  constructor(transactions: Transaction[], externalDataService?: ExternalDataService) {
    this.transactions = transactions;
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
          predict: this.arimaPredict.bind(this)
        },
        {
          name: 'Prophet',
          weight: 0.25,
          predict: this.prophetPredict.bind(this)
        },
        {
          name: 'LSTM',
          weight: 0.2,
          predict: this.lstmPredict.bind(this)
        },
        {
          name: 'RandomForest',
          weight: 0.15,
          predict: this.randomForestPredict.bind(this)
        },
        {
          name: 'XGBoost',
          weight: 0.15,
          predict: this.xgboostPredict.bind(this)
        },
        {
          name: 'GradientBoosting',
          weight: 0.05,
          predict: this.gradientBoostingPredict.bind(this)
        }
      ],
      metaModel: this.adaptiveEnsemble.bind(this)
    };
  }

  // Подготовка расширенных данных временных рядов
  private async prepareEnhancedTimeSeriesData(): Promise<EnhancedTimeSeriesData[]> {
    const dailyData = new Map<string, { revenue: number, count: number, transactions: Transaction[] }>();
    
    // Группируем транзакции по дням
    this.transactions.forEach(tx => {
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
    const sortedDates = Array.from(dailyData.keys()).sort();

    // Получаем внешние данные для всех дат
    let externalData: any = {};
    if (this.externalDataService) {
      try {
        externalData = await this.externalDataService.getAllExternalData({
          lat: 55.7558, // Москва
          lon: 37.6176,
          name: 'Moscow'
        });
      } catch (error) {
        console.warn('Failed to fetch external data:', error);
      }
    }

    for (let i = 0; i < sortedDates.length; i++) {
      const date = sortedDates[i];
      const data = dailyData.get(date)!;
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
      const isQuarterStart = dayOfMonth <= 3 && (month === 0 || month === 3 || month === 6 || month === 9);
      const isQuarterEnd = dayOfMonth >= 28 && (month === 2 || month === 5 || month === 8 || month === 11);
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
        revenue: data.revenue,
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
        isYearEnd
      };
      
      timeSeriesData.push(enhancedData);
    }

    this.timeSeriesData = timeSeriesData;
    return timeSeriesData;
  }

  // ARIMA модель с улучшенными параметрами
  private arimaPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
    if (data.length < 14) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const revenues = data.map(d => d.revenue);
    const n = revenues.length;
    
    // Автоматический выбор порядка ARIMA
    const arimaOrder = this.selectARIMAOrder(revenues);
    const { ar, ma, diff } = arimaOrder;
    
    // Применяем дифференцирование
    const diffRevenues = this.difference(revenues, diff);
    
    // Обучаем модель
    const arCoeffs = this.fitAR(diffRevenues, ar);
    const maCoeffs = this.fitMA(diffRevenues, ma);
    
    // Прогнозируем
    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const prediction = this.predictARIMA(diffRevenues, arCoeffs, maCoeffs, i + 1);
      const undiffPrediction = this.undifference(revenues, prediction, diff);
      predictions.push(Math.max(0, undiffPrediction));
    }
    
    return predictions;
  }

  // Prophet-подобная модель с сезонностью
  private prophetPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
    if (data.length < 7) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Анализируем тренд
    const trend = this.calculateTrend(data, data.length);
    
    // Анализируем сезонность
    const weeklySeasonality = this.calculateWeeklySeasonality(data);
    const monthlySeasonality = this.calculateMonthlySeasonality(data);
    const yearlySeasonality = this.calculateYearlySeasonality(data);
    
    // Анализируем праздничные эффекты
    const holidayEffects = this.calculateHolidayEffects(data);
    
    // Анализируем погодные эффекты
    const weatherEffects = this.calculateWeatherEffects(data);
    
    const predictions: number[] = [];
    const baseRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
    
    for (let i = 0; i < futureData.length; i++) {
      const future = futureData[i];
      if (!future) continue;
      
      let prediction = baseRevenue;
      
      // Тренд
      prediction += trend * (i + 1);
      
      // Сезонность
      if (future.dayOfWeek !== undefined) {
        prediction *= weeklySeasonality[future.dayOfWeek] || 1;
      }
      if (future.month !== undefined) {
        prediction *= monthlySeasonality[future.month] || 1;
      }
      if (future.quarter !== undefined) {
        prediction *= yearlySeasonality[future.quarter] || 1;
      }
      
      // Праздники
      if (future.isHoliday) {
        prediction *= (1 + (future.holidayImpact || 0));
      }
      
      // Погода
      if (future.temperature !== undefined) {
        prediction *= this.getWeatherMultiplier(future.temperature, future.precipitation || 0);
      }
      
      predictions.push(Math.max(0, prediction));
    }
    
    return predictions;
  }

  // LSTM-подобная модель
  private lstmPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
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
  private randomForestPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map(d => d.revenue);
    
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
  private xgboostPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map(d => d.revenue);
    
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
          ? stepRawWeights.map(weight => weight / totalWeight)
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

  // Расчет точности моделей на исторических данных
  private calculateModelAccuracy(predictions: number[][]): number[] {
    const accuracies: number[] = [];
    
    for (let i = 0; i < predictions.length; i++) {
      const modelPredictions = predictions[i];
      
      // Простая оценка стабильности прогнозов
      const variance = this.calculateVariance(modelPredictions);
      const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
      
      // Чем меньше вариация относительно среднего, тем выше точность
      const stability = Math.max(0, 1 - (variance / (mean + 1)));
      accuracies.push(stability);
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
    
    // Получаем внешние данные для будущих дат
    let futureExternalData: any = {};
    if (this.externalDataService) {
      try {
        futureExternalData = await this.externalDataService.getEnhancedForecastData({
          lat: 55.7558,
          lon: 37.6176,
          name: 'Moscow'
        }, days);
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
      const holiday = this.findHoliday(format(forecastDate, 'yyyy-MM-dd'), futureExternalData.holidays || []);
      
      // Погодные данные
      const weather = this.findWeatherData(format(forecastDate, 'yyyy-MM-dd'), futureExternalData.weather || []);
      
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
        socialSentiment: this.findSocialSentiment(format(forecastDate, 'yyyy-MM-dd'), futureExternalData.sentiment || [])?.sentiment || 0,
        socialVolume: this.findSocialSentiment(format(forecastDate, 'yyyy-MM-dd'), futureExternalData.sentiment || [])?.volume || 0
      });
    }

    // Получаем прогнозы от всех моделей
    const rawModelPredictions = this.modelEnsemble.models.map(model =>
      model.predict(timeSeriesData, futureData),
    );

    const revenueHistory = timeSeriesData.map(d => d.revenue);
    const averageRevenue =
      revenueHistory.length > 0
        ? revenueHistory.reduce((sum, value) => sum + value, 0) / revenueHistory.length
        : 0;
    const latestRevenue = revenueHistory[revenueHistory.length - 1] ?? 0;
    const baseRevenue = Math.max(averageRevenue, latestRevenue, 1);

    const modelPredictions = rawModelPredictions.map(series =>
      series.map(prediction => this.convertToAbsolutePrediction(prediction, baseRevenue)),
    );

    // Объединяем прогнозы
    const ensemblePredictions = this.modelEnsemble.metaModel(modelPredictions);
    const { clampLimit } = calculateHistoricalClamp(revenueHistory, baseRevenue);
    const clampedEnsemblePredictions = ensemblePredictions.map(pred => Math.min(pred, clampLimit));

    // Создаем финальные прогнозы
    const forecasts: ForecastData[] = [];
    for (let i = 0; i < days; i++) {
      const forecastDate = addDays(lastDate, i + 1);
      const future = futureData[i];
      
      // Расчет факторов влияния
      const factors = this.calculateEnhancedInfluenceFactors(forecastDate, timeSeriesData, future);
      
      // Расчет уверенности
      const confidence = this.calculateEnhancedConfidence(timeSeriesData, modelPredictions, i);
      
      // Определение тренда
      const trend = this.determineTrend(clampedEnsemblePredictions, i);

      const rawPrediction = ensemblePredictions[i] ?? 0;
      const clampedPrediction = clampedEnsemblePredictions[i] ?? 0;
      const safePrediction = Math.max(0, clampedPrediction);

      if (isEnsembleDebugEnabled) {
        const dateLabel = format(forecastDate, 'yyyy-MM-dd');
        console.debug(
          `[enhanced ensemble][${dateLabel}] base=${formatDebugNumber(baseRevenue)} ` +
            `raw=${formatDebugNumber(rawPrediction)} ` +
            `clamp=${formatDebugNumber(clampLimit)} ` +
            `clamped=${formatDebugNumber(clampedPrediction)} ` +
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
    return holidays.find(h => h.date === date);
  }

  private findWeatherData(date: string, weather: WeatherAPIResponse | WeatherAPIResponse[]): WeatherAPIResponse | undefined {
    if (Array.isArray(weather)) {
      return weather.find(w => w.date === date);
    }
    return weather;
  }

  private findSocialSentiment(date: string, sentiment: SocialSentiment[]): SocialSentiment | undefined {
    return sentiment.find(s => s.date === date);
  }

  private calculateMovingAverage(data: EnhancedTimeSeriesData[], period: number, field: keyof EnhancedTimeSeriesData): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map(d => d[field] as number);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private calculateVolatility(data: EnhancedTimeSeriesData[], period: number): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map(d => d.revenue);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateTrend(data: EnhancedTimeSeriesData[], period: number): number {
    if (data.length < period) return 0;
    const values = data.slice(-period).map(d => d.revenue);
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

  private predictARIMA(data: number[], arCoeffs: number[], maCoeffs: number[], steps: number): number {
    return data[data.length - 1] || 0;
  }

  private calculateWeeklySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const weekly = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    
    data.forEach(d => {
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
    
    data.forEach(d => {
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

  private calculateYearlySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const quarterly = new Array(4).fill(0);
    const counts = new Array(4).fill(0);
    
    data.forEach(d => {
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
    const holidayData = data.filter(d => d.isHoliday);
    
    if (holidayData.length > 0) {
      const avgHolidayRevenue = holidayData.reduce((sum, d) => sum + d.revenue, 0) / holidayData.length;
      const avgRegularRevenue = data.filter(d => !d.isHoliday).reduce((sum, d) => sum + d.revenue, 0) / data.filter(d => !d.isHoliday).length;
      effects.set('holiday', avgRegularRevenue > 0 ? (avgHolidayRevenue - avgRegularRevenue) / avgRegularRevenue : 0);
    }
    
    return effects;
  }

  private calculateWeatherEffects(data: EnhancedTimeSeriesData[]): Map<string, number> {
    const effects = new Map<string, number>();
    
    // Анализируем влияние температуры
    const coldDays = data.filter(d => d.temperature < 5);
    const hotDays = data.filter(d => d.temperature > 25);
    const normalDays = data.filter(d => d.temperature >= 5 && d.temperature <= 25);
    
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
    return data.map(d => [
      d.revenue,
      d.dayOfWeek / 7,
      d.dayOfMonth / 31,
      d.month / 12,
      d.temperature / 50,
      d.precipitation / 20,
      d.humidity / 100,
      d.isWeekend ? 1 : 0,
      d.isHoliday ? 1 : 0,
      d.socialSentiment,
      d.consumerConfidence,
      d.movingAverage7 / 10000,
      d.volatility / 1000
    ]);
  }

  private trainLSTM(features: number[][], sequenceLength: number): any {
    // Упрощенная LSTM модель
    return {
      weights: Array(13).fill(0.1),
      bias: 0.1
    };
  }

  private predictLSTM(features: number[][], weights: any, steps: number): number {
    const lastFeatures = features[features.length - 1];
    return lastFeatures.reduce((sum, val, i) => sum + val * weights.weights[i], weights.bias) * 1000;
  }

  private extractFeatures(data: EnhancedTimeSeriesData[]): number[][] {
    return data.map(d => [
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
      d.isYearEnd ? 1 : 0
    ]);
  }

  private extractFutureFeatures(future: Partial<EnhancedTimeSeriesData>, data: EnhancedTimeSeriesData[]): number[] {
    const lastData = data[data.length - 1];
    return [
      lastData?.revenue || 0,
      future.dayOfWeek || 0,
      future.dayOfMonth || 0,
      future.month || 0,
      future.quarter || 0,
      future.temperature || 15,
      future.precipitation || 0,
      future.humidity || 60,
      future.windSpeed || 5,
      future.cloudCover || 30,
      future.uvIndex || 3,
      future.visibility || 10,
      future.exchangeRate || 95.5,
      future.inflation || 4.5,
      future.consumerConfidence || 0.2,
      future.unemploymentRate || 3.2,
      future.socialSentiment || 0,
      future.socialVolume || 0,
      lastData?.movingAverage7 || 0,
      lastData?.movingAverage14 || 0,
      lastData?.movingAverage30 || 0,
      lastData?.volatility || 0,
      lastData?.trend || 0,
      future.isWeekend ? 1 : 0,
      future.isHoliday ? 1 : 0,
      future.month !== undefined && future.month >= 2 && future.month <= 4 ? 1 : 0,
      future.month !== undefined && future.month >= 5 && future.month <= 7 ? 1 : 0,
      future.month !== undefined && future.month >= 8 && future.month <= 10 ? 1 : 0,
      future.month !== undefined && (future.month === 11 || future.month === 0 || future.month === 1) ? 1 : 0,
      future.isMonthStart ? 1 : 0,
      future.isMonthEnd ? 1 : 0,
      future.isQuarterStart ? 1 : 0,
      future.isQuarterEnd ? 1 : 0,
      future.isYearStart ? 1 : 0,
      future.isYearEnd ? 1 : 0
    ];
  }

  private trainRandomForest(features: number[][], targets: number[], nTrees: number): any[] {
    // Упрощенная Random Forest
    return Array(nTrees).fill(null).map(() => ({
      feature: Math.floor(Math.random() * features[0].length),
      threshold: Math.random() * 1000,
      leftValue: Math.random() * 1000,
      rightValue: Math.random() * 1000
    }));
  }

  private predictRandomForest(trees: any[], features: number[]): number {
    const predictions = trees.map(tree => {
      const value = features[tree.feature];
      return value < tree.threshold ? tree.leftValue : tree.rightValue;
    });
    return predictions.reduce((sum: number, val: number) => sum + val, 0) / predictions.length;
  }

  private trainXGBoost(features: number[][], targets: number[]): any {
    const featureCount = features[0]?.length ?? 0;
    const baseline = this.calculateMeanValue(targets, 0);

    if (featureCount === 0 || features.length === 0 || targets.length === 0) {
      return { baseline, trees: [] };
    }

    const treeCount = Math.min(10, featureCount);
    const trees: Array<{ feature: number; threshold: number; leftValue: number; rightValue: number }> = [];

    for (let i = 0; i < treeCount; i++) {
      const featureIndex = i % featureCount;
      const featureValues = features
        .map(row => (row && Number.isFinite(row[featureIndex]) ? row[featureIndex] : undefined))
        .filter((value): value is number => value !== undefined);

      const threshold = this.calculateMedianValue(featureValues, 0);
      const { left, right } = this.partitionTargetsByThreshold(features, targets, featureIndex, threshold);

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

      const featureIndex =
        typeof tree.feature === 'number' && tree.feature >= 0 ? tree.feature : 0;
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
    return Math.max(0, meanPrediction);
  }

  private calculateMeanValue(values: number[], fallback: number): number {
    const finite = values.filter(value => Number.isFinite(value));
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
    const safeMultiplier =
      Number.isFinite(rawMultiplier) && rawMultiplier >= 0 ? rawMultiplier : 0;

    return safeBase * safeMultiplier;
  }

  private calculateMedianValue(values: number[], fallback: number): number {
    const finite = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
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
      const fallbackTargets = targets.filter(value => Number.isFinite(value));
      return { left: [], right: fallbackTargets };
    }

    return { left, right };
  }

  private estimateSeasonalityStrength(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 7) {
      return 0.1;
    }

    const dayGroups = new Map<number, number[]>();
    data.forEach(entry => {
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

    const averages = Array.from(dayGroups.values()).map(values =>
      this.calculateMeanValue(values, 0),
    );

    const meanOfMeans = this.calculateMeanValue(averages, 0);
    if (meanOfMeans <= 0) {
      return 0.1;
    }

    const variance =
      averages.reduce((sum, value) => sum + Math.pow(value - meanOfMeans, 2), 0) /
      averages.length;
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
      .map(entry => entry.revenue)
      .filter(value => Number.isFinite(value));
    const previous = data
      .slice(-14, -7)
      .map(entry => entry.revenue)
      .filter(value => Number.isFinite(value));

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
  private gradientBoostingPredict(data: EnhancedTimeSeriesData[], futureData: Partial<EnhancedTimeSeriesData>[]): number[] {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    const features = this.extractFeatures(data);
    const targets = data.map(d => d.revenue);
    
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
      trees: Array(20).fill(null).map(() => ({
        feature: Math.floor(Math.random() * features[0].length),
        threshold: Math.random() * 1000,
        leftValue: Math.random() * 1000,
        rightValue: Math.random() * 1000,
        learningRate: 0.1
      }))
    };
  }

  private predictGradientBoosting(model: any, features: number[]): number {
    let prediction = 0;
    for (const tree of model.trees) {
      const value = features[tree.feature];
      const treePrediction = value < tree.threshold ? tree.leftValue : tree.rightValue;
      prediction += treePrediction * tree.learningRate;
    }
    return prediction;
  }

  private calculateEnhancedInfluenceFactors(date: Date, data: EnhancedTimeSeriesData[], future: Partial<EnhancedTimeSeriesData>): any {
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
      economicIndicators: this.calculateEconomicIndicatorsFactor(future)
    };
  }

  private calculateSeasonalFactor(dayOfWeek: number, month: number, data: EnhancedTimeSeriesData[]): number {
    const dayOfWeekData = data.filter(d => d.dayOfWeek === dayOfWeek);
    const monthData = data.filter(d => d.month === month);
    
    if (dayOfWeekData.length === 0 || monthData.length === 0) return 1;

    const avgDayRevenue = dayOfWeekData.reduce((sum, d) => sum + d.revenue, 0) / dayOfWeekData.length;
    const avgMonthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0) / monthData.length;
    const overallAvg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return (avgDayRevenue + avgMonthRevenue) / (2 * overallAvg);
  }

  private calculateTrendFactor(data: EnhancedTimeSeriesData[]): number {
    if (data.length < 7) return 0;

    const recent = data.slice(-7).map(d => d.revenue);
    const older = data.slice(-14, -7).map(d => d.revenue);

    const recentAvg = recent.reduce((sum, rev) => sum + rev, 0) / recent.length;
    const olderAvg = older.reduce((sum, rev) => sum + rev, 0) / older.length;

    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  private calculateWeatherFactor(future: Partial<EnhancedTimeSeriesData>): number {
    if (!future.temperature) return 0;
    
    let factor = 0;
    
    // Температурный эффект
    if (future.temperature < 0) factor -= 0.1;
    else if (future.temperature > 30) factor -= 0.05;
    else if (future.temperature >= 15 && future.temperature <= 25) factor += 0.05;
    
    // Эффект осадков
    if (future.precipitation && future.precipitation > 5) factor -= 0.1;
    else if (future.precipitation && future.precipitation > 2) factor -= 0.05;
    
    return factor;
  }

  private calculateTimeOfMonthFactor(dayOfMonth: number): number {
    if (dayOfMonth <= 5) return -0.05;
    if (dayOfMonth >= 25) return 0.1;
    return 0;
  }

  private calculateHistoricalPatternFactor(dayOfWeek: number, data: EnhancedTimeSeriesData[]): number {
    const sameDayData = data.filter(d => d.dayOfWeek === dayOfWeek);
    if (sameDayData.length < 2) return 0;

    const revenues = sameDayData.map(d => d.revenue);
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

  private calculateEconomicIndicatorsFactor(future: Partial<EnhancedTimeSeriesData>): number {
    let factor = 0;
    
    // Влияние курса валют
    if (future.exchangeRate) {
      const baseRate = 95.5;
      factor += (future.exchangeRate - baseRate) / baseRate * 0.1;
    }
    
    // Влияние инфляции
    if (future.inflation) {
      const baseInflation = 4.5;
      factor -= (future.inflation - baseInflation) * 0.05;
    }
    
    // Влияние потребительского доверия
    if (future.consumerConfidence) {
      factor += future.consumerConfidence * 0.1;
    }
    
    return factor;
  }

  private calculateEnhancedConfidence(data: EnhancedTimeSeriesData[], modelPredictions: number[][], step: number): number {
    // Базовое качество данных
    const dataQuality = Math.min(1, data.length / 100);
    
    // Согласованность моделей
    const predictions = modelPredictions.map(pred => pred[step]);
    const mean = predictions.reduce((sum, pred) => sum + pred, 0) / predictions.length;
    const variance = predictions.reduce((sum, pred) => sum + Math.pow(pred - mean, 2), 0) / predictions.length;
    const consistency = Math.max(0, 1 - Math.sqrt(variance) / (mean + 1));
    
    // Стабильность тренда
    const recentTrend = this.calculateTrend(data.slice(-14), 14);
    const trendStability = Math.max(0, 1 - Math.abs(recentTrend) / 1000);
    
    // Внешние факторы
    const externalFactors = this.calculateExternalFactorConfidence(data);
    
    return Math.min(0.95, 
      dataQuality * 0.3 + 
      consistency * 0.3 + 
      trendStability * 0.2 + 
      externalFactors * 0.2
    );
  }

  private calculateExternalFactorConfidence(data: EnhancedTimeSeriesData[]): number {
    // Проверяем наличие внешних данных
    const hasWeather = data.some(d => d.temperature !== 15);
    const hasEconomic = data.some(d => d.exchangeRate !== 95.5);
    const hasSocial = data.some(d => d.socialSentiment !== 0);
    
    let confidence = 0.5; // Базовый уровень
    
    if (hasWeather) confidence += 0.1;
    if (hasEconomic) confidence += 0.1;
    if (hasSocial) confidence += 0.1;
    
    return Math.min(1, confidence);
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
    
    return (completeness * 0.4 + consistency * 0.3 + trendStability * 0.3);
  }

  private calculateDataCompleteness(data: EnhancedTimeSeriesData[]): number {
    const expectedFields = [
      'revenue', 'temperature', 'humidity', 'precipitation',
      'exchangeRate', 'consumerConfidence', 'socialSentiment'
    ];
    
    let totalCompleteness = 0;
    for (const field of expectedFields) {
      const nonDefaultValues = data.filter(d => {
        const value = (d as any)[field];
        return value !== undefined && value !== null && 
               !(field === 'temperature' && value === 15) &&
               !(field === 'humidity' && value === 60) &&
               !(field === 'exchangeRate' && value === 95.5);
      }).length;
      
      totalCompleteness += nonDefaultValues / data.length;
    }
    
    return totalCompleteness / expectedFields.length;
  }

  private calculateDataConsistency(data: EnhancedTimeSeriesData[]): number {
    const revenues = data.map(d => d.revenue);
    const mean = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
    const variance = revenues.reduce((sum, rev) => sum + Math.pow(rev - mean, 2), 0) / revenues.length;
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
    const modelPerformance = performanceRaw.map(perf =>
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
      .map(entry => entry.revenue)
      .filter(value => Number.isFinite(value) && value > 0);

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

    const basePerformance = this.modelEnsemble.models.map(model =>
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

  // Детекция аномалий в данных
  private detectAnomalies(data: EnhancedTimeSeriesData[]): number[] {
    const anomalies: number[] = [];
    const revenues = data.map(d => d.revenue);
    
    if (revenues.length < 10) return anomalies;
    
    // Используем метод межквартильного размаха (IQR) для детекции выбросов
    const sorted = [...revenues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    // Также проверяем на статистические аномалии
    const mean = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
    const variance = revenues.reduce((sum, rev) => sum + Math.pow(rev - mean, 2), 0) / revenues.length;
    const stdDev = Math.sqrt(variance);
    
    for (let i = 0; i < revenues.length; i++) {
      const revenue = revenues[i];
      
      // Проверяем на выбросы по IQR
      if (revenue < lowerBound || revenue > upperBound) {
        anomalies.push(i);
        continue;
      }
      
      // Проверяем на статистические аномалии (более 3 стандартных отклонений)
      if (Math.abs(revenue - mean) > 3 * stdDev) {
        anomalies.push(i);
        continue;
      }
      
      // Проверяем на внезапные скачки (изменение более чем на 50% от предыдущего дня)
      if (i > 0) {
        const prevRevenue = revenues[i - 1];
        const change = Math.abs(revenue - prevRevenue) / prevRevenue;
        if (change > 0.5 && prevRevenue > 0) {
          anomalies.push(i);
        }
      }
    }
    
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
    const avgRevenue = this.transactions.reduce((sum, t) => sum + t.amount, 0) / this.transactions.length;

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
