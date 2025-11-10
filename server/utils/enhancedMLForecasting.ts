import { Transaction, ForecastData, ProfitabilityRecord, InsertForecastPrediction } from '@shared/schema';
import { addDays, format, getDay, startOfDay, endOfDay, subDays, isWeekend } from 'date-fns';
import {
  ExternalDataService,
  WeatherAPIResponse,
  EconomicIndicator,
  HolidayData,
  SocialSentiment,
} from './externalDataSources';
import { getEnhancedSalesDataForPeriod, type EnhancedSalesData } from './enhancedDataIntegration';
import { LLMForecastingEngine } from './llmForecasting';
import type { IStorage } from '../storage';
import { spawn } from 'child_process';
import { join } from 'path';
import { createHash } from 'crypto';

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
export interface EnhancedTimeSeriesData {
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

// Интерфейс для сериализуемых параметров модели
interface ModelParameters {
  dataHash: string; // Хеш данных для проверки актуальности
  trainedAt: Date;
  parameters: Record<string, any>; // Параметры модели (коэффициенты, веса и т.д.)
  dataLength: number; // Количество точек данных, на которых обучена модель
  lastDataDate?: string; // Дата последней точки данных
}

// Кеш обученных моделей
interface ModelCache {
  [modelName: string]: {
    [dataHash: string]: {
      parameters: ModelParameters;
      lastUsed: Date;
    };
  };
}

interface AdvancedModel {
  name: string;
  weight: number;
  predict: (
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ) => number[] | Promise<number[]>; // Поддержка как синхронных, так и асинхронных моделей
}

interface ModelEnsemble {
  models: AdvancedModel[];
  metaModel: (predictions: number[][], futureData?: Partial<EnhancedTimeSeriesData>[]) => Promise<number[]>;
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
  private dayOfWeekAccuracies: Map<number, number[]> = new Map(); // Точность моделей по дням недели
  private llmEngine?: LLMForecastingEngine;
  private currentLLMWeight: number = 0.15; // Текущий вес LLM модели
  private lastGRUAnalysisDate?: Date; // Дата последнего анализа интеграции GRU
  private useLLM: boolean; // Флаг использования LLM
  private storage?: IStorage; // Хранилище для сохранения прогнозов
  private uploadId?: string; // ID загрузки данных для связи прогнозов с данными
  private modelCache: ModelCache = {}; // Кеш обученных моделей
  private readonly CACHE_MAX_SIZE = 50; // Максимальное количество моделей в кеше
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Время жизни кеша: 24 часа

  constructor(
    transactions: Transaction[],
    externalDataService?: ExternalDataService,
    profitabilityRecords?: ProfitabilityRecord[],
    useLLM: boolean = true, // По умолчанию используем LLM, если доступен
    storage?: IStorage, // Хранилище для сохранения прогнозов
    uploadId?: string, // ID загрузки данных
  ) {
    this.transactions = transactions;
    this.profitabilityRecords = profitabilityRecords;
    this.externalDataService = externalDataService;
    this.useLLM = useLLM;
    this.storage = storage;
    this.uploadId = uploadId;
    // LLM движок будет инициализирован лениво при первом использовании
    this.llmEngine = undefined;
    this.modelEnsemble = this.initializeModelEnsemble();
    
    // Загружаем модели из БД асинхронно (не блокируем конструктор)
    if (this.storage && this.uploadId) {
      this.loadModelsFromDB().catch((error) => {
        console.warn(`[EnhancedMLForecast] Ошибка при загрузке моделей из БД: ${error}`);
      });
    }
  }

  // Ленивая инициализация LLM движка
  private ensureLLMEngine(): void {
    if (this.llmEngine !== undefined) {
      return; // Уже инициализирован или явно отключен
    }

    // Если LLM отключен через параметр конструктора, не инициализируем
    if (!this.useLLM) {
      this.llmEngine = undefined;
      console.debug('[EnhancedMLForecast] LLM отключен через параметр конструктора (useLLM=false)');
      return;
    }

    // LLM всегда включен по умолчанию, если есть API ключ
    const apiKey = process.env.OPENAI_API_KEY || '';
    
    if (!apiKey) {
      this.llmEngine = undefined;
      return;
    }
    
    try {
      this.llmEngine = new LLMForecastingEngine();
      if (this.llmEngine.isAvailable()) {
        console.log('[EnhancedMLForecast] ✅ LLM движок успешно инициализирован');
      } else {
        console.warn('[EnhancedMLForecast] ⚠️  LLM движок создан, но недоступен (проверьте конфигурацию)');
      }
    } catch (error) {
      console.error('[EnhancedMLForecast] ❌ Не удалось инициализировать LLM движок:', error);
      this.llmEngine = undefined;
    }
  }

  // Инициализация ансамбля моделей
  private initializeModelEnsemble(): ModelEnsemble {
    return {
      models: [
        {
          name: 'ARIMA',
          weight: 0.15,
          predict: this.arimaPredict.bind(this),
        },
        {
          name: 'Prophet',
          weight: 0.15,
          predict: this.prophetPredict.bind(this),
        },
        {
          name: 'LSTM',
          weight: 0.12,
          predict: this.lstmPredict.bind(this),
        },
        {
          name: 'GRU',
          weight: 0.12,
          predict: this.gruPredict.bind(this),
        },
        {
          name: 'RandomForest',
          weight: 0.12,
          predict: this.randomForestPredict.bind(this),
        },
        {
          name: 'XGBoost',
          weight: 0.12,
          predict: this.xgboostPredict.bind(this),
        },
        {
          name: 'GradientBoosting',
          weight: 0.05,
          predict: this.gradientBoostingPredict.bind(this),
        },
        {
          name: 'NHITS',
          weight: 0.20,
          predict: this.nhitsPredict.bind(this),
        },
      ],
      metaModel: this.adaptiveEnsemble.bind(this),
    };
  }

  // ========== Методы для работы с кешем моделей ==========

  /**
   * Вычисляет хеш данных для идентификации модели в кеше
   */
  private computeDataHash(data: EnhancedTimeSeriesData[]): string {
    if (data.length === 0) return 'empty';
    
    // Используем последние N точек и общую статистику для хеша
    const lastN = Math.min(20, data.length);
    const lastPoints = data.slice(-lastN);
    const hashInput = JSON.stringify({
      length: data.length,
      lastDates: lastPoints.map(d => d.date),
      lastRevenues: lastPoints.map(d => d.revenue),
      firstDate: data[0]?.date,
      lastDate: data[data.length - 1]?.date,
    });
    
    return createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
  }

  /**
   * Получает модель из кеша, если она актуальна
   * Проверяет сначала in-memory кеш, затем БД
   */
  private async getCachedModel(modelName: string, dataHash: string): Promise<ModelParameters | null> {
    const now = new Date();
    const cached = this.modelCache[modelName]?.[dataHash];
    
    // Проверяем in-memory кеш
    if (cached) {
      // Проверяем TTL
      const age = now.getTime() - cached.lastUsed.getTime();
      if (age > this.CACHE_TTL_MS) {
        delete this.modelCache[modelName][dataHash];
      } else {
        // Обновляем время последнего использования
        cached.lastUsed = now;
        return cached.parameters;
      }
    }
    
    // Если не найдено в памяти и есть storage, проверяем БД
    if (this.storage && this.uploadId) {
      try {
        const dbModel = await this.storage.getMLModel(modelName, this.uploadId, dataHash);
        if (dbModel) {
          // Проверяем TTL для модели из БД
          const age = now.getTime() - dbModel.lastUsedAt.getTime();
          if (age <= this.CACHE_TTL_MS) {
            // Загружаем модель в память
            const modelParams: ModelParameters = {
              dataHash: dbModel.dataHash,
              trainedAt: dbModel.trainedAt,
              parameters: dbModel.parameters as Record<string, any>,
              dataLength: dbModel.dataLength,
              lastDataDate: dbModel.lastDataDate?.toISOString(),
            };
            
            // Сохраняем в in-memory кеш
            if (!this.modelCache[modelName]) {
              this.modelCache[modelName] = {};
            }
            this.modelCache[modelName][dataHash] = {
              parameters: modelParams,
              lastUsed: now,
            };
            
            // Обновляем время последнего использования в БД
            await this.storage.updateMLModelLastUsed(dbModel.id);
            
            return modelParams;
          }
        }
      } catch (error) {
        console.warn(`[EnhancedMLForecast] Ошибка при загрузке модели из БД: ${error}`);
      }
    }
    
    return null;
  }

  /**
   * Сохраняет модель в кеш (in-memory и БД)
   */
  private async saveModelToCache(modelName: string, parameters: ModelParameters): Promise<void> {
    if (!this.modelCache[modelName]) {
      this.modelCache[modelName] = {};
    }
    
    this.modelCache[modelName][parameters.dataHash] = {
      parameters,
      lastUsed: new Date(),
    };
    
    // Сохраняем в БД, если есть storage и uploadId
    if (this.storage && this.uploadId) {
      try {
        await this.saveModelToDB(modelName, parameters);
      } catch (error) {
        console.warn(`[EnhancedMLForecast] Ошибка при сохранении модели в БД: ${error}`);
      }
    }
    
    // Очищаем старые модели если кеш переполнен
    this.cleanupCache();
  }
  
  /**
   * Сохраняет модель в БД
   */
  private async saveModelToDB(modelName: string, parameters: ModelParameters): Promise<void> {
    if (!this.storage || !this.uploadId) {
      return;
    }
    
    // Определяем, поддерживает ли модель инкрементальное обучение
    const supportsIncremental = ['LSTM', 'GRU', 'RandomForest', 'XGBoost', 'GradientBoosting'].includes(modelName);
    
    try {
      await this.storage.saveMLModel({
        modelName,
        uploadId: this.uploadId,
        dataHash: parameters.dataHash,
        parameters: parameters.parameters,
        dataLength: parameters.dataLength,
        lastDataDate: parameters.lastDataDate ? new Date(parameters.lastDataDate) : null,
        version: 1,
        supportsIncremental,
      });
    } catch (error) {
      console.error(`[EnhancedMLForecast] Ошибка при сохранении модели ${modelName} в БД:`, error);
      throw error;
    }
  }
  
  /**
   * Загружает модели из БД при инициализации
   */
  private async loadModelsFromDB(): Promise<void> {
    if (!this.storage || !this.uploadId) {
      return;
    }
    
    try {
      const dbModels = await this.storage.getMLModelsByUploadId(this.uploadId);
      const now = new Date();
      
      for (const dbModel of dbModels) {
        // Проверяем TTL
        const age = now.getTime() - dbModel.lastUsedAt.getTime();
        if (age <= this.CACHE_TTL_MS) {
          const modelParams: ModelParameters = {
            dataHash: dbModel.dataHash,
            trainedAt: dbModel.trainedAt,
            parameters: dbModel.parameters as Record<string, any>,
            dataLength: dbModel.dataLength,
            lastDataDate: dbModel.lastDataDate?.toISOString(),
          };
          
          // Загружаем в in-memory кеш
          if (!this.modelCache[dbModel.modelName]) {
            this.modelCache[dbModel.modelName] = {};
          }
          this.modelCache[dbModel.modelName][dbModel.dataHash] = {
            parameters: modelParams,
            lastUsed: dbModel.lastUsedAt,
          };
        }
      }
      
      if (dbModels.length > 0) {
        console.log(`[EnhancedMLForecast] ✅ Загружено ${dbModels.length} моделей из БД для uploadId: ${this.uploadId}`);
      }
    } catch (error) {
      console.warn(`[EnhancedMLForecast] Ошибка при загрузке моделей из БД: ${error}`);
    }
  }

  /**
   * Очищает устаревшие модели из кеша
   */
  private cleanupCache(): void {
    const now = new Date();
    let totalModels = 0;
    
    // Подсчитываем общее количество моделей
    for (const modelName in this.modelCache) {
      totalModels += Object.keys(this.modelCache[modelName]).length;
    }
    
    // Если кеш переполнен, удаляем самые старые модели
    if (totalModels > this.CACHE_MAX_SIZE) {
      const allEntries: Array<{ modelName: string; dataHash: string; lastUsed: Date }> = [];
      
      for (const modelName in this.modelCache) {
        for (const dataHash in this.modelCache[modelName]) {
          allEntries.push({
            modelName,
            dataHash,
            lastUsed: this.modelCache[modelName][dataHash].lastUsed,
          });
        }
      }
      
      // Сортируем по времени последнего использования (старые первыми)
      allEntries.sort((a, b) => a.lastUsed.getTime() - b.lastUsed.getTime());
      
      // Удаляем самые старые модели
      const toRemove = totalModels - this.CACHE_MAX_SIZE;
      for (let i = 0; i < toRemove; i++) {
        const entry = allEntries[i];
        delete this.modelCache[entry.modelName][entry.dataHash];
        if (Object.keys(this.modelCache[entry.modelName]).length === 0) {
          delete this.modelCache[entry.modelName];
        }
      }
    }
    
    // Удаляем модели с истекшим TTL
    for (const modelName in this.modelCache) {
      for (const dataHash in this.modelCache[modelName]) {
        const age = now.getTime() - this.modelCache[modelName][dataHash].lastUsed.getTime();
        if (age > this.CACHE_TTL_MS) {
          delete this.modelCache[modelName][dataHash];
        }
      }
      if (Object.keys(this.modelCache[modelName]).length === 0) {
        delete this.modelCache[modelName];
      }
    }
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
  // Теперь включает SARIMA для учета недельной сезонности и улучшенный выбор порядка
  private async arimaPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 14) {
      // Для малых датасетов используем более простой подход
      const lastRevenue = data[data.length - 1]?.revenue || 0;
      const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      const basePrediction = (lastRevenue + avgRevenue) / 2;
      return futureData.map(() => basePrediction);
    }

    const revenues = data.map((d) => d.revenue);
    const n = revenues.length;
    
    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('ARIMA', dataHash);
    
    let arCoeffs: number[];
    let maCoeffs: number[];
    let sarCoeffs: number[] = [];
    let smaCoeffs: number[] = [];
    let arimaOrder: ReturnType<typeof this.selectARIMAOrderImproved>;
    let cleanedRevenues: number[];
    let diffRevenues: number[];
    let seasonalDiffRevenues: number[];
    let median: number;
    
    if (cachedModel && cachedModel.parameters.arCoeffs && cachedModel.parameters.maCoeffs) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[ARIMA] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      arCoeffs = cachedModel.parameters.arCoeffs;
      maCoeffs = cachedModel.parameters.maCoeffs;
      sarCoeffs = cachedModel.parameters.sarCoeffs || [];
      smaCoeffs = cachedModel.parameters.smaCoeffs || [];
      arimaOrder = cachedModel.parameters.arimaOrder;
      median = cachedModel.parameters.median;
      
      // Для обратного дифференцирования нужны полные данные, пересчитываем их
      cleanedRevenues = this.removeOutliers(revenues);
      const { diff, seasonalDiff, seasonalPeriod } = arimaOrder;
      diffRevenues = this.difference(cleanedRevenues, diff);
      seasonalDiffRevenues = diffRevenues;
      if (seasonalPeriod > 0 && seasonalDiff > 0 && diffRevenues.length >= seasonalPeriod * 2) {
        seasonalDiffRevenues = this.seasonalDifference(diffRevenues, seasonalPeriod, seasonalDiff);
      }
    } else {
      // Обучаем модель заново
      console.log(`[ARIMA] 🔄 Обучение новой модели на ${data.length} точках данных`);
      // Обработка выбросов перед обучением модели
      cleanedRevenues = this.removeOutliers(revenues);
      
      // Используем медиану для более устойчивой оценки
      const sorted = [...cleanedRevenues].sort((a, b) => a - b);
      median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];

      // Улучшенный автоматический выбор порядка ARIMA через AIC/BIC
      arimaOrder = this.selectARIMAOrderImproved(cleanedRevenues);
      const { ar, ma, diff, sar, sma, seasonalDiff, seasonalPeriod } = arimaOrder;

      // Применяем дифференцирование
      diffRevenues = this.difference(cleanedRevenues, diff);

      // Применяем сезонное дифференцирование для SARIMA (если есть сезонность)
      seasonalDiffRevenues = diffRevenues;
      if (seasonalPeriod > 0 && seasonalDiff > 0 && diffRevenues.length >= seasonalPeriod * 2) {
        seasonalDiffRevenues = this.seasonalDifference(diffRevenues, seasonalPeriod, seasonalDiff);
      }

      // Обучаем модель с улучшенными методами
      arCoeffs = this.fitARImproved(seasonalDiffRevenues, ar);
      maCoeffs = this.fitMAImproved(seasonalDiffRevenues, ma);
      
      // Обучаем сезонные компоненты SARIMA (если есть)
      if (seasonalPeriod > 0 && sar > 0 && sma > 0 && seasonalDiffRevenues.length >= seasonalPeriod * 2) {
        sarCoeffs = this.fitARImproved(seasonalDiffRevenues, sar, seasonalPeriod);
        smaCoeffs = this.fitMAImproved(seasonalDiffRevenues, sma, seasonalPeriod);
      }
      
      // Сохраняем модель в кеш (только параметры, без данных)
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          arCoeffs,
          maCoeffs,
          sarCoeffs,
          smaCoeffs,
          arimaOrder,
          median,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      await this.saveModelToCache('ARIMA', modelParams);
      console.log(`[ARIMA] 💾 Модель сохранена в кеш (хеш: ${dataHash.substring(0, 8)}...)`);
    }
    
    const { diff, seasonalPeriod, seasonalDiff } = arimaOrder;

    // Прогнозируем с ограничениями
    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      // Прогноз с учетом сезонности
      let prediction = this.predictARIMAImproved(
        seasonalDiffRevenues,
        arCoeffs,
        maCoeffs,
        i + 1,
        sarCoeffs,
        smaCoeffs,
        seasonalPeriod,
      );
      
      // Обратное сезонное дифференцирование
      if (seasonalPeriod > 0 && seasonalDiff > 0) {
        prediction = this.undifferenceSeasonal(
          diffRevenues,
          prediction,
          seasonalPeriod,
          seasonalDiff,
        );
      }
      
      // Обратное дифференцирование
      const undiffPrediction = this.undifference(cleanedRevenues, prediction, diff);
      
      // Ограничиваем прогноз: не более 1.5x от медианы и не менее 0.5x
      let clampedPrediction = Math.max(
        median * 0.5,
        Math.min(median * 1.5, undiffPrediction),
      );
      
      // Постобработка: учитываем влияние праздников
      // ARIMA не учитывает внешние факторы напрямую, поэтому применяем корректировку после прогноза
      const future = futureData[i];
      if (future?.isHoliday && future?.holidayImpact) {
        // Применяем влияние праздника с учетом его типа и силы
        const holidayMultiplier = 1 + (future.holidayImpact * 1.2); // Усиливаем влияние на 20%
        clampedPrediction *= Math.max(0.6, Math.min(1.7, holidayMultiplier));
      } else if (future?.isHoliday && future?.holidayType) {
        // Если holidayImpact не указан, используем тип праздника
        const typeImpact = this.encodeHolidayType(future.holidayType);
        if (typeImpact > 0) {
          const holidayMultiplier = 1 + (typeImpact * 1.2);
          clampedPrediction *= Math.max(0.6, Math.min(1.7, holidayMultiplier));
        }
      }
      
      predictions.push(Math.max(0, clampedPrediction));
    }

    return predictions;
  }

  // Prophet-подобная модель с улучшенными кастомными сезонностями, changepoint detection и обработкой праздников
  private async prophetPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 7) {
      const lastRevenue = data[data.length - 1]?.revenue || 0;
      const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      const basePrediction = (lastRevenue + avgRevenue) / 2;
      return futureData.map(() => basePrediction);
    }

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('Prophet', dataHash);
    
    let changepoints: number[];
    let trendSegments: any[];
    let weeklySeasonality: number[];
    let monthlySeasonality: number[];
    let yearlySeasonality: number[];
    let monthTimeSeasonality: any;
    let holidayEffectsByType: Map<string, number>;
    let weatherEffects: Map<string, number>;
    let median: number;
    let avgRevenue: number;
    let baseRevenue: number;
    
    if (cachedModel && cachedModel.parameters.changepoints && cachedModel.parameters.weeklySeasonality) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[Prophet] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      changepoints = cachedModel.parameters.changepoints as number[];
      trendSegments = cachedModel.parameters.trendSegments as any[];
      weeklySeasonality = cachedModel.parameters.weeklySeasonality as number[];
      monthlySeasonality = cachedModel.parameters.monthlySeasonality as number[];
      yearlySeasonality = cachedModel.parameters.yearlySeasonality as number[];
      monthTimeSeasonality = cachedModel.parameters.monthTimeSeasonality;
      holidayEffectsByType = new Map(Object.entries(cachedModel.parameters.holidayEffectsByType || {}));
      weatherEffects = new Map(Object.entries(cachedModel.parameters.weatherEffects || {}));
      median = cachedModel.parameters.median as number;
      avgRevenue = cachedModel.parameters.avgRevenue as number;
      baseRevenue = cachedModel.parameters.baseRevenue as number;
    } else {
      // Вычисляем параметры заново
      const revenues = data.map((d) => d.revenue);
      const sorted = [...revenues].sort((a, b) => a - b);
      median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
      baseRevenue = median * 0.7 + avgRevenue * 0.3;

      // Обнаружение changepoints (точек изменения тренда)
      changepoints = this.detectChangepoints(data);
      trendSegments = this.calculateTrendSegments(data, changepoints);

      // Улучшенные кастомные сезонности с более точными расчетами
      weeklySeasonality = this.calculateCustomWeeklySeasonality(data);
      monthlySeasonality = this.calculateCustomMonthlySeasonality(data);
      yearlySeasonality = this.calculateYearlySeasonality(data);
      
      // Сезонность по времени месяца (начало/середина/конец)
      monthTimeSeasonality = this.calculateMonthTimeSeasonality(data);

      // Улучшенная обработка праздников с учетом типов
      holidayEffectsByType = this.calculateHolidayEffectsByType(data);

      // Анализируем погодные эффекты
      weatherEffects = this.calculateWeatherEffects(data);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          changepoints,
          trendSegments,
          weeklySeasonality,
          monthlySeasonality,
          yearlySeasonality,
          monthTimeSeasonality,
          holidayEffectsByType: Object.fromEntries(holidayEffectsByType),
          weatherEffects: Object.fromEntries(weatherEffects),
          median,
          avgRevenue,
          baseRevenue,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('Prophet', modelParams);
    }

    const predictions: number[] = [];

    for (let i = 0; i < futureData.length; i++) {
      const future = futureData[i];
      if (!future) continue;

      let prediction = baseRevenue;

      // Тренд с учетом changepoints (адаптивный тренд)
      const currentTrend = this.getTrendAtStep(trendSegments, changepoints, data.length + i);
      const trendDecay = Math.exp(-i * 0.08); // Немного более медленное затухание
      prediction += currentTrend * (i + 1) * trendDecay;

      // Улучшенная сезонность (кастомные сезонности)
      let seasonalMultiplier = 1;
      
      // Недельная сезонность (более точная)
      if (future.dayOfWeek !== undefined) {
        const weeklyMult = weeklySeasonality[future.dayOfWeek] || 1;
        seasonalMultiplier *= Math.max(0.75, Math.min(1.25, weeklyMult));
      }
      
      // Месячная сезонность (более точная)
      if (future.month !== undefined) {
        const monthlyMult = monthlySeasonality[future.month] || 1;
        seasonalMultiplier *= Math.max(0.85, Math.min(1.15, monthlyMult));
      }
      
      // Сезонность по времени месяца
      if (future.dayOfMonth !== undefined) {
        const monthTimeMult = this.getMonthTimeMultiplier(future.dayOfMonth, monthTimeSeasonality);
        seasonalMultiplier *= monthTimeMult;
      }
      
      // Квартальная сезонность
      if (future.quarter !== undefined) {
        seasonalMultiplier *= Math.max(0.95, Math.min(1.05, yearlySeasonality[future.quarter] || 1));
      }
      
      prediction *= seasonalMultiplier;

      // Улучшенная обработка праздников с учетом типов
      // Значительно увеличен базовый множитель и расширены диапазоны для учета сильного влияния праздников
      if (future.isHoliday) {
        let holidayMult = 1.35; // Увеличен базовый множитель с 1.15 до 1.35 (+17%)
        
        if (future.holidayType && holidayEffectsByType.has(future.holidayType)) {
          // Используем специфичный эффект для типа праздника
          const typeEffect = holidayEffectsByType.get(future.holidayType) || 0;
          holidayMult = Math.max(0.7, Math.min(1.7, 1 + typeEffect * 1.2)); // Расширен диапазон и усилен эффект
        } else if (future.holidayImpact !== undefined) {
          // Используем предоставленный impact с усилением
          holidayMult = Math.max(0.6, Math.min(1.7, 1 + future.holidayImpact * 1.3)); // Расширен диапазон и усилен эффект
        } else {
          // Используем средний эффект всех праздников
          const avgHolidayEffect = Array.from(holidayEffectsByType.values())
            .reduce((sum, effect) => sum + effect, 0) / Math.max(1, holidayEffectsByType.size);
          holidayMult = Math.max(0.8, Math.min(1.6, 1 + avgHolidayEffect * 1.2)); // Расширен диапазон и усилен эффект
        }
        
        prediction *= holidayMult;
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

  // Улучшенная LSTM-подобная модель с увеличенной sequence length, dropout и улучшенной нормализацией
  private async lstmPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('LSTM', dataHash);
    
    let lstmWeights: number[];
    let sequenceLength: number;
    let features: number[][];
    
    if (cachedModel && cachedModel.parameters.lstmWeights && cachedModel.parameters.sequenceLength) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[LSTM] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      lstmWeights = cachedModel.parameters.lstmWeights as number[];
      sequenceLength = cachedModel.parameters.sequenceLength as number;
      // Нужно пересчитать features для прогнозирования
      features = this.extractLSTMFeaturesImproved(data);
    } else {
      // Увеличиваем sequence length для лучшего учета долгосрочных зависимостей
      sequenceLength = Math.min(28, Math.max(14, Math.floor(data.length * 0.3)));
      features = this.extractLSTMFeaturesImproved(data);

      // Улучшенная LSTM модель с dropout
      lstmWeights = this.trainLSTMImproved(features, sequenceLength);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          lstmWeights,
          sequenceLength,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('LSTM', modelParams);
    }

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const prediction = this.predictLSTMImproved(features, lstmWeights, i + 1, data);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // GRU (Gated Recurrent Unit) модель - упрощенная версия LSTM
  private async gruPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('GRU', dataHash);
    
    let gruWeights: number[];
    let sequenceLength: number;
    let features: number[][];
    let avgRevenue: number;
    let revenueStd: number;
    
    if (cachedModel && cachedModel.parameters.gruWeights && cachedModel.parameters.sequenceLength) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[GRU] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      gruWeights = cachedModel.parameters.gruWeights as number[];
      sequenceLength = cachedModel.parameters.sequenceLength as number;
      avgRevenue = cachedModel.parameters.avgRevenue as number;
      revenueStd = cachedModel.parameters.revenueStd as number;
      // Нужно пересчитать features для прогнозирования
      features = this.extractGRUFeatures(data);
    } else {
      sequenceLength = Math.min(14, data.length);
      features = this.extractGRUFeatures(data);

      // Вычисляем параметры нормализации для денормализации прогнозов
      const revenues = data.map((d) => d.revenue).filter((r) => r > 0);
      avgRevenue = revenues.length > 0 ? revenues.reduce((sum, r) => sum + r, 0) / revenues.length : 1;
      revenueStd = revenues.length > 1
        ? Math.sqrt(revenues.reduce((sum, r) => sum + Math.pow(r - avgRevenue, 2), 0) / revenues.length)
        : avgRevenue;

      // Обучение GRU модели
      gruWeights = this.trainGRU(features, sequenceLength);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          gruWeights,
          sequenceLength,
          avgRevenue,
          revenueStd,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('GRU', modelParams);
    }

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const prediction = this.predictGRU(features, gruWeights, i + 1, avgRevenue, revenueStd);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // Random Forest модель
  private async randomForestPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('RandomForest', dataHash);
    
    let trees: any[];
    
    if (cachedModel && cachedModel.parameters.trees) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[RandomForest] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      trees = cachedModel.parameters.trees as any[];
    } else {
      const features = this.extractFeatures(data);
      const targets = data.map((d) => d.revenue);

      // Обучаем Random Forest
      trees = this.trainRandomForest(features, targets, 100);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          trees,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('RandomForest', modelParams);
    }

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictRandomForest(trees, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // XGBoost-подобная модель
  private async xgboostPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('XGBoost', dataHash);
    
    let model: any;
    
    if (cachedModel && cachedModel.parameters.model) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[XGBoost] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      model = cachedModel.parameters.model;
    } else {
      const features = this.extractFeatures(data);
      const targets = data.map((d) => d.revenue);

      // Обучаем XGBoost
      model = this.trainXGBoost(features, targets);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          model,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('XGBoost', modelParams);
    }

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictXGBoost(model, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // Вычисляет вес LLM на основе исторической точности
  private calculateLLMWeight(timeSeriesData: EnhancedTimeSeriesData[]): number {
    this.ensureLLMEngine();
    if (!this.llmEngine || !this.llmEngine.isAvailable() || timeSeriesData.length < 14) {
      return 0.15; // Базовый вес для LLM
    }

    // Используем кросс-валидацию для оценки точности LLM
    // Упрощенная версия: оцениваем на основе стабильности данных
    const revenues = timeSeriesData.map((d) => d.revenue);
    const avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
    
    // Если данные стабильные (низкая волатильность), LLM может работать лучше
    const variance = revenues.reduce((sum, r) => sum + Math.pow(r - avgRevenue, 2), 0) / revenues.length;
    const volatility = Math.sqrt(variance) / avgRevenue;
    
    // Высокая волатильность -> меньше вес LLM (0.1), низкая волатильность -> больше вес (0.25)
    const baseWeight = volatility > 0.3 ? 0.1 : volatility < 0.1 ? 0.25 : 0.15;
    
    // Также учитываем количество данных: больше данных -> больше доверия к LLM
    const dataQuality = Math.min(1, timeSeriesData.length / 90); // Нормализуем до 90 дней
    const adjustedWeight = baseWeight * (0.7 + dataQuality * 0.3);
    
    return Math.max(0.05, Math.min(0.3, adjustedWeight)); // Ограничиваем вес между 5% и 30%
  }

  // Адаптивный ансамбль с динамическими весами
  // Улучшенная версия с контекстно-зависимым взвешиванием и увеличенным влиянием реальной точности
  private async adaptiveEnsemble(
    predictions: number[][],
    futureData?: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    const result: number[] = [];
    const numPredictions = predictions[0]?.length ?? 0;
    this.lastAdaptiveDiagnostics = [];

    // Рассчитываем точность каждой модели на исторических данных
    const modelAccuracy = await this.calculateModelAccuracy(predictions);
    
    // Рассчитываем точность по дням недели (если еще не рассчитана)
    if (this.dayOfWeekAccuracies.size === 0 && this.timeSeriesData.length >= 21) {
      this.dayOfWeekAccuracies = await this.calculateDayOfWeekAccuracy();
    }

    // Рассчитываем волатильность данных для контекстно-зависимого взвешивания
    // Используем коэффициент вариации (стандартное отклонение / среднее)
    let dataVolatility = 0;
    if (this.timeSeriesData.length >= 7) {
      const recentData = this.timeSeriesData.slice(-7);
      const revenues = recentData.map((d) => d.revenue);
      const mean = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
      if (mean > 0) {
        const variance = revenues.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / revenues.length;
        const stdDev = Math.sqrt(variance);
        dataVolatility = stdDev / mean; // Коэффициент вариации
      }
    }

    // Классификация моделей по типам для контекстно-зависимого взвешивания
    const modelTypes: Record<string, 'stable' | 'adaptive' | 'seasonal'> = {
      'ARIMA': 'stable',
      'Prophet': 'seasonal',
      'LSTM': 'adaptive',
      'GRU': 'adaptive',
      'RandomForest': 'adaptive',
      'XGBoost': 'adaptive',
      'GradientBoosting': 'adaptive',
      'NHITS': 'seasonal',
    };

    // Получаем метрики LLM для динамического взвешивания
    let llmSuccessRate = 0.5; // По умолчанию 50%
    let llmAvailable = false;
    if (this.llmEngine && this.llmEngine.isAvailable()) {
      try {
        const llmMetrics = this.llmEngine.getMetrics();
        llmAvailable = true;
        if (llmMetrics.totalRequests > 0) {
          llmSuccessRate = llmMetrics.successfulRequests / llmMetrics.totalRequests;
        }
      } catch (error) {
        console.warn('[EnhancedMLForecast] Ошибка при получении метрик LLM:', error);
      }
    }

    for (let i = 0; i < numPredictions; i++) {
      const stepRawWeights: number[] = [];
      let weightedSum = 0;
      let totalWeight = 0;
      
      // Определяем контекст для этого прогноза
      const dayOfWeek = futureData?.[i]?.dayOfWeek;
      const horizon = i + 1; // Горизонт прогнозирования (дни вперед)
      const isHoliday = futureData?.[i]?.isHoliday || false;
      const isWeekend = futureData?.[i]?.isWeekend || (dayOfWeek === 0 || dayOfWeek === 6);
      const dayType: 'weekday' | 'weekend' | 'holiday' = isHoliday ? 'holiday' : isWeekend ? 'weekend' : 'weekday';
      
      const useDowAccuracy = dayOfWeek !== undefined && this.dayOfWeekAccuracies.size > 0;

      // Контекстно-зависимые модификаторы весов
      // 1. По горизонту: близкие прогнозы - больше вес стабильным моделям
      const horizonModifier = horizon <= 7 ? 1.0 : horizon <= 14 ? 0.95 : 0.9;
      const stableModelBonus = horizon <= 7 ? 1.15 : horizon <= 14 ? 1.05 : 1.0;
      
      // 2. По волатильности: высокая волатильность - больше вес адаптивным моделям
      const highVolatility = dataVolatility > 0.2;
      const adaptiveModelBonus = highVolatility ? 1.2 : 1.0;
      const stableModelPenalty = highVolatility ? 0.9 : 1.0;
      
      // 3. По типу дня: выходные - больше вес моделям, учитывающим сезонность
      const seasonalModelBonus = (dayType === 'weekend' || dayType === 'holiday') ? 1.15 : 1.0;

      for (let j = 0; j < predictions.length; j++) {
        // Проверяем, является ли это LLM прогнозом (индекс больше количества моделей)
        const isLLM = j >= this.modelEnsemble.models.length;
        
        let baseWeight: number;
        let generalAccuracy: number;
        
        if (isLLM) {
          // Динамическое взвешивание LLM на основе метрик успешности
          const baseLLMWeight = 0.15;
          // Корректируем вес LLM на основе успешности запросов
          // При успешности >80% увеличиваем вес до 0.25, при <50% снижаем до 0.05
          const llmWeightMultiplier = llmSuccessRate > 0.8 ? 1.5 : llmSuccessRate > 0.6 ? 1.2 : llmSuccessRate > 0.4 ? 1.0 : 0.5;
          baseWeight = baseLLMWeight * llmWeightMultiplier;
          
          // Для LLM точность оцениваем на основе метрик успешности и среднего других моделей
          const avgOtherAccuracy = modelAccuracy.length > 0
            ? modelAccuracy.reduce((sum, acc) => sum + acc, 0) / modelAccuracy.length
            : 0.6;
          generalAccuracy = avgOtherAccuracy * 0.7 + llmSuccessRate * 0.3;
        } else {
          baseWeight = this.modelEnsemble.models[j].weight;
          generalAccuracy = modelAccuracy[j] ?? 0.5;
        }
        
        // Получаем точность для конкретного дня недели (если доступна)
        let daySpecificAccuracy = generalAccuracy;
        if (useDowAccuracy && dayOfWeek !== undefined && !isLLM) {
          const modelDowAccuracies = this.dayOfWeekAccuracies.get(j);
          if (modelDowAccuracies && modelDowAccuracies[dayOfWeek] !== undefined) {
            // Комбинируем общую точность (30%) с точностью по дню недели (70%)
            daySpecificAccuracy = 
              generalAccuracy * 0.3 + 
              modelDowAccuracies[dayOfWeek] * 0.7;
          }
        }
        
        // Увеличиваем влияние реальной точности до 70%: baseWeight * 0.3 + accuracyWeight * 0.7
        let adaptiveWeight = baseWeight * 0.3 + daySpecificAccuracy * 0.7;

        // Применяем контекстно-зависимые модификаторы
        if (!isLLM) {
          const modelName = this.modelEnsemble.models[j].name;
          const modelType = modelTypes[modelName] || 'stable';
          
          // Модификаторы по типу модели
          if (modelType === 'stable') {
            adaptiveWeight *= stableModelBonus * stableModelPenalty * horizonModifier;
          } else if (modelType === 'adaptive') {
            adaptiveWeight *= adaptiveModelBonus;
          } else if (modelType === 'seasonal') {
            adaptiveWeight *= seasonalModelBonus;
          }
        } else {
          // Для LLM применяем модификаторы на основе успешности и горизонта
          // LLM лучше работает на близких прогнозах
          const llmHorizonModifier = horizon <= 7 ? 1.1 : horizon <= 14 ? 1.0 : 0.9;
          adaptiveWeight *= llmHorizonModifier;
        }

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
  // Защита от переобучения: снижен вес метрик из БД, увеличен вес кросс-валидации
  private async calculateModelAccuracy(predictions: number[][]): Promise<number[]> {
    const accuracies: number[] = [];

    // Пытаемся получить реальные метрики из БД с валидацией (минимум 10 образцов)
    const realMetricsMap: Record<string, number> = {};
    if (this.storage) {
      try {
        const { getModelMetrics } = await import('./forecastFeedback');
        const modelNameMap: Record<string, string> = {
          'arima': 'ARIMA',
          'prophet': 'Prophet',
          'lstm': 'LSTM',
          'gru': 'GRU',
          'randomforest': 'RandomForest',
          'xgboost': 'XGBoost',
          'gradientboosting': 'GradientBoosting',
          'nhits': 'NHITS',
        };

        for (let i = 0; i < this.modelEnsemble.models.length; i++) {
          const model = this.modelEnsemble.models[i];
          const modelName = modelNameMap[model.name.toLowerCase()] || model.name;
          // Используем минимум 10 образцов для надежности метрик
          const metrics = await getModelMetrics(modelName, this.storage, 10);
          
          if (metrics.length > 0) {
            const overallMetric = metrics.find((m) => m.dayOfWeek === null && m.horizon === null);
            if (overallMetric && overallMetric.sampleSize && overallMetric.sampleSize >= 10) {
              // Валидация MAPE: должен быть в разумных пределах (0-1000%)
              if (overallMetric.mape >= 0 && overallMetric.mape <= 1000) {
                const mape = overallMetric.mape / 100; // MAPE в процентах
                const accuracy = Math.max(0, Math.min(1, 1 - mape));
                // Увеличиваем вес при большем размере выборки (логарифмическая шкала)
                const sampleSizeWeight = Math.min(1, Math.log10(overallMetric.sampleSize + 1) / Math.log10(100));
                // Более консервативный подход: меньший вес для метрик из БД
                realMetricsMap[model.name.toLowerCase()] = accuracy * sampleSizeWeight + 0.5 * (1 - sampleSizeWeight);
              }
            }
          }
        }
      } catch (error) {
        console.warn('[EnhancedMLForecast] Ошибка при получении метрик из БД:', error);
      }
    }

    // Если есть исторические данные, используем кросс-валидацию (приоритет)
    if (this.timeSeriesData.length >= 14) {
      const historicalAccuracy = await this.calculateHistoricalModelAccuracy();
      if (historicalAccuracy.length > 0) {
        // ИЗМЕНЕНО: Снижен вес метрик из БД с 80% до 50%, увеличен вес кросс-валидации с 15% до 40%
        // Это защищает от переобучения на ошибках в метриках из БД
        for (let i = 0; i < predictions.length; i++) {
          const model = this.modelEnsemble.models[i];
          const modelKey = model.name.toLowerCase();
          const realAccuracy = realMetricsMap[modelKey];
          const historicalAcc = historicalAccuracy[i] ?? 0.5;
          
          const modelPredictions = predictions[i];
          const variance = this.calculateVariance(modelPredictions);
          const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
          const stability = Math.max(0, 1 - variance / (mean + 1));
          
          // Комбинируем: метрики из БД (50%), кросс-валидация (40%), стабильность (10%)
          if (realAccuracy !== undefined) {
            const combinedAccuracy = realAccuracy * 0.5 + historicalAcc * 0.4 + stability * 0.1;
            accuracies.push(Math.max(0, Math.min(1, combinedAccuracy)));
          } else {
            // Если нет реальных метрик, используем кросс-валидацию (80%) + стабильность (20%)
            const combinedAccuracy = historicalAcc * 0.8 + stability * 0.2;
            accuracies.push(Math.max(0, Math.min(1, combinedAccuracy)));
          }
        }
        return accuracies;
      }
    }

    // Fallback: используем реальные метрики если доступны, иначе оценка стабильности прогнозов
    for (let i = 0; i < predictions.length; i++) {
      const model = this.modelEnsemble.models[i];
      const modelKey = model.name.toLowerCase();
      const realAccuracy = realMetricsMap[modelKey];
      
      if (realAccuracy !== undefined) {
        // Используем реальные метрики с корректировкой на стабильность (более консервативно)
        const modelPredictions = predictions[i];
        const variance = this.calculateVariance(modelPredictions);
        const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
        const stability = Math.max(0, 1 - variance / (mean + 1));
        // Снижен вес метрик из БД: 70% метрики + 30% стабильность
        const combinedAccuracy = realAccuracy * 0.7 + stability * 0.3;
        accuracies.push(Math.max(0, Math.min(1, combinedAccuracy)));
      } else {
        // Только оценка стабильности прогнозов
        const modelPredictions = predictions[i];
        const variance = this.calculateVariance(modelPredictions);
        const mean = modelPredictions.reduce((sum, pred) => sum + pred, 0) / modelPredictions.length;
        const stability = Math.max(0, 1 - variance / (mean + 1));
        accuracies.push(stability);
      }
    }

    return accuracies;
  }

  // Кросс-валидация на исторических данных для оценки точности моделей
  // Улучшенная версия с MAE, RMSE и специализацией по дням недели
  private async calculateHistoricalModelAccuracy(): Promise<number[]> {
    if (this.timeSeriesData.length < 14) {
      return [];
    }

    const accuracies: number[] = [];
    const dataLength = this.timeSeriesData.length;
    
    // Увеличиваем долю данных для валидации с 30% до 45% (0.55 означает 45% данных)
    const validationStart = Math.max(7, Math.floor(dataLength * 0.55));
    const validationData = this.timeSeriesData.slice(validationStart);
    const trainingData = this.timeSeriesData.slice(0, validationStart);

    if (trainingData.length < 7 || validationData.length < 3) {
      return [];
    }

    // Для каждой модели делаем прогноз на валидационных данных
    for (const model of this.modelEnsemble.models) {
      const predictions: number[] = [];
      const actuals: number[] = [];
      const dayOfWeekIndices: number[] = []; // Для специализации по дням недели

      // Делаем прогнозы на всех валидационных данных (не ограничиваем 7 днями)
      // Используем последовательный подход для асинхронных моделей
      for (let i = 0; i < validationData.length; i++) {
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
        const predictionResult = model.predict(trainingSlice, futureData);
        // Поддержка асинхронных моделей (например, N-HITS)
        const modelPredictions = predictionResult instanceof Promise 
          ? await predictionResult 
          : predictionResult;
        
        if (modelPredictions.length > 0 && modelPredictions[0] !== undefined) {
          predictions.push(modelPredictions[0]);
          actuals.push(validationData[i].revenue);
          dayOfWeekIndices.push(validationData[i].dayOfWeek);
        }
      }

      // Рассчитываем точность с использованием нескольких метрик
      if (predictions.length > 0 && actuals.length > 0) {
        // MAPE (Mean Absolute Percentage Error)
        let mapeSum = 0;
        let mapeValidPoints = 0;
        
        // MAE (Mean Absolute Error)
        let maeSum = 0;
        let maeValidPoints = 0;
        
        // RMSE (Root Mean Squared Error)
        let mseSum = 0;
        let rmseValidPoints = 0;
        
        // Средняя выручка для нормализации
        const avgRevenue = actuals.reduce((sum, val) => sum + val, 0) / actuals.length;
        
        for (let j = 0; j < predictions.length; j++) {
          const actual = actuals[j];
          const predicted = predictions[j];
          
          if (Number.isFinite(predicted) && predicted >= 0) {
            // MAPE (только для дней с ненулевой выручкой)
            if (actual > 0) {
              const error = Math.abs((actual - predicted) / actual);
              mapeSum += error;
              mapeValidPoints++;
            }
            
            // MAE (всегда)
            const absError = Math.abs(actual - predicted);
            maeSum += absError;
            maeValidPoints++;
            
            // RMSE (всегда)
            const squaredError = Math.pow(actual - predicted, 2);
            mseSum += squaredError;
            rmseValidPoints++;
          }
        }

        if (mapeValidPoints > 0 && maeValidPoints > 0 && rmseValidPoints > 0) {
          // Рассчитываем метрики
          const mape = mapeSum / mapeValidPoints;
          const mae = maeSum / maeValidPoints;
          const rmse = Math.sqrt(mseSum / rmseValidPoints);
          
          // Нормализуем метрики для преобразования в точность (0-1)
          // MAPE: 0.1 (10% ошибка) = 0.9 точность
          const mapeAccuracy = Math.max(0, Math.min(1, 1 - mape));
          
          // MAE: нормализуем относительно средней выручки
          // MAE = 5000 при средней выручке 50000 = 10% ошибка = 0.9 точность
          const normalizedMae = avgRevenue > 0 ? mae / avgRevenue : 0;
          const maeAccuracy = Math.max(0, Math.min(1, 1 - normalizedMae));
          
          // RMSE: нормализуем относительно средней выручки
          const normalizedRmse = avgRevenue > 0 ? rmse / avgRevenue : 0;
          const rmseAccuracy = Math.max(0, Math.min(1, 1 - normalizedRmse));
          
          // Взвешенная комбинация: MAPE (40%), MAE (30%), RMSE (30%)
          const combinedAccuracy = 
            mapeAccuracy * 0.4 + 
            maeAccuracy * 0.3 + 
            rmseAccuracy * 0.3;
          
          accuracies.push(Math.max(0, Math.min(1, combinedAccuracy)));
        } else {
          accuracies.push(0.5); // Fallback
        }
      } else {
        accuracies.push(0.5); // Fallback
      }
    }

    return accuracies;
  }

  // Расчет точности моделей по дням недели (специализация)
  private async calculateDayOfWeekAccuracy(): Promise<Map<number, number[]>> {
    const dowAccuracies = new Map<number, number[]>();
    
    if (this.timeSeriesData.length < 21) {
      // Недостаточно данных для специализации
      return dowAccuracies;
    }

    const dataLength = this.timeSeriesData.length;
    const validationStart = Math.max(7, Math.floor(dataLength * 0.55));
    const validationData = this.timeSeriesData.slice(validationStart);
    const trainingData = this.timeSeriesData.slice(0, validationStart);

    if (trainingData.length < 7 || validationData.length < 3) {
      return dowAccuracies;
    }

    // Группируем валидационные данные по дням недели
    const validationByDow = new Map<number, EnhancedTimeSeriesData[]>();
    for (const data of validationData) {
      const dow = data.dayOfWeek;
      if (!validationByDow.has(dow)) {
        validationByDow.set(dow, []);
      }
      validationByDow.get(dow)!.push(data);
    }

    // Для каждой модели и каждого дня недели
    for (let modelIdx = 0; modelIdx < this.modelEnsemble.models.length; modelIdx++) {
      const model = this.modelEnsemble.models[modelIdx];
      const modelAccuracies: number[] = [];

      for (let dow = 0; dow < 7; dow++) {
        const dowData = validationByDow.get(dow) || [];
        
        if (dowData.length === 0) {
          modelAccuracies.push(0.5); // Fallback если нет данных для этого дня недели
          continue;
        }

        const predictions: number[] = [];
        const actuals: number[] = [];

        // Делаем прогнозы для всех дней этого дня недели
        for (let i = 0; i < dowData.length; i++) {
          const dataPoint = dowData[i];
          const futureDataPoint: Partial<EnhancedTimeSeriesData> = {
            date: dataPoint.date,
            dayOfWeek: dataPoint.dayOfWeek,
            dayOfMonth: dataPoint.dayOfMonth,
            month: dataPoint.month,
            quarter: dataPoint.quarter,
            year: dataPoint.year,
            isWeekend: dataPoint.isWeekend,
            isHoliday: dataPoint.isHoliday,
            holidayType: dataPoint.holidayType,
            holidayImpact: dataPoint.holidayImpact,
            temperature: dataPoint.temperature,
            precipitation: dataPoint.precipitation,
            humidity: dataPoint.humidity,
            windSpeed: dataPoint.windSpeed,
            cloudCover: dataPoint.cloudCover,
            uvIndex: dataPoint.uvIndex,
            visibility: dataPoint.visibility,
            exchangeRate: dataPoint.exchangeRate,
            inflation: dataPoint.inflation,
            consumerConfidence: dataPoint.consumerConfidence,
            unemploymentRate: dataPoint.unemploymentRate,
            socialSentiment: dataPoint.socialSentiment,
            socialVolume: dataPoint.socialVolume,
          };

          // Находим индекс этого дня в полном валидационном наборе
          const fullIndex = validationData.findIndex(d => d.date === dataPoint.date);
          const trainingSlice = trainingData.concat(
            validationData.slice(0, fullIndex >= 0 ? fullIndex : 0)
          );
          
          const futureData = [futureDataPoint];
          const predictionResult = model.predict(trainingSlice, futureData);
          // Поддержка асинхронных моделей (например, N-HITS)
          const modelPredictions = predictionResult instanceof Promise 
            ? await predictionResult 
            : predictionResult;
          
          if (modelPredictions.length > 0 && modelPredictions[0] !== undefined) {
            predictions.push(modelPredictions[0]);
            actuals.push(dataPoint.revenue);
          }
        }

        // Рассчитываем точность для этого дня недели
        if (predictions.length > 0 && actuals.length > 0) {
          let totalError = 0;
          let validPoints = 0;
          const avgRevenue = actuals.reduce((sum, val) => sum + val, 0) / actuals.length;

          for (let j = 0; j < predictions.length; j++) {
            const actual = actuals[j];
            const predicted = predictions[j];
            
            if (actual > 0 && Number.isFinite(predicted) && predicted >= 0) {
              // Используем комбинацию MAPE и MAE для точности
              const mape = Math.abs((actual - predicted) / actual);
              const normalizedMae = avgRevenue > 0 ? Math.abs(actual - predicted) / avgRevenue : 0;
              const combinedError = mape * 0.6 + normalizedMae * 0.4;
              totalError += combinedError;
              validPoints++;
            }
          }

          if (validPoints > 0) {
            const avgError = totalError / validPoints;
            const accuracy = Math.max(0, Math.min(1, 1 - avgError));
            modelAccuracies.push(accuracy);
          } else {
            modelAccuracies.push(0.5);
          }
        } else {
          modelAccuracies.push(0.5);
        }
      }

      dowAccuracies.set(modelIdx, modelAccuracies);
    }

    return dowAccuracies;
  }

  // Расчет дисперсии
  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return variance;
  }

  // Расчет волатильности для конкретного дня недели
  private calculateDayOfWeekVolatility(dayOfWeek: number, data: EnhancedTimeSeriesData[]): number {
    if (data.length === 0) return 0;
    
    // Фильтруем данные по дню недели
    const dowData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    
    if (dowData.length < 2) return 0;
    
    const revenues = dowData.map((d) => d.revenue);
    const mean = revenues.reduce((sum, val) => sum + val, 0) / revenues.length;
    
    if (mean === 0) return 0;
    
    // Рассчитываем коэффициент вариации (CV) - стандартное отклонение / среднее
    const variance = revenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / revenues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;
    
    return coefficientOfVariation;
  }

  // Динамическая калибровка на основе исторических ошибок
  // Улучшенная версия с калибровкой по горизонтам, типам дней и взвешенным историческим ошибкам
  private async applyDynamicCalibration(
    prediction: number,
    dayOfWeek: number,
    data: EnhancedTimeSeriesData[],
    horizon: number = 1, // Горизонт прогнозирования (дни вперед)
    dayType?: 'weekday' | 'weekend' | 'holiday', // Тип дня
  ): Promise<number> {
    // Снижен минимальный порог с 21 до 14 дней для более ранней активации калибровки
    if (data.length < 14) {
      // Недостаточно данных для калибровки
      return prediction;
    }

    // Определяем тип дня, если не передан
    if (!dayType) {
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        dayType = 'weekend';
      } else {
        dayType = 'weekday';
      }
    }

    // Используем кросс-валидацию для оценки систематической ошибки по дню недели
    const dataLength = data.length;
    const validationStart = Math.max(7, Math.floor(dataLength * 0.55));
    const validationData = data.slice(validationStart);
    const trainingData = data.slice(0, validationStart);

    if (trainingData.length < 7 || validationData.length < 3) {
      return prediction;
    }

    // Группируем валидационные данные по дням недели и типу дня
    const dowValidationData = validationData.filter((d) => {
      if (d.dayOfWeek !== dayOfWeek) return false;
      // Фильтруем по типу дня, если это праздник
      if (dayType === 'holiday') return d.isHoliday;
      if (dayType === 'weekend') return d.isWeekend;
      if (dayType === 'weekday') return !d.isWeekend && !d.isHoliday;
      return true;
    });
    
    if (dowValidationData.length < 2) {
      // Если недостаточно данных для этого типа дня, используем данные только по дню недели
      const fallbackData = validationData.filter((d) => d.dayOfWeek === dayOfWeek);
      if (fallbackData.length < 2) {
        return prediction;
      }
      dowValidationData.push(...fallbackData);
    }

    // Рассчитываем среднюю ошибку прогноза с взвешенным средним и экспоненциальным затуханием
    // Более свежие данные имеют больший вес
    const historicalDowRevenues = dowValidationData.map((d, idx) => ({
      revenue: d.revenue,
      weight: Math.exp(-idx * 0.1), // Экспоненциальное затухание: более свежие данные важнее
      date: d.date,
    }));
    
    const totalWeight = historicalDowRevenues.reduce((sum, d) => sum + d.weight, 0);
    const avgHistoricalDowRevenue = totalWeight > 0
      ? historicalDowRevenues.reduce((sum, d) => sum + d.revenue * d.weight, 0) / totalWeight
      : historicalDowRevenues.reduce((sum, d) => sum + d.revenue, 0) / historicalDowRevenues.length;
    
    // Также используем данные из trainingData для этого дня недели с взвешиванием
    const trainingDowData = trainingData
      .filter((d) => {
        if (d.dayOfWeek !== dayOfWeek) return false;
        if (dayType === 'holiday') return d.isHoliday;
        if (dayType === 'weekend') return d.isWeekend;
        if (dayType === 'weekday') return !d.isWeekend && !d.isHoliday;
        return true;
      })
      .map((d, idx) => ({
        revenue: d.revenue,
        weight: Math.exp(-idx * 0.08), // Меньшее затухание для training данных
      }));
    
    const trainingTotalWeight = trainingDowData.reduce((sum, d) => sum + d.weight, 0);
    const avgTrainingDowRevenue = trainingDowData.length > 0 && trainingTotalWeight > 0
      ? trainingDowData.reduce((sum, d) => sum + d.revenue * d.weight, 0) / trainingTotalWeight
      : avgHistoricalDowRevenue;
    
    // Комбинируем средние значения из training и validation с учетом горизонта
    // Для дальних прогнозов больше веса training данным (они более стабильны)
    const horizonWeight = Math.min(1, horizon / 30); // Нормализуем горизонт до 0-1
    const trainingWeight = 0.5 + horizonWeight * 0.2; // 50-70% для training в зависимости от горизонта
    const combinedAvgDowRevenue = 
      avgTrainingDowRevenue * trainingWeight + avgHistoricalDowRevenue * (1 - trainingWeight);
    
    // Рассчитываем систематическую ошибку с учетом горизонта
    // Для дальних прогнозов используем больше исторических данных
    const lookbackWindow = horizon <= 7 ? 30 : horizon <= 14 ? 45 : 60;
    const recentDowData = data
      .slice(-Math.min(lookbackWindow, data.length))
      .filter((d) => {
        if (d.dayOfWeek !== dayOfWeek) return false;
        // Для праздников используем только праздничные дни
        if (dayType === 'holiday') return d.isHoliday;
        // Для выходных используем только выходные
        if (dayType === 'weekend') return d.isWeekend;
        // Для будней исключаем праздники и выходные
        if (dayType === 'weekday') return !d.isWeekend && !d.isHoliday;
        return true;
      });
    
    if (recentDowData.length >= 3) {
      // Используем взвешенное среднее с экспоненциальным затуханием для недавних данных
      const weightedRecentData = recentDowData.map((d, idx) => ({
        revenue: d.revenue,
        weight: Math.exp(-idx * 0.05), // Более свежие данные важнее
      }));
      const recentTotalWeight = weightedRecentData.reduce((sum, d) => sum + d.weight, 0);
      const recentAvg = recentTotalWeight > 0
        ? weightedRecentData.reduce((sum, d) => sum + d.revenue * d.weight, 0) / recentTotalWeight
        : recentDowData.reduce((sum, d) => sum + d.revenue, 0) / recentDowData.length;
      
      // Если прогноз сильно отличается от исторического среднего для этого дня недели
      // применяем мягкую калибровку
      const historicalAvg = combinedAvgDowRevenue;
      const predictionBias = (prediction - historicalAvg) / (historicalAvg + 1);
      
      // Снижен порог калибровки до 3% для более точной калибровки
      const calibrationThreshold = 0.03; // 3% порог
      
      // Пытаемся получить исторические ошибки из метрик БД для более точной калибровки
      // Учитываем горизонт и тип дня
      let historicalBias = 0;
      let hasHistoricalMetrics = false;
      
      if (this.storage) {
        try {
          const { getModelMetrics } = await import('./forecastFeedback');
          // Получаем метрики для ансамбля
          const ensembleMetrics = await getModelMetrics('Ensemble', this.storage);
          
          // Ищем метрики по дню недели и горизонту
          const horizonCategory = horizon <= 7 ? 7 : horizon <= 14 ? 14 : 30;
          let dowMetrics = ensembleMetrics.find(m => 
            m.dayOfWeek === dayOfWeek && 
            (m.horizon === horizonCategory || m.horizon === null)
          );
          
          // Если не нашли по горизонту, используем метрики только по дню недели
          if (!dowMetrics) {
            dowMetrics = ensembleMetrics.find(m => m.dayOfWeek === dayOfWeek);
          }
          
          // Если не нашли по дню недели, используем общие метрики
          if (!dowMetrics) {
            dowMetrics = ensembleMetrics.find(m => m.dayOfWeek === null && m.horizon === null);
          }
          
          if (dowMetrics && dowMetrics.sampleSize > 0) {
            // Используем MAPE и MAE для оценки систематической ошибки
            const mape = dowMetrics.mape / 100; // MAPE в процентах
            const avgRevenue = recentAvg;
            if (avgRevenue > 0) {
              const normalizedMae = dowMetrics.mae / avgRevenue;
              
              // Учитываем горизонт: для дальних прогнозов ошибки обычно больше
              const horizonMultiplier = 1 + (horizon - 1) * 0.02; // +2% на каждый день горизонта
              
              // Комбинируем MAPE и MAE для более точной оценки
              // Используем взвешенное среднее с учетом горизонта
              historicalBias = (mape * 0.6 + normalizedMae * 0.4) * 0.3 * horizonMultiplier;
              hasHistoricalMetrics = true;
            }
          }
        } catch (error) {
          // Игнорируем ошибки получения метрик
          console.warn('[EnhancedMLForecast] Ошибка при получении метрик для калибровки:', error);
        }
      }
      
      if (Math.abs(predictionBias) > calibrationThreshold || hasHistoricalMetrics) {
        // Адаптивная сила калибровки с учетом горизонта и типа дня
        // Для дальних прогнозов применяем более сильную калибровку
        // Для выходных и праздников применяем более мягкую калибровку (они более волатильны)
        const absBias = Math.abs(predictionBias);
        let calibrationFactor = 0.3; // Базовая калибровка
        
        // Корректировка на основе отклонения
        if (absBias > 0.2) {
          calibrationFactor = 0.5; // Сильная калибровка при больших отклонениях
        } else if (absBias > 0.1) {
          calibrationFactor = 0.4; // Средняя калибровка
        }
        
        // Корректировка на основе горизонта: дальние прогнозы требуют больше калибровки
        const horizonAdjustment = Math.min(0.15, (horizon - 1) * 0.01); // До +15% для дальних прогнозов
        calibrationFactor += horizonAdjustment;
        
        // Корректировка на основе типа дня: выходные и праздники более волатильны
        const dayTypeAdjustment = dayType === 'holiday' ? -0.1 : dayType === 'weekend' ? -0.05 : 0;
        calibrationFactor = Math.max(0.2, Math.min(0.65, calibrationFactor + dayTypeAdjustment));
        
        // Если есть исторические метрики, увеличиваем силу калибровки
        if (hasHistoricalMetrics) {
          calibrationFactor = Math.min(0.7, calibrationFactor + 0.1);
        }
        
        // Применяем калибровку: смещаем прогноз в сторону исторического среднего
        let calibrated = prediction * (1 - calibrationFactor) + historicalAvg * calibrationFactor;
        
        // Учитываем историческую ошибку из метрик БД
        if (hasHistoricalMetrics && Math.abs(historicalBias) > 0.01) {
          // Корректируем прогноз на основе исторической ошибки
          calibrated = calibrated * (1 - historicalBias);
        }
        
        // Учитываем также недавний тренд с учетом горизонта
        // Для дальних прогнозов тренд менее важен
        const trendWeight = Math.max(0.3, 1 - horizon * 0.02); // Снижаем вес тренда для дальних прогнозов
        const recentTrend = recentAvg / historicalAvg;
        const finalCalibrated = calibrated * (1 - trendWeight + recentTrend * trendWeight);
        
        return Math.max(0, finalCalibrated);
      }
    }

    return prediction;
  }

  // Проверка доступности LLM движка
  public isLLMAvailable(): boolean {
    this.ensureLLMEngine();
    return this.llmEngine?.isAvailable() ?? false;
  }

  // Получение метрик качества моделей для отображения
  public async getModelQualityMetrics(timeSeriesData?: EnhancedTimeSeriesData[]): Promise<Record<string, number>> {
    const data = timeSeriesData || this.timeSeriesData;
    
    if (data.length < 7) {
      // Дефолтные значения при недостатке данных
      return {
        arima: 0.5,
        prophet: 0.5,
        lstm: 0.5,
        gru: 0.5,
        nhits: 0.5,
        llm: 0,
      };
    }

    // Получаем теоретическую оценку производительности (10% веса, только как fallback)
    const performanceRaw = this.evaluateModelPerformance(data);
    const modelPerformance = performanceRaw.map((perf) =>
      Number.isFinite(perf) && perf > 0 ? perf : 1e-6,
    );

    // Нормализуем к 0-1 диапазону
    const maxPerformance = Math.max(...modelPerformance, 1);
    const normalizedPerformance = modelPerformance.map((perf) => Math.min(1, perf / maxPerformance));

    // Получаем историческую точность моделей (fallback при отсутствии реальных метрик)
    const historicalAccuracies = await this.calculateHistoricalModelAccuracy();
    const historicalQualityMap: Record<string, number> = {};
    this.modelEnsemble.models.forEach((model, index) => {
      const historicalAccuracy = historicalAccuracies[index];
      if (historicalAccuracy !== undefined && Number.isFinite(historicalAccuracy)) {
        historicalQualityMap[model.name.toLowerCase()] = historicalAccuracy;
      }
    });

    // Получаем реальные метрики точности из БД с учетом горизонтов и типов дней
    // Используем взвешенное среднее с экспоненциальным затуханием (более свежие метрики важнее)
    const realMetrics: Record<string, number> = {};
    const realMetricsStability: Record<string, number> = {}; // Стабильность качества (низкая вариативность = выше качество)
    
    try {
      const { getModelMetrics } = await import('./forecastFeedback');
      
      // Маппинг названий моделей
      const modelNameMap: Record<string, string> = {
        'arima': 'ARIMA',
        'prophet': 'Prophet',
        'lstm': 'LSTM',
        'gru': 'GRU',
        'randomforest': 'RandomForest',
        'xgboost': 'XGBoost',
        'gradientboosting': 'GradientBoosting',
        'nhits': 'NHITS',
      };

      for (const [key, modelName] of Object.entries(modelNameMap)) {
        const metrics = await getModelMetrics(modelName, this.storage);
        
        if (metrics.length > 0) {
          // Собираем все метрики с весами на основе горизонта и типа дня
          // Более свежие метрики (больший sampleSize) имеют больший вес
          const weightedAccuracies: Array<{ accuracy: number; weight: number }> = [];
          
          // Группируем метрики по горизонтам и типам дней для оценки стабильности
          const accuracyByHorizon: number[] = [];
          const accuracyByDayType: { weekday: number[]; weekend: number[]; holiday: number[] } = {
            weekday: [],
            weekend: [],
            holiday: [],
          };
          
          for (const metric of metrics) {
            if (metric.sampleSize === 0) continue;
            
            const mape = metric.mape / 100; // MAPE в процентах, преобразуем в долю
            const accuracy = Math.max(0, Math.min(1, 1 - mape));
            
            // Вес метрики: экспоненциальное затухание по времени + вес выборки
            // Больше выборка = больше доверия, но также учитываем свежесть данных
            const sampleSizeWeight = Math.min(1, Math.log10(metric.sampleSize + 1) / Math.log10(50));
            
            // Приоритет метрик: общие > по горизонту > по дню недели
            let priorityWeight = 1.0;
            if (metric.dayOfWeek === null && metric.horizon === null) {
              priorityWeight = 1.0; // Общие метрики имеют максимальный приоритет
            } else if (metric.horizon !== null) {
              priorityWeight = 0.8; // Метрики по горизонту
            } else if (metric.dayOfWeek !== null) {
              priorityWeight = 0.7; // Метрики по дню недели
            }
            
            const totalWeight = sampleSizeWeight * priorityWeight;
            weightedAccuracies.push({ accuracy, weight: totalWeight });
            
            // Собираем метрики для оценки стабильности
            if (metric.horizon !== null) {
              accuracyByHorizon.push(accuracy);
            }
            
            // Группируем по типам дней (будни/выходные/праздники)
            if (metric.dayOfWeek !== null) {
              const dow = metric.dayOfWeek;
              if (dow === 0 || dow === 6) {
                accuracyByDayType.weekend.push(accuracy);
              } else {
                accuracyByDayType.weekday.push(accuracy);
              }
            }
          }
          
          // Рассчитываем взвешенное среднее с экспоненциальным затуханием
          if (weightedAccuracies.length > 0) {
            const totalWeight = weightedAccuracies.reduce((sum, m) => sum + m.weight, 0);
            const weightedAccuracy = totalWeight > 0
              ? weightedAccuracies.reduce((sum, m) => sum + m.accuracy * m.weight, 0) / totalWeight
              : weightedAccuracies.reduce((sum, m) => sum + m.accuracy, 0) / weightedAccuracies.length;
            
            realMetrics[key] = weightedAccuracy;
            
            // Оценка стабильности качества: низкая вариативность = выше качество
            let stability = 1.0;
            if (accuracyByHorizon.length > 1) {
              const mean = accuracyByHorizon.reduce((sum, a) => sum + a, 0) / accuracyByHorizon.length;
              const variance = accuracyByHorizon.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / accuracyByHorizon.length;
              const stdDev = Math.sqrt(variance);
              // Низкая вариативность (stdDev < 0.1) = высокая стабильность
              stability = Math.max(0, Math.min(1, 1 - stdDev * 2));
            }
            
            // Также учитываем стабильность по типам дней
            const dayTypeStabilities: number[] = [];
            Object.values(accuracyByDayType).forEach((accuracies) => {
              if (accuracies.length > 1) {
                const mean = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
                const variance = accuracies.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / accuracies.length;
                const stdDev = Math.sqrt(variance);
                dayTypeStabilities.push(Math.max(0, Math.min(1, 1 - stdDev * 2)));
              }
            });
            
            if (dayTypeStabilities.length > 0) {
              const avgDayTypeStability = dayTypeStabilities.reduce((sum, s) => sum + s, 0) / dayTypeStabilities.length;
              stability = (stability * 0.6 + avgDayTypeStability * 0.4);
            }
            
            realMetricsStability[key] = stability;
            
            // Учитываем стабильность в финальной оценке качества
            // Стабильность добавляет бонус до 5% к качеству
            realMetrics[key] = Math.min(1, weightedAccuracy + stability * 0.05);
          } else {
            // Если нет взвешенных метрик, используем историческую точность
            realMetrics[key] = historicalQualityMap[key] ?? 0.5;
            realMetricsStability[key] = 0.5;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to get real metrics from forecastFeedback:', error);
    }

    // Комбинируем реальные метрики (90%) с теоретической оценкой (10%)
    // Если реальных метрик нет, используем историческую точность (70%) + теоретическую (30%)
    const metrics: Record<string, number> = {};
    this.modelEnsemble.models.forEach((model, index) => {
      const theoreticalQuality = normalizedPerformance[index] ?? 0.5;
      const modelKey = model.name.toLowerCase();
      const realQuality = realMetrics[modelKey];
      const historicalQuality = historicalQualityMap[modelKey];
      
      if (realQuality !== undefined) {
        // Есть реальные метрики: 90% реальные + 10% теоретические
        metrics[modelKey] = realQuality * 0.9 + theoreticalQuality * 0.1;
      } else if (historicalQuality !== undefined) {
        // Нет реальных метрик, но есть историческая точность: 70% историческая + 30% теоретические
        metrics[modelKey] = historicalQuality * 0.7 + theoreticalQuality * 0.3;
      } else {
        // Только теоретическая оценка
        metrics[modelKey] = theoreticalQuality;
      }
    });

    // Добавляем метрики LLM если доступны
    this.ensureLLMEngine();
    if (this.llmEngine && this.llmEngine.isAvailable()) {
      try {
        // Пытаемся получить реальные метрики для LLM
        const { getModelMetrics } = await import('./forecastFeedback');
        const llmRealMetrics = await getModelMetrics('LLM', this.storage);
        
        let llmRealQuality = undefined;
        if (llmRealMetrics.length > 0) {
          const overallMetric = llmRealMetrics.find((m) => m.dayOfWeek === null && m.horizon === null);
          if (overallMetric && overallMetric.sampleSize > 0) {
            const mape = overallMetric.mape / 100; // MAPE хранится в процентах
            const accuracy = Math.max(0, Math.min(1, 1 - mape));
            const sampleSizeWeight = Math.min(1, Math.log10(overallMetric.sampleSize + 1) / Math.log10(50));
            llmRealQuality = accuracy * sampleSizeWeight + 0.5 * (1 - sampleSizeWeight);
          }
        }
        
        const llmMetrics = this.llmEngine.getMetrics();
        // Рассчитываем теоретическое качество на основе успешных запросов
        const successRate = llmMetrics.totalRequests > 0 
          ? llmMetrics.successfulRequests / llmMetrics.totalRequests 
          : 0;
        const avgResponseTime = llmMetrics.averageResponseTime || 0;
        const responseTimeScore = avgResponseTime > 0 && avgResponseTime < 5000 
          ? Math.max(0, 1 - (avgResponseTime / 5000)) 
          : 0.5;
        const theoreticalLLMQuality = Math.min(1, (successRate * 0.7 + responseTimeScore * 0.3));
        
        // Комбинируем реальные метрики (80%) с теоретическими (20%)
        if (llmRealQuality !== undefined) {
          metrics.llm = llmRealQuality * 0.8 + theoreticalLLMQuality * 0.2;
        } else {
          metrics.llm = theoreticalLLMQuality;
        }
      } catch (error) {
        console.warn('Failed to get LLM metrics:', error);
        metrics.llm = 0;
      }
    } else {
      metrics.llm = 0;
    }

    return metrics;
  }

  // Получение статуса и метрик LLM
  public getLLMStatus(): {
    enabled: boolean;
    available: boolean;
    metrics?: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      cacheHits: number;
      averageResponseTime: number;
      successRate: number;
    };
  } {
    this.ensureLLMEngine();
    
    if (!this.llmEngine) {
      return { enabled: false, available: false };
    }

    const isAvailable = this.llmEngine.isAvailable();
    if (!isAvailable) {
      return { enabled: true, available: false };
    }

    try {
      const metrics = this.llmEngine.getMetrics();
      const successRate = metrics.totalRequests > 0 
        ? metrics.successfulRequests / metrics.totalRequests 
        : 0;

      return {
        enabled: true,
        available: true,
        metrics: {
          totalRequests: metrics.totalRequests,
          successfulRequests: metrics.successfulRequests,
          failedRequests: metrics.failedRequests,
          cacheHits: metrics.cacheHits,
          averageResponseTime: metrics.averageResponseTime,
          successRate,
        },
      };
    } catch (error) {
      console.warn('Failed to get LLM metrics:', error);
      return { enabled: true, available: false };
    }
  }

  // Основной метод прогнозирования
  public async generateEnhancedForecast(days: number = 7): Promise<ForecastData[]> {
    const timeSeriesData = await this.prepareEnhancedTimeSeriesData();
    
    // Сохраняем данные для последующего использования в getModelQualityMetrics
    this.timeSeriesData = timeSeriesData;

    if (timeSeriesData.length < 7) {
      return this.generateFallbackForecast(days);
    }

    // Улучшенное обучение на новых данных (асинхронное)
    await this.retrainModelsOnNewData(timeSeriesData);

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
      let holiday = this.findHoliday(
        format(forecastDate, 'yyyy-MM-dd'),
        futureExternalData.holidays || [],
      );

      // Fallback: если праздник не найден в загруженных данных, используем встроенную функцию определения
      // Это гарантирует, что праздники всегда будут определены, даже если внешний API недоступен
      if (!holiday) {
        const holidayInfo = this.getHolidayInfoFallback(forecastDate);
        if (holidayInfo.isHoliday) {
          holiday = {
            date: format(forecastDate, 'yyyy-MM-dd'),
            name: holidayInfo.name || 'Праздник',
            type: holidayInfo.type || 'national',
            country: 'RU',
            impact: this.calculateHolidayImpactFallback(holidayInfo),
          };
        }
      }

      // Проверяем предпраздничные дни (1 день до праздника)
      const nextDay = addDays(forecastDate, 1);
      let nextDayHoliday = this.findHoliday(
        format(nextDay, 'yyyy-MM-dd'),
        futureExternalData.holidays || [],
      );
      
      // Fallback для следующего дня (используем всегда, если праздник не найден)
      if (!nextDayHoliday) {
        const nextDayHolidayInfo = this.getHolidayInfoFallback(nextDay);
        if (nextDayHolidayInfo.isHoliday) {
          nextDayHoliday = {
            date: format(nextDay, 'yyyy-MM-dd'),
            name: nextDayHolidayInfo.name || 'Праздник',
            type: nextDayHolidayInfo.type || 'national',
            country: 'RU',
            impact: this.calculateHolidayImpactFallback(nextDayHolidayInfo),
          };
        }
      }
      
      const isPreHoliday = !holiday && !!nextDayHoliday;

      // Рассчитываем влияние праздника с учетом предпраздничных дней
      let holidayImpact = holiday?.impact || 0;
      if (isPreHoliday && nextDayHoliday) {
        // Предпраздничные дни имеют 50% от влияния праздника
        holidayImpact = (nextDayHoliday.impact || 0) * 0.5;
      }
      
      // Логируем для отладки, если найден праздник
      if (holiday || isPreHoliday) {
        console.log(
          `[EnhancedMLForecasting] Праздник найден: ${format(forecastDate, 'yyyy-MM-dd')}, ` +
          `название: ${holiday?.name || nextDayHoliday?.name}, ` +
          `тип: ${holiday?.type || nextDayHoliday?.type}, ` +
          `влияние: ${holidayImpact.toFixed(3)}`
        );
      }

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
        isHoliday: !!holiday || isPreHoliday,
        holidayType: holiday?.type || (isPreHoliday ? nextDayHoliday?.type : undefined),
        holidayImpact: holidayImpact,
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

    // Получаем прогнозы от всех моделей параллельно с таймаутами и обработкой ошибок
    const modelTimeoutMs = parseInt(process.env.MODEL_TIMEOUT_MS || '30000', 10); // 30 секунд по умолчанию
    
    const modelPromises = this.modelEnsemble.models.map(async (model, index) => {
      const modelName = model.name;
      
      // Создаем промис с таймаутом
      const timeoutPromise = new Promise<number[]>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Model ${modelName} timeout after ${modelTimeoutMs}ms`));
        }, modelTimeoutMs);
      });
      
      // Обертываем вызов модели в промис
      const modelPromise = new Promise<number[]>((resolve, reject) => {
        try {
          // Выполняем модель в следующем тике event loop для неблокирующего выполнения
          setImmediate(async () => {
            try {
              const predictions = await Promise.resolve(model.predict(timeSeriesData, futureData));
              // Проверяем, является ли результат Promise (для асинхронных моделей типа N-HITS)
              if (predictions instanceof Promise) {
                const asyncPredictions = await predictions;
                resolve(asyncPredictions);
              } else {
                resolve(predictions);
              }
            } catch (error) {
              reject(error);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
      
      // Соревнование между моделью и таймаутом
      try {
        const predictions = await Promise.race([modelPromise, timeoutPromise]);
        return { modelIndex: index, modelName, predictions, success: true };
      } catch (error) {
        console.warn(`[EnhancedMLForecast] Model ${modelName} failed or timed out:`, error);
        // Fallback: используем простое среднее для этой модели
        const avgRevenue = timeSeriesData.length > 0
          ? timeSeriesData.reduce((sum, d) => sum + d.revenue, 0) / timeSeriesData.length
          : 0;
        const fallbackPredictions = futureData.map(() => avgRevenue);
        return { modelIndex: index, modelName, predictions: fallbackPredictions, success: false };
      }
    });
    
    // Ждем выполнения всех моделей параллельно
    const modelResults = await Promise.all(modelPromises);
    
    // Сортируем результаты по индексу модели и извлекаем прогнозы
    const rawModelPredictions = modelResults
      .sort((a, b) => a.modelIndex - b.modelIndex)
      .map(result => result.predictions);
    
    // Логируем результаты всех моделей
    const successfulModels = modelResults.filter(r => r.success).map(r => r.modelName);
    const failedModels = modelResults.filter(r => !r.success).map(r => r.modelName);
    
    // Всегда логируем информацию о моделях
    console.log(`[EnhancedMLForecast] 📊 Модели ансамбля: ${this.modelEnsemble.models.length} моделей`);
    console.log(`[EnhancedMLForecast] ✅ Успешные модели (${successfulModels.length}): ${successfulModels.join(', ')}`);
    if (failedModels.length > 0) {
      console.log(`[EnhancedMLForecast] ⚠️  Модели с fallback (${failedModels.length}): ${failedModels.join(', ')}`);
    }
    
    // Логируем базовые веса моделей
    const modelWeights = this.modelEnsemble.models.map((m, idx) => {
      const result = modelResults.find(r => r.modelIndex === idx);
      const status = result?.success ? '✅' : '⚠️';
      return `${status} ${m.name}: ${(m.weight * 100).toFixed(1)}%`;
    }).join(', ');
    console.log(`[EnhancedMLForecast] 📈 Веса моделей в ансамбле: ${modelWeights}`);
    
    // Проверяем участие NHITS
    const nhitsResult = modelResults.find(r => r.modelName === 'NHITS');
    if (nhitsResult) {
      const nhitsModel = this.modelEnsemble.models.find(m => m.name === 'NHITS');
      const nhitsWeight = nhitsModel ? nhitsModel.weight : 0;
      const nhitsStatus = nhitsResult.success ? '✅' : '⚠️';
      console.log(`[EnhancedMLForecast] 🎯 NHITS: ${nhitsStatus} вес=${(nhitsWeight * 100).toFixed(2)}%, участвует=${nhitsResult.success ? 'да' : 'fallback'}`);
    } else {
      console.warn(`[EnhancedMLForecast] ⚠️  NHITS не найден в результатах моделей!`);
    }
    
    // Валидация: проверяем что все модели вернули прогнозы
    const expectedModels = ['ARIMA', 'Prophet', 'LSTM', 'GRU', 'RandomForest', 'XGBoost', 'GradientBoosting', 'NHITS'];
    const foundModels = modelResults.map(r => r.modelName);
    const missingModels = expectedModels.filter(m => !foundModels.includes(m));
    if (missingModels.length > 0) {
      console.warn(`[EnhancedMLForecast] ⚠️  Отсутствуют модели в результатах: ${missingModels.join(', ')}`);
    }
    
    // Проверяем что все модели вернули прогнозы правильной длины
    const predictionLength = futureData.length;
    const invalidModels = modelResults.filter(r => !r.predictions || r.predictions.length !== predictionLength);
    if (invalidModels.length > 0) {
      console.warn(`[EnhancedMLForecast] ⚠️  Модели с некорректной длиной прогнозов: ${invalidModels.map(m => `${m.modelName} (${m.predictions?.length || 0} вместо ${predictionLength})`).join(', ')}`);
    }

    // Анализ интеграции GRU (только при первом запуске или при изменении данных)
    if (this.shouldAnalyzeGRUIntegration()) {
      await this.analyzeGRUIntegration(timeSeriesData, rawModelPredictions, futureData);
    }

    // Получаем прогноз от LLM (если доступен) и добавляем в ансамбль
    let llmPredictions: number[] = [];
    this.ensureLLMEngine();
    if (this.llmEngine && this.llmEngine.isAvailable()) {
      try {
        const llmStartTime = Date.now();
        console.log(`[EnhancedMLForecast] 🤖 Запуск LLM прогнозирования для ${futureData.length} дней...`);
        llmPredictions = await this.llmPredict(timeSeriesData, futureData);
        const llmDuration = Date.now() - llmStartTime;
        
        // Вычисляем вес LLM на основе исторической точности (если доступна)
        // Используем базовый вес 0.15 для LLM, который будет адаптивно корректироваться
        this.currentLLMWeight = this.calculateLLMWeight(timeSeriesData);
        
        // Логирование использования LLM
        const llmMetrics = this.llmEngine.getMetrics();
        const successRate = llmMetrics.totalRequests > 0 
          ? (llmMetrics.successfulRequests / llmMetrics.totalRequests * 100).toFixed(1)
          : '0';
        
        console.log(
          `[EnhancedMLForecast] ✅ LLM прогноз завершен: ${llmPredictions.length} дней, ` +
          `вес: ${this.currentLLMWeight.toFixed(3)}, ` +
          `время: ${llmDuration}ms, ` +
          `запросов: ${llmMetrics.totalRequests}, ` +
          `успешно: ${llmMetrics.successfulRequests} (${successRate}%), ` +
          `ошибок: ${llmMetrics.failedRequests}, ` +
          `кеш попаданий: ${llmMetrics.cacheHits}`,
        );
        
        // Добавляем LLM прогнозы в ансамбль
        rawModelPredictions.push(llmPredictions);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[EnhancedMLForecast] ❌ Ошибка LLM прогнозирования: ${errorMessage}`);
        console.error(`[EnhancedMLForecast] Продолжаем без LLM прогнозов...`);
        this.currentLLMWeight = 0; // Отключаем LLM вес при ошибке
      }
    } else {
      this.currentLLMWeight = 0;
      // LLM отключен - работаем без него
    }

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

    // Объединяем прогнозы с учетом дней недели
    const ensemblePredictions = await this.modelEnsemble.metaModel(modelPredictions, futureData);
    
    // Логируем адаптивные веса после ансамбля (для первого дня прогноза)
    if (this.lastAdaptiveDiagnostics.length > 0) {
      const firstDayDiagnostics = this.lastAdaptiveDiagnostics[0];
      if (firstDayDiagnostics && firstDayDiagnostics.normalizedWeights) {
        const adaptiveWeights = this.modelEnsemble.models.map((m, idx) => {
          const weight = firstDayDiagnostics.normalizedWeights[idx] || 0;
          return `${m.name}: ${(weight * 100).toFixed(2)}%`;
        }).join(', ');
        console.log(`[EnhancedMLForecast] 🔄 Адаптивные веса (первый день): ${adaptiveWeights}`);
      }
    }
    const { clampLimit, clampMin, median } = calculateHistoricalClamp(revenueHistory, baseRevenue);
    const seasonalityStats = this.computeSeasonalityStats(timeSeriesData);
    
    // Для малых датасетов используем менее консервативный подход для сохранения влияния факторов
    const isSmallDataset = timeSeriesData.length < 30;
    const conservativeMultiplier = isSmallDataset ? 0.95 : 1.0; // Уменьшено с 0.9 до 0.95

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
      // Убеждаемся, что holidayImpact установлен
      if (future.holidayImpact === undefined) {
        console.warn(
          `[EnhancedMLForecasting] holidayImpact не установлен для ${format(forecastDate, 'yyyy-MM-dd')}, ` +
          `isHoliday: ${future.isHoliday}, holidayType: ${future.holidayType}`
        );
      }
      const factors = this.calculateEnhancedInfluenceFactors(forecastDate, timeSeriesData, future);
      
      // Логируем holidayImpact для отладки
      if (factors.holiday && Math.abs(factors.holiday) > 0.01) {
        console.log(
          `[EnhancedMLForecasting] factors.holiday для ${format(forecastDate, 'yyyy-MM-dd')}: ${factors.holiday.toFixed(3)}`
        );
      }

      // Улучшенный фактор из данных Z-отчетов (COGS, маржа)
      const profitabilityFactor = this.calculateProfitabilityFactor(timeSeriesData, future);

      // Ослабленные ограничения для более сильного влияния факторов
      const seasonalRange = isSmallDataset ? [0.6, 1.4] : [0.4, 1.6];
      const trendRange = isSmallDataset ? [0.8, 1.2] : [0.6, 1.4];
      const otherRange = isSmallDataset ? [0.85, 1.15] : [0.6, 1.4]; // Увеличено влияние погоды и праздников
      
      const seasonalMultiplier = this.clampMultiplier(factors.seasonal ?? 1, seasonalRange[0], seasonalRange[1]);
      const trendMultiplier = this.clampMultiplier(1 + (factors.trend ?? 0), trendRange[0], trendRange[1]);
      const weatherMultiplier = this.clampMultiplier(1 + (factors.weather ?? 0), otherRange[0], otherRange[1]);
      // Значительно расширен диапазон влияния праздников: от -40% до +70% для учета сильного влияния крупных праздников
      const holidayMultiplier = this.clampMultiplier(1 + (factors.holiday ?? 0), 0.6, 1.7);
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
      
      // Увеличенные веса факторов для более сильного влияния
      // Значительно увеличен вес праздников для более точного учета их влияния
      const weights = isSmallDataset
        ? [
            { value: seasonalMultiplier, weight: 0.30 - profitabilityWeight }, // Уменьшено с 0.35 для баланса
            { value: trendMultiplier, weight: 0.15 },
            { value: weatherMultiplier, weight: 0.15 },
            { value: holidayMultiplier, weight: 0.22 }, // Значительно увеличено с 0.12 до 0.22 (+83%)
            { value: timeOfMonthMultiplier, weight: 0.10 },
            { value: historicalMultiplier, weight: 0.08 }, // Уменьшено с 0.10 для баланса
            { value: economicMultiplier, weight: 0.03 },
            { value: sentimentMultiplier, weight: 0.01 },
            { value: regionalCoffeeDemandMultiplier, weight: 0.01 },
            ...(hasProfitabilityData ? [{ value: profitabilityMultiplier, weight: profitabilityWeight }] : []),
          ]
        : [
            { value: seasonalMultiplier, weight: 0.25 - profitabilityWeight }, // Уменьшено с 0.30 для баланса
            { value: trendMultiplier, weight: 0.18 },
            { value: weatherMultiplier, weight: 0.18 }, // Уменьшено с 0.20 для баланса
            { value: holidayMultiplier, weight: 0.25 }, // Значительно увеличено с 0.15 до 0.25 (+67%)
            { value: timeOfMonthMultiplier, weight: 0.08 },
            { value: historicalMultiplier, weight: 0.06 }, // Уменьшено с 0.08 для баланса
            { value: economicMultiplier, weight: 0.05 },
            { value: sentimentMultiplier, weight: 0.03 },
            { value: regionalCoffeeDemandMultiplier, weight: 0.03 },
            ...(hasProfitabilityData ? [{ value: profitabilityMultiplier, weight: profitabilityWeight }] : []),
          ];
      
      const compositeMultiplier = this.combineMultipliers(weights, 1);

      // Уменьшенное сглаживание для более сильного влияния факторов
      const isFirstDay = i === 0;
      const stabilityWeight = isFirstDay ? 0.75 : 0.65; // Уменьшено сглаживание (было 0.6/0.4)
      
      const adjustedRaw = Math.max(0, rawPrediction) * compositeMultiplier * conservativeMultiplier;
      
      // Меньше сглаживания с базовым прогнозом для сохранения влияния факторов
      const blendedPrediction = this.blendPredictions(
        adjustedRaw,
        baselineSeasonalPrediction,
        stabilityWeight,
      );
      
      // Уменьшенное дополнительное сглаживание с медианой для малых датасетов
      let finalBlended = blendedPrediction;
      if (isSmallDataset) {
        finalBlended = blendedPrediction * 0.85 + median * 0.15; // Уменьшено сглаживание (было 0.7/0.3)
      }
      
      // Применяем ограничения
      const clampedPrediction = Math.min(finalBlended, clampLimit);
      const safePrediction = Math.max(clampMin, clampedPrediction);
      
      // Улучшенная проверка сглаживания с учетом дня недели
      if (i > 0 && finalPredictions.length > 0) {
        const prevPrediction = finalPredictions[finalPredictions.length - 1];
        const change = Math.abs(safePrediction - prevPrediction) / prevPrediction;
        
        // Определяем порог сглаживания на основе дня недели и волатильности
        // Понедельники (1) и дни после выходных могут иметь большую волатильность
        const isHighVolatilityDay = dayOfWeek === 1 || dayOfWeek === 0; // Понедельник или воскресенье
        const isTransitionDay = dayOfWeek === 1 || dayOfWeek === 6; // Понедельник или суббота
        
        // Снижаем базовый порог с 50% до 32%
        // Для дней с высокой волатильностью увеличиваем порог до 45%
        const baseSmoothingThreshold = 0.32;
        const volatilityBonus = isHighVolatilityDay ? 0.13 : 0;
        const smoothingThreshold = baseSmoothingThreshold + volatilityBonus;
        
        // Также учитываем историческую волатильность для этого дня недели
        const historicalVolatility = this.calculateDayOfWeekVolatility(dayOfWeek, timeSeriesData);
        const volatilityAdjustment = Math.min(0.08, historicalVolatility * 0.1);
        const finalThreshold = smoothingThreshold + volatilityAdjustment;
        
        // Если изменение превышает порог, применяем умное сглаживание
        if (change > finalThreshold) {
          // Для дней с высокой волатильностью применяем более мягкое сглаживание
          const smoothingStrength = isHighVolatilityDay ? 0.6 : 0.75; // Меньше сглаживания для волатильных дней
          const smoothed = prevPrediction * smoothingStrength + safePrediction * (1 - smoothingStrength);
          finalPredictions.push(Math.max(clampMin, Math.min(clampLimit, smoothed)));
          continue;
        }
      }

      // Определяем тип дня для калибровки
      const isHoliday = future.isHoliday || false;
      const isWeekend = future.isWeekend || (dayOfWeek === 0 || dayOfWeek === 6);
      const dayType: 'weekday' | 'weekend' | 'holiday' = isHoliday ? 'holiday' : isWeekend ? 'weekend' : 'weekday';
      
      // Применяем динамическую калибровку на основе исторических ошибок
      // Передаем горизонт (i+1) и тип дня для более точной калибровки
      const calibratedPrediction = await this.applyDynamicCalibration(
        safePrediction,
        dayOfWeek,
        timeSeriesData,
        i + 1, // Горизонт прогнозирования (дни вперед)
        dayType, // Тип дня
      );

      finalPredictions.push(calibratedPrediction);

      // Расчет уверенности
      const confidence = await this.calculateEnhancedConfidence(timeSeriesData, modelPredictions, i);

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

      // Получаем данные о празднике для структуры factors (для holidayName)
      const holiday = this.findHoliday(
        format(forecastDate, 'yyyy-MM-dd'),
        futureExternalData.holidays || [],
      );
      const nextDay = addDays(forecastDate, 1);
      const nextDayHoliday = this.findHoliday(
        format(nextDay, 'yyyy-MM-dd'),
        futureExternalData.holidays || [],
      );
      const isPreHoliday = !holiday && !!nextDayHoliday;
      const actualHoliday = holiday || (isPreHoliday ? nextDayHoliday : null);

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
        timeOfMonthImpact: factors.timeOfMonth,
        historicalPatternImpact: factors.historicalPattern,
        economicCycleImpact: factors.economicCycle,
        localEventImpact: factors.localEvent,
        customerBehaviorImpact: factors.customerSegment,
        factors: {
          weather: {
            temperature: future.temperature || 15,
            precipitation: future.precipitation || 0,
            humidity: future.humidity,
            windSpeed: future.windSpeed,
            cloudCover: future.cloudCover,
            uvIndex: future.uvIndex,
            visibility: future.visibility,
            impact: factors.weather || 0,
          },
          economic: {
            exchangeRate: future.exchangeRate || futureExternalData.economic?.exchangeRate || 95.5,
            inflation: futureExternalData.economic?.inflation,
            consumerConfidence: futureExternalData.economic?.consumerConfidence,
            unemploymentRate: futureExternalData.economic?.unemploymentRate,
            impact: factors.economicIndicators || 0,
          },
          traffic: {
            congestionLevel: 0,
            averageSpeed: 0,
            trafficVolume: 0,
            impact: factors.localEvent || 0,
          },
          social: {
            sentiment: future.socialSentiment || 0,
            volume: future.socialVolume || 0,
            platforms: [],
            impact: factors.socialSentiment || 0,
          },
          demographic: {
            population: 0,
            ageGroups: {},
            incomeLevels: {},
            employmentRate: 0,
            impact: factors.customerSegment || 0,
          },
          holiday: {
            isHoliday: !!actualHoliday || isPreHoliday,
            holidayType: actualHoliday?.type,
            holidayName: actualHoliday?.name,
            impact: factors.holiday || 0,
          },
          seasonality: factors.seasonal || 1,
          trend: factors.trend || 0,
          timeOfMonth: factors.timeOfMonth || 0,
          historicalPattern: factors.historicalPattern || 0,
          economicCycle: factors.economicCycle || 0,
          localEvent: factors.localEvent || 0,
          customerBehavior: factors.customerSegment || 0,
        },
      });
      
      finalPredictions.push(safePrediction);
    }

    // Сохраняем прогнозы в БД для обратной связи
    if (this.storage && this.uploadId) {
      await this.saveForecastsToStorage(
        forecasts,
        modelPredictions,
        llmPredictions,
        finalPredictions,
        lastDate,
      );
    }

    return forecasts;
  }

  /**
   * Сохраняет прогнозы всех моделей в хранилище для последующего анализа отклонений
   */
  private async saveForecastsToStorage(
    ensembleForecasts: ForecastData[],
    modelPredictions: number[][],
    llmPredictions: number[],
    finalPredictions: number[],
    lastDate: Date,
  ): Promise<void> {
    if (!this.storage || !this.uploadId) {
      return;
    }

    try {
      const savePromises: Promise<any>[] = [];

      // Сохраняем прогнозы от каждой модели отдельно
      for (let modelIdx = 0; modelIdx < this.modelEnsemble.models.length; modelIdx++) {
        const model = this.modelEnsemble.models[modelIdx];
        const predictions = modelPredictions[modelIdx] || [];

        for (let i = 0; i < ensembleForecasts.length; i++) {
          const forecast = ensembleForecasts[i];
          const forecastDate = new Date(forecast.date);
          const dayOfWeek = getDay(forecastDate);
          const horizon = i + 1;

          const prediction: InsertForecastPrediction = {
            uploadId: this.uploadId,
            modelName: model.name,
            forecastDate: forecastDate,
            actualDate: forecastDate,
            predictedRevenue: predictions[i] || 0,
            actualRevenue: null,
            dayOfWeek,
            horizon,
            mape: null,
            mae: null,
            rmse: null,
            factors: forecast.factors || null,
          };

          savePromises.push(this.storage.createForecastPrediction(prediction));
        }
      }

      // Сохраняем LLM прогнозы (если есть)
      if (llmPredictions.length > 0) {
        for (let i = 0; i < ensembleForecasts.length; i++) {
          const forecast = ensembleForecasts[i];
          const forecastDate = new Date(forecast.date);
          const dayOfWeek = getDay(forecastDate);
          const horizon = i + 1;

          const prediction: InsertForecastPrediction = {
            uploadId: this.uploadId,
            modelName: 'LLM',
            forecastDate: forecastDate,
            actualDate: forecastDate,
            predictedRevenue: llmPredictions[i] || 0,
            actualRevenue: null,
            dayOfWeek,
            horizon,
            mape: null,
            mae: null,
            rmse: null,
            factors: forecast.factors || null,
          };

          savePromises.push(this.storage.createForecastPrediction(prediction));
        }
      }

      // Сохраняем финальный ансамбль-прогноз
      for (let i = 0; i < ensembleForecasts.length; i++) {
        const forecast = ensembleForecasts[i];
        const forecastDate = new Date(forecast.date);
        const dayOfWeek = getDay(forecastDate);
        const horizon = i + 1;

        const prediction: InsertForecastPrediction = {
          uploadId: this.uploadId,
          modelName: 'Ensemble',
          forecastDate: forecastDate,
          actualDate: forecastDate,
          predictedRevenue: finalPredictions[i] || forecast.predictedRevenue,
          actualRevenue: null,
          dayOfWeek,
          horizon,
          mape: null,
          mae: null,
          rmse: null,
          factors: forecast.factors || null,
        };

        savePromises.push(this.storage.createForecastPrediction(prediction));
      }

      // Выполняем сохранение параллельно
      await Promise.all(savePromises);
      console.log(
        `[EnhancedMLForecast] Сохранено ${savePromises.length} прогнозов для uploadId: ${this.uploadId}`,
      );
    } catch (error) {
      console.error('[EnhancedMLForecast] Ошибка при сохранении прогнозов:', error);
      // Не прерываем выполнение, если сохранение не удалось
    }
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

  // Fallback метод для определения праздников на основе даты (если внешний API недоступен)
  private getHolidayInfoFallback(date: Date): { isHoliday: boolean; type?: string; name?: string } {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    // Российские государственные праздники
    const holidays: { [key: string]: { name: string; type: string } } = {
      '01-01': { name: 'Новый год', type: 'national' },
      '01-02': { name: 'Новогодние каникулы', type: 'national' },
      '01-03': { name: 'Новогодние каникулы', type: 'national' },
      '01-04': { name: 'Новогодние каникулы', type: 'national' },
      '01-05': { name: 'Новогодние каникулы', type: 'national' },
      '01-06': { name: 'Новогодние каникулы', type: 'national' },
      '01-07': { name: 'Рождество Христово', type: 'religious' },
      '01-08': { name: 'Новогодние каникулы', type: 'national' },
      '02-23': { name: 'День защитника Отечества', type: 'national' },
      '03-08': { name: 'Международный женский день', type: 'national' },
      '05-01': { name: 'Праздник Весны и Труда', type: 'national' },
      '05-09': { name: 'День Победы', type: 'national' },
      '06-12': { name: 'День России', type: 'national' },
      '11-04': { name: 'День народного единства', type: 'national' },
    };

    const dateKey = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const holiday = holidays[dateKey];

    if (holiday) {
      return {
        isHoliday: true,
        type: holiday.type,
        name: holiday.name,
      };
    }

    return { isHoliday: false };
  }

  // Fallback метод для расчета влияния праздника
  private calculateHolidayImpactFallback(holiday: {
    isHoliday: boolean;
    type?: string;
    name?: string;
  }): number {
    if (!holiday.isHoliday) return 0;

    switch (holiday.type) {
      case 'national':
        // Государственные праздники обычно значительно увеличивают выручку
        return 0.4;
      case 'religious':
        // Религиозные праздники
        return holiday.name?.includes('Рождество') ? 0.5 : 0.35;
      case 'regional':
        return 0.3;
      case 'unofficial':
        return 0.15;
      default:
        return 0;
    }
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

  // Улучшенный выбор порядка ARIMA через AIC/BIC критерии
  private selectARIMAOrderImproved(revenues: number[]): {
    ar: number;
    ma: number;
    diff: number;
    sar: number;
    sma: number;
    seasonalDiff: number;
    seasonalPeriod: number;
  } {
    const n = revenues.length;
    if (n < 14) {
      return { ar: 1, ma: 1, diff: 1, sar: 0, sma: 0, seasonalDiff: 0, seasonalPeriod: 0 };
    }

    // Определяем сезонный период (7 дней для недельной сезонности)
    const seasonalPeriod = n >= 21 ? 7 : 0; // Минимум 3 недели данных для сезонности

    // Тестируем различные порядки ARIMA
    const maxOrder = Math.min(3, Math.floor(n / 10)); // Максимальный порядок зависит от размера данных
    let bestAIC = Infinity;
    let bestOrder = { ar: 1, ma: 1, diff: 1, sar: 0, sma: 0, seasonalDiff: 0, seasonalPeriod: 0 };

    // Тестируем порядки дифференцирования
    for (let diff = 0; diff <= Math.min(2, maxOrder); diff++) {
      if (n < diff + 10) continue;
      
      const diffRevenues = this.difference(revenues, diff);
      if (diffRevenues.length < 7) continue;

      // Тестируем AR и MA порядки
      for (let ar = 0; ar <= maxOrder; ar++) {
        for (let ma = 0; ma <= maxOrder; ma++) {
          if (ar === 0 && ma === 0) continue; // Хотя бы один должен быть > 0
          
          try {
            const arCoeffs = this.fitARImproved(diffRevenues, ar);
            const maCoeffs = this.fitMAImproved(diffRevenues, ma);
            
            // Рассчитываем AIC
            const aic = this.calculateAIC(diffRevenues, arCoeffs, maCoeffs, ar, ma, diff);
            
            if (aic < bestAIC && Number.isFinite(aic)) {
              bestAIC = aic;
              bestOrder = { ar, ma, diff, sar: 0, sma: 0, seasonalDiff: 0, seasonalPeriod: 0 };
            }
          } catch (error) {
            // Пропускаем невалидные комбинации
            continue;
          }
        }
      }

      // Тестируем SARIMA (если есть сезонность)
      if (seasonalPeriod > 0 && diffRevenues.length >= seasonalPeriod * 2) {
        for (let sar = 0; sar <= Math.min(1, maxOrder); sar++) {
          for (let sma = 0; sma <= Math.min(1, maxOrder); sma++) {
            if (sar === 0 && sma === 0) continue;
            
            try {
              const seasonalDiffRevenues = this.seasonalDifference(diffRevenues, seasonalPeriod, 1);
              if (seasonalDiffRevenues.length < 7) continue;
              
              const arCoeffs = this.fitARImproved(seasonalDiffRevenues, bestOrder.ar);
              const maCoeffs = this.fitMAImproved(seasonalDiffRevenues, bestOrder.ma);
              const sarCoeffs = sar > 0 ? this.fitARImproved(seasonalDiffRevenues, sar, seasonalPeriod) : [];
              const smaCoeffs = sma > 0 ? this.fitMAImproved(seasonalDiffRevenues, sma, seasonalPeriod) : [];
              
              // Рассчитываем AIC для SARIMA
              const aic = this.calculateAIC(
                seasonalDiffRevenues,
                arCoeffs,
                maCoeffs,
                bestOrder.ar,
                bestOrder.ma,
                bestOrder.diff,
                sarCoeffs,
                smaCoeffs,
                sar,
                sma,
              );
              
              if (aic < bestAIC && Number.isFinite(aic)) {
                bestAIC = aic;
                bestOrder = {
                  ar: bestOrder.ar,
                  ma: bestOrder.ma,
                  diff: bestOrder.diff,
                  sar,
                  sma,
                  seasonalDiff: 1,
                  seasonalPeriod,
                };
              }
            } catch (error) {
              continue;
            }
          }
        }
      }
    }

    return bestOrder;
  }

  // Удаление выбросов через IQR метод
  private removeOutliers(data: number[]): number[] {
    if (data.length < 4) return data;
    
    const sorted = [...data].sort((a, b) => a - b);
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Index];
    const q3 = sorted[q3Index];
    const iqr = q3 - q1;
    
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    
    // Заменяем выбросы на ближайшие валидные значения
    return data.map(val => {
      if (val < lowerBound) return Math.max(lowerBound, sorted[0]);
      if (val > upperBound) return Math.min(upperBound, sorted[sorted.length - 1]);
      return val;
    });
  }

  // Сезонное дифференцирование
  private seasonalDifference(data: number[], period: number, order: number): number[] {
    if (order === 0 || data.length < period * 2) return data;
    
    const result: number[] = [];
    for (let i = period; i < data.length; i++) {
      result.push(data[i] - data[i - period]);
    }
    
    if (order > 1) {
      return this.seasonalDifference(result, period, order - 1);
    }
    
    return result;
  }

  // Улучшенная подгонка AR через метод наименьших квадратов (Yule-Walker)
  private fitARImproved(data: number[], order: number, lag: number = 1): number[] {
    if (order === 0 || data.length < order + 5) {
      return [];
    }

    // Вычисляем автокорреляции
    const autocorrelations: number[] = [];
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    
    if (variance < 1e-10) {
      return Array(order).fill(0.1);
    }

    for (let k = 0; k <= order; k++) {
      let sum = 0;
      for (let i = k; i < data.length; i++) {
        sum += (data[i] - mean) * (data[i - k] - mean);
      }
      autocorrelations.push(sum / (data.length - k) / variance);
    }

    // Решаем систему Yule-Walker уравнений (упрощенная версия)
    const coeffs: number[] = [];
    for (let i = 1; i <= order; i++) {
      let coeff = autocorrelations[i];
      
      // Учитываем предыдущие коэффициенты (упрощенная версия)
      for (let j = 1; j < i; j++) {
        coeff -= (coeffs[j - 1] || 0) * (autocorrelations[Math.abs(i - j)] || 0);
      }
      
      // Нормализуем
      if (Math.abs(autocorrelations[0]) > 1e-10) {
        coeff /= autocorrelations[0];
      }
      
      coeffs.push(Math.max(-0.99, Math.min(0.99, coeff))); // Ограничиваем для стабильности
    }

    return coeffs.length === order ? coeffs : Array(order).fill(0.1);
  }

  // Улучшенная подгонка MA через метод наименьших квадратов
  private fitMAImproved(data: number[], order: number, lag: number = 1): number[] {
    if (order === 0 || data.length < order + 5) {
      return [];
    }

    // Упрощенная подгонка MA через минимизацию ошибок
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const residuals: number[] = data.map(val => val - mean);
    
    const coeffs: number[] = [];
    for (let i = 1; i <= order; i++) {
      if (i * lag >= residuals.length) break;
      
      // Вычисляем корреляцию между текущими и лаговыми остатками
      let sum = 0;
      let count = 0;
      for (let j = i * lag; j < residuals.length; j++) {
        sum += residuals[j] * residuals[j - i * lag];
        count++;
      }
      
      const coeff = count > 0 ? sum / count / (mean * mean + 1) : 0;
      coeffs.push(Math.max(-0.99, Math.min(0.99, coeff)));
    }

    return coeffs.length === order ? coeffs : Array(order).fill(0.1);
  }

  // Улучшенный прогноз ARIMA с учетом сезонности
  private predictARIMAImproved(
    data: number[],
    arCoeffs: number[],
    maCoeffs: number[],
    steps: number,
    sarCoeffs: number[] = [],
    smaCoeffs: number[] = [],
    seasonalPeriod: number = 0,
  ): number {
    if (data.length === 0) return 0;

    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    let prediction = mean;

    // AR компонент
    for (let i = 0; i < arCoeffs.length && i < data.length; i++) {
      prediction += arCoeffs[i] * (data[data.length - 1 - i] - mean);
    }

    // Сезонный AR компонент (SARIMA)
    if (seasonalPeriod > 0 && sarCoeffs.length > 0 && data.length >= seasonalPeriod) {
      for (let i = 0; i < sarCoeffs.length; i++) {
        const lag = seasonalPeriod * (i + 1);
        if (data.length >= lag) {
          prediction += sarCoeffs[i] * (data[data.length - lag] - mean);
        }
      }
    }

    // MA компонент (упрощенный, так как нам нужны будущие ошибки)
    // Используем исторические остатки как приближение
    const historicalResiduals: number[] = [];
    for (let i = Math.max(maCoeffs.length, 1); i < data.length; i++) {
      let predicted = mean;
      for (let j = 0; j < arCoeffs.length && i - j - 1 >= 0; j++) {
        predicted += arCoeffs[j] * (data[i - j - 1] - mean);
      }
      historicalResiduals.push(data[i] - predicted);
    }

    if (historicalResiduals.length > 0) {
      const avgResidual = historicalResiduals.reduce((sum, r) => sum + r, 0) / historicalResiduals.length;
      for (let i = 0; i < maCoeffs.length && i < historicalResiduals.length; i++) {
        prediction += maCoeffs[i] * (historicalResiduals[historicalResiduals.length - 1 - i] - avgResidual);
      }
    }

    // Сезонный MA компонент
    if (seasonalPeriod > 0 && smaCoeffs.length > 0 && historicalResiduals.length >= seasonalPeriod) {
      for (let i = 0; i < smaCoeffs.length; i++) {
        const lag = seasonalPeriod * (i + 1);
        if (historicalResiduals.length >= lag) {
          const seasonalResidual = historicalResiduals[historicalResiduals.length - lag];
          prediction += smaCoeffs[i] * seasonalResidual;
        }
      }
    }

    // Затухание для дальних прогнозов
    const decayFactor = Math.exp(-steps * 0.1);
    prediction = mean + (prediction - mean) * decayFactor;

    return prediction;
  }

  // Обратное сезонное дифференцирование
  private undifferenceSeasonal(
    original: number[],
    prediction: number,
    period: number,
    order: number,
  ): number {
    if (order === 0 || original.length < period) return prediction;
    
    // Берем последнее значение из оригинального ряда (до сезонного дифференцирования)
    const lastValue = original[original.length - period] || 0;
    return prediction + lastValue;
  }

  // Расчет AIC (Akaike Information Criterion)
  private calculateAIC(
    data: number[],
    arCoeffs: number[],
    maCoeffs: number[],
    ar: number,
    ma: number,
    diff: number,
    sarCoeffs: number[] = [],
    smaCoeffs: number[] = [],
    sar: number = 0,
    sma: number = 0,
  ): number {
    if (data.length < ar + ma + diff + 1) return Infinity;

    // Рассчитываем остатки (residuals)
    const residuals: number[] = [];
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    
    for (let i = Math.max(ar, ma, sar * 7); i < data.length; i++) {
      let predicted = mean;
      
      // AR компонент
      for (let j = 0; j < ar && i - j - 1 >= 0; j++) {
        predicted += (arCoeffs[j] || 0) * (data[i - j - 1] - mean);
      }
      
      // SAR компонент
      if (sar > 0) {
        const period = 7; // Недельная сезонность
        for (let j = 0; j < sar && i - period * (j + 1) >= 0; j++) {
          predicted += (sarCoeffs[j] || 0) * (data[i - period * (j + 1)] - mean);
        }
      }
      
      residuals.push(data[i] - predicted);
    }

    if (residuals.length === 0) return Infinity;

    // Рассчитываем сумму квадратов остатков
    const ssr = residuals.reduce((sum, r) => sum + r * r, 0);
    const mse = ssr / residuals.length;
    
    if (mse < 1e-10) return Infinity;

    // Количество параметров
    const k = ar + ma + diff + sar + sma + 1; // +1 для константы
    
    // AIC = n * ln(MSE) + 2 * k
    const n = residuals.length;
    const aic = n * Math.log(mse) + 2 * k;
    
    return Number.isFinite(aic) ? aic : Infinity;
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

  // Улучшенная кастомная недельная сезонность с учетом трендов
  private calculateCustomWeeklySeasonality(data: EnhancedTimeSeriesData[]): number[] {
    const weekly = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    const weeklyTrends = new Array(7).fill(0);

    // Разделяем данные на периоды для учета изменений
    const midPoint = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, midPoint);
    const secondHalf = data.slice(midPoint);

    data.forEach((d) => {
      weekly[d.dayOfWeek] += d.revenue;
      counts[d.dayOfWeek]++;
    });

    // Рассчитываем тренды по дням недели
    firstHalf.forEach((d) => {
      weeklyTrends[d.dayOfWeek] -= d.revenue;
    });
    secondHalf.forEach((d) => {
      weeklyTrends[d.dayOfWeek] += d.revenue;
    });

    const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return weekly.map((revenue, day) => {
      if (counts[day] === 0) return 1;
      const dayAvg = revenue / counts[day];
      
      // Учитываем тренд (если выручка растет, увеличиваем множитель)
      const trend = weeklyTrends[day] / Math.max(1, counts[day]);
      const trendAdjustment = Math.abs(trend) > avgRevenue * 0.1 
        ? (trend / avgRevenue) * 0.1 
        : 0;
      
      return (dayAvg / avgRevenue) * (1 + trendAdjustment);
    });
  }

  // Улучшенная кастомная месячная сезонность
  private calculateCustomMonthlySeasonality(data: EnhancedTimeSeriesData[]): number[] {
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
      return monthAvg / avgRevenue;
    });
  }

  // Сезонность по времени месяца (начало/середина/конец)
  private calculateMonthTimeSeasonality(data: EnhancedTimeSeriesData[]): {
    start: number; // 1-10 дни
    middle: number; // 11-20 дни
    end: number; // 21-31 дни
  } {
    const startDays: number[] = [];
    const middleDays: number[] = [];
    const endDays: number[] = [];

    data.forEach((d) => {
      if (d.dayOfMonth <= 10) {
        startDays.push(d.revenue);
      } else if (d.dayOfMonth <= 20) {
        middleDays.push(d.revenue);
      } else {
        endDays.push(d.revenue);
      }
    });

    const avgRevenue = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    const startAvg = startDays.length > 0
      ? startDays.reduce((sum, r) => sum + r, 0) / startDays.length
      : avgRevenue;
    const middleAvg = middleDays.length > 0
      ? middleDays.reduce((sum, r) => sum + r, 0) / middleDays.length
      : avgRevenue;
    const endAvg = endDays.length > 0
      ? endDays.reduce((sum, r) => sum + r, 0) / endDays.length
      : avgRevenue;

    return {
      start: startAvg / avgRevenue,
      middle: middleAvg / avgRevenue,
      end: endAvg / avgRevenue,
    };
  }

  // Получить множитель для времени месяца
  private getMonthTimeMultiplier(dayOfMonth: number, seasonality: { start: number; middle: number; end: number }): number {
    if (dayOfMonth <= 10) {
      return Math.max(0.9, Math.min(1.1, seasonality.start));
    } else if (dayOfMonth <= 20) {
      return Math.max(0.95, Math.min(1.05, seasonality.middle));
    } else {
      return Math.max(0.9, Math.min(1.1, seasonality.end));
    }
  }

  // Обнаружение changepoints (точек изменения тренда)
  private detectChangepoints(data: EnhancedTimeSeriesData[]): number[] {
    if (data.length < 14) return [];

    const changepoints: number[] = [];
    const windowSize = Math.max(7, Math.floor(data.length / 5));
    const minChange = 0.15; // Минимальное изменение для обнаружения changepoint

    for (let i = windowSize; i < data.length - windowSize; i += Math.floor(windowSize / 2)) {
      const beforeWindow = data.slice(i - windowSize, i);
      const afterWindow = data.slice(i, i + windowSize);

      const beforeAvg = beforeWindow.reduce((sum, d) => sum + d.revenue, 0) / beforeWindow.length;
      const afterAvg = afterWindow.reduce((sum, d) => sum + d.revenue, 0) / afterWindow.length;

      const change = Math.abs((afterAvg - beforeAvg) / beforeAvg);
      
      if (change > minChange) {
        changepoints.push(i);
      }
    }

    return changepoints;
  }

  // Расчет трендов для сегментов между changepoints
  private calculateTrendSegments(
    data: EnhancedTimeSeriesData[],
    changepoints: number[],
  ): Array<{ start: number; end: number; trend: number }> {
    const segments: Array<{ start: number; end: number; trend: number }> = [];
    const points = [0, ...changepoints, data.length];

    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i];
      const end = points[i + 1];
      const segment = data.slice(start, end);

      if (segment.length < 3) continue;

      const revenues = segment.map((d) => d.revenue);
      const trend = this.calculateLinearTrend(revenues);
      
      segments.push({ start, end, trend });
    }

    return segments;
  }

  // Линейный тренд через метод наименьших квадратов
  private calculateLinearTrend(revenues: number[]): number {
    if (revenues.length < 2) return 0;

    const n = revenues.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += revenues[i];
      sumXY += i * revenues[i];
      sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (Math.abs(denominator) < 1e-10) return 0;

    const slope = (n * sumXY - sumX * sumY) / denominator;
    return Number.isFinite(slope) ? slope : 0;
  }

  // Получить тренд на конкретном шаге с учетом changepoints
  private getTrendAtStep(
    segments: Array<{ start: number; end: number; trend: number }>,
    changepoints: number[],
    step: number,
  ): number {
    if (segments.length === 0) return 0;

    // Находим сегмент, к которому относится этот шаг
    for (const segment of segments) {
      if (step >= segment.start && step < segment.end) {
        return segment.trend;
      }
    }

    // Если шаг за пределами всех сегментов, используем последний тренд
    return segments[segments.length - 1]?.trend || 0;
  }

  // Расчет эффектов праздников по типам
  private calculateHolidayEffectsByType(data: EnhancedTimeSeriesData[]): Map<string, number> {
    const effects = new Map<string, number>();
    const holidayDataByType = new Map<string, number[]>();
    const regularData: number[] = [];

    data.forEach((d) => {
      if (d.isHoliday && d.holidayType) {
        if (!holidayDataByType.has(d.holidayType)) {
          holidayDataByType.set(d.holidayType, []);
        }
        holidayDataByType.get(d.holidayType)!.push(d.revenue);
      } else {
        regularData.push(d.revenue);
      }
    });

    if (regularData.length === 0) return effects;

    const avgRegularRevenue = regularData.reduce((sum, r) => sum + r, 0) / regularData.length;

    holidayDataByType.forEach((revenues, type) => {
      if (revenues.length > 0) {
        const avgHolidayRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
        const effect = avgRegularRevenue > 0 
          ? (avgHolidayRevenue - avgRegularRevenue) / avgRegularRevenue 
          : 0;
        effects.set(type, effect);
      }
    });

    return effects;
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
    // Мультипликативная модель: result = product(multiplier^weight)
    // Используем логарифмическое пространство для стабильности
    let weightedLogSum = 0;
    let totalWeight = 0;

    entries.forEach((entry) => {
      const { value, weight } = entry;
      if (!Number.isFinite(weight) || weight <= 0) return;
      if (!Number.isFinite(value) || value === undefined || value <= 0) return;

      // В логарифмическом пространстве: log(multiplier^weight) = weight * log(multiplier)
      weightedLogSum += weight * Math.log(value);
      totalWeight += weight;
    });

    if (totalWeight <= 0) {
      return fallback;
    }

    // Преобразуем обратно: exp(sum(weight * log(multiplier))) = product(multiplier^weight)
    const combined = Math.exp(weightedLogSum / totalWeight);
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

  // Улучшенное извлечение признаков с лаговыми признаками и rolling statistics
  private extractLSTMFeaturesImproved(data: EnhancedTimeSeriesData[]): number[][] {
    const revenues = data.map((d) => d.revenue).filter((r) => r > 0);
    
    // RobustScaler для устойчивости к выбросам
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const q1 = sortedRevenues[Math.floor(sortedRevenues.length * 0.25)] || 0;
    const q3 = sortedRevenues[Math.floor(sortedRevenues.length * 0.75)] || 1;
    const median = sortedRevenues.length % 2 === 0
      ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
      : sortedRevenues[Math.floor(sortedRevenues.length / 2)];
    const iqr = Math.max(1, q3 - q1);

    // MinMaxScaler для других признаков
    const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 1;
    const minRevenue = revenues.length > 0 ? Math.min(...revenues) : 0;
    const revenueRange = maxRevenue - minRevenue || 1;

    return data.map((d, idx) => {
      // RobustScaler для выручки (устойчив к выбросам)
      const revenueNorm = (d.revenue - median) / iqr;
      
      // Лаговые признаки (lag features)
      const lag1 = idx > 0 ? (data[idx - 1].revenue - median) / iqr : 0;
      const lag7 = idx >= 7 ? (data[idx - 7].revenue - median) / iqr : 0;
      
      // Rolling statistics
      const window7 = data.slice(Math.max(0, idx - 6), idx + 1);
      const rollingMean7 = window7.length > 0
        ? window7.reduce((sum, d) => sum + d.revenue, 0) / window7.length
        : d.revenue;
      const rollingStd7 = window7.length > 1
        ? Math.sqrt(window7.reduce((sum, d) => sum + Math.pow(d.revenue - rollingMean7, 2), 0) / window7.length)
        : 0;
      const rollingMeanNorm = (rollingMean7 - median) / iqr;
      const rollingStdNorm = rollingStd7 / iqr;
      
      // MinMax нормализация для других признаков
      const checksCountNorm = d.checksCount !== undefined && d.checksCount > 0
        ? Math.min(1, d.checksCount / 1000)
        : 0;
      
      const avgCheckNorm = d.averageCheck !== undefined && revenueRange > 0
        ? Math.min(1, Math.max(0, (d.averageCheck - minRevenue) / revenueRange))
        : 0;

      return [
        revenueNorm, // RobustScaler нормализованная выручка
        lag1, // Лаг 1 день
        lag7, // Лаг 7 дней (неделя)
        rollingMeanNorm, // Скользящее среднее 7 дней
        rollingStdNorm, // Скользящее стандартное отклонение 7 дней
        d.dayOfWeek / 7, // День недели [0, 1]
        d.dayOfMonth / 31, // День месяца [0, 1]
        d.month / 12, // Месяц [0, 1]
        (d.temperature + 30) / 60, // Температура [-30, 30] -> [0, 1]
        Math.min(1, d.precipitation / 20), // Осадки
        d.humidity / 100, // Влажность
        d.isWeekend ? 1 : 0, // Выходной
        d.isHoliday ? 1 : 0, // Праздник
        (d.socialSentiment + 1) / 2, // Социальный сентимент
        (d.consumerConfidence + 1) / 2, // Доверие потребителей
        d.movingAverage7 / (maxRevenue + 1), // Скользящее среднее (из данных)
        Math.min(1, d.volatility / (median + 1)), // Волатильность (RobustScaler)
        checksCountNorm,
        avgCheckNorm,
        d.returnRate ?? 0,
        d.grossMargin ?? 0,
        d.dataQuality ?? 0.5,
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

  // Улучшенное обучение LSTM с dropout регуляризацией
  private trainLSTMImproved(features: number[][], sequenceLength: number): any {
    const featureCount = features[0]?.length ?? 22;
    const dropoutRate = 0.2; // 20% dropout для регуляризации
    
    // Инициализация весов с учетом dropout
    const weights: number[] = [];
    for (let i = 0; i < featureCount; i++) {
      // Инициализация весов с учетом dropout (уменьшаем веса на dropout rate)
      weights.push((Math.random() - 0.5) * 0.2 * (1 - dropoutRate));
    }
    
    // Простое обучение через минимизацию ошибок на последовательностях
    if (features.length >= sequenceLength) {
      // Используем последние sequenceLength примеров для обучения
      const trainingData = features.slice(-sequenceLength);
      const targets = trainingData.map((f, idx) => {
        if (idx < trainingData.length - 1) {
          // Целевое значение - следующее значение выручки
          return trainingData[idx + 1][0]; // Первый признак - выручка
        }
        return f[0];
      });
      
      // Простая градиентная оптимизация (упрощенная версия)
      for (let epoch = 0; epoch < 10; epoch++) {
        for (let i = 0; i < trainingData.length - 1; i++) {
          const input = trainingData[i];
          const target = targets[i];
          
          // Прямой проход
          let output = weights.reduce((sum, w, idx) => sum + w * (input[idx] || 0), 0.1);
          
          // Ошибка
          const error = target - output;
          
          // Обратный проход (упрощенный градиентный спуск)
          const learningRate = 0.01;
          for (let j = 0; j < weights.length; j++) {
            weights[j] += learningRate * error * (input[j] || 0);
            // Применяем dropout (уменьшаем веса)
            if (Math.random() < dropoutRate) {
              weights[j] *= (1 - dropoutRate);
            }
          }
        }
      }
    }
    
    return {
      weights,
      bias: 0.1,
      dropoutRate,
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

  // Улучшенный прогноз LSTM с учетом лаговых признаков и rolling statistics
  private predictLSTMImproved(
    features: number[][],
    weights: any,
    steps: number,
    originalData: EnhancedTimeSeriesData[],
  ): number {
    if (features.length === 0) return 0;
    
    const lastFeatures = features[features.length - 1];
    const revenues = originalData.map((d) => d.revenue);
    
    // Денормализация: восстанавливаем параметры для RobustScaler
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const q1 = sortedRevenues[Math.floor(sortedRevenues.length * 0.25)] || 0;
    const q3 = sortedRevenues[Math.floor(sortedRevenues.length * 0.75)] || 1;
    const median = sortedRevenues.length % 2 === 0
      ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
      : sortedRevenues[Math.floor(sortedRevenues.length / 2)];
    const iqr = Math.max(1, q3 - q1);
    
    // Базовый прогноз с учетом dropout (во время инференса dropout отключен)
    let predictionNorm = lastFeatures.reduce((sum, val, i) => {
      const weight = weights.weights[i] || 0;
      return sum + val * weight;
    }, weights.bias);
    
    // Учитываем лаговые признаки для более точного прогноза
    if (lastFeatures.length > 2) {
      const lag1 = lastFeatures[1] || 0; // Лаг 1 день
      const lag7 = lastFeatures[2] || 0; // Лаг 7 дней
      predictionNorm = predictionNorm * 0.7 + (lag1 * 0.2 + lag7 * 0.1);
    }
    
    // Денормализация
    let prediction = predictionNorm * iqr + median;
    
    // Учитываем тренд из rolling statistics
    if (lastFeatures.length > 4) {
      const rollingMeanNorm = lastFeatures[3] || 0;
      const rollingStdNorm = lastFeatures[4] || 0;
      const rollingMean = rollingMeanNorm * iqr + median;
      
      // Корректируем прогноз на основе rolling mean
      prediction = prediction * 0.6 + rollingMean * 0.4;
    }
    
    // Учитываем сезонность дня недели
    if (lastFeatures.length > 5) {
      const dayOfWeekRaw = Math.round(lastFeatures[5] * 7);
      const dayOfWeek = dayOfWeekRaw % 7;
      const dayVariation = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.05 : 0.98;
      prediction *= dayVariation;
    }
    
    return Math.max(0, prediction);
  }

  // Извлечение признаков для GRU (используем те же признаки, что и для LSTM)
  private extractGRUFeatures(data: EnhancedTimeSeriesData[]): number[][] {
    // GRU использует те же признаки, что и LSTM
    return this.extractLSTMFeatures(data);
  }

  // Обучение GRU модели
  private trainGRU(features: number[][], sequenceLength: number): any {
    if (features.length === 0 || !features[0]) {
      // Fallback на дефолтные веса
      return {
        resetWeights: Array(20).fill(0.12),
        resetBias: 0.05,
        updateWeights: Array(20).fill(0.1),
        updateBias: 0.1,
        candidateWeights: Array(20).fill(0.08),
        candidateBias: 0.05,
        outputWeights: Array(20).fill(0.1),
        outputBias: 0.1,
      };
    }

    const featureCount = features[0].length;
    
    // Простое обучение: вычисляем средние значения признаков и используем их для инициализации весов
    const avgFeatures = Array(featureCount).fill(0);
    for (const featureRow of features) {
      for (let i = 0; i < featureCount; i++) {
        if (Number.isFinite(featureRow[i])) {
          avgFeatures[i] += featureRow[i];
        }
      }
    }
    
    // Нормализуем средние значения
    const featureSum = avgFeatures.reduce((sum, val) => sum + Math.abs(val), 0);
    const normalizedFeatures = featureSum > 0 
      ? avgFeatures.map(val => val / featureSum / featureCount)
      : avgFeatures.map(() => 0.1 / featureCount);

    return {
      // Веса для reset gate - используем нормализованные признаки
      resetWeights: normalizedFeatures.map(val => 0.12 + val * 0.1),
      resetBias: 0.05,
      // Веса для update gate
      updateWeights: normalizedFeatures.map(val => 0.1 + val * 0.08),
      updateBias: 0.1,
      // Веса для candidate activation
      candidateWeights: normalizedFeatures.map(val => 0.08 + val * 0.06),
      candidateBias: 0.05,
      // Финальные веса для выхода
      outputWeights: normalizedFeatures.map(val => 0.1 + val * 0.08),
      outputBias: 0.1,
    };
  }

  // Предсказание на основе обученной GRU модели
  private predictGRU(features: number[][], weights: any, steps: number, avgRevenue: number, revenueStd: number): number {
    if (features.length === 0) return avgRevenue;
    
    const lastFeatures = features[features.length - 1];
    
    // GRU вычисление: более простая архитектура, чем LSTM
    // 1. Reset gate: определяет, какая часть предыдущего состояния забывается
    const resetGate = Math.tanh(
      lastFeatures.reduce((sum, val, i) => sum + val * (weights.resetWeights[i] || 0.12), weights.resetBias || 0.05)
    );
    
    // 2. Update gate: определяет баланс между старым и новым состоянием
    const updateGate = Math.tanh(
      lastFeatures.reduce((sum, val, i) => sum + val * (weights.updateWeights[i] || 0.1), weights.updateBias || 0.1)
    );
    
    // 3. Candidate activation: новое состояние с учетом reset gate
    const candidateActivation = Math.tanh(
      lastFeatures.reduce((sum, val, i) => 
        sum + val * (weights.candidateWeights[i] || 0.08) * resetGate, weights.candidateBias || 0.05
      )
    );
    
    // 4. Денормализуем нормализованную выручку (первый признак) для использования в hidden state
    // revenueNorm = (revenue - avgRevenue) / (revenueStd + 1)
    // revenue = revenueNorm * (revenueStd + 1) + avgRevenue
    const denormalizedRevenue = lastFeatures[0] * (revenueStd + 1) + avgRevenue;
    const hiddenState = (1 - updateGate) * candidateActivation * avgRevenue + updateGate * denormalizedRevenue;
    
    // 5. Выходной слой - денормализуем результат
    const normalizedOutput = lastFeatures.reduce((sum, val, i) => 
      sum + val * (weights.outputWeights[i] || 0.1), weights.outputBias || 0.1
    );
    
    // Денормализуем: если normalizedOutput близок к 0, используем среднюю выручку
    // Если normalizedOutput положительный, добавляем к средней выручке
    let prediction = avgRevenue + normalizedOutput * revenueStd * 2;
    
    // Применяем hidden state к прогнозу
    prediction = prediction * 0.6 + hiddenState * 0.4;
    
    // Учитываем тренд из последних значений для разных шагов
    if (features.length >= 3) {
      // Денормализуем последние значения выручки
      const recentRevenues = features.slice(-3).map(f => {
        const denorm = f[0] * (revenueStd + 1) + avgRevenue;
        return Math.max(0, denorm);
      });
      
      if (recentRevenues.length > 1 && recentRevenues[0] > 0) {
        const trend = (recentRevenues[recentRevenues.length - 1] - recentRevenues[0]) / recentRevenues.length;
        
        // Применяем тренд с затуханием для дальних прогнозов (GRU более чувствителен к тренду)
        const trendComponent = trend * steps * Math.exp(-steps * 0.12);
        prediction += trendComponent;
      }
    }
    
    // Учитываем сезонность дня недели
    if (lastFeatures.length > 1) {
      const dayOfWeekRaw = Math.round(lastFeatures[1] * 7); // Восстанавливаем день недели (0-6)
      const dayOfWeek = dayOfWeekRaw % 7;
      // GRU лучше улавливает сезонные паттерны
      const dayVariation = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.08 : 0.95;
      prediction *= dayVariation;
    }
    
    // Обеспечиваем разумные границы прогноза
    const minPrediction = avgRevenue * 0.3;
    const maxPrediction = avgRevenue * 2.5;
    prediction = Math.max(minPrediction, Math.min(maxPrediction, prediction));
    
    return Math.max(0, prediction);
  }

  // Проверка необходимости анализа интеграции GRU
  private shouldAnalyzeGRUIntegration(): boolean {
    // Анализируем раз в день или при первом запуске
    if (!this.lastGRUAnalysisDate) {
      return true;
    }
    const hoursSinceLastAnalysis = (Date.now() - this.lastGRUAnalysisDate.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastAnalysis >= 24; // Раз в 24 часа
  }

  // Анализ интеграции GRU в ансамбль
  private async analyzeGRUIntegration(
    timeSeriesData: EnhancedTimeSeriesData[],
    allPredictions: number[][],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): void {
    const gruIndex = this.modelEnsemble.models.findIndex((m) => m.name === 'GRU');
    const lstmIndex = this.modelEnsemble.models.findIndex((m) => m.name === 'LSTM');
    
    if (gruIndex === -1 || lstmIndex === -1) {
      console.warn('⚠️  GRU или LSTM модель не найдена в ансамбле');
      return;
    }

    const gruPredictions = allPredictions[gruIndex];
    const lstmPredictions = allPredictions[lstmIndex];
    
    // Улучшенная проверка валидности данных
    if (!gruPredictions || !lstmPredictions || gruPredictions.length === 0) {
      console.warn('⚠️  GRU или LSTM прогнозы пусты или отсутствуют');
      console.warn(`   GRU прогнозы: ${gruPredictions ? gruPredictions.length : 'null'}`);
      console.warn(`   LSTM прогнозы: ${lstmPredictions ? lstmPredictions.length : 'null'}`);
      return;
    }

    // Проверка на валидные числовые значения
    const validGRUPredictions = gruPredictions.filter(p => Number.isFinite(p) && p >= 0);
    const validLSTMPredictions = lstmPredictions.filter(p => Number.isFinite(p) && p >= 0);
    
    if (validGRUPredictions.length === 0) {
      console.warn('⚠️  GRU прогнозы не содержат валидных значений');
      console.warn(`   Примеры прогнозов: ${gruPredictions.slice(0, 5).join(', ')}`);
      return;
    }

    // Проверка на одинаковые значения (может указывать на проблему)
    const uniqueGRUValues = new Set(validGRUPredictions.map(p => Math.round(p * 100) / 100));
    const uniqueLSTMValues = new Set(validLSTMPredictions.map(p => Math.round(p * 100) / 100));
    
    if (uniqueGRUValues.size === 1) {
      console.warn(`⚠️  GRU возвращает одинаковые прогнозы: ${Array.from(uniqueGRUValues)[0]}`);
      console.warn(`   Это может указывать на проблему в обучении модели`);
    }

    // 1. Сравнение точности GRU vs LSTM
    const historicalAccuracy = await this.calculateHistoricalModelAccuracy();
    
    if (historicalAccuracy.length === 0) {
      console.warn('⚠️  Историческая точность не рассчитана (недостаточно данных)');
      console.warn(`   Требуется минимум 14 дней данных, доступно: ${timeSeriesData.length}`);
      return;
    }
    
    if (gruIndex >= historicalAccuracy.length || lstmIndex >= historicalAccuracy.length) {
      console.warn(`⚠️  Индексы моделей выходят за границы массива точности`);
      console.warn(`   GRU индекс: ${gruIndex}, LSTM индекс: ${lstmIndex}, длина массива: ${historicalAccuracy.length}`);
      return;
    }
    
    const gruAccuracy = historicalAccuracy[gruIndex] ?? 0.01; // Минимальная точность вместо 0.5
    const lstmAccuracy = historicalAccuracy[lstmIndex] ?? 0.01;
    
    // 2. Корреляция прогнозов GRU с другими моделями (с улучшенной обработкой)
    const correlations: Record<string, number> = {};
    for (let i = 0; i < allPredictions.length; i++) {
      if (i !== gruIndex) {
        const otherPredictions = allPredictions[i];
        if (otherPredictions && otherPredictions.length === gruPredictions.length) {
          const correlation = this.calculateCorrelation(gruPredictions, otherPredictions);
          const modelName = this.modelEnsemble.models[i].name;
          correlations[modelName] = correlation;
        }
      }
    }

    // 3. Вклад GRU в финальный прогноз (с улучшенной обработкой)
    const ensembleWeights = this.modelEnsemble.models.map((m) => m.weight);
    const gruWeight = ensembleWeights[gruIndex] ?? 0;
    
    if (gruWeight === 0) {
      console.warn('⚠️  Вес GRU модели равен 0, модель не участвует в ансамбле');
    }
    
    const avgGRUContribution = validGRUPredictions.reduce((sum, pred) => sum + pred, 0) / validGRUPredictions.length;
    const avgEnsemblePrediction = allPredictions.reduce((sum, preds) => {
      if (!preds || preds.length === 0) return sum;
      const validPreds = preds.filter(p => Number.isFinite(p) && p >= 0);
      if (validPreds.length === 0) return sum;
      const avg = validPreds.reduce((s, p) => s + p, 0) / validPreds.length;
      return sum + avg;
    }, 0) / allPredictions.filter(p => p && p.length > 0).length;
    
    const gruContributionPercent = avgEnsemblePrediction > 0 
      ? (avgGRUContribution * gruWeight) / avgEnsemblePrediction * 100 
      : 0;

    // 4. Стабильность прогнозов GRU
    const gruVariance = this.calculateVariance(validGRUPredictions);
    const gruMean = avgGRUContribution;
    const gruStability = gruMean > 0 ? Math.max(0, Math.min(1, 1 - gruVariance / gruMean)) : 0;

    // 5. Производительность (время выполнения) - с более точным измерением
    const startTime = process.hrtime.bigint();
    this.gruPredict(timeSeriesData, futureData);
    const endTime = process.hrtime.bigint();
    const gruExecutionTime = Number(endTime - startTime) / 1_000_000; // Конвертируем в миллисекунды

    // Вывод результатов анализа с дополнительной диагностикой
    console.log('\n=== Анализ интеграции GRU в ансамбль ===');
    console.log(`Точность GRU: ${(gruAccuracy * 100).toFixed(1)}%`);
    console.log(`Точность LSTM: ${(lstmAccuracy * 100).toFixed(1)}%`);
    console.log(`Разница: ${((gruAccuracy - lstmAccuracy) * 100).toFixed(1)}%`);
    
    // Диагностическая информация
    console.log(`\nДиагностика GRU:`);
    console.log(`  Количество прогнозов: ${gruPredictions.length}`);
    console.log(`  Валидных прогнозов: ${validGRUPredictions.length}`);
    console.log(`  Уникальных значений: ${uniqueGRUValues.size}`);
    console.log(`  Средний прогноз: ${avgGRUContribution.toFixed(2)}`);
    console.log(`  Мин/Макс: ${Math.min(...validGRUPredictions).toFixed(2)} / ${Math.max(...validGRUPredictions).toFixed(2)}`);
    console.log(`  Стандартное отклонение: ${Math.sqrt(gruVariance).toFixed(2)}`);
    
    console.log(`\nКорреляция GRU с другими моделями:`);
    Object.entries(correlations).forEach(([model, corr]) => {
      const corrStatus = Math.abs(corr) < 0.01 ? '⚠️  (очень низкая)' : 
                        Math.abs(corr) < 0.3 ? '⚠️  (низкая)' : 
                        Math.abs(corr) > 0.9 ? '⚠️  (очень высокая - возможно дублирование)' : '✅';
      console.log(`  ${model}: ${corr.toFixed(3)} ${corrStatus}`);
    });
    
    console.log(`\nВклад GRU в ансамбль: ${gruContributionPercent.toFixed(1)}%`);
    console.log(`  Вес модели: ${(gruWeight * 100).toFixed(1)}%`);
    console.log(`  Средний вклад: ${(avgGRUContribution * gruWeight).toFixed(2)}`);
    
    console.log(`Стабильность прогнозов GRU: ${(gruStability * 100).toFixed(1)}%`);
    console.log(`Время выполнения GRU: ${gruExecutionTime.toFixed(2)}ms`);
    
    console.log(`\nОценка интеграции: ${this.evaluateGRUIntegrationQuality(
      gruAccuracy,
      lstmAccuracy,
      correlations,
      gruStability,
    )}`);
    console.log('========================================\n');

    this.lastGRUAnalysisDate = new Date();
  }

  // Расчет корреляции между двумя массивами прогнозов
  private calculateCorrelation(predictions1: number[], predictions2: number[]): number {
    if (predictions1.length !== predictions2.length || predictions1.length === 0) {
      return 0;
    }

    // Фильтруем только валидные значения
    const validPairs: [number, number][] = [];
    for (let i = 0; i < predictions1.length; i++) {
      const p1 = predictions1[i];
      const p2 = predictions2[i];
      if (Number.isFinite(p1) && Number.isFinite(p2) && p1 >= 0 && p2 >= 0) {
        validPairs.push([p1, p2]);
      }
    }

    if (validPairs.length === 0) {
      return 0;
    }

    const mean1 = validPairs.reduce((sum, [p1]) => sum + p1, 0) / validPairs.length;
    const mean2 = validPairs.reduce((sum, [, p2]) => sum + p2, 0) / validPairs.length;

    // Проверка на одинаковые значения (если все значения одинаковые, корреляция не определена)
    const allSame1 = validPairs.every(([p1]) => Math.abs(p1 - mean1) < 1e-10);
    const allSame2 = validPairs.every(([, p2]) => Math.abs(p2 - mean2) < 1e-10);
    
    if (allSame1 || allSame2) {
      // Если все значения одинаковые, корреляция технически не определена
      // Возвращаем 1, если оба массива имеют одинаковые значения, иначе 0
      return (allSame1 && allSame2 && Math.abs(mean1 - mean2) < 1e-10) ? 1 : 0;
    }

    let numerator = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;

    for (const [p1, p2] of validPairs) {
      const diff1 = p1 - mean1;
      const diff2 = p2 - mean2;
      numerator += diff1 * diff2;
      sumSq1 += diff1 * diff1;
      sumSq2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSq1 * sumSq2);
    if (denominator < 1e-10) {
      return 0; // Избегаем деления на ноль
    }
    
    const correlation = numerator / denominator;
    
    // Ограничиваем корреляцию диапазоном [-1, 1] из-за возможных ошибок округления
    return Math.max(-1, Math.min(1, correlation));
  }

  // Оценка качества интеграции GRU
  private evaluateGRUIntegrationQuality(
    gruAccuracy: number,
    lstmAccuracy: number,
    correlations: Record<string, number>,
    stability: number,
  ): string {
    let score = 0;
    let comments: string[] = [];

    // Оценка точности (40% веса)
    if (gruAccuracy >= lstmAccuracy) {
      score += 0.4;
      comments.push('GRU показывает сопоставимую или лучшую точность, чем LSTM');
    } else if (gruAccuracy >= lstmAccuracy * 0.9) {
      score += 0.3;
      comments.push('GRU показывает хорошую точность, близкую к LSTM');
    } else {
      score += 0.2;
      comments.push('GRU показывает приемлемую точность');
    }

    // Оценка разнообразия (30% веса) - низкая корреляция с другими моделями = хорошо
    const avgCorrelation = Object.values(correlations).reduce((sum, corr) => sum + Math.abs(corr), 0) / Object.values(correlations).length;
    if (avgCorrelation < 0.7) {
      score += 0.3;
      comments.push('GRU добавляет разнообразие в ансамбль (низкая корреляция)');
    } else if (avgCorrelation < 0.85) {
      score += 0.2;
      comments.push('GRU имеет умеренную корреляцию с другими моделями');
    } else {
      score += 0.1;
      comments.push('GRU имеет высокую корреляцию с другими моделями');
    }

    // Оценка стабильности (30% веса)
    if (stability >= 0.8) {
      score += 0.3;
      comments.push('GRU показывает высокую стабильность прогнозов');
    } else if (stability >= 0.6) {
      score += 0.2;
      comments.push('GRU показывает приемлемую стабильность');
    } else {
      score += 0.1;
      comments.push('GRU показывает низкую стабильность');
    }

    const finalScore = Math.min(1, score);
    const quality = finalScore >= 0.8 ? 'Отличная' : finalScore >= 0.6 ? 'Хорошая' : finalScore >= 0.4 ? 'Удовлетворительная' : 'Требует улучшения';
    
    return `${quality} (${(finalScore * 100).toFixed(0)}/100). ${comments.join('; ')}.`;
  }

  // Вспомогательная функция для кодирования типа праздника в числовое значение
  private encodeHolidayType(holidayType?: string): number {
    const holidayTypeMap: Record<string, number> = {
      'national': 0.4,    // Национальные праздники - наибольшее влияние
      'religious': 0.35,  // Религиозные праздники
      'regional': 0.3,    // Региональные праздники
      'unofficial': 0.15, // Неофициальные праздники
    };
    return holidayType ? (holidayTypeMap[holidayType] || 0) : 0;
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
      d.holidayImpact ?? 0, // Количественное влияние праздника (0.15-0.5)
      this.encodeHolidayType(d.holidayType), // Тип праздника как числовое значение
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
      future.holidayImpact ?? 0, // Количественное влияние праздника (0.15-0.5)
      this.encodeHolidayType(future.holidayType), // Тип праздника как числовое значение
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
  private async gradientBoostingPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 10) return futureData.map(() => data[data.length - 1]?.revenue || 0);

    // Проверяем кеш перед обучением
    const dataHash = this.computeDataHash(data);
    const cachedModel = await this.getCachedModel('GradientBoosting', dataHash);
    
    let model: any;
    
    if (cachedModel && cachedModel.parameters.model) {
      // Используем сохраненные параметры из кеша
      const cacheAge = Math.round((new Date().getTime() - cachedModel.trainedAt.getTime()) / 1000 / 60);
      console.log(`[GradientBoosting] ✅ Используем кешированную модель (возраст: ${cacheAge} мин, данные: ${cachedModel.dataLength} точек)`);
      
      model = cachedModel.parameters.model;
    } else {
      const features = this.extractFeatures(data);
      const targets = data.map((d) => d.revenue);

      // Обучаем Gradient Boosting
      model = this.trainGradientBoosting(features, targets);
      
      // Сохраняем параметры в кеш
      const modelParams: ModelParameters = {
        dataHash,
        trainedAt: new Date(),
        parameters: {
          model,
        },
        dataLength: data.length,
        lastDataDate: data[data.length - 1]?.date,
      };
      
      await this.saveModelToCache('GradientBoosting', modelParams);
    }

    const predictions: number[] = [];
    for (let i = 0; i < futureData.length; i++) {
      const futureFeatures = this.extractFutureFeatures(futureData[i], data);
      const prediction = this.predictGradientBoosting(model, futureFeatures);
      predictions.push(Math.max(0, prediction));
    }

    return predictions;
  }

  // Флаг для отслеживания доступности N-HITS
  private static nhitsAvailable: boolean | null = null;
  private static nhitsCheckTime: number = 0;
  private static readonly NHITS_CHECK_INTERVAL = 3600000; // Проверяем раз в час

  /**
   * Проверка доступности N-HITS (Python и библиотеки)
   */
  private async checkNHITSAvailability(): Promise<boolean> {
    const now = Date.now();
    
    // Используем кешированный результат, если проверка была недавно
    if (EnhancedMLForecastingEngine.nhitsAvailable !== null && 
        (now - EnhancedMLForecastingEngine.nhitsCheckTime) < EnhancedMLForecastingEngine.NHITS_CHECK_INTERVAL) {
      return EnhancedMLForecastingEngine.nhitsAvailable;
    }

    try {
      const scriptPath = join(process.cwd(), 'scripts', 'nhits_forecast.py');
      const testProcess = spawn('python3', ['-c', 'import neuralforecast; import pandas; import numpy'], {
        stdio: 'pipe',
      });

      const result = await new Promise<boolean>((resolve) => {
        testProcess.on('close', (code) => {
          resolve(code === 0);
        });
        testProcess.on('error', () => {
          resolve(false);
        });
        setTimeout(() => {
          testProcess.kill();
          resolve(false);
        }, 5000);
      });

      EnhancedMLForecastingEngine.nhitsAvailable = result;
      EnhancedMLForecastingEngine.nhitsCheckTime = now;
      return result;
    } catch {
      EnhancedMLForecastingEngine.nhitsAvailable = false;
      EnhancedMLForecastingEngine.nhitsCheckTime = now;
      return false;
    }
  }

  /**
   * Прогнозирование с помощью N-HITS через Python скрипт
   * N-HITS (Neural Hierarchical Interpolation for Time Series) - продвинутая нейросетевая модель
   * для прогнозирования временных рядов с иерархической декомпозицией
   */
  private async nhitsPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    if (data.length < 14) {
      // Недостаточно данных для N-HITS, используем fallback
      const avg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      return futureData.map(() => avg);
    }

    // Проверяем доступность N-HITS перед запуском
    const isAvailable = await this.checkNHITSAvailability();
    if (!isAvailable) {
      // Если N-HITS недоступен, используем fallback без логирования ошибок
      const avg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      return futureData.map(() => avg);
    }

    try {
      // Подготовка данных для Python скрипта
      const historicalData = data.map((d) => ({
        date: d.date,
        revenue: d.revenue,
      }));

      const inputData = {
        historical_data: historicalData,
        horizon: futureData.length,
      };

      // Путь к Python скрипту
      const scriptPath = join(process.cwd(), 'scripts', 'nhits_forecast.py');
      
      // Выполняем Python скрипт
      const pythonProcess = spawn('python3', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Отправляем данные в stdin
      pythonProcess.stdin.write(JSON.stringify(inputData));
      pythonProcess.stdin.end();

      // Собираем результат
      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      pythonProcess.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      // Ждем завершения процесса с уменьшенным таймаутом
      const result = await new Promise<{ success: boolean; predictions: number[]; error?: string }>(
        (resolve) => {
          pythonProcess.on('close', (code) => {
            if (code !== 0) {
              // Логируем только первую ошибку, затем отключаем N-HITS
              if (EnhancedMLForecastingEngine.nhitsAvailable !== false) {
                console.warn(`[N-HITS] Python скрипт завершился с кодом ${code}. Отключаем N-HITS.`);
                if (stderr) {
                  console.warn(`[N-HITS] stderr: ${stderr.substring(0, 200)}`);
                }
                EnhancedMLForecastingEngine.nhitsAvailable = false;
              }
              resolve({ success: false, predictions: [], error: stderr });
            } else {
              try {
                const parsed = JSON.parse(stdout);
                resolve(parsed);
              } catch (error) {
                console.error('[N-HITS] Ошибка парсинга результата:', error);
                resolve({ success: false, predictions: [], error: 'Parse error' });
              }
            }
          });

          pythonProcess.on('error', (error) => {
            if (EnhancedMLForecastingEngine.nhitsAvailable !== false) {
              console.warn(`[N-HITS] Ошибка запуска Python процесса. Отключаем N-HITS: ${error.message}`);
              EnhancedMLForecastingEngine.nhitsAvailable = false;
            }
            resolve({ success: false, predictions: [], error: error.message });
          });

          // Уменьшенный таймаут до 30 секунд
          setTimeout(() => {
            pythonProcess.kill();
            if (EnhancedMLForecastingEngine.nhitsAvailable !== false) {
              console.warn('[N-HITS] Таймаут выполнения. Отключаем N-HITS.');
              EnhancedMLForecastingEngine.nhitsAvailable = false;
            }
            resolve({ success: false, predictions: [], error: 'Timeout' });
          }, 30000);
        },
      );

      if (result.success && result.predictions.length > 0) {
        // Применяем ограничения к прогнозам
        const historicalRevenues = data.map((d) => d.revenue);
        const avg = historicalRevenues.reduce((a, b) => a + b, 0) / historicalRevenues.length;
        const { clampLimit, clampMin } = calculateHistoricalClamp(historicalRevenues, avg);

        return result.predictions.map((pred) => {
          const clamped = Math.max(clampMin, Math.min(clampLimit, pred));
          return Math.max(0, clamped);
        });
      } else {
        // Fallback на среднее значение без логирования
        const avg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
        return futureData.map(() => avg);
      }
    } catch (error) {
      // Fallback без логирования ошибок
      const avg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
      return futureData.map(() => avg);
    }
  }

  // LLM модель (асинхронная)
  private async llmPredict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    this.ensureLLMEngine();
    if (!this.llmEngine || !this.llmEngine.isAvailable() || data.length < 7) {
      // Fallback на простое среднее
      const avgRevenue = data.length > 0
        ? data.reduce((sum, d) => sum + d.revenue, 0) / data.length
        : 0;
      return futureData.map(() => Math.round(avgRevenue));
    }

    try {
      const predictions = await this.llmEngine.predict(data, futureData);
      return predictions;
    } catch (error) {
      console.error('[EnhancedMLForecast] LLM prediction error:', error);
      // Fallback на простое среднее
      const avgRevenue = data.length > 0
        ? data.reduce((sum, d) => sum + d.revenue, 0) / data.length
        : 0;
      return futureData.map(() => Math.round(avgRevenue));
    }
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

  // Улучшенный расчет сезонности дня недели с учетом исторических паттернов
  private calculateSeasonalFactor(
    dayOfWeek: number,
    month: number,
    data: EnhancedTimeSeriesData[],
  ): number {
    if (data.length === 0) return 1;

    const overallAvg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;
    if (overallAvg === 0) return 1;

    // 1. Базовый фактор дня недели (с учетом всех исторических данных)
    const dayOfWeekData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    let dowFactor = 1;
    if (dayOfWeekData.length > 0) {
      const avgDayRevenue =
        dayOfWeekData.reduce((sum, d) => sum + d.revenue, 0) / dayOfWeekData.length;
      dowFactor = avgDayRevenue / overallAvg;
    }

    // 2. Фактор месяца (сезонность)
    const monthData = data.filter((d) => d.month === month);
    let monthFactor = 1;
    if (monthData.length > 0) {
      const avgMonthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0) / monthData.length;
      monthFactor = avgMonthRevenue / overallAvg;
    }

    // 3. Взаимодействие дня недели и месяца (более точный паттерн)
    // Например, понедельники в ноябре могут отличаться от понедельников в других месяцах
    const dayMonthData = data.filter(
      (d) => d.dayOfWeek === dayOfWeek && d.month === month,
    );
    let interactionFactor = 1;
    if (dayMonthData.length >= 2) {
      // Минимум 2 точки для надежной оценки
      const avgDayMonthRevenue =
        dayMonthData.reduce((sum, d) => sum + d.revenue, 0) / dayMonthData.length;
      const expectedRevenue = overallAvg * dowFactor * monthFactor;
      interactionFactor = expectedRevenue > 0 ? avgDayMonthRevenue / expectedRevenue : 1;
    }

    // 4. Учет недавнего тренда для конкретного дня недели
    // Используем последние 30 дней (или меньше, если данных недостаточно)
    const recentWindow = Math.min(30, data.length);
    const recentDayData = data
      .slice(-recentWindow)
      .filter((d) => d.dayOfWeek === dayOfWeek);
    
    let trendFactor = 1;
    if (recentDayData.length >= 4) {
      // Разделяем на первую и вторую половину для оценки тренда
      const mid = Math.floor(recentDayData.length / 2);
      const firstHalf = recentDayData.slice(0, mid);
      const secondHalf = recentDayData.slice(mid);
      
      const firstHalfAvg = firstHalf.reduce((sum, d) => sum + d.revenue, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, d) => sum + d.revenue, 0) / secondHalf.length;
      
      if (firstHalfAvg > 0) {
        // Тренд показывает, как изменился этот день недели в последнее время
        const trendChange = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;
        // Применяем умеренный тренд (50% от полного изменения)
        trendFactor = 1 + trendChange * 0.5;
      }
    }

    // 4. Квартальная сезонность (Q1-Q4)
    const quarter = Math.floor(month / 3) + 1;
    const quarterData = data.filter((d) => d.quarter === quarter);
    let quarterFactor = 1;
    if (quarterData.length > 0) {
      const avgQuarterRevenue = quarterData.reduce((sum, d) => sum + d.revenue, 0) / quarterData.length;
      quarterFactor = overallAvg > 0 ? avgQuarterRevenue / overallAvg : 1;
    }

    // 5. Комбинируем все факторы с улучшенными весами
    // Базовый фактор дня недели: 35%
    // Фактор месяца: 25%
    // Взаимодействие дня недели и месяца: 30% (увеличено с 20%)
    // Квартальная сезонность: 5%
    // Тренд: 5%
    const combinedFactor =
      dowFactor * 0.35 + 
      monthFactor * 0.25 + 
      (dowFactor * monthFactor * interactionFactor) * 0.30 + 
      quarterFactor * 0.05 +
      (dowFactor * trendFactor) * 0.05;

    return Math.max(0.5, Math.min(2.0, combinedFactor)); // Ограничиваем диапазон
  }

  private calculateTrendFactor(data: EnhancedTimeSeriesData[]): number {
    // Увеличено минимальное окно с 14 до 21 дня для более точного расчета
    if (data.length < 21) {
      // Если данных меньше 21 дня, используем доступные данные, но с меньшей точностью
      if (data.length < 7) return 0;
    }

    // Увеличено окно расчета тренда с 14 до 30 дней (или доступное количество)
    const windowSize = Math.min(30, data.length);
    const recent = data.slice(-windowSize);
    
    // Экспоненциальное взвешивание: более свежие данные важнее
    const weights: number[] = [];
    const alpha = 0.1; // Коэффициент затухания (чем больше, тем больше вес свежих данных)
    for (let i = 0; i < recent.length; i++) {
      // Более свежие данные (ближе к концу массива) получают больший вес
      const weight = Math.exp(alpha * (i - recent.length + 1));
      weights.push(weight);
    }
    
    // Нормализуем веса
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const normalizedWeights = weights.map(w => w / totalWeight);
    
    // Взвешенное среднее выручки
    const weightedAvgRevenue = recent.reduce((sum, d, i) => sum + d.revenue * normalizedWeights[i], 0);
    
    // Взвешенная линейная регрессия для расчета тренда
    const n = recent.length;
    const x = Array.from({ length: n }, (_, i) => i);
    
    // Взвешенные суммы для регрессии
    let sumWX = 0, sumWY = 0, sumWXY = 0, sumWX2 = 0;
    for (let i = 0; i < n; i++) {
      const w = normalizedWeights[i];
      sumWX += w * x[i];
      sumWY += w * recent[i].revenue;
      sumWXY += w * x[i] * recent[i].revenue;
      sumWX2 += w * x[i] * x[i];
    }
    
    const denominator = sumWX2 - sumWX * sumWX;
    if (Math.abs(denominator) < 1e-10) return 0;
    
    // Абсолютный тренд (изменение выручки в день) с учетом весов
    const absoluteTrend = (sumWXY - sumWX * sumWY) / denominator;
    
    // Возвращаем относительное изменение тренда (коэффициент)
    return weightedAvgRevenue > 0 ? absoluteTrend / weightedAvgRevenue : 0;
  }

  // Улучшенный расчет погодного фактора для Липецка, Россия
  // Увеличенное влияние погоды с учетом сезонности и комбинаций факторов
  private calculateWeatherFactor(future: Partial<EnhancedTimeSeriesData>): number {
    if (!future.temperature) return 0;

    let factor = 0;
    const month = future.month !== undefined ? future.month : new Date().getMonth();
    const isWinter = month >= 11 || month <= 2; // Декабрь, Январь, Февраль
    const isSummer = month >= 5 && month <= 7; // Июнь, Июль, Август
    const isSpring = month >= 3 && month <= 4; // Март, Апрель
    const isAutumn = month >= 8 && month <= 10; // Сентябрь, Октябрь, Ноябрь

    // Сезонная корректировка базового влияния температуры
    // Зимний холод влияет сильнее на потребность в горячих напитках
    const seasonalMultiplier = isWinter ? 1.3 : isSummer ? 0.9 : 1.0;

    // Улучшенный температурный эффект с увеличенными весами
    // Зима: холодно, но кофе популярен (увеличенное влияние)
    if (future.temperature < -10) {
      // Очень холодно - больше хотят горячий кофе, но меньше выходят
      // Зимой эффект сильнее
      factor += (isWinter ? 0.08 : 0.05) * seasonalMultiplier;
    } else if (future.temperature < 0) {
      // Холодно - кофе популярен (увеличено с 0.08 до 0.15)
      factor += 0.15 * seasonalMultiplier;
    } else if (future.temperature >= 0 && future.temperature < 10) {
      // Прохладно - идеально для кофе (увеличено с 0.12 до 0.20)
      factor += 0.20 * seasonalMultiplier;
    } else if (future.temperature >= 10 && future.temperature < 20) {
      // Комфортно - отличная погода для кофе (увеличено с 0.15 до 0.25)
      factor += 0.25 * seasonalMultiplier;
    } else if (future.temperature >= 20 && future.temperature <= 25) {
      // Тепло - кофе все еще популярен (увеличено с 0.10 до 0.15)
      factor += 0.15;
    } else if (future.temperature > 25 && future.temperature <= 30) {
      // Жарко - холодные напитки популярнее, но кофе тоже
      // Летом эффект может быть положительным за счет холодных напитков
      factor += isSummer ? 0.08 : 0.05;
    } else if (future.temperature > 30) {
      // Очень жарко - больше холодных напитков
      // Летом может быть небольшой плюс за холодные напитки
      factor += isSummer ? 0.02 : -0.08;
    }

    // Улучшенный эффект осадков с учетом комбинаций факторов
    if (future.precipitation) {
      if (future.precipitation > 10) {
        // Сильный дождь/снег - меньше посетителей
        // Но если холодно, люди могут искать укрытие
        const coldMultiplier = future.temperature < 5 ? 0.8 : 1.0;
        factor -= 0.18 * coldMultiplier;
      } else if (future.precipitation > 5) {
        // Умеренные осадки
        const moderateMultiplier = future.temperature < 10 ? 0.7 : 1.0;
        factor -= 0.10 * moderateMultiplier;
      } else if (future.precipitation > 2) {
        // Легкие осадки - некоторые ищут укрытие в кофейне
        // Особенно в холодную погоду
        const lightMultiplier = future.temperature < 10 ? 1.5 : 1.0;
        factor += 0.05 * lightMultiplier;
      }
    }

    // Улучшенный учет влажности (комфорт в помещении)
    if (future.humidity !== undefined) {
      if (future.humidity < 30 || future.humidity > 70) {
        // Некомфортная влажность - больше времени в помещении
        // В сочетании с экстремальной температурой эффект усиливается
        const extremeTemp = future.temperature < -5 || future.temperature > 30;
        factor += extremeTemp ? 0.04 : 0.02;
      }
    }

    // Улучшенный учет ветра с учетом температуры
    if (future.windSpeed !== undefined) {
      if (future.windSpeed > 15) {
        // Сильный ветер - особенно неприятен в холодную погоду
        const coldWindMultiplier = future.temperature < 5 ? 1.3 : 1.0;
        factor -= 0.12 * coldWindMultiplier;
      } else if (future.windSpeed > 10) {
        const moderateWindMultiplier = future.temperature < 5 ? 1.2 : 1.0;
        factor -= 0.06 * moderateWindMultiplier;
      }
    }

    // Видимость (туман снижает трафик)
    if (future.visibility !== undefined && future.visibility < 5) {
      // Туман особенно влияет в холодную погоду
      const fogMultiplier = future.temperature < 5 ? 1.2 : 1.0;
      factor -= 0.10 * fogMultiplier;
    }

    // Комбинация факторов: холод + осадки + ветер = сильное негативное влияние
    const badWeatherCombo = 
      future.temperature < 5 && 
      (future.precipitation || 0) > 2 && 
      (future.windSpeed || 0) > 10;
    if (badWeatherCombo) {
      factor -= 0.05; // Дополнительный штраф за плохую погоду
    }

    // Комбинация факторов: комфортная температура + легкие осадки = люди ищут укрытие
    const goodWeatherCombo = 
      future.temperature >= 10 && 
      future.temperature <= 20 && 
      (future.precipitation || 0) > 1 && 
      (future.precipitation || 0) <= 5;
    if (goodWeatherCombo) {
      factor += 0.03; // Дополнительный бонус
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

  private async calculateEnhancedConfidence(
    data: EnhancedTimeSeriesData[],
    modelPredictions: number[][],
    step: number,
  ): Promise<number> {
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

    // Получаем историческую точность моделей из БД (если доступна)
    let historicalAccuracy = 0.5; // Fallback значение
    if (this.storage) {
      try {
        const { getModelMetrics } = await import('./forecastFeedback');
        const ensembleMetrics = await getModelMetrics('Ensemble', this.storage);
        const overallMetric = ensembleMetrics.find((m) => m.dayOfWeek === null && m.horizon === null);
        
        if (overallMetric && overallMetric.sampleSize > 0) {
          const mape = overallMetric.mape / 100; // MAPE в процентах
          historicalAccuracy = Math.max(0, Math.min(1, 1 - mape));
          // Учитываем размер выборки для надежности метрики
          const sampleSizeWeight = Math.min(1, Math.log10(overallMetric.sampleSize + 1) / Math.log10(50));
          historicalAccuracy = historicalAccuracy * sampleSizeWeight + 0.5 * (1 - sampleSizeWeight);
        }
      } catch (error) {
        // Игнорируем ошибки получения метрик
      }
    }

    // ВАЖНО: Уверенность снижается с расстоянием прогноза (horizon decay)
    // Чем дальше прогноз, тем меньше уверенность
    const horizonDecay = Math.exp(-step * 0.08); // Экспоненциальное затухание
    
    // Комбинируем факторы с учетом исторической точности (30% веса)
    const baseConfidence =
      historicalAccuracy * 0.3 + // Историческая точность моделей
      enhancedDataQuality * 0.25 + // Качество данных (снижено с 0.35)
      consistency * 0.25 + // Согласованность моделей (снижено с 0.3)
      trendStability * 0.15 + // Стабильность тренда (снижено с 0.2)
      externalFactors * 0.05 + // Внешние факторы (снижено с 0.15)
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
  // Улучшено: теперь использует реальные данные для переобучения через кросс-валидацию
  private async retrainModelsOnNewData(timeSeriesData: EnhancedTimeSeriesData[]): Promise<void> {
    // Анализируем качество новых данных
    const dataQuality = this.assessDataQuality(timeSeriesData);

    // Если качество данных хорошее, переобучаем модели
    if (dataQuality > 0.7 && timeSeriesData.length >= 14) {
      console.log('[EnhancedMLForecast] Переобучение моделей на новых данных с качеством:', dataQuality);

      // Используем кросс-валидацию для оценки точности и обновления весов
      const historicalAccuracy = await this.calculateHistoricalModelAccuracy();
      if (historicalAccuracy.length > 0) {
        // Обновляем веса моделей на основе реальной точности из кросс-валидации
        const totalAcc = historicalAccuracy.reduce((sum, acc) => sum + acc, 0);
        if (totalAcc > 0) {
          for (let i = 0; i < this.modelEnsemble.models.length && i < historicalAccuracy.length; i++) {
            const newWeight = historicalAccuracy[i] / totalAcc;
            // Гарантируем минимальный вес для NHITS
            if (this.modelEnsemble.models[i].name === 'NHITS') {
              this.modelEnsemble.models[i].weight = Math.max(newWeight, 0.05);
            } else {
              this.modelEnsemble.models[i].weight = newWeight;
            }
          }

          // Перенормализуем веса
          const totalWeight = this.modelEnsemble.models.reduce((sum, m) => sum + m.weight, 0);
          if (totalWeight > 0) {
            for (let i = 0; i < this.modelEnsemble.models.length; i++) {
              this.modelEnsemble.models[i].weight /= totalWeight;
            }
          }
        }
      } else {
        // Fallback: используем старый метод обновления весов
        this.updateModelWeights(timeSeriesData);
      }

      // Сохраняем информацию о переобучении
      this.lastRetrainDate = new Date();
      this.retrainCount++;
    }
  }

  /**
   * Переобучение моделей ансамбля на реальных данных из транзакций
   * Использует реальные выручки для обучения на ошибках прогнозов
   */
  public async retrainEnsembleModelsOnActuals(transactions: Transaction[]): Promise<{
    success: boolean;
    modelsRetrained: number;
    averageAccuracy: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let modelsRetrained = 0;
    let totalAccuracy = 0;

    try {
      // Используем переданные транзакции (они уже включают все данные для uploadId)
      // Временно обновляем транзакции для подготовки временного ряда
      const previousTransactions = this.transactions;
      this.transactions = transactions;

      // Подготавливаем временной ряд из всех транзакций
      const timeSeriesData = await this.prepareEnhancedTimeSeriesData();
      this.timeSeriesData = timeSeriesData;

      if (timeSeriesData.length < 14) {
        // Восстанавливаем предыдущие транзакции
        this.transactions = previousTransactions;
        return {
          success: false,
          modelsRetrained: 0,
          averageAccuracy: 0,
          errors: ['Недостаточно данных для переобучения (минимум 14 дней)'],
        };
      }

      // Анализируем качество данных
      const dataQuality = this.assessDataQuality(timeSeriesData);
      if (dataQuality < 0.5) {
        this.transactions = previousTransactions;
        return {
          success: false,
          modelsRetrained: 0,
          averageAccuracy: 0,
          errors: [`Качество данных слишком низкое: ${dataQuality.toFixed(2)}`],
        };
      }

      console.log(
        `[EnhancedMLForecast] Начало переобучения моделей на ${timeSeriesData.length} днях данных (качество: ${dataQuality.toFixed(2)})`,
      );

      // Используем кросс-валидацию для переобучения каждой модели
      const validationStart = Math.max(7, Math.floor(timeSeriesData.length * 0.7));
      const validationData = timeSeriesData.slice(validationStart);
      const trainingData = timeSeriesData.slice(0, validationStart);

      if (trainingData.length < 7 || validationData.length < 3) {
        this.transactions = previousTransactions;
        return {
          success: false,
          modelsRetrained: 0,
          averageAccuracy: 0,
          errors: ['Недостаточно данных для валидации'],
        };
      }

      const modelAccuracies: number[] = [];

      // Переобучаем каждую модель на новых данных
      for (let modelIdx = 0; modelIdx < this.modelEnsemble.models.length; modelIdx++) {
        const model = this.modelEnsemble.models[modelIdx];
        try {
          const predictions: number[] = [];
          const actuals: number[] = [];

          // Делаем прогнозы на валидационных данных
          for (let i = 0; i < validationData.length; i++) {
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

            // Обучаем на данных до этой точки (включая новые реальные данные)
            const trainingSlice = trainingData.concat(validationData.slice(0, i));
            const futureData = [futureDataPoint];
            const predictionResult = model.predict(trainingSlice, futureData);
            const modelPredictions = predictionResult instanceof Promise
              ? await predictionResult
              : predictionResult;

            if (modelPredictions.length > 0 && modelPredictions[0] !== undefined) {
              predictions.push(modelPredictions[0]);
              actuals.push(validationData[i].revenue);
            }
          }

          // Рассчитываем точность модели
          if (predictions.length > 0 && actuals.length > 0) {
            let mapeSum = 0;
            let mapeValidPoints = 0;
            const avgRevenue = actuals.reduce((sum, val) => sum + val, 0) / actuals.length;

            for (let j = 0; j < predictions.length; j++) {
              const actual = actuals[j];
              const predicted = predictions[j];

              if (Number.isFinite(predicted) && predicted >= 0 && actual > 0) {
                const error = Math.abs((actual - predicted) / actual);
                mapeSum += error;
                mapeValidPoints++;
              }
            }

            if (mapeValidPoints > 0) {
              const mape = mapeSum / mapeValidPoints;
              const accuracy = Math.max(0, Math.min(1, 1 - mape));
              modelAccuracies.push(accuracy);
              totalAccuracy += accuracy;
              modelsRetrained++;
            } else {
              modelAccuracies.push(0.5); // Fallback
            }
          } else {
            modelAccuracies.push(0.5); // Fallback
          }
        } catch (error) {
          const errorMsg = `Ошибка при переобучении модели ${model.name}: ${error instanceof Error ? error.message : String(error)}`;
          console.error(`[EnhancedMLForecast] ${errorMsg}`);
          errors.push(errorMsg);
          modelAccuracies.push(0.5); // Fallback
        }
      }

      // Обновляем веса моделей на основе новой точности
      if (modelAccuracies.length > 0) {
        const totalAcc = modelAccuracies.reduce((sum, acc) => sum + acc, 0);
        if (totalAcc > 0) {
          for (let i = 0; i < this.modelEnsemble.models.length; i++) {
            const newWeight = modelAccuracies[i] / totalAcc;
            // Гарантируем минимальный вес для NHITS
            if (this.modelEnsemble.models[i].name === 'NHITS') {
              this.modelEnsemble.models[i].weight = Math.max(newWeight, 0.05);
            } else {
              this.modelEnsemble.models[i].weight = newWeight;
            }
          }

          // Перенормализуем веса
          const totalWeight = this.modelEnsemble.models.reduce((sum, m) => sum + m.weight, 0);
          if (totalWeight > 0) {
            for (let i = 0; i < this.modelEnsemble.models.length; i++) {
              this.modelEnsemble.models[i].weight /= totalWeight;
            }
          }
        }
      }

      // Обновляем информацию о переобучении
      this.lastRetrainDate = new Date();
      this.retrainCount++;

      const averageAccuracy = modelsRetrained > 0 ? totalAccuracy / modelsRetrained : 0;

      console.log(
        `[EnhancedMLForecast] Переобучение завершено: ${modelsRetrained} моделей, средняя точность: ${averageAccuracy.toFixed(3)}`,
      );

      // Восстанавливаем предыдущие транзакции, чтобы не изменять состояние объекта
      this.transactions = previousTransactions;

      return {
        success: true,
        modelsRetrained,
        averageAccuracy,
        errors,
      };
    } catch (error) {
      const errorMsg = `Критическая ошибка при переобучении: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[EnhancedMLForecast] ${errorMsg}`);
      
      // Восстанавливаем транзакции в случае ошибки
      if (typeof previousTransactions !== 'undefined') {
        this.transactions = previousTransactions;
      }
      
      return {
        success: false,
        modelsRetrained: 0,
        averageAccuracy: 0,
        errors: [errorMsg],
      };
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
        const model = this.modelEnsemble.models[i];
        let weight = modelPerformance[i] / totalPerformance;
        
        // Гарантируем минимальный вес для NHITS (не менее 0.05 или 5%)
        if (model.name === 'NHITS') {
          weight = Math.max(weight, 0.05);
        }
        
        this.modelEnsemble.models[i].weight = weight;
      }
      
      // Перенормализуем веса после применения минимального веса для NHITS
      const totalWeight = this.modelEnsemble.models.reduce((sum, m) => sum + m.weight, 0);
      if (totalWeight > 0) {
        for (let i = 0; i < this.modelEnsemble.models.length; i++) {
          this.modelEnsemble.models[i].weight /= totalWeight;
        }
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
        case 'GRU':
          // GRU лучше работает с сезонностью и трендами, чем LSTM, но требует меньше данных
          score *= 1 + Math.min(seasonalityStrength, 0.5);
          score *= 1 + Math.min(trendStrength, 0.4);
          score *= 1 + Math.min(volatility, 0.3);
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
        case 'NHITS':
          // NHITS - нейросетевая модель для временных рядов, хорошо работает с трендами и сезонностью
          // Увеличиваем оценку для NHITS, так как это продвинутая модель
          score *= 1 + Math.min(trendStrength + seasonalityStrength, 0.7);
          score *= 1 + Math.min(volatility, 0.5);
          score *= 1 + Math.min(recentGrowth, 0.3);
          // Гарантируем минимальный вес для NHITS (не менее 50% от базового веса)
          score = Math.max(score, basePerformance[index] * 0.7);
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

  /**
   * Очищает все ресурсы: временные данные, кеши, LLM движок
   * Вызывается после завершения анализа для освобождения памяти
   */
  public cleanup(): void {
    // Очищаем временные данные временных рядов
    this.timeSeriesData = [];
    
    // Очищаем расширенные данные продаж
    this.enhancedSalesData = undefined;
    
    // Очищаем метрики точности по дням недели
    this.dayOfWeekAccuracies.clear();
    
    // Очищаем отладочные данные ансамбля
    this.lastAdaptiveDiagnostics = [];
    
    // Очищаем LLM движок, если он был инициализирован
    if (this.llmEngine) {
      this.llmEngine.cleanup();
    }
    
    // Сбрасываем вес LLM модели
    this.currentLLMWeight = 0.15;
    
    // Сбрасываем дату последнего анализа GRU
    this.lastGRUAnalysisDate = undefined;
    
    console.log('[EnhancedML Forecast] Ресурсы очищены');
  }
}
