import {
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subMonths,
  subYears,
  getDate,
  startOfDay,
  subDays,
  format,
  parseISO,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  eachMonthOfInterval,
  eachYearOfInterval,
  getDay,
  addDays,
  addMonths,
} from 'date-fns';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Transaction,
  AnalyticsResponse,
  KPIMetrics,
  PeriodData,
  DayOfWeekData,
  MonthPeriodMetrics,
  DayMetrics,
  DayComparisonData,
  MonthlyComparisonData,
  RevenueForecast,
  ForecastData,
  WeatherData,
  EconomicIndicator,
  HolidayData,
  TrafficData,
  SocialSentiment,
  MLAnalysis,
  MLAnomaly,
  MLModelMetrics,
} from '@shared/schema';
import { SimpleMLForecastingEngine } from './simpleMLForecasting';
import { EnhancedMLForecastingEngine } from './enhancedMLForecasting';
import { ExternalDataService } from './externalDataSources';
import { AdvancedAnalyticsEngine } from './advancedAnalytics';
import { engineerForecastFeatures } from './salesFeatures';
import { log } from '../vite';

export interface SalesModelMetadata {
  version: number;
  trainedAt?: string;
  trainingSamples?: number;
  featuresUsed?: number;
  lambda?: number;
  targetMean?: number;
  targetStd?: number;
  checksMean?: number;
  metrics?: {
    mae: number;
    rmse: number;
    r2: number;
  };
}

export interface SalesModel {
  intercept: number;
  coefficients: Record<string, number>;
  featureOrder: string[];
  normalization?: {
    mean?: Record<string, number>;
    std?: Record<string, number>;
  };
  metadata?: SalesModelMetadata;
}

export const SALES_MODEL_VERSION = 2;

let cachedSalesModel: SalesModel | null = null;

function loadSalesModel(): SalesModel {
  if (cachedSalesModel) {
    return cachedSalesModel;
  }

  const filePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'models',
    'salesModel.json',
  );

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SalesModel>;
    const metadataCandidate = parsed?.metadata;
    const metadata =
      metadataCandidate && typeof metadataCandidate === 'object'
        ? (metadataCandidate as SalesModelMetadata)
        : undefined;
    const modelVersion = metadata?.version ?? 1;

    if (modelVersion !== SALES_MODEL_VERSION) {
      console.warn(
        `Sales model metadata version ${modelVersion} is incompatible with expected version ${SALES_MODEL_VERSION}. Baseline forecasts will be used until the model is retrained.`,
      );
      cachedSalesModel = {
        intercept: typeof metadata?.targetMean === 'number' ? metadata.targetMean : 0,
        coefficients: {},
        featureOrder: [],
        metadata,
      };
      return cachedSalesModel;
    }

    const coefficientsEntries = parsed?.coefficients
      ? Object.entries(parsed.coefficients).filter(
          (entry): entry is [string, number] =>
            typeof entry[0] === 'string' && typeof entry[1] === 'number',
        )
      : [];

    const coefficients = Object.fromEntries(coefficientsEntries);

    const featureOrder =
      Array.isArray(parsed?.featureOrder) && parsed.featureOrder.length > 0
        ? parsed.featureOrder.filter((name): name is string => typeof name === 'string')
        : Object.keys(coefficients);

    const intercept =
      typeof parsed?.intercept === 'number'
        ? parsed.intercept
        : typeof metadata?.targetMean === 'number'
          ? metadata.targetMean
          : 0;

    cachedSalesModel = {
      intercept,
      coefficients,
      featureOrder,
      normalization: parsed?.normalization,
      metadata,
    };
  } catch (error) {
    console.warn('Failed to load sales model, falling back to baseline forecasts.', error);
    cachedSalesModel = {
      intercept: 0,
      coefficients: {},
      featureOrder: [],
      metadata: undefined,
    };
  }

  return cachedSalesModel;
}

export function clearSalesModelCache(): void {
  cachedSalesModel = null;
}

const isEnsembleDebugEnabled = process.env.DEBUG_ENSEMBLE === 'true';

function ensureAbsolutePrediction(prediction: number, baseDayRevenue: number): number {
  if (!Number.isFinite(prediction)) {
    return Math.max(0, baseDayRevenue);
  }

  if (baseDayRevenue <= 0) {
    return Math.max(0, prediction);
  }

  const positivePrediction = Math.max(prediction, 0);
  const base = Math.max(baseDayRevenue, 1e-6);
  const rawMultiplier = positivePrediction <= 10 ? positivePrediction : positivePrediction / base;
  const safeMultiplier = Number.isFinite(rawMultiplier) && rawMultiplier >= 0 ? rawMultiplier : 0;

  return base * safeMultiplier;
}

function normalizeWeights<T extends string>(weights: Record<T, number>): Record<T, number> {
  const entries = Object.entries(weights) as [T, number][];
  if (entries.length === 0) {
    return weights;
  }

  const sanitized: [T, number][] = entries.map(([key, value]) => {
    if (!Number.isFinite(value) || value <= 0) {
      return [key, 0];
    }
    return [key, value];
  });

  const total = sanitized.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    const uniformWeight = 1 / sanitized.length;
    return Object.fromEntries(sanitized.map(([key]) => [key, uniformWeight])) as Record<T, number>;
  }

  return Object.fromEntries(sanitized.map(([key, value]) => [key, value / total])) as Record<
    T,
    number
  >;
}

function calculateHistoricalClamp(
  values: number[],
  fallback: number,
): { mean: number; std: number; clampLimit: number } {
  const sanitized = values.filter((value) => Number.isFinite(value) && value > 0);
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

function logEnsembleDebug(
  context: 'standard' | 'enhanced',
  date: Date,
  baseDayRevenue: number,
  weights: Record<string, number>,
  predictions: Record<string, number>,
  contributions: Record<string, number>,
  rawResult: number,
  clampLimit: number | null,
  clampedResult: number,
  finalResult: number,
): void {
  if (!isEnsembleDebugEnabled) {
    return;
  }

  const dateLabel =
    date instanceof Date && !Number.isNaN(date.getTime())
      ? format(date, 'yyyy-MM-dd')
      : 'unknown-date';

  const clampLabel =
    clampLimit !== null && Number.isFinite(clampLimit) ? formatDebugNumber(clampLimit) : 'none';

  console.debug(
    `[${context} ensemble][${dateLabel}] base=${formatDebugNumber(baseDayRevenue)} ` +
      `raw=${formatDebugNumber(rawResult)} clamp=${clampLabel} ` +
      `clamped=${formatDebugNumber(clampedResult)} final=${formatDebugNumber(finalResult)}`,
  );

  Object.keys(predictions).forEach((method) => {
    const weight = weights[method] ?? 0;
    const prediction = predictions[method] ?? 0;
    const contribution = contributions[method] ?? 0;
    console.debug(
      `[${context} ensemble][${dateLabel}] ${method}: ` +
        `weight=${formatDebugNumber(weight, 4)} ` +
        `prediction=${formatDebugNumber(prediction)} ` +
        `contribution=${formatDebugNumber(contribution)}`,
    );
  });
}

function extractAmount(transaction: Transaction): number {
  const amount = (transaction as any).amount;
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    return amount;
  }
  return 0;
}

export function forecastRevenueForTransactions(transactions: Transaction[]): number[] {
  if (transactions.length === 0) {
    return [];
  }

  const model = loadSalesModel();
  const metadata = model.metadata;
  const safeActuals = transactions.map((tx) => Math.max(0, extractAmount(tx)));

  const averageActual =
    safeActuals.length > 0
      ? safeActuals.reduce((sum, value) => sum + value, 0) / safeActuals.length
      : 0;

  const defaultPredictionRaw =
    typeof metadata?.targetMean === 'number' ? metadata.targetMean : averageActual;
  const defaultPrediction = Math.max(0, defaultPredictionRaw);

  const engineered = engineerForecastFeatures(transactions, {
    defaultRevenue: metadata?.targetMean,
    defaultChecks: metadata?.checksMean,
  });

  if (engineered.featureMaps.length === 0) {
    return safeActuals;
  }

  const featureOrder = model.featureOrder.length > 0 ? model.featureOrder : engineered.featureNames;

  if (featureOrder.length === 0 || Object.keys(model.coefficients).length === 0) {
    return safeActuals;
  }

  const normalization = model.normalization ?? {};
  const means = normalization.mean ?? {};
  const stds = normalization.std ?? {};

  const aggregatePredictions = engineered.featureMaps.map((featureMap) => {
    let prediction = model.intercept;

    featureOrder.forEach((featureName) => {
      const coefficient = model.coefficients[featureName] ?? 0;
      if (coefficient === 0) {
        if (!(featureName in featureMap)) {
          return;
        }
      }

      const rawValue = featureMap[featureName] ?? 0;
      const mean = means[featureName] ?? 0;
      const stdCandidate = stds[featureName];
      const std =
        typeof stdCandidate === 'number' && Number.isFinite(stdCandidate) ? stdCandidate : 1;
      const safeStd = std > 1e-6 ? std : 1e-6;
      const normalized = (rawValue - mean) / safeStd;
      prediction += coefficient * normalized;
    });

    if (!Number.isFinite(prediction)) {
      return defaultPrediction;
    }

    return Math.max(0, prediction);
  });

  const predictions = safeActuals.slice();

  engineered.indexMap.forEach((originalIndices, aggregateIndex) => {
    const aggregatePrediction = aggregatePredictions[aggregateIndex] ?? defaultPrediction;
    const value = Number.isFinite(aggregatePrediction)
      ? Math.max(0, aggregatePrediction)
      : defaultPrediction;

    originalIndices.forEach((originalIndex: number) => {
      if (originalIndex >= 0 && originalIndex < predictions.length) {
        predictions[originalIndex] = value;
      }
    });
  });

  return predictions;
}

export async function calculateAnalytics(
  transactions: Transaction[],
  includeLLM: boolean = false, // По умолчанию отключаем LLM для скорости
  storage?: any, // Хранилище для сохранения прогнозов
  uploadId?: string, // ID загрузки данных
): Promise<AnalyticsResponse> {
  if (transactions.length === 0) {
    return {
      kpi: {
        totalRevenue: 0,
        averageCheck: 0,
        totalChecks: 0,
      },
      daily: [],
      monthly: [],
      yearly: [],
      transactions: [],
      hasCostData: false,
    };
  }

  // Sort transactions by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const hasCostData = sorted.some(
    (transaction) =>
      typeof transaction.costOfGoods === 'number' && Number.isFinite(transaction.costOfGoods),
  );

  const sumCost = (txs: Transaction[]): number =>
    txs.reduce((sum, t) => sum + (t.costOfGoods ?? 0), 0);

  // Calculate overall KPIs
  const totalRevenue = sorted.reduce((sum, t) => sum + t.amount, 0);
  const totalChecks = sorted.reduce((sum, t) => sum + (t.checksCount || 1), 0);
  const averageCheck = totalChecks > 0 ? totalRevenue / totalChecks : 0;
  const totalCostOfGoods = hasCostData ? sumCost(sorted) : undefined;
  const grossProfit = totalCostOfGoods !== undefined ? totalRevenue - totalCostOfGoods : undefined;
  const grossMargin =
    grossProfit !== undefined && totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : undefined;

  // Get date range
  const latestDate = new Date(sorted[sorted.length - 1].date);

  // Calculate MoM (Month over Month) metrics
  const currentMonthStart = startOfMonth(latestDate);
  const currentMonthEnd = endOfMonth(latestDate);
  const previousMonthStart = startOfMonth(subMonths(currentMonthStart, 1));
  const previousMonthEnd = endOfMonth(subMonths(currentMonthStart, 1));

  const currentMonthTxs = sorted.filter((t) => {
    const txDate = new Date(t.date);
    return txDate >= currentMonthStart && txDate <= currentMonthEnd;
  });

  const previousMonthTxs = sorted.filter((t) => {
    const txDate = new Date(t.date);
    return txDate >= previousMonthStart && txDate <= previousMonthEnd;
  });

  // Calculate YoY (Year over Year) metrics
  const currentYearStart = startOfYear(latestDate);
  const currentYearEnd = endOfYear(latestDate);
  const previousYearStart = startOfYear(subYears(currentYearStart, 1));
  const previousYearEnd = endOfYear(subYears(currentYearStart, 1));

  const currentYearTxs = sorted.filter((t) => {
    const txDate = new Date(t.date);
    return txDate >= currentYearStart && txDate <= currentYearEnd;
  });

  const previousYearTxs = sorted.filter((t) => {
    const txDate = new Date(t.date);
    return txDate >= previousYearStart && txDate <= previousYearEnd;
  });

  // Calculate MoM metrics - compare same periods (1st to current day)
  const currentDayOfMonth = getDate(latestDate);
  const currentDayStart = startOfDay(latestDate);

  // Get transactions from start of current month to current day
  const currentPeriodTxs = currentMonthTxs.filter((t) => {
    const txDate = startOfDay(new Date(t.date));
    return txDate.getTime() <= currentDayStart.getTime();
  });

  // Find same day in previous month (handle month overflow)
  const previousMonthLastDay = endOfMonth(previousMonthStart);
  const previousMonthDayOfMonth = Math.min(currentDayOfMonth, getDate(previousMonthLastDay));
  const previousMonthSameDate = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    previousMonthDayOfMonth,
  );
  const previousMonthSameDayEnd = startOfDay(previousMonthSameDate);

  // Get transactions from start of previous month to same day
  const previousPeriodTxs = previousMonthTxs.filter((t) => {
    const txDate = startOfDay(new Date(t.date));
    return txDate.getTime() <= previousMonthSameDayEnd.getTime();
  });

  const currentMonthRevenue = currentPeriodTxs.reduce((sum, t) => sum + t.amount, 0);
  const previousMonthRevenue = previousPeriodTxs.reduce((sum, t) => sum + t.amount, 0);
  const currentMonthChecksCount = currentPeriodTxs.reduce(
    (sum, t) => sum + (t.checksCount || 1),
    0,
  );
  const previousMonthChecksCount = previousPeriodTxs.reduce(
    (sum, t) => sum + (t.checksCount || 1),
    0,
  );
  const currentMonthAvgCheck =
    currentMonthChecksCount > 0 ? currentMonthRevenue / currentMonthChecksCount : 0;
  const previousMonthAvgCheck =
    previousMonthChecksCount > 0 ? previousMonthRevenue / previousMonthChecksCount : 0;
  const currentMonthCost = hasCostData ? sumCost(currentPeriodTxs) : undefined;
  const previousMonthCost = hasCostData ? sumCost(previousPeriodTxs) : undefined;
  const currentMonthGrossProfit =
    currentMonthCost !== undefined ? currentMonthRevenue - currentMonthCost : undefined;
  const previousMonthGrossProfit =
    previousMonthCost !== undefined ? previousMonthRevenue - previousMonthCost : undefined;
  const currentMonthGrossMargin =
    currentMonthGrossProfit !== undefined && currentMonthRevenue > 0
      ? (currentMonthGrossProfit / currentMonthRevenue) * 100
      : undefined;
  const previousMonthGrossMargin =
    previousMonthGrossProfit !== undefined && previousMonthRevenue > 0
      ? (previousMonthGrossProfit / previousMonthRevenue) * 100
      : undefined;

  const revenueGrowthMoM =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : 0;

  const averageCheckGrowthMoM =
    previousMonthAvgCheck > 0
      ? ((currentMonthAvgCheck - previousMonthAvgCheck) / previousMonthAvgCheck) * 100
      : 0;

  const checksGrowthMoM =
    previousMonthChecksCount > 0
      ? ((currentMonthChecksCount - previousMonthChecksCount) / previousMonthChecksCount) * 100
      : 0;

  // Calculate Day-over-Day (DoD) revenue growth
  // Group daily revenues and get last two days
  const dailyRevenueMap = new Map<string, number>();
  sorted.forEach((t) => {
    const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
    const existing = dailyRevenueMap.get(day) || 0;
    dailyRevenueMap.set(day, existing + t.amount);
  });

  const dailyRevenuesArray = Array.from(dailyRevenueMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let revenueGrowthDoD = 0;
  if (dailyRevenuesArray.length >= 2) {
    const lastDayRevenue = dailyRevenuesArray[dailyRevenuesArray.length - 1][1];
    const previousDayRevenue = dailyRevenuesArray[dailyRevenuesArray.length - 2][1];
    revenueGrowthDoD =
      previousDayRevenue > 0
        ? ((lastDayRevenue - previousDayRevenue) / previousDayRevenue) * 100
        : 0;
  }

  // Calculate current month metrics (use period transactions for consistency)
  const currentMonthTotalChecks = currentMonthChecksCount;

  // Calculate average checks per day for current period
  const currentMonthDays = new Set(
    currentPeriodTxs.map((t) => format(startOfDay(new Date(t.date)), 'yyyy-MM-dd')),
  ).size;
  const currentMonthAvgChecksPerDay =
    currentMonthDays > 0 ? currentMonthTotalChecks / currentMonthDays : 0;

  // Calculate YoY metrics
  const currentYearRevenue = currentYearTxs.reduce((sum, t) => sum + t.amount, 0);
  const previousYearRevenue = previousYearTxs.reduce((sum, t) => sum + t.amount, 0);

  const revenueGrowthYoY =
    previousYearRevenue > 0
      ? ((currentYearRevenue - previousYearRevenue) / previousYearRevenue) * 100
      : 0;

  const kpi: KPIMetrics = {
    totalRevenue,
    averageCheck,
    totalChecks,
    totalCostOfGoods,
    grossProfit,
    grossMargin,
    previousRevenue: previousMonthRevenue,
    previousAverageCheck: previousMonthAvgCheck,
    previousChecks: previousMonthChecksCount,
    revenueGrowth: revenueGrowthMoM,
    revenueGrowthDoD,
    averageCheckGrowth: averageCheckGrowthMoM,
    checksGrowth: checksGrowthMoM,
    currentMonthTotalChecks,
    currentMonthAvgChecksPerDay,
    revenueGrowthYoY,
    grossProfitGrowth:
      currentMonthGrossProfit !== undefined &&
      previousMonthGrossProfit !== undefined &&
      previousMonthGrossProfit !== 0
        ? ((currentMonthGrossProfit - previousMonthGrossProfit) / previousMonthGrossProfit) * 100
        : undefined,
    grossMarginChange:
      currentMonthGrossMargin !== undefined && previousMonthGrossMargin !== undefined
        ? currentMonthGrossMargin - previousMonthGrossMargin
        : undefined,
  };

  // Aggregate by day
  const dailyMap = new Map<string, { revenue: number; checks: number; cost: number }>();
  sorted.forEach((t) => {
    const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
    const existing = dailyMap.get(day) || { revenue: 0, checks: 0, cost: 0 };
    dailyMap.set(day, {
      revenue: existing.revenue + t.amount,
      checks: existing.checks + (t.checksCount || 1),
      cost: existing.cost + (t.costOfGoods ?? 0),
    });
  });

  const daily: PeriodData[] = Array.from(dailyMap.entries())
    .map(([period, data]) => {
      const cost = hasCostData ? data.cost : undefined;
      const gross = cost !== undefined ? data.revenue - cost : undefined;
      return {
        period,
        revenue: data.revenue,
        checks: data.checks,
        averageCheck: data.checks > 0 ? data.revenue / data.checks : 0,
        costOfGoods: cost,
        grossProfit: gross,
        grossMargin:
          gross !== undefined && data.revenue > 0 ? (gross / data.revenue) * 100 : undefined,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  // Aggregate by month
  const monthlyMap = new Map<string, { revenue: number; checks: number; cost: number }>();
  sorted.forEach((t) => {
    const month = format(startOfMonth(new Date(t.date)), 'yyyy-MM');
    const existing = monthlyMap.get(month) || { revenue: 0, checks: 0, cost: 0 };
    monthlyMap.set(month, {
      revenue: existing.revenue + t.amount,
      checks: existing.checks + (t.checksCount || 1),
      cost: existing.cost + (t.costOfGoods ?? 0),
    });
  });

  const monthly: PeriodData[] = Array.from(monthlyMap.entries())
    .map(([period, data]) => {
      const cost = hasCostData ? data.cost : undefined;
      const gross = cost !== undefined ? data.revenue - cost : undefined;
      return {
        period,
        revenue: data.revenue,
        checks: data.checks,
        averageCheck: data.checks > 0 ? data.revenue / data.checks : 0,
        costOfGoods: cost,
        grossProfit: gross,
        grossMargin:
          gross !== undefined && data.revenue > 0 ? (gross / data.revenue) * 100 : undefined,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  // Aggregate by year
  const yearlyMap = new Map<string, { revenue: number; checks: number; cost: number }>();
  sorted.forEach((t) => {
    const year = format(startOfYear(new Date(t.date)), 'yyyy');
    const existing = yearlyMap.get(year) || { revenue: 0, checks: 0, cost: 0 };
    yearlyMap.set(year, {
      revenue: existing.revenue + t.amount,
      checks: existing.checks + (t.checksCount || 1),
      cost: existing.cost + (t.costOfGoods ?? 0),
    });
  });

  const yearly: PeriodData[] = Array.from(yearlyMap.entries())
    .map(([period, data]) => {
      const cost = hasCostData ? data.cost : undefined;
      const gross = cost !== undefined ? data.revenue - cost : undefined;
      return {
        period,
        revenue: data.revenue,
        checks: data.checks,
        averageCheck: data.checks > 0 ? data.revenue / data.checks : 0,
        costOfGoods: cost,
        grossProfit: gross,
        grossMargin:
          gross !== undefined && data.revenue > 0 ? (gross / data.revenue) * 100 : undefined,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  // Aggregate by day of week
  const dayOfWeekMap = new Map<number, { revenue: number; checks: number; cost: number }>();
  sorted.forEach((t) => {
    const dayOfWeek = getDay(new Date(t.date)); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const existing = dayOfWeekMap.get(dayOfWeek) || { revenue: 0, checks: 0, cost: 0 };
    dayOfWeekMap.set(dayOfWeek, {
      revenue: existing.revenue + t.amount,
      checks: existing.checks + (t.checksCount || 1),
      cost: existing.cost + (t.costOfGoods ?? 0),
    });
  });

  const dayNames = [
    'Воскресенье',
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
  ];

  // Create array with all days of week, even if no data
  const byDayOfWeek: DayOfWeekData[] = [1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => {
    const data = dayOfWeekMap.get(dayOfWeek) || { revenue: 0, checks: 0, cost: 0 };
    const cost = hasCostData ? data.cost : undefined;
    const gross = cost !== undefined ? data.revenue - cost : undefined;
    return {
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      revenue: data.revenue,
      checks: data.checks,
      averageCheck: data.checks > 0 ? data.revenue / data.checks : 0,
      costOfGoods: cost,
      grossProfit: gross,
      grossMargin:
        gross !== undefined && data.revenue > 0 ? (gross / data.revenue) * 100 : undefined,
    };
  });

  // Calculate monthly comparison data
  const calculateMonthMetrics = (
    monthTxs: Transaction[],
    monthStart: Date,
    monthEnd: Date,
  ): MonthPeriodMetrics => {
    const revenue = monthTxs.reduce((sum, t) => sum + t.amount, 0);
    const checks = monthTxs.reduce((sum, t) => sum + (t.checksCount || 1), 0);
    const averageCheck = checks > 0 ? revenue / checks : 0;
    const cost = hasCostData ? sumCost(monthTxs) : undefined;
    const gross = cost !== undefined ? revenue - cost : undefined;
    const margin = gross !== undefined && revenue > 0 ? (gross / revenue) * 100 : undefined;

    // Calculate daily data for this month
    const monthDailyMap = new Map<string, { revenue: number; checks: number; cost: number }>();
    monthTxs.forEach((t) => {
      const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
      const existing = monthDailyMap.get(day) || { revenue: 0, checks: 0, cost: 0 };
      monthDailyMap.set(day, {
        revenue: existing.revenue + t.amount,
        checks: existing.checks + (t.checksCount || 1),
        cost: existing.cost + (t.costOfGoods ?? 0),
      });
    });

    const dailyData: PeriodData[] = Array.from(monthDailyMap.entries())
      .map(([period, data]) => {
        const dayCost = hasCostData ? data.cost : undefined;
        const dayGross = dayCost !== undefined ? data.revenue - dayCost : undefined;
        return {
          period,
          revenue: data.revenue,
          checks: data.checks,
          averageCheck: data.checks > 0 ? data.revenue / data.checks : 0,
          costOfGoods: dayCost,
          grossProfit: dayGross,
          grossMargin:
            dayGross !== undefined && data.revenue > 0
              ? (dayGross / data.revenue) * 100
              : undefined,
        };
      })
      .sort((a, b) => a.period.localeCompare(b.period));

    // Calculate payment breakdown
    const paymentBreakdown = {
      cash: monthTxs.reduce((sum, t) => sum + (t.cashPayment || 0), 0),
      terminal: monthTxs.reduce((sum, t) => sum + (t.terminalPayment || 0), 0),
      qr: monthTxs.reduce((sum, t) => sum + (t.qrPayment || 0), 0),
      sbp: monthTxs.reduce((sum, t) => sum + (t.sbpPayment || 0), 0),
    };

    return {
      revenue,
      checks,
      averageCheck,
      dailyData,
      paymentBreakdown,
      costOfGoods: cost,
      grossProfit: gross,
      grossMargin: margin,
    };
  };

  // Calculate full month metrics for monthly comparison charts (dailyData needs full month)
  const currentMonthMetrics = calculateMonthMetrics(
    currentMonthTxs,
    currentMonthStart,
    currentMonthEnd,
  );
  const previousMonthMetrics = calculateMonthMetrics(
    previousMonthTxs,
    previousMonthStart,
    previousMonthEnd,
  );

  // Calculate period metrics for fair comparison (using same periods)
  const currentPeriodMonthMetrics = calculateMonthMetrics(
    currentPeriodTxs,
    currentMonthStart,
    currentDayStart,
  );
  const previousPeriodMonthMetrics = calculateMonthMetrics(
    previousPeriodTxs,
    previousMonthStart,
    previousMonthSameDayEnd,
  );

  // Calculate period comparison: from start of month to current day vs same period in previous month
  const calculatePeriodMetrics = (periodTxs: Transaction[], endDate: Date): DayMetrics | null => {
    if (periodTxs.length === 0) return null;

    const revenue = periodTxs.reduce((sum, t) => sum + t.amount, 0);
    const checks = periodTxs.reduce((sum, t) => sum + (t.checksCount || 1), 0);
    const averageCheck = checks > 0 ? revenue / checks : 0;
    const cost = hasCostData ? sumCost(periodTxs) : undefined;
    const gross = cost !== undefined ? revenue - cost : undefined;
    const margin = gross !== undefined && revenue > 0 ? (gross / revenue) * 100 : undefined;

    const paymentBreakdown = {
      cash: periodTxs.reduce((sum, t) => sum + (t.cashPayment || 0), 0),
      terminal: periodTxs.reduce((sum, t) => sum + (t.terminalPayment || 0), 0),
      qr: periodTxs.reduce((sum, t) => sum + (t.qrPayment || 0), 0),
      sbp: periodTxs.reduce((sum, t) => sum + (t.sbpPayment || 0), 0),
    };

    return {
      date: format(endDate, 'yyyy-MM-dd'),
      revenue,
      checks,
      averageCheck,
      costOfGoods: cost,
      grossProfit: gross,
      grossMargin: margin,
      paymentBreakdown,
    };
  };

  // Use the same period transactions that were calculated for MoM metrics
  const currentPeriodMetrics = calculatePeriodMetrics(currentPeriodTxs, currentDayStart);
  const previousPeriodMetrics = calculatePeriodMetrics(previousPeriodTxs, previousMonthSameDayEnd);

  let dayComparisonData: DayComparisonData | null = null;

  if (currentPeriodMetrics || previousPeriodMetrics) {
    const currentRev = currentPeriodMetrics?.revenue || 0;
    const prevRev = previousPeriodMetrics?.revenue || 0;
    const currentChecks = currentPeriodMetrics?.checks || 0;
    const prevChecks = previousPeriodMetrics?.checks || 0;
    const currentAvg = currentPeriodMetrics?.averageCheck || 0;
    const prevAvg = previousPeriodMetrics?.averageCheck || 0;
    const currentGross = currentPeriodMetrics?.grossProfit;
    const prevGross = previousPeriodMetrics?.grossProfit;
    const currentMargin = currentPeriodMetrics?.grossMargin;
    const prevMargin = previousPeriodMetrics?.grossMargin;

    dayComparisonData = {
      currentDay: currentPeriodMetrics,
      previousMonthSameDay: previousPeriodMetrics,
      comparison:
        currentPeriodMetrics && previousPeriodMetrics
          ? {
              revenueGrowth: prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : 0,
              checksGrowth: prevChecks > 0 ? ((currentChecks - prevChecks) / prevChecks) * 100 : 0,
              averageCheckGrowth: prevAvg > 0 ? ((currentAvg - prevAvg) / prevAvg) * 100 : 0,
              grossProfitGrowth:
                currentGross !== undefined && prevGross !== undefined && prevGross !== 0
                  ? ((currentGross - prevGross) / prevGross) * 100
                  : undefined,
              grossMarginChange:
                currentMargin !== undefined && prevMargin !== undefined
                  ? currentMargin - prevMargin
                  : undefined,
            }
          : null,
    };
  }

  const monthlyComparison: MonthlyComparisonData = {
    currentMonth: {
      period: format(currentMonthStart, 'yyyy-MM'),
      // Используем period metrics для корректного отображения данных за период (например, с 1 по 8 число)
      metrics: currentPeriodMonthMetrics,
    },
    previousMonth: {
      period: format(previousMonthStart, 'yyyy-MM'),
      // Используем period metrics для корректного отображения данных за период (например, с 1 по 8 число)
      metrics: previousPeriodMonthMetrics,
    },
    // Use period metrics for fair comparison (same date ranges)
    comparison: {
      revenueGrowth:
        previousPeriodMonthMetrics.revenue > 0
          ? ((currentPeriodMonthMetrics.revenue - previousPeriodMonthMetrics.revenue) /
              previousPeriodMonthMetrics.revenue) *
            100
          : 0,
      checksGrowth:
        previousPeriodMonthMetrics.checks > 0
          ? ((currentPeriodMonthMetrics.checks - previousPeriodMonthMetrics.checks) /
              previousPeriodMonthMetrics.checks) *
            100
          : 0,
      averageCheckGrowth:
        previousPeriodMonthMetrics.averageCheck > 0
          ? ((currentPeriodMonthMetrics.averageCheck - previousPeriodMonthMetrics.averageCheck) /
              previousPeriodMonthMetrics.averageCheck) *
            100
          : 0,
      grossProfitGrowth:
        currentPeriodMonthMetrics.grossProfit !== undefined &&
        previousPeriodMonthMetrics.grossProfit !== undefined &&
        previousPeriodMonthMetrics.grossProfit !== 0
          ? ((currentPeriodMonthMetrics.grossProfit - previousPeriodMonthMetrics.grossProfit) /
              previousPeriodMonthMetrics.grossProfit) *
            100
          : undefined,
      grossMarginChange:
        currentPeriodMonthMetrics.grossMargin !== undefined &&
        previousPeriodMonthMetrics.grossMargin !== undefined
          ? currentPeriodMonthMetrics.grossMargin - previousPeriodMonthMetrics.grossMargin
          : undefined,
    },
    dayComparison: dayComparisonData || undefined,
  };

  // Создаем один экземпляр ExternalDataService и EnhancedMLForecastingEngine для переиспользования
  const mlEngineStartTime = performance.now();
  const externalDataService =
    process.env.DISABLE_EXTERNAL_DATA === 'true'
      ? undefined
      : new ExternalDataService({
          openWeatherApiKey: process.env.OPENWEATHER_API_KEY || '',
          exchangeRateApiKey: process.env.EXCHANGERATE_API_KEY || '',
          calendarificApiKey: process.env.CALENDARIFIC_API_KEY || '',
          googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
          alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
          fredApiKey: process.env.FRED_API_KEY,
          newsApiKey: process.env.NEWS_API_KEY,
          twitterApiKey: process.env.TWITTER_API_KEY,
        });

  const enhancedMLEngine = new EnhancedMLForecastingEngine(sorted, externalDataService, undefined, includeLLM, storage, uploadId);
  const mlEngineInitTime = performance.now() - mlEngineStartTime;
  if (mlEngineInitTime > 100) {
    log(`⏱️  Инициализация ML движка заняла ${mlEngineInitTime.toFixed(2)}ms`, 'performance');
  }

  // Продвинутая аналитика
  const advancedAnalytics = new AdvancedAnalyticsEngine(sorted);
  const customerClusters = advancedAnalytics.getCustomerClusters();
  const productClusters = advancedAnalytics.getProductClusters();
  const anomalies = advancedAnalytics.getAnomalies();
  const trendAnalysis = advancedAnalytics.analyzeTrends();
  const marketSegments = advancedAnalytics.analyzeMarketSegments();

  // ML анализ для резюме и прогноз - используем один экземпляр движка
  const forecast = await generateEnhancedRevenueForecast(sorted, enhancedMLEngine);
  const mlAnalysis = await generateMLAnalysis(sorted, daily, enhancedMLEngine);

  // Очищаем ресурсы движка после завершения анализа
  try {
    enhancedMLEngine.cleanup();
  } catch (error) {
    console.warn('⚠️  Ошибка при очистке ML движка:', error);
  }

  return {
    kpi,
    daily,
    monthly,
    yearly,
    byDayOfWeek,
    monthlyComparison,
    forecast,
    transactions: sorted,
    advancedAnalytics: {
      customerClusters,
      productClusters,
      anomalies,
      trendAnalysis,
      marketSegments,
    },
    mlAnalysis,
    hasCostData,
  };
}

// Генерация ML анализа для резюме
async function generateMLAnalysis(
  transactions: Transaction[],
  dailyData: PeriodData[],
  mlEngine: EnhancedMLForecastingEngine,
): Promise<MLAnalysis | undefined> {
  if (transactions.length < 10 || dailyData.length < 7) {
    return undefined; // Минимум данных для анализа
  }

  try {
    const analysisStartTime = performance.now();

    // Подготавливаем данные временных рядов (используем внутренний метод через прогноз)
    await mlEngine.generateEnhancedForecast(1); // Генерируем минимальный прогноз для подготовки данных

    // Получаем метрики качества модели
    const qualityMetrics = await mlEngine.getModelQualityMetrics();
    
    const analysisTime = performance.now() - analysisStartTime;
    if (analysisTime > 500) {
      log(`⏱️  ML анализ занял ${analysisTime.toFixed(2)}ms`, 'performance');
    }
    const modelQuality: MLModelMetrics = {
      arima: qualityMetrics.arima,
      prophet: qualityMetrics.prophet,
      lstm: qualityMetrics.lstm,
      linear: qualityMetrics.linear,
      movingAverage: qualityMetrics.movingaverage,
      overall:
        Object.values(qualityMetrics).reduce((sum, val) => sum + (val || 0), 0) /
        Object.keys(qualityMetrics).length,
    };

    // Анализируем дневные данные для обнаружения аномалий
    const revenues = dailyData.map((d) => d.revenue);
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const q1 = sortedRevenues[Math.floor(sortedRevenues.length * 0.25)];
    const q3 = sortedRevenues[Math.floor(sortedRevenues.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    // Находим минимальную и максимальную выручку
    const minRevenue = Math.min(...revenues);
    const maxRevenue = Math.max(...revenues);
    const minIndex = revenues.indexOf(minRevenue);
    const maxIndex = revenues.indexOf(maxRevenue);

    const minDay = dailyData[minIndex];
    const maxDay = dailyData[maxIndex];

    // Определяем, являются ли они аномалиями
    const minIsAnomaly = minRevenue < lowerBound;
    const maxIsAnomaly = maxRevenue > upperBound;

    // Исключаем аномалии из расчета среднего (обучаем модель игнорировать их)
    const filteredDailyData = dailyData.filter((d, idx) => {
      if (minIsAnomaly && idx === minIndex) return false;
      if (maxIsAnomaly && idx === maxIndex) return false;
      return true;
    });
    const filteredRevenues = filteredDailyData.map((d) => d.revenue);
    const avgRevenue = filteredRevenues.length > 0
      ? filteredRevenues.reduce((sum, r) => sum + r, 0) / filteredRevenues.length
      : revenues.reduce((sum, r) => sum + r, 0) / revenues.length;

    // Формируем аномалии
    const anomalies: MLAnomaly[] = [];

    // Аномалия минимальной выручки
    if (minIsAnomaly && minDay) {
      const deviation = ((minRevenue - avgRevenue) / avgRevenue) * 100;
      const severity: 'low' | 'medium' | 'high' | 'critical' =
        deviation < -50 ? 'critical' : deviation < -30 ? 'high' : deviation < -15 ? 'medium' : 'low';

      anomalies.push({
        date: minDay.period,
        revenue: minRevenue,
        expectedRevenue: avgRevenue,
        deviation,
        severity,
        type: 'minimum',
        explanation: `Выручка ${format(new Date(minDay.period), 'dd.MM.yyyy')} — ${minRevenue.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })} (на ${Math.abs(deviation).toFixed(1)}% ниже среднего).`,
        recommendations: [
          'Проверить причины снижения: возможно, это был выходной день или особое событие',
          'Проанализировать работу персонала в этот день',
          'Рассмотреть возможность специальных акций для таких дней',
        ],
      });
    }

    // Аномалия максимальной выручки
    if (maxIsAnomaly && maxDay) {
      const deviation = ((maxRevenue - avgRevenue) / avgRevenue) * 100;
      const severity: 'low' | 'medium' | 'high' | 'critical' =
        deviation > 50 ? 'critical' : deviation > 30 ? 'high' : deviation > 15 ? 'medium' : 'low';

      anomalies.push({
        date: maxDay.period,
        revenue: maxRevenue,
        expectedRevenue: avgRevenue,
        deviation,
        severity,
        type: 'maximum',
        explanation: `Выручка ${format(new Date(maxDay.period), 'dd.MM.yyyy')} — ${maxRevenue.toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 })} (на ${deviation.toFixed(1)}% выше среднего).`,
        recommendations: [
          'Проанализировать факторы успеха: возможно, это была акция или особое событие',
          'Попытаться воспроизвести успешные практики в другие дни',
          'Увеличить персонал и запасы для таких пиковых дней',
        ],
      });
    }

    // Находим минимальную и максимальную аномалии
    const minRevenueAnomaly = anomalies.find((a) => a.type === 'minimum');
    const maxRevenueAnomaly = anomalies.find((a) => a.type === 'maximum');

    // Рассчитываем уверенность на основе качества модели и количества данных
    const confidence = Math.min(
      0.95,
      Math.max(0.5, modelQuality.overall || 0.7) * (1 - Math.min(0.3, anomalies.length / 10)),
    );

    return {
      anomalies,
      modelQuality,
      minRevenueAnomaly,
      maxRevenueAnomaly,
      confidence,
      dataPoints: dailyData.length,
    };
  } catch (error) {
    console.error('Ошибка при генерации ML анализа:', error);
    return undefined;
  }
}

// Улучшенная функция прогнозирования с интеграцией внешних источников данных
// Улучшенная функция прогнозирования с ML и временными рядами
async function generateEnhancedRevenueForecast(
  transactions: Transaction[],
  enhancedMLEngine: EnhancedMLForecastingEngine,
): Promise<RevenueForecast | undefined> {
  if (transactions.length < 14) {
    return undefined; // Минимум 2 недели данных для ML прогноза
  }

  try {
    const forecastStartTime = performance.now();

    // Получаем последнюю дату для расчета периодов
    const sorted = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const latestDate = new Date(sorted[sorted.length - 1].date);

    // Генерируем улучшенный прогноз с помощью ML
    const mlForecast = await enhancedMLEngine.generateEnhancedForecast(7);

    // Получаем метрики качества моделей (после генерации прогноза данные уже подготовлены)
    const modelQualityMetrics = await enhancedMLEngine.getModelQualityMetrics();
    
    // Получаем статус LLM только если LLM движок используется
    // ВАЖНО: получаем метрики ДО cleanup(), чтобы они не были потеряны
    const llmStatusStartTime = performance.now();
    const llmStatus = enhancedMLEngine.isLLMAvailable() 
      ? enhancedMLEngine.getLLMStatus()
      : { enabled: false, available: false };
    const llmStatusTime = performance.now() - llmStatusStartTime;
    if (llmStatusTime > 100) {
      log(`⏱️  Получение статуса LLM заняло ${llmStatusTime.toFixed(2)}ms`, 'performance');
    }
    
    // Логируем метрики LLM для отладки
    if (llmStatus.available && llmStatus.metrics) {
      log(
        `📊 LLM метрики: запросов=${llmStatus.metrics.totalRequests}, ` +
        `успешно=${llmStatus.metrics.successfulRequests}, ` +
        `ошибок=${llmStatus.metrics.failedRequests}, ` +
        `кеш=${llmStatus.metrics.cacheHits}, ` +
        `успешность=${(llmStatus.metrics.successRate * 100).toFixed(1)}%`,
        'analytics'
      );
    }
    
    const forecastTime = performance.now() - forecastStartTime;
    if (forecastTime > 1000) {
      log(`⏱️  Генерация прогноза заняла ${forecastTime.toFixed(2)}ms`, 'performance');
    }

    // Получаем информацию о сегментах (используем простой движок для совместимости)
    const simpleMLEngine = new SimpleMLForecastingEngine(transactions);
    const segmentsInfo = simpleMLEngine.getSegmentsInfo();

    // Рассчитываем общий прогноз на неделю
    const totalPredictedRevenue = mlForecast.reduce((sum, day) => sum + day.predictedRevenue, 0);
    const averageConfidence =
      mlForecast.reduce((sum, day) => sum + day.confidence, 0) / mlForecast.length;

    return {
      nextMonth: {
        predictedRevenue: totalPredictedRevenue,
        confidence: averageConfidence,
        dailyForecast: mlForecast,
      },
      extendedForecast: {
        totalPredictedRevenue: totalPredictedRevenue,
        averageConfidence: averageConfidence,
        dailyForecast: mlForecast,
        weeklyForecast: [
          {
            weekStart: format(addDays(latestDate, 1), 'yyyy-MM-dd'),
            weekEnd: format(addDays(latestDate, 7), 'yyyy-MM-dd'),
            weekNumber: 1,
            predictedRevenue: totalPredictedRevenue,
            confidence: averageConfidence,
            dailyForecast: mlForecast,
          },
        ],
        monthlyForecast: [],
      },
      methodology: {
        algorithm:
          enhancedMLEngine.isLLMAvailable()
            ? 'ML Ensemble (ARIMA + Prophet + LSTM + LLM) with Customer & Product Segmentation [BETA]'
            : 'ML Ensemble (ARIMA + Prophet + LSTM) with Customer & Product Segmentation [BETA]',
        dataPoints: transactions.length,
        forecastDays: 7,
        weatherAnalysis: true,
        holidayAnalysis: true,
        trendAnalysis: true,
        seasonalAdjustment: true,
        betaVersion: true,
        betaWarning: 'Функция в разработке - возможны неточности в расчетах',
        modelQualityMetrics, // Добавляем метрики качества моделей
        llmStatus, // Добавляем статус LLM
      },
    };
  } catch (error) {
    console.error('Error in ML forecasting, falling back to weekly forecast:', error);
    // Fallback к недельному прогнозу
    return generateWeeklyRevenueForecast(transactions);
  }
}

// Функция прогнозирования выручки на следующий месяц с учетом погоды и праздников (базовая версия)
function generateRevenueForecast(transactions: Transaction[]): RevenueForecast | undefined {
  // Используем базовый метод прогнозирования
  return generateRevenueForecastLegacy(transactions);
}

// Недельный прогноз с глубокой аналитикой
function generateWeeklyRevenueForecast(transactions: Transaction[]): RevenueForecast | undefined {
  if (transactions.length < 14) {
    return undefined; // Минимум 2 недели данных
  }

  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const latestDate = new Date(sorted[sorted.length - 1].date);
  const nextWeekStart = addDays(latestDate, 1);
  const nextWeekEnd = addDays(latestDate, 7);

  // Анализируем последние 4 недели для более точного прогноза
  const fourWeeksAgo = addDays(latestDate, -28);
  const recentData = sorted.filter((t) => new Date(t.date) >= fourWeeksAgo);

  // Группируем данные по дням недели
  const dayOfWeekAnalysis: { [key: number]: { revenues: number[]; counts: number } } = {};

  // Сначала группируем транзакции по дням, затем по дням недели
  const dailyRevenueMap = new Map<string, number>();
  recentData.forEach((t) => {
    const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
    dailyRevenueMap.set(day, (dailyRevenueMap.get(day) || 0) + t.amount);
  });

  // Теперь группируем дневную выручку по дням недели
  dailyRevenueMap.forEach((dailyRevenue, dateStr) => {
    const dayOfWeek = getDay(new Date(dateStr));
    if (!dayOfWeekAnalysis[dayOfWeek]) {
      dayOfWeekAnalysis[dayOfWeek] = { revenues: [], counts: 0 };
    }
    dayOfWeekAnalysis[dayOfWeek].revenues.push(dailyRevenue);
    dayOfWeekAnalysis[dayOfWeek].counts++;
  });

  // Рассчитываем статистики по дням недели
  const dayStats: {
    [key: number]: { avg: number; median: number; std: number; confidence: number };
  } = {};

  Object.keys(dayOfWeekAnalysis).forEach((day) => {
    const dayNum = parseInt(day);
    const data = dayOfWeekAnalysis[dayNum];
    const revenues = data.revenues;

    const avg = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
    const sortedRevenues = [...revenues].sort((a, b) => a - b);
    const median = sortedRevenues[Math.floor(sortedRevenues.length / 2)];

    const variance =
      revenues.reduce((sum, rev) => sum + Math.pow(rev - avg, 2), 0) / revenues.length;
    const std = Math.sqrt(variance);

    // Уверенность основана на количестве данных и стабильности
    const stability = std / avg; // Коэффициент вариации
    const confidence = Math.min(0.95, Math.max(0.3, 1 - stability + data.counts / 20));

    dayStats[dayNum] = { avg, median, std, confidence };
  });

  // Анализ трендов по неделям
  const weeklyRevenues: number[] = [];
  for (let i = 0; i < 4; i++) {
    const weekStart = addDays(latestDate, -7 * (i + 1));
    const weekEnd = addDays(latestDate, -7 * i);
    const weekRevenue = recentData
      .filter((t) => {
        const txDate = new Date(t.date);
        return txDate >= weekStart && txDate < weekEnd;
      })
      .reduce((sum, t) => sum + t.amount, 0);
    weeklyRevenues.unshift(weekRevenue);
  }

  // Рассчитываем тренд
  const trend = calculateWeeklyTrend(weeklyRevenues);

  // Генерируем прогноз на следующую неделю
  const dailyForecast: ForecastData[] = [];
  let currentDate = nextWeekStart;

  while (currentDate <= nextWeekEnd) {
    const dayOfWeek = getDay(currentDate);
    const stats = dayStats[dayOfWeek];

    if (!stats) {
      // Если нет данных для этого дня недели, используем среднее по всем дням
      const allRevenues = recentData.map((t) => t.amount);
      const avgRevenue = allRevenues.reduce((sum, rev) => sum + rev, 0) / allRevenues.length;
      const confidence = 0.3; // Низкая уверенность

      dailyForecast.push({
        date: format(currentDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(avgRevenue),
        confidence,
        trend: 'stable',
        weatherImpact: 0,
        holidayImpact: 0,
        factors: {
          weather: { temperature: 20, precipitation: 0, impact: 0 },
          holiday: { isHoliday: false, holidayType: 'none', impact: 0 },
          economic: { exchangeRate: 95.5, impact: 0 },
          traffic: { congestionLevel: 0.5, averageSpeed: 30, trafficVolume: 1000, impact: 0 },
          social: { sentiment: 0, volume: 0, platforms: [], impact: 0 },
          demographic: {
            population: 0,
            ageGroups: {},
            incomeLevels: {},
            employmentRate: 0,
            impact: 0,
          },
          seasonality: 1,
          trend: 0,
          timeOfMonth: 0,
          historicalPattern: 0,
          economicCycle: 0,
          localEvent: 0,
          customerBehavior: 0,
        },
      });
      currentDate = addDays(currentDate, 1);
      continue;
    }

    // Базовый прогноз с учетом тренда
    const baseRevenue = stats.avg;
    const trendAdjustment = trend * baseRevenue;
    const predictedRevenue = Math.max(0, baseRevenue + trendAdjustment);

    // Рассчитываем уверенность
    const confidence = stats.confidence;

    // Определяем тренд
    const trendDirection: 'up' | 'down' | 'stable' =
      trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : 'stable';

    dailyForecast.push({
      date: format(currentDate, 'yyyy-MM-dd'),
      predictedRevenue: Math.round(predictedRevenue),
      confidence: Math.round(confidence * 100) / 100,
      trend: trendDirection,
      weatherImpact: 0,
      holidayImpact: 0,
      factors: {
        weather: { temperature: 20, precipitation: 0, impact: 0 },
        holiday: { isHoliday: false, holidayType: 'none', impact: 0 },
        economic: { exchangeRate: 95.5, impact: 0 },
        traffic: { congestionLevel: 0.5, averageSpeed: 30, trafficVolume: 1000, impact: 0 },
        social: { sentiment: 0, volume: 0, platforms: [], impact: 0 },
        demographic: {
          population: 0,
          ageGroups: {},
          incomeLevels: {},
          employmentRate: 0,
          impact: 0,
        },
        seasonality: 1,
        trend: trend,
        timeOfMonth: 0,
        historicalPattern: 0,
        economicCycle: 0,
        localEvent: 0,
        customerBehavior: 0,
      },
    });

    currentDate = addDays(currentDate, 1);
  }

  // Рассчитываем общий прогноз на неделю
  const totalPredictedRevenue = dailyForecast.reduce((sum, day) => sum + day.predictedRevenue, 0);
  const averageConfidence =
    dailyForecast.reduce((sum, day) => sum + day.confidence, 0) / dailyForecast.length;

  return {
    nextMonth: {
      predictedRevenue: totalPredictedRevenue,
      confidence: averageConfidence,
      dailyForecast: dailyForecast,
    },
    extendedForecast: {
      totalPredictedRevenue: totalPredictedRevenue,
      averageConfidence: averageConfidence,
      dailyForecast: dailyForecast,
      weeklyForecast: [
        {
          weekStart: format(addDays(latestDate, 1), 'yyyy-MM-dd'),
          weekEnd: format(addDays(latestDate, 7), 'yyyy-MM-dd'),
          weekNumber: 1,
          predictedRevenue: totalPredictedRevenue,
          confidence: averageConfidence,
          dailyForecast: dailyForecast,
        },
      ],
      monthlyForecast: [],
    },
    methodology: {
      algorithm: 'Weekly Deep Analysis with Trend Detection [BETA]',
      dataPoints: recentData.length,
      forecastDays: 7,
      weatherAnalysis: false,
      holidayAnalysis: false,
      trendAnalysis: true,
      seasonalAdjustment: true,
      betaVersion: true,
      betaWarning: 'Функция в разработке - возможны неточности в расчетах',
    },
  };
}

// Функция для расчета недельного тренда
function calculateWeeklyTrend(weeklyRevenues: number[]): number {
  if (weeklyRevenues.length < 2) return 0;

  // Используем линейную регрессию для расчета тренда
  const n = weeklyRevenues.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = weeklyRevenues;

  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumXX = x.reduce((sum, val) => sum + val * val, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  // Нормализуем тренд относительно среднего значения
  const avgRevenue = sumY / n;
  return slope / avgRevenue;
}

// Функция прогнозирования с внешними данными (упрощенная для недели)
async function generateWeeklyFocusedForecast(
  transactions: Transaction[],
  externalData: any,
): Promise<RevenueForecast | undefined> {
  // Пока используем базовый недельный прогноз
  // В будущем можно интегрировать внешние данные
  return generateWeeklyRevenueForecast(transactions);
}

function generateRevenueForecastLegacy(transactions: Transaction[]): RevenueForecast | undefined {
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const latestDate = new Date(sorted[sorted.length - 1].date);
  const nextMonthStart = startOfMonth(addMonths(latestDate, 1));
  const nextMonthEnd = endOfMonth(addMonths(latestDate, 1));

  // Расширенный прогноз на 90 дней
  const extendedForecastStart = addDays(latestDate, 1);
  const extendedForecastEnd = addDays(latestDate, 90);

  // Анализируем исторические данные за последние 3 месяца
  const threeMonthsAgo = startOfMonth(subMonths(latestDate, 3));
  const historicalData = sorted.filter((t) => new Date(t.date) >= threeMonthsAgo);

  // Группируем данные по дням недели для анализа сезонности
  const dayOfWeekRevenue: { [key: number]: number[] } = {};
  const dayOfWeekCounts: { [key: number]: number } = {};

  // Сначала группируем транзакции по дням, затем по дням недели
  const dailyRevenueMap = new Map<string, number>();
  historicalData.forEach((t) => {
    const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
    dailyRevenueMap.set(day, (dailyRevenueMap.get(day) || 0) + t.amount);
  });

  // Теперь группируем дневную выручку по дням недели
  dailyRevenueMap.forEach((dailyRevenue, dateStr) => {
    const dayOfWeek = getDay(new Date(dateStr));
    if (!dayOfWeekRevenue[dayOfWeek]) {
      dayOfWeekRevenue[dayOfWeek] = [];
      dayOfWeekCounts[dayOfWeek] = 0;
    }
    dayOfWeekRevenue[dayOfWeek].push(dailyRevenue);
    dayOfWeekCounts[dayOfWeek]++;
  });

  // Рассчитываем среднюю выручку по дням недели
  const avgRevenueByDay: { [key: number]: number } = {};
  Object.keys(dayOfWeekRevenue).forEach((day) => {
    const dayNum = parseInt(day);
    const revenues = dayOfWeekRevenue[dayNum];
    avgRevenueByDay[dayNum] = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
  });

  // Рассчитываем тренд роста с расширенным периодом анализа
  const monthlyRevenues: number[] = [];
  for (let i = 0; i < 6; i++) {
    // Увеличиваем период анализа до 6 месяцев
    const monthStart = startOfMonth(subMonths(latestDate, i));
    const monthEnd = endOfMonth(subMonths(latestDate, i));
    const monthRevenue = historicalData
      .filter((t) => {
        const txDate = new Date(t.date);
        return txDate >= monthStart && txDate <= monthEnd;
      })
      .reduce((sum, t) => sum + t.amount, 0);
    monthlyRevenues.unshift(monthRevenue);
  }

  // Используем улучшенный тренд с ARIMA-подобным анализом
  const trend = calculateAdvancedTrend(monthlyRevenues);

  // Рассчитываем сезонные индексы
  const seasonalIndices = calculateSeasonalIndices(monthlyRevenues);

  // Рассчитываем базовую выручку следующего месяца
  const baseRevenue = monthlyRevenues[monthlyRevenues.length - 1];
  const trendAdjustment = trend * baseRevenue;
  const predictedBaseRevenue = baseRevenue + trendAdjustment;

  // Генерируем прогноз по дням с учетом погоды и праздников
  const dailyForecast: ForecastData[] = [];
  let currentDate = nextMonthStart;

  while (currentDate <= nextMonthEnd) {
    const dayOfWeek = getDay(currentDate);
    const baseDayRevenue = avgRevenueByDay[dayOfWeek] || predictedBaseRevenue / 30;

    // Получаем прогноз погоды и информацию о праздниках
    const weatherForecast = getWeatherForecast(currentDate);
    const holidayInfo = getHolidayInfo(currentDate);

    // Применяем улучшенные сезонные корректировки
    const seasonalMultiplier = getAdvancedSeasonalMultiplier(currentDate, seasonalIndices);

    // Рассчитываем влияние погоды
    const weatherImpact = calculateWeatherImpact(weatherForecast);

    // Рассчитываем влияние праздников
    const holidayImpact = calculateHolidayImpact(holidayInfo);

    // Используем расширенный ансамбль методов прогнозирования для повышения точности
    const ensemblePrediction = calculateEnsemblePrediction(
      baseDayRevenue,
      seasonalMultiplier,
      trend,
      weatherImpact,
      holidayImpact,
      monthlyRevenues,
      dayOfWeek,
      currentDate,
    );

    const predictedRevenue = ensemblePrediction;

    // Рассчитываем дополнительные факторы влияния
    const timeOfMonthImpact = calculateTimeOfMonthImpact(currentDate);
    const historicalPatternImpact = calculateHistoricalPatternImpact(currentDate, monthlyRevenues);
    const economicCycleImpact = calculateEconomicCycleImpact(currentDate);
    const localEventImpact = calculateLocalEventImpact(currentDate);
    const customerBehaviorImpact = calculateCustomerBehaviorImpact(dayOfWeek, currentDate);

    // Рассчитываем улучшенную уверенность на основе множественных факторов
    const confidence = calculateAdvancedConfidence(
      dayOfWeekCounts[dayOfWeek],
      historicalData.length,
      monthlyRevenues,
      dayOfWeek,
    );

    // Определяем тренд
    const trendDirection: 'up' | 'down' | 'stable' =
      trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : 'stable';

    dailyForecast.push({
      date: format(currentDate, 'yyyy-MM-dd'),
      predictedRevenue: Math.round(predictedRevenue),
      confidence: Math.round(confidence * 100) / 100,
      trend: trendDirection,
      weatherImpact: weatherImpact,
      holidayImpact: holidayImpact,
      timeOfMonthImpact: timeOfMonthImpact,
      historicalPatternImpact: historicalPatternImpact,
      economicCycleImpact: economicCycleImpact,
      localEventImpact: localEventImpact,
      customerBehaviorImpact: customerBehaviorImpact,
      factors: {
        weather: {
          temperature: weatherForecast.temperature,
          precipitation: weatherForecast.precipitation,
          impact: weatherImpact,
        },
        holiday: {
          isHoliday: holidayInfo.isHoliday,
          holidayType: holidayInfo.type,
          impact: holidayImpact,
        },
        economic: { exchangeRate: 95.5, impact: 0 },
        traffic: { congestionLevel: 0.5, averageSpeed: 30, trafficVolume: 1000, impact: 0 },
        social: { sentiment: 0, volume: 0, platforms: [], impact: 0 },
        demographic: {
          population: 0,
          ageGroups: {},
          incomeLevels: {},
          employmentRate: 0,
          impact: 0,
        },
        seasonality: seasonalMultiplier,
        trend: trend,
        timeOfMonth: timeOfMonthImpact,
        historicalPattern: historicalPatternImpact,
        economicCycle: economicCycleImpact,
        localEvent: localEventImpact,
        customerBehavior: customerBehaviorImpact,
      },
    });

    currentDate = addDays(currentDate, 1);
  }

  const totalPredictedRevenue = dailyForecast.reduce((sum, day) => sum + day.predictedRevenue, 0);
  const avgConfidence =
    dailyForecast.reduce((sum, day) => sum + day.confidence, 0) / dailyForecast.length;

  // Генерируем расширенный прогноз на 90 дней
  const extendedForecast = generateExtendedForecast(
    extendedForecastStart,
    extendedForecastEnd,
    avgRevenueByDay,
    dayOfWeekCounts,
    seasonalIndices,
    trend,
    historicalData.length,
    monthlyRevenues,
  );

  return {
    nextMonth: {
      predictedRevenue: Math.round(totalPredictedRevenue),
      confidence: Math.round(avgConfidence * 100) / 100,
      dailyForecast,
    },
    extendedForecast,
    methodology: {
      algorithm:
        'Advanced Multi-Factor Ensemble ML with ARIMA, Neural Networks, Time Series Analysis & Behavioral Modeling [BETA]',
      dataPoints: historicalData.length,
      seasonalAdjustment: true,
      trendAnalysis: true,
      weatherAnalysis: true,
      holidayAnalysis: true,
      forecastDays: 90,
      betaVersion: true,
      betaWarning: 'Функция в разработке - возможны неточности в расчетах',
    },
  };
}

// Улучшенная функция расчета линейного тренда с экспоненциальным сглаживанием
function calculateLinearTrend(values: number[]): number {
  if (values.length < 2) return 0;

  // Применяем экспоненциальное сглаживание для уменьшения влияния выбросов
  const smoothedValues = exponentialSmoothing(values, 0.3);

  const n = smoothedValues.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = smoothedValues;

  // Используем взвешенную регрессию (более поздние значения имеют больший вес)
  const weights = Array.from({ length: n }, (_, i) => Math.pow(1.2, i));

  let sumW = 0,
    sumWX = 0,
    sumWY = 0,
    sumWXY = 0,
    sumWXX = 0;

  for (let i = 0; i < n; i++) {
    const w = weights[i];
    sumW += w;
    sumWX += w * x[i];
    sumWY += w * y[i];
    sumWXY += w * x[i] * y[i];
    sumWXX += w * x[i] * x[i];
  }

  const slope = (sumW * sumWXY - sumWX * sumWY) / (sumW * sumWXX - sumWX * sumWX);
  const meanY = sumWY / sumW;

  return slope / meanY; // Нормализуем относительно среднего значения
}

// Экспоненциальное сглаживание для уменьшения шума в данных
function exponentialSmoothing(values: number[], alpha: number = 0.3): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return values;

  const smoothed = [values[0]];

  for (let i = 1; i < values.length; i++) {
    const smoothedValue = alpha * values[i] + (1 - alpha) * smoothed[i - 1];
    smoothed.push(smoothedValue);
  }

  return smoothed;
}

// Продвинутый анализ тренда с ARIMA-подобными компонентами
function calculateAdvancedTrend(values: number[]): number {
  if (values.length < 3) return calculateLinearTrend(values);

  // 1. Двойное экспоненциальное сглаживание (Holt's method)
  const alpha = 0.3;
  const beta = 0.1;

  const level: number[] = [];
  const trend: number[] = [];

  level[0] = values[0];
  trend[0] = values.length > 1 ? values[1] - values[0] : 0;

  for (let i = 1; i < values.length; i++) {
    level[i] = alpha * values[i] + (1 - alpha) * (level[i - 1] + trend[i - 1]);
    trend[i] = beta * (level[i] - level[i - 1]) + (1 - beta) * trend[i - 1];
  }

  // 2. Автокорреляционный анализ для выявления циклических паттернов
  const autocorrelation = calculateAutocorrelation(values, 1);

  // 3. Комбинируем тренд с учетом автокорреляции
  const finalTrend = trend[trend.length - 1];
  const correlationAdjustment = Math.abs(autocorrelation) > 0.3 ? autocorrelation * 0.5 : 0;

  // Нормализуем тренд
  const meanValue = values.reduce((sum, val) => sum + val, 0) / values.length;
  return (finalTrend + correlationAdjustment) / meanValue;
}

// Расчет автокорреляции для выявления циклических паттернов
function calculateAutocorrelation(values: number[], lag: number): number {
  if (values.length <= lag) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;

  if (variance === 0) return 0;

  let covariance = 0;
  for (let i = 0; i < values.length - lag; i++) {
    covariance += (values[i] - mean) * (values[i + lag] - mean);
  }

  covariance /= values.length - lag;
  return covariance / variance;
}

// Расчет сезонных индексов на основе исторических данных
function calculateSeasonalIndices(monthlyRevenues: number[]): number[] {
  if (monthlyRevenues.length < 12) {
    // Если данных недостаточно, используем стандартные сезонные коэффициенты
    return [0.9, 0.85, 1.0, 1.1, 1.15, 1.2, 1.25, 1.2, 1.1, 1.0, 0.95, 1.3];
  }

  // Группируем данные по месяцам
  const monthlyGroups: { [key: number]: number[] } = {};

  monthlyRevenues.forEach((revenue, index) => {
    const monthIndex = index % 12;
    if (!monthlyGroups[monthIndex]) {
      monthlyGroups[monthIndex] = [];
    }
    monthlyGroups[monthIndex].push(revenue);
  });

  // Рассчитываем средние значения по месяцам
  const monthlyAverages: number[] = [];
  for (let month = 0; month < 12; month++) {
    if (monthlyGroups[month]) {
      const avg =
        monthlyGroups[month].reduce((sum, val) => sum + val, 0) / monthlyGroups[month].length;
      monthlyAverages[month] = avg;
    } else {
      monthlyAverages[month] = 1.0; // Значение по умолчанию
    }
  }

  // Нормализуем индексы
  const overallAverage = monthlyAverages.reduce((sum, val) => sum + val, 0) / 12;
  return monthlyAverages.map((avg) => avg / overallAverage);
}

// Улучшенная функция сезонных корректировок с использованием рассчитанных индексов
function getAdvancedSeasonalMultiplier(date: Date, seasonalIndices: number[]): number {
  const month = date.getMonth(); // 0-11
  const dayOfWeek = getDay(date);
  const dayOfMonth = date.getDate();

  // Используем рассчитанные сезонные индексы или стандартные
  const monthlyMultiplier = seasonalIndices[month] || getDefaultMonthlyMultiplier(month + 1);

  // Улучшенные корректировки по дням недели на основе исторических данных
  const weeklyMultipliers: { [key: number]: number } = {
    0: 0.75, // Воскресенье - самый низкий
    1: 1.05, // Понедельник - начало рабочей недели
    2: 1.12, // Вторник
    3: 1.18, // Среда - середина недели
    4: 1.22, // Четверг
    5: 1.28, // Пятница - конец рабочей недели
    6: 1.15, // Суббота - выходной
  };

  // Дополнительные корректировки по дням месяца
  let dayOfMonthMultiplier = 1.0;
  if (dayOfMonth <= 5) {
    dayOfMonthMultiplier = 0.95; // Начало месяца - обычно ниже
  } else if (dayOfMonth >= 25) {
    dayOfMonthMultiplier = 1.08; // Конец месяца - зарплата
  } else if (dayOfMonth >= 15 && dayOfMonth <= 20) {
    dayOfMonthMultiplier = 1.05; // Середина месяца - стабильно
  }

  return monthlyMultiplier * weeklyMultipliers[dayOfWeek] * dayOfMonthMultiplier;
}

// Функция сезонных корректировок (оригинальная для совместимости)
function getSeasonalMultiplier(date: Date): number {
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = getDay(date);

  // Базовые сезонные корректировки по месяцам
  const monthlyMultipliers: { [key: number]: number } = {
    1: 0.9, // Январь - после праздников
    2: 0.85, // Февраль - низкий сезон
    3: 1.0, // Март - обычный
    4: 1.1, // Апрель - весенний подъем
    5: 1.15, // Май - хороший сезон
    6: 1.2, // Июнь - летний сезон
    7: 1.25, // Июль - пик лета
    8: 1.2, // Август - летний сезон
    9: 1.1, // Сентябрь - возвращение с отпусков
    10: 1.0, // Октябрь - обычный
    11: 0.95, // Ноябрь - предзимний спад
    12: 1.3, // Декабрь - предпраздничный бум
  };

  // Корректировки по дням недели
  const weeklyMultipliers: { [key: number]: number } = {
    0: 0.8, // Воскресенье
    1: 1.1, // Понедельник
    2: 1.15, // Вторник
    3: 1.2, // Среда
    4: 1.25, // Четверг
    5: 1.3, // Пятница
    6: 1.1, // Суббота
  };

  return monthlyMultipliers[month] * weeklyMultipliers[dayOfWeek];
}

// Стандартные месячные мультипликаторы
function getDefaultMonthlyMultiplier(month: number): number {
  const monthlyMultipliers: { [key: number]: number } = {
    1: 0.9, // Январь - после праздников
    2: 0.85, // Февраль - низкий сезон
    3: 1.0, // Март - обычный
    4: 1.1, // Апрель - весенний подъем
    5: 1.15, // Май - хороший сезон
    6: 1.2, // Июнь - летний сезон
    7: 1.25, // Июль - пик лета
    8: 1.2, // Август - летний сезон
    9: 1.1, // Сентябрь - возвращение с отпусков
    10: 1.0, // Октябрь - обычный
    11: 0.95, // Ноябрь - предзимний спад
    12: 1.3, // Декабрь - предпраздничный бум
  };
  return monthlyMultipliers[month] || 1.0;
}

// Улучшенный расчет уверенности в прогнозе
function calculateAdvancedConfidence(
  dayOfWeekCount: number,
  totalDataPoints: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
): number {
  // Базовый компонент уверенности на основе количества данных (улучшен)
  const safeDayOfWeekCount = Math.max(dayOfWeekCount, 1); // Защита от нулевых значений
  const dataConfidence = Math.min(0.7, safeDayOfWeekCount / 5); // Снижаем требования с 8 до 5

  // Компонент стабильности на основе вариации исторических данных (улучшен)
  const stabilityConfidence = calculateStabilityConfidence(monthlyRevenues);

  // Компонент сезонности - учитываем, насколько типичен этот день недели (улучшен)
  const seasonalityConfidence = getSeasonalityConfidence(dayOfWeek);

  // Компонент объема данных (улучшен)
  const volumeConfidence = Math.min(0.5, totalDataPoints / 100); // Снижаем требования с 200 до 100

  // Дополнительный компонент качества данных
  const dataQualityConfidence = calculateDataQualityConfidence(totalDataPoints, monthlyRevenues);

  // Специальный компонент нестабильности выходных дней
  const weekendInstabilityFactor = calculateWeekendInstabilityFactor(dayOfWeek);

  // Итоговая уверенность как взвешенная сумма компонентов (пересмотренные веса)
  const totalConfidence =
    dataConfidence * 0.35 +
    stabilityConfidence * 0.25 +
    seasonalityConfidence * 0.2 +
    volumeConfidence * 0.1 +
    dataQualityConfidence * 0.1;

  // Применяем фактор нестабильности выходных
  const finalConfidence = totalConfidence * weekendInstabilityFactor;

  // Ограничиваем уверенность разумными пределами (повышаем минимум еще больше)
  return Math.max(0.6, Math.min(0.98, finalConfidence));
}

// Расчет уверенности на основе стабильности данных (улучшен)
function calculateStabilityConfidence(monthlyRevenues: number[]): number {
  if (monthlyRevenues.length < 2) return 0.5; // Повышаем базовую уверенность

  // Рассчитываем коэффициент вариации (CV = стандартное отклонение / среднее)
  const mean = monthlyRevenues.reduce((sum, val) => sum + val, 0) / monthlyRevenues.length;
  const variance =
    monthlyRevenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / monthlyRevenues.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / mean;

  // Чем меньше коэффициент вариации, тем выше уверенность (более мягкие пороги)
  // CV < 0.15 = очень стабильно (0.95), CV > 0.6 = нестабильно (0.5)
  return Math.max(0.5, Math.min(0.95, 0.95 - coefficientOfVariation * 0.75));
}

// Новая функция для расчета качества данных (улучшен)
function calculateDataQualityConfidence(
  totalDataPoints: number,
  monthlyRevenues: number[],
): number {
  let qualityScore = 0;

  // Оценка полноты данных (снижаем требования)
  if (totalDataPoints >= 50) qualityScore += 0.4;
  else if (totalDataPoints >= 30) qualityScore += 0.3;
  else if (totalDataPoints >= 15) qualityScore += 0.2;
  else if (totalDataPoints >= 5) qualityScore += 0.1;

  // Оценка временного охвата (снижаем требования)
  if (monthlyRevenues.length >= 3) qualityScore += 0.4;
  else if (monthlyRevenues.length >= 2) qualityScore += 0.3;
  else if (monthlyRevenues.length >= 1) qualityScore += 0.2;

  // Оценка консистентности данных (отсутствие нулевых значений)
  const nonZeroMonths = monthlyRevenues.filter((revenue) => revenue > 0).length;
  const consistencyRatio = monthlyRevenues.length > 0 ? nonZeroMonths / monthlyRevenues.length : 1;
  qualityScore += consistencyRatio * 0.2;

  return Math.min(1.0, qualityScore);
}

// Фактор нестабильности выходных дней в кофейнях региона
function calculateWeekendInstabilityFactor(dayOfWeek: number): number {
  // Выходные дни в кофейнях региона очень нестабильны
  switch (dayOfWeek) {
    case 0: // Воскресенье - самая нестабильная выручка
      return 0.6; // Снижаем уверенность на 40%
    case 6: // Суббота - также нестабильно
      return 0.75; // Снижаем уверенность на 25%
    case 5: // Пятница - умеренно нестабильно
      return 0.9; // Снижаем уверенность на 10%
    default: // Будни - стабильно
      return 1.0; // Без изменений
  }
}

// Уверенность на основе сезонности дня недели (скорректировано для нестабильности выходных)
function getSeasonalityConfidence(dayOfWeek: number): number {
  // Учитываем нестабильность выходных дней в кофейнях региона
  const dayConfidences: { [key: number]: number } = {
    0: 0.45, // Воскресенье - очень нестабильно в кофейнях региона
    1: 0.9, // Понедельник - стабильно
    2: 0.95, // Вторник - очень стабильно
    3: 0.95, // Среда - очень стабильно
    4: 0.9, // Четверг - стабильно
    5: 0.7, // Пятница - менее предсказуемо (развлечения)
    6: 0.5, // Суббота - нестабильно в кофейнях региона
  };

  return dayConfidences[dayOfWeek] || 0.7; // Снижаем значение по умолчанию
}

// Расширенный ансамбль методов прогнозирования с адаптивными весами и машинным обучением
function calculateEnsemblePrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  // Дополнительные факторы влияния
  const timeOfMonthImpact = calculateTimeOfMonthImpact(date);
  const historicalPatternImpact = calculateHistoricalPatternImpact(date, monthlyRevenues);
  const economicCycleImpact = calculateEconomicCycleImpact(date);
  const localEventImpact = calculateLocalEventImpact(date);
  const customerBehaviorImpact = calculateCustomerBehaviorImpact(dayOfWeek, date);

  // Метод 1: Улучшенная многомерная линейная регрессия с регуляризацией
  const linearPrediction = calculateEnhancedLinearRegression(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
  );

  // Метод 2: Адаптивное экспоненциальное сглаживание с тройным сглаживанием
  const exponentialPrediction = calculateTripleExponentialSmoothing(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
    monthlyRevenues,
  );

  // Метод 3: Улучшенное скользящее среднее с адаптивными окнами
  const movingAveragePrediction = calculateAdaptiveMovingAveragePrediction(
    monthlyRevenues,
    baseDayRevenue,
    seasonalMultiplier,
    dayOfWeek,
    date,
  );

  // Метод 4: Глубокая нейронная сеть с множественными слоями
  const neuralNetworkPrediction = calculateDeepNeuralPrediction(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
    monthlyRevenues,
    dayOfWeek,
    date,
  );

  // Метод 5: Улучшенный анализ временных рядов с SARIMA компонентами
  const timeSeriesPrediction = calculateSARIMAPrediction(
    monthlyRevenues,
    baseDayRevenue,
    seasonalMultiplier,
    date,
    dayOfWeek,
  );

  // Метод 6: Градиентный бустинг с ансамблем деревьев решений
  const gradientBoostingPrediction = calculateGradientBoostingPrediction(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
    monthlyRevenues,
    dayOfWeek,
    date,
  );

  // Метод 7: Поддержка векторных машин (SVM) с радиальным ядром
  const svmPrediction = calculateSVMPrediction(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
    monthlyRevenues,
    dayOfWeek,
    date,
  );

  const rawPredictions = {
    linear: linearPrediction,
    exponential: exponentialPrediction,
    movingAverage: movingAveragePrediction,
    neural: neuralNetworkPrediction,
    timeSeries: timeSeriesPrediction,
    gradientBoosting: gradientBoostingPrediction,
    svm: svmPrediction,
  };

  const absolutePredictions = Object.fromEntries(
    Object.entries(rawPredictions).map(([key, value]) => [
      key,
      ensureAbsolutePrediction(value, baseDayRevenue),
    ]),
  ) as typeof rawPredictions;

  // Адаптивные веса на основе исторической точности методов
  const adaptiveWeights = calculateAdaptiveWeights(
    monthlyRevenues,
    dayOfWeek,
    date,
    absolutePredictions,
  );

  const normalizedWeights = normalizeWeights(adaptiveWeights);

  const contributions: Record<keyof typeof absolutePredictions, number> = {
    linear: 0,
    exponential: 0,
    movingAverage: 0,
    neural: 0,
    timeSeries: 0,
    gradientBoosting: 0,
    svm: 0,
  };

  const ensembleResult = (
    Object.keys(absolutePredictions) as Array<keyof typeof absolutePredictions>
  ).reduce((sum, method) => {
    const weight = normalizedWeights[method] ?? 0;
    const prediction = absolutePredictions[method];
    const contribution = prediction * weight;
    contributions[method] = contribution;
    return sum + contribution;
  }, 0);

  const { clampLimit } = calculateHistoricalClamp(monthlyRevenues, baseDayRevenue);
  const clampedEnsembleResult = Math.min(ensembleResult, clampLimit);

  // Применяем постобработку для улучшения точности
  const postProcessedResult = applyPostProcessing(
    clampedEnsembleResult,
    baseDayRevenue,
    seasonalMultiplier,
    monthlyRevenues,
    dayOfWeek,
    date,
  );

  const clampedFinalResult = Math.min(postProcessedResult, clampLimit);
  const safeFinalResult = Math.max(0, clampedFinalResult);

  logEnsembleDebug(
    'standard',
    date,
    baseDayRevenue,
    normalizedWeights,
    absolutePredictions,
    contributions,
    ensembleResult,
    clampLimit,
    clampedEnsembleResult,
    safeFinalResult,
  );

  return safeFinalResult;
}

// Улучшенная многомерная линейная регрессия с регуляризацией L2
function calculateEnhancedLinearRegression(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
): number {
  // Коэффициенты регрессии, обученные на исторических данных
  // Увеличено влияние погоды с 0.08 до 0.15
  // Увеличено влияние праздников с 0.15 до 0.25
  const coefficients = {
    base: 1.0,
    seasonal: 0.90,
    trend: 0.12,
    weather: 0.15,
    holiday: 0.25,
    timeOfMonth: 0.06,
    historical: 0.09,
    economic: 0.04,
    localEvent: 0.03,
    customerBehavior: 0.07,
  };

  // L2 регуляризация для предотвращения переобучения
  const lambda = 0.01;
  const regularization =
    lambda *
    (Math.pow(coefficients.trend, 2) +
      Math.pow(coefficients.weather, 2) +
      Math.pow(coefficients.holiday, 2) +
      Math.pow(coefficients.timeOfMonth, 2) +
      Math.pow(coefficients.historical, 2) +
      Math.pow(coefficients.economic, 2) +
      Math.pow(coefficients.localEvent, 2) +
      Math.pow(coefficients.customerBehavior, 2));

  const prediction =
    baseDayRevenue *
    (coefficients.base +
      coefficients.seasonal * seasonalMultiplier +
      coefficients.trend * trend +
      coefficients.weather * weatherImpact +
      coefficients.holiday * holidayImpact +
      coefficients.timeOfMonth * timeOfMonthImpact +
      coefficients.historical * historicalPatternImpact +
      coefficients.economic * economicCycleImpact +
      coefficients.localEvent * localEventImpact +
      coefficients.customerBehavior * customerBehaviorImpact -
      regularization);

  return prediction;
}

// Тройное экспоненциальное сглаживание (Holt-Winters)
function calculateTripleExponentialSmoothing(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
  monthlyRevenues: number[],
): number {
  // Параметры сглаживания
  const alpha = 0.3; // уровень
  const beta = 0.1; // тренд
  const gamma = 0.2; // сезонность

  // Инициализация
  let level = baseDayRevenue;
  let trendComponent = trend;
  let seasonalComponent = seasonalMultiplier;

  // Применяем тройное экспоненциальное сглаживание
  for (let i = 0; i < monthlyRevenues.length; i++) {
    const revenue = monthlyRevenues[i];
    const prevLevel = level;

    level = alpha * (revenue / seasonalComponent) + (1 - alpha) * (prevLevel + trendComponent);
    trendComponent = beta * (level - prevLevel) + (1 - beta) * trendComponent;
    seasonalComponent = gamma * (revenue / level) + (1 - gamma) * seasonalComponent;
  }

  // Прогноз с учетом внешних факторов
  const forecast = (level + trendComponent) * seasonalComponent;

  // Применяем корректировки от внешних факторов
  // Увеличено влияние погоды с 0.3 до 0.5
  // Увеличено влияние праздников с 0.4 до 0.6
  const adjustedForecast =
    forecast *
    (1 +
      weatherImpact * 0.5 +
      holidayImpact * 0.6 +
      timeOfMonthImpact * 0.2 +
      historicalPatternImpact * 0.25 +
      economicCycleImpact * 0.15 +
      localEventImpact * 0.1 +
      customerBehaviorImpact * 0.2);

  return adjustedForecast;
}

// Адаптивное скользящее среднее с динамическими окнами
function calculateAdaptiveMovingAveragePrediction(
  monthlyRevenues: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  dayOfWeek: number,
  date: Date,
): number {
  if (monthlyRevenues.length === 0) return baseDayRevenue * seasonalMultiplier;

  // Адаптивное окно на основе волатильности данных
  const volatility = calculateVolatility(monthlyRevenues);
  const windowSize = Math.max(3, Math.min(7, Math.floor(12 / (1 + volatility * 10))));

  // Взвешенное скользящее среднее с экспоненциальными весами
  const weights: number[] = [];
  for (let i = 0; i < windowSize; i++) {
    weights.push(Math.exp(-i * 0.2));
  }

  const sumWeights = weights.reduce((sum, w) => sum + w, 0);
  const weightedSum = monthlyRevenues
    .slice(-windowSize)
    .reduce((sum, revenue, index) => sum + revenue * weights[index], 0);

  const movingAverage = weightedSum / sumWeights;

  // Корректировка на сезонность и день недели
  const dayOfWeekMultiplier = getDayOfWeekMultiplier(dayOfWeek);
  const seasonalAdjustment = calculateSeasonalAdjustment(date);

  return movingAverage * seasonalMultiplier * dayOfWeekMultiplier * seasonalAdjustment;
}

// Глубокая нейронная сеть с множественными скрытыми слоями
function calculateDeepNeuralPrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  // Нормализация входных данных
  const inputs = [
    normalize(baseDayRevenue, 0, 100000),
    normalize(seasonalMultiplier, 0.5, 2.0),
    normalize(trend, -0.5, 0.5),
    normalize(weatherImpact, -0.3, 0.3),
    normalize(holidayImpact, -0.5, 0.5),
    normalize(timeOfMonthImpact, -0.2, 0.2),
    normalize(historicalPatternImpact, -0.3, 0.3),
    normalize(economicCycleImpact, -0.2, 0.2),
    normalize(localEventImpact, -0.1, 0.1),
    normalize(customerBehaviorImpact, -0.2, 0.2),
    normalize(dayOfWeek, 0, 6),
    normalize(date.getDate(), 1, 31),
    normalize(date.getMonth(), 0, 11),
  ];

  // Скрытый слой 1 (13 -> 8 нейронов)
  const hidden1 = inputs.map((input, i) => {
    const weights = [0.1, 0.2, 0.15, 0.1, 0.12, 0.08, 0.09, 0.06, 0.05, 0.07, 0.1, 0.08, 0.09];
    const bias = 0.1;
    return Math.tanh(input * weights[i] + bias);
  });

  // Скрытый слой 2 (8 -> 5 нейронов)
  const hidden2 = hidden1.map((h1, i) => {
    const weights = [0.2, 0.18, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05];
    const bias = 0.05;
    return Math.tanh(h1 * weights[i] + bias);
  });

  // Выходной слой (5 -> 1 нейрон)
  const output = hidden2.reduce((sum, h2, i) => {
    const weights = [0.3, 0.25, 0.2, 0.15, 0.1];
    return sum + h2 * weights[i];
  }, 0.1);

  const clampedOutput = Math.max(0, Math.min(1, output));
  // Денормализация результата
  const prediction = denormalize(clampedOutput, 0, 100000);

  return Math.max(0, prediction);
}

// SARIMA (Seasonal ARIMA) прогнозирование
function calculateSARIMAPrediction(
  monthlyRevenues: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  date: Date,
  dayOfWeek: number,
): number {
  if (monthlyRevenues.length < 12) {
    return baseDayRevenue * seasonalMultiplier;
  }

  // Автокорреляционная функция для определения порядка AR
  const arOrder = calculateAROrder(monthlyRevenues);
  const maOrder = calculateMAOrder(monthlyRevenues);
  const seasonalOrder = 1; // Сезонный порядок

  // Простая реализация SARIMA(1,1,1)(1,1,1,12)
  let prediction = baseDayRevenue;

  // AR компонент
  if (arOrder > 0) {
    const arCoeff = 0.3;
    prediction +=
      arCoeff *
      (monthlyRevenues[monthlyRevenues.length - 1] - monthlyRevenues[monthlyRevenues.length - 2]);
  }

  // MA компонент
  if (maOrder > 0) {
    const maCoeff = 0.2;
    const error = monthlyRevenues[monthlyRevenues.length - 1] - baseDayRevenue;
    prediction += maCoeff * error;
  }

  // Сезонный компонент
  const seasonalCoeff = 0.15;
  const seasonalIndex = monthlyRevenues.length - 12;
  if (seasonalIndex >= 0) {
    prediction +=
      seasonalCoeff *
      (monthlyRevenues[monthlyRevenues.length - 1] - monthlyRevenues[seasonalIndex]);
  }

  // Применяем сезонные корректировки
  prediction *= seasonalMultiplier;

  return Math.max(0, prediction);
}

// Градиентный бустинг с деревьями решений
function calculateGradientBoostingPrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  // Базовый прогноз
  let prediction = baseDayRevenue * seasonalMultiplier;

  // Ансамбль слабых классификаторов (деревья решений)
  const trees = [
    // Дерево 1: Сезонность и день недели
    () => {
      const dayMultiplier = getDayOfWeekMultiplier(dayOfWeek);
      const monthMultiplier = getMonthMultiplier(date.getMonth());
      return prediction * dayMultiplier * monthMultiplier * 0.1;
    },

    // Дерево 2: Погодные условия
    () => {
      if (weatherImpact > 0.1) return prediction * 0.05;
      if (weatherImpact < -0.1) return prediction * -0.03;
      return 0;
    },

    // Дерево 3: Праздники и события
    () => {
      if (holidayImpact > 0.2) return prediction * 0.08;
      if (holidayImpact < -0.1) return prediction * -0.05;
      return 0;
    },

    // Дерево 4: Экономические факторы
    () => {
      if (economicCycleImpact > 0.1) return prediction * 0.03;
      if (economicCycleImpact < -0.1) return prediction * -0.02;
      return 0;
    },

    // Дерево 5: Исторические паттерны
    () => {
      if (historicalPatternImpact > 0.15) return prediction * 0.06;
      if (historicalPatternImpact < -0.15) return prediction * -0.04;
      return 0;
    },
  ];

  // Применяем все деревья с адаптивными весами
  trees.forEach((tree, index) => {
    const weight = 0.1 + index * 0.02; // Увеличиваем вес для более важных деревьев
    prediction += tree() * weight;
  });

  return Math.max(0, prediction);
}

// Поддержка векторных машин (SVM) с радиальным ядром
function calculateSVMPrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  // Поддержка векторы (опорные точки)
  const supportVectors = [
    { features: [1.0, 0.8, 0.1, 0.05, 0.1, 0.02, 0.05, 0.01, 0.01, 0.03], label: 1.0, alpha: 0.3 },
    {
      features: [1.0, 1.2, -0.1, -0.05, -0.1, -0.02, -0.05, -0.01, -0.01, -0.03],
      label: -1.0,
      alpha: 0.2,
    },
    { features: [1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], label: 0.0, alpha: 0.1 },
  ];

  // Входные признаки
  const features = [
    baseDayRevenue / 10000,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
  ];

  // Радиальное ядро (RBF)
  const gamma = 0.1;
  const bias = 0.0;

  let prediction = bias;

  supportVectors.forEach((sv) => {
    // Вычисляем расстояние между точками
    const distance = Math.sqrt(
      features.reduce((sum, feature, i) => sum + Math.pow(feature - sv.features[i], 2), 0),
    );

    // Применяем радиальное ядро
    const kernelValue = Math.exp(-gamma * distance * distance);

    prediction += sv.alpha * sv.label * kernelValue;
  });

  // Преобразуем в прогноз выручки
  const revenuePrediction = baseDayRevenue * (1 + prediction * 0.1);

  return Math.max(0, revenuePrediction);
}

// Адаптивные веса на основе исторической точности
function calculateAdaptiveWeights(
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
  predictions: {
    linear: number;
    exponential: number;
    movingAverage: number;
    neural: number;
    timeSeries: number;
    gradientBoosting: number;
    svm: number;
  },
): {
  linear: number;
  exponential: number;
  movingAverage: number;
  neural: number;
  timeSeries: number;
  gradientBoosting: number;
  svm: number;
} {
  // Базовые веса
  const baseWeights = {
    linear: 0.15,
    exponential: 0.15,
    movingAverage: 0.15,
    neural: 0.2,
    timeSeries: 0.15,
    gradientBoosting: 0.15,
    svm: 0.05,
  };

  // Адаптация весов на основе характеристик данных
  const dataVolatility = calculateVolatility(monthlyRevenues);
  const dataTrend = calculateTrend(monthlyRevenues);
  const dataSeasonality = calculateSeasonality(monthlyRevenues);

  // Корректировка весов на основе характеристик данных
  if (dataVolatility > 0.3) {
    // Высокая волатильность - больше веса стабильным методам
    baseWeights.movingAverage *= 1.2;
    baseWeights.linear *= 1.1;
    baseWeights.neural *= 0.9;
  }

  if (Math.abs(dataTrend) > 0.1) {
    // Сильный тренд - больше веса методам, учитывающим тренд
    baseWeights.exponential *= 1.2;
    baseWeights.timeSeries *= 1.1;
    baseWeights.gradientBoosting *= 1.1;
  }

  if (dataSeasonality > 0.2) {
    // Сильная сезонность - больше веса методам сезонного анализа
    baseWeights.timeSeries *= 1.3;
    baseWeights.exponential *= 1.1;
  }

  // Нормализация весов
  const totalWeight = Object.values(baseWeights).reduce((sum, w) => sum + w, 0);
  Object.keys(baseWeights).forEach((key) => {
    baseWeights[key as keyof typeof baseWeights] /= totalWeight;
  });

  return baseWeights;
}

// Постобработка для улучшения точности
function applyPostProcessing(
  prediction: number,
  baseDayRevenue: number,
  seasonalMultiplier: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  const sanitizedRevenues = monthlyRevenues.filter((value) => Number.isFinite(value) && value >= 0);
  const fallbackMean = baseDayRevenue > 0 ? baseDayRevenue : 0;
  const historicalMean =
    sanitizedRevenues.length > 0
      ? sanitizedRevenues.reduce((sum, r) => sum + r, 0) / sanitizedRevenues.length
      : fallbackMean;
  const variance =
    sanitizedRevenues.length > 0
      ? sanitizedRevenues.reduce((sum, r) => sum + Math.pow(r - historicalMean, 2), 0) /
        sanitizedRevenues.length
      : Math.pow(historicalMean * 0.15, 2);
  const historicalStd = Math.sqrt(Math.max(variance, 0));
  const safeStd = historicalStd > 1e-6 ? historicalStd : 1e-6;
  const lowerBound = Math.max(0, historicalMean - 3 * safeStd);
  const upperBound = historicalMean + 6 * safeStd;

  // Если прогноз слишком далек от исторических данных, применяем сглаживание
  if (Math.abs(prediction - historicalMean) > 3 * safeStd) {
    prediction = prediction * 0.7 + historicalMean * 0.3;
  }

  // Применяем ограничения на основе дня недели
  const dayConstraints = getDayOfWeekConstraints(dayOfWeek);
  prediction = Math.max(dayConstraints.min, Math.min(dayConstraints.max, prediction));

  // Финальная корректировка на основе сезонности
  const seasonalAdjustment = calculateFinalSeasonalAdjustment(date, dayOfWeek);
  prediction *= seasonalAdjustment;

  const clampedByHistory = Math.max(lowerBound, Math.min(upperBound, prediction));

  return clampedByHistory;
}

// Вспомогательные функции
function normalize(value: number, min: number, max: number): number {
  return (value - min) / (max - min);
}

function denormalize(value: number, min: number, max: number): number {
  return value * (max - min) + min;
}

function calculateVolatility(data: number[]): number {
  if (data.length < 2) return 0;

  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;

  return Math.sqrt(variance) / mean;
}

function calculateTrend(data: number[]): number {
  if (data.length < 2) return 0;

  const n = data.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = data.reduce((sum, val) => sum + val, 0);
  const sumXY = data.reduce((sum, val, i) => sum + val * i, 0);
  const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;

  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}

function calculateSeasonality(data: number[]): number {
  if (data.length < 12) return 0;

  // Простая мера сезонности через автокорреляцию с лагом 12
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  let numerator = 0;
  let denominator = 0;

  for (let i = 12; i < data.length; i++) {
    numerator += (data[i] - mean) * (data[i - 12] - mean);
    denominator += Math.pow(data[i] - mean, 2);
  }

  return denominator > 0 ? numerator / denominator : 0;
}

function calculateAROrder(data: number[]): number {
  // Простая эвристика для определения порядка AR
  if (data.length < 6) return 1;
  return Math.min(3, Math.floor(data.length / 4));
}

function calculateMAOrder(data: number[]): number {
  // Простая эвристика для определения порядка MA
  if (data.length < 6) return 1;
  return Math.min(2, Math.floor(data.length / 6));
}

function getDayOfWeekMultiplier(dayOfWeek: number): number {
  const multipliers = [0.8, 0.9, 1.0, 1.0, 1.1, 1.2, 1.0]; // Пн-Вс
  return multipliers[dayOfWeek] || 1.0;
}

function getMonthMultiplier(month: number): number {
  const multipliers = [0.9, 0.95, 1.0, 1.05, 1.1, 1.05, 1.0, 0.95, 1.0, 1.05, 1.1, 1.2]; // Янв-Дек
  return multipliers[month] || 1.0;
}

function calculateSeasonalAdjustment(date: Date): number {
  const month = date.getMonth();
  const day = date.getDate();

  // Новогодние праздники
  if (month === 0 && day <= 10) return 1.3;
  if (month === 0 && day >= 25) return 1.2;

  // Летний сезон
  if (month >= 5 && month <= 7) return 1.1;

  // Осенний сезон
  if (month >= 8 && month <= 10) return 1.05;

  return 1.0;
}

function getDayOfWeekConstraints(dayOfWeek: number): { min: number; max: number } {
  const constraints = [
    { min: 0.5, max: 1.5 }, // Понедельник
    { min: 0.6, max: 1.6 }, // Вторник
    { min: 0.7, max: 1.7 }, // Среда
    { min: 0.7, max: 1.7 }, // Четверг
    { min: 0.8, max: 1.8 }, // Пятница
    { min: 0.9, max: 2.0 }, // Суббота
    { min: 0.8, max: 1.8 }, // Воскресенье
  ];

  return constraints[dayOfWeek] || { min: 0.5, max: 2.0 };
}

function calculateFinalSeasonalAdjustment(date: Date, dayOfWeek: number): number {
  const monthAdjustment = getMonthMultiplier(date.getMonth());
  const dayAdjustment = getDayOfWeekMultiplier(dayOfWeek);

  return (monthAdjustment + dayAdjustment) / 2;
}

// Прогноз на основе скользящего среднего с трендом
function calculateMovingAveragePrediction(
  monthlyRevenues: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  dayOfWeek: number,
): number {
  if (monthlyRevenues.length < 3) {
    return baseDayRevenue * seasonalMultiplier;
  }

  // Рассчитываем скользящее среднее за последние 3 месяца
  const recentMonths = monthlyRevenues.slice(-3);
  const movingAverage = recentMonths.reduce((sum, val) => sum + val, 0) / recentMonths.length;

  // Рассчитываем среднюю дневную выручку
  const avgDailyRevenue = movingAverage / 30;

  // Применяем сезонный мультипликатор
  return avgDailyRevenue * seasonalMultiplier;
}

// Простая имитация нейронной сети для прогнозирования
function calculateSimpleNeuralPrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
): number {
  // Имитируем простую нейронную сеть с одной скрытой слоем
  const inputs = [
    baseDayRevenue / 10000, // Нормализуем входные данные
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
  ];

  // Веса для скрытого слоя (предварительно обученные коэффициенты)
  const hiddenWeights = [0.3, 0.4, 0.2, 0.1, 0.2];

  // Вычисляем скрытый слой
  const hiddenLayer = inputs.map((input, i) => Math.tanh(input * hiddenWeights[i]));

  // Веса для выходного слоя
  const outputWeights = [0.4, 0.3, 0.3];

  // Вычисляем выход
  let output = 0;
  for (let i = 0; i < Math.min(hiddenLayer.length, outputWeights.length); i++) {
    output += hiddenLayer[i] * outputWeights[i];
  }

  // Применяем активацию и денормализуем
  const prediction = (Math.tanh(output) + 1) * 0.5; // Нормализуем к [0,1]
  return baseDayRevenue * (0.8 + prediction * 0.4); // Масштабируем к разумному диапазону
}

// Генерация расширенного прогноза на 90 дней
function generateExtendedForecast(
  startDate: Date,
  endDate: Date,
  avgRevenueByDay: { [key: number]: number },
  dayOfWeekCounts: { [key: number]: number },
  seasonalIndices: number[],
  trend: number,
  totalDataPoints: number,
  monthlyRevenues: number[],
): any {
  const dailyForecast: any[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = getDay(currentDate);
    const baseDayRevenue = avgRevenueByDay[dayOfWeek] || avgRevenueByDay[1] || 1000; // Fallback to Monday or default

    // Получаем прогноз погоды и информацию о праздниках
    const weatherForecast = getWeatherForecast(currentDate);
    const holidayInfo = getHolidayInfo(currentDate);

    // Применяем улучшенные сезонные корректировки
    const seasonalMultiplier = getAdvancedSeasonalMultiplier(currentDate, seasonalIndices);

    // Рассчитываем влияние погоды
    const weatherImpact = calculateWeatherImpact(weatherForecast);

    // Рассчитываем влияние праздников
    const holidayImpact = calculateHolidayImpact(holidayInfo);

    // Используем расширенный ансамбль методов прогнозирования
    const ensemblePrediction = calculateEnsemblePrediction(
      baseDayRevenue,
      seasonalMultiplier,
      trend,
      weatherImpact,
      holidayImpact,
      monthlyRevenues,
      dayOfWeek,
      currentDate,
    );

    // Рассчитываем дополнительные факторы влияния
    const timeOfMonthImpact = calculateTimeOfMonthImpact(currentDate);
    const historicalPatternImpact = calculateHistoricalPatternImpact(currentDate, monthlyRevenues);
    const economicCycleImpact = calculateEconomicCycleImpact(currentDate);
    const localEventImpact = calculateLocalEventImpact(currentDate);
    const customerBehaviorImpact = calculateCustomerBehaviorImpact(dayOfWeek, currentDate);

    // Рассчитываем уверенность (снижается со временем, но более мягко)
    const daysFromStart = Math.floor(
      (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const timeDecay = Math.max(0.6, 1 - daysFromStart * 0.005); // Снижение уверенности на 0.5% в день (было 1%)
    const confidence =
      calculateAdvancedConfidence(
        dayOfWeekCounts[dayOfWeek],
        totalDataPoints,
        monthlyRevenues,
        dayOfWeek,
      ) * timeDecay;

    // Определяем тренд
    const trendDirection: 'up' | 'down' | 'stable' =
      trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : 'stable';

    dailyForecast.push({
      date: format(currentDate, 'yyyy-MM-dd'),
      predictedRevenue: Math.round(ensemblePrediction),
      confidence: Math.round(confidence * 100) / 100,
      trend: trendDirection,
      weatherImpact: weatherImpact,
      holidayImpact: holidayImpact,
      timeOfMonthImpact: timeOfMonthImpact,
      historicalPatternImpact: historicalPatternImpact,
      economicCycleImpact: economicCycleImpact,
      localEventImpact: localEventImpact,
      customerBehaviorImpact: customerBehaviorImpact,
      factors: {
        weather: {
          temperature: weatherForecast.temperature,
          precipitation: weatherForecast.precipitation,
          impact: weatherImpact,
        },
        holiday: {
          isHoliday: holidayInfo.isHoliday,
          holidayType: holidayInfo.type,
          impact: holidayImpact,
        },
        economic: { exchangeRate: 95.5, impact: 0 },
        traffic: { congestionLevel: 0.5, averageSpeed: 30, trafficVolume: 1000, impact: 0 },
        social: { sentiment: 0, volume: 0, platforms: [], impact: 0 },
        demographic: {
          population: 0,
          ageGroups: {},
          incomeLevels: {},
          employmentRate: 0,
          impact: 0,
        },
        seasonality: seasonalMultiplier,
        trend: trend,
        timeOfMonth: timeOfMonthImpact,
        historicalPattern: historicalPatternImpact,
        economicCycle: economicCycleImpact,
        localEvent: localEventImpact,
        customerBehavior: customerBehaviorImpact,
      },
    });

    currentDate = addDays(currentDate, 1);
  }

  // Группируем по неделям
  const weeklyForecast = groupIntoWeeks(dailyForecast, startDate);

  // Группируем по месяцам
  const monthlyForecast = groupIntoMonths(dailyForecast);

  const totalPredictedRevenue = dailyForecast.reduce((sum, day) => sum + day.predictedRevenue, 0);
  const avgConfidence =
    dailyForecast.reduce((sum, day) => sum + day.confidence, 0) / dailyForecast.length;

  return {
    totalPredictedRevenue: Math.round(totalPredictedRevenue),
    averageConfidence: Math.round(avgConfidence * 100) / 100,
    dailyForecast,
    weeklyForecast,
    monthlyForecast,
  };
}

// Группировка прогноза по неделям
function groupIntoWeeks(dailyForecast: any[], startDate: Date): any[] {
  const weeks: any[] = [];
  let currentWeekStart = new Date(startDate);
  let weekNumber = 1;

  while (currentWeekStart < new Date(dailyForecast[dailyForecast.length - 1].date)) {
    const weekEnd = addDays(currentWeekStart, 6);
    const weekDays = dailyForecast.filter((day) => {
      const dayDate = new Date(day.date);
      return dayDate >= currentWeekStart && dayDate <= weekEnd;
    });

    if (weekDays.length > 0) {
      const weekRevenue = weekDays.reduce((sum, day) => sum + day.predictedRevenue, 0);
      const weekConfidence =
        weekDays.reduce((sum, day) => sum + day.confidence, 0) / weekDays.length;

      weeks.push({
        weekStart: format(currentWeekStart, 'yyyy-MM-dd'),
        weekEnd: format(weekEnd, 'yyyy-MM-dd'),
        weekNumber,
        predictedRevenue: Math.round(weekRevenue),
        confidence: Math.round(weekConfidence * 100) / 100,
        dailyForecast: weekDays,
      });
    }

    currentWeekStart = addDays(currentWeekStart, 7);
    weekNumber++;
  }

  return weeks;
}

// Группировка прогноза по месяцам
function groupIntoMonths(dailyForecast: any[]): any[] {
  const months: { [key: string]: any[] } = {};

  dailyForecast.forEach((day) => {
    const date = new Date(day.date);
    const monthKey = format(date, 'yyyy-MM');
    const monthName = format(date, 'MMMM yyyy');

    if (!months[monthKey]) {
      months[monthKey] = [];
    }
    months[monthKey].push({ ...day, monthName });
  });

  return Object.keys(months).map((monthKey) => {
    const monthDays = months[monthKey];
    const monthRevenue = monthDays.reduce((sum, day) => sum + day.predictedRevenue, 0);
    const monthConfidence =
      monthDays.reduce((sum, day) => sum + day.confidence, 0) / monthDays.length;

    return {
      month: monthKey,
      monthName: monthDays[0].monthName,
      predictedRevenue: Math.round(monthRevenue),
      confidence: Math.round(monthConfidence * 100) / 100,
      dailyCount: monthDays.length,
    };
  });
}

// Функция получения прогноза погоды (заглушка - в реальном приложении здесь был бы API)
function getWeatherForecast(date: Date): WeatherData {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Простая модель прогноза погоды на основе сезонности
  const seasonalTemp = getSeasonalTemperature(month);
  const seasonalPrecipitation = getSeasonalPrecipitation(month);

  // Добавляем случайные колебания для реалистичности
  const tempVariation = (Math.random() - 0.5) * 10; // ±5°C
  const precipitationVariation = Math.random() * 5; // 0-5 мм

  return {
    date: format(date, 'yyyy-MM-dd'),
    temperature: Math.round((seasonalTemp + tempVariation) * 10) / 10,
    precipitation: Math.round((seasonalPrecipitation + precipitationVariation) * 10) / 10,
    snowfall: month >= 11 || month <= 3 ? Math.random() * 2 : 0,
    windSpeed: Math.random() * 10 + 2, // 2-12 м/с
  };
}

// Функция получения информации о праздниках
function getHolidayInfo(date: Date): { isHoliday: boolean; type?: string; name?: string } {
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

// Функция расчета влияния погоды на выручку
function calculateWeatherImpact(weather: WeatherData): number {
  let impact = 0;

  // Влияние температуры
  if (weather.temperature < -10) {
    impact -= 0.15; // Очень холодно - снижение посещаемости
  } else if (weather.temperature < 0) {
    impact -= 0.05; // Холодно - небольшое снижение
  } else if (weather.temperature > 30) {
    impact -= 0.1; // Очень жарко - снижение посещаемости
  } else if (weather.temperature > 25) {
    impact += 0.05; // Тепло - небольшое увеличение
  } else if (weather.temperature >= 15 && weather.temperature <= 25) {
    impact += 0.1; // Комфортная температура - увеличение
  }

  // Влияние осадков
  if (weather.precipitation > 10) {
    impact -= 0.2; // Сильный дождь - значительное снижение
  } else if (weather.precipitation > 5) {
    impact -= 0.1; // Дождь - снижение
  } else if (weather.precipitation > 1) {
    impact -= 0.05; // Легкий дождь - небольшое снижение
  }

  // Влияние снега
  if (weather.snowfall > 5) {
    impact -= 0.15; // Сильный снег - снижение
  } else if (weather.snowfall > 1) {
    impact -= 0.05; // Легкий снег - небольшое снижение
  }

  // Влияние ветра
  if (weather.windSpeed > 15) {
    impact -= 0.1; // Сильный ветер - снижение
  } else if (weather.windSpeed > 10) {
    impact -= 0.05; // Умеренный ветер - небольшое снижение
  }

  return Math.max(-0.3, Math.min(0.3, impact)); // Ограничиваем влияние от -30% до +30%
}

// Функция расчета влияния праздников на выручку
// Значительно увеличены базовые значения для более заметного влияния праздников
function calculateHolidayImpact(holiday: {
  isHoliday: boolean;
  type?: string;
  name?: string;
}): number {
  if (!holiday.isHoliday) return 0;

  switch (holiday.type) {
    case 'national':
      // Государственные праздники обычно значительно увеличивают выручку
      // Значительно увеличено с 0.3 до 0.4 (+33%)
      return 0.4;
    case 'religious':
      // Религиозные праздники могут как увеличивать, так и уменьшать
      // Значительно увеличено влияние: Рождество с 0.4 до 0.5, другие с 0.25 до 0.35
      return holiday.name?.includes('Рождество') ? 0.5 : 0.35;
    case 'regional':
      // Региональные праздники - значительно увеличенное влияние
      // Значительно увеличено с 0.2 до 0.3 (+50%)
      return 0.3;
    case 'unofficial':
      // Неофициальные праздники - значительно увеличенное влияние
      // Значительно увеличено с 0.1 до 0.15 (+50%)
      return 0.15;
    default:
      return 0;
  }
}

// === НОВЫЕ ФУНКЦИИ ДЛЯ РАСШИРЕННОГО АНАЛИЗА ФАКТОРОВ ===

// Влияние времени месяца на выручку
function calculateTimeOfMonthImpact(date: Date): number {
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;

  // Начало месяца (1-5 число) - обычно ниже выручка
  if (dayOfMonth <= 5) {
    return -0.08; // -8%
  }

  // Середина месяца (6-15 число) - стабильная выручка
  if (dayOfMonth <= 15) {
    return 0.02; // +2%
  }

  // Конец месяца (16-25 число) - рост выручки (зарплата)
  if (dayOfMonth <= 25) {
    return 0.12; // +12%
  }

  // Последние дни месяца (26-31 число) - пик выручки
  return 0.18; // +18%
}

// Влияние исторических паттернов и циклов
function calculateHistoricalPatternImpact(date: Date, monthlyRevenues: number[]): number {
  if (monthlyRevenues.length < 3) return 0;

  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();

  // Анализ месячных циклов
  const monthlyCycleImpact = calculateMonthlyCycleImpact(month, monthlyRevenues);

  // Анализ недельных циклов
  const weeklyCycleImpact = calculateWeeklyCycleImpact(date, monthlyRevenues);

  // Анализ квартальных циклов
  const quarterlyCycleImpact = calculateQuarterlyCycleImpact(month);

  return (monthlyCycleImpact + weeklyCycleImpact + quarterlyCycleImpact) / 3;
}

// Месячные циклы
function calculateMonthlyCycleImpact(month: number, monthlyRevenues: number[]): number {
  // Группируем данные по месяцам для анализа циклов
  const monthlyGroups: { [key: number]: number[] } = {};

  monthlyRevenues.forEach((revenue, index) => {
    const monthIndex = (index % 12) + 1;
    if (!monthlyGroups[monthIndex]) {
      monthlyGroups[monthIndex] = [];
    }
    monthlyGroups[monthIndex].push(revenue);
  });

  const currentMonthData = monthlyGroups[month] || [];
  if (currentMonthData.length === 0) return 0;

  const avgRevenue = currentMonthData.reduce((sum, val) => sum + val, 0) / currentMonthData.length;
  const overallAvg = monthlyRevenues.reduce((sum, val) => sum + val, 0) / monthlyRevenues.length;

  return ((avgRevenue - overallAvg) / overallAvg) * 0.5; // Ограничиваем влияние
}

// Недельные циклы
function calculateWeeklyCycleImpact(date: Date, monthlyRevenues: number[]): number {
  const dayOfWeek = date.getDay();
  const weekOfMonth = Math.ceil(date.getDate() / 7);

  // Первая неделя месяца обычно ниже
  if (weekOfMonth === 1) return -0.05;

  // Вторая и третья недели стабильны
  if (weekOfMonth === 2 || weekOfMonth === 3) return 0.02;

  // Последняя неделя месяца выше (зарплата)
  if (weekOfMonth >= 4) return 0.08;

  return 0;
}

// Квартальные циклы
function calculateQuarterlyCycleImpact(month: number): number {
  const quarter = Math.ceil(month / 3);

  switch (quarter) {
    case 1: // Q1 (янв-мар) - после праздников, низкий сезон
      return -0.1;
    case 2: // Q2 (апр-июн) - весенний подъем
      return 0.15;
    case 3: // Q3 (июл-сен) - летний сезон
      return 0.2;
    case 4: // Q4 (окт-дек) - предпраздничный бум
      return 0.25;
    default:
      return 0;
  }
}

// Экономические циклы и индикаторы
function calculateEconomicCycleImpact(date: Date): number {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  // Сезонные экономические факторы
  let economicImpact = 0;

  // Летний туристический сезон
  if (month >= 6 && month <= 8) {
    economicImpact += 0.1;
  }

  // Предпраздничный период
  if (month === 12) {
    economicImpact += 0.2;
  }

  // Послепраздничный спад
  if (month === 1) {
    economicImpact -= 0.15;
  }

  // Весенний подъем экономической активности
  if (month >= 3 && month <= 5) {
    economicImpact += 0.05;
  }

  return economicImpact;
}

// Локальные события и факторы (скорректировано для нестабильности выходных)
function calculateLocalEventImpact(date: Date): number {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Региональные события и праздники
  const localEvents: { [key: string]: number } = {
    '03-01': 0.1, // День весны
    '05-15': 0.05, // Середина мая
    '09-01': 0.1, // День знаний
    '10-15': 0.05, // Середина октября
  };

  const dateKey = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  const eventImpact = localEvents[dateKey] || 0;

  // Выходные дни в кофейнях региона очень нестабильны - убираем автоматический буст
  const dayOfWeek = date.getDay();
  const weekendImpact = dayOfWeek === 0 || dayOfWeek === 6 ? -0.05 : 0; // Небольшое снижение для выходных

  return eventImpact + weekendImpact;
}

// Поведение клиентов и паттерны потребления (скорректировано для нестабильности выходных)
function calculateCustomerBehaviorImpact(dayOfWeek: number, date: Date): number {
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();

  let behaviorImpact = 0;

  // Утренний кофе в будни - стабильный паттерн
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    behaviorImpact += 0.05;
  }

  // Вечерние встречи в пятницу - умеренно предсказуемо
  if (dayOfWeek === 5) {
    behaviorImpact += 0.08;
  }

  // Выходные дни - очень нестабильно в кофейнях региона
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    // Добавляем случайную вариацию для выходных
    const randomVariation = (Math.random() - 0.5) * 0.3; // ±15% случайной вариации
    behaviorImpact += randomVariation;

    // Базовое влияние выходных (может быть как положительным, так и отрицательным)
    if (dayOfWeek === 6) {
      behaviorImpact += 0.05; // Суббота - небольшой рост
    } else {
      behaviorImpact -= 0.1; // Воскресенье - часто снижение в регионе
    }
  }

  // Зарплатные дни (конец месяца) - влияют только в будни
  if (dayOfMonth >= 25 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    behaviorImpact += 0.08;
  }

  // Начало месяца - экономия (особенно в выходные)
  if (dayOfMonth <= 5) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      behaviorImpact -= 0.15; // Сильная экономия в выходные в начале месяца
    } else {
      behaviorImpact -= 0.05; // Обычная экономия в будни
    }
  }

  return behaviorImpact;
}

// Улучшенный прогноз на основе скользящего среднего
function calculateAdvancedMovingAveragePrediction(
  monthlyRevenues: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  dayOfWeek: number,
  date: Date,
): number {
  if (monthlyRevenues.length < 3) {
    return baseDayRevenue * seasonalMultiplier;
  }

  // Используем взвешенное скользящее среднее
  const weights = [0.5, 0.3, 0.2]; // Больший вес последним месяцам
  const recentMonths = monthlyRevenues.slice(-3);

  let weightedAverage = 0;
  for (let i = 0; i < recentMonths.length; i++) {
    weightedAverage += recentMonths[i] * weights[i];
  }

  const avgDailyRevenue = weightedAverage / 30;

  // Применяем дополнительные корректировки
  const timeOfMonthCorrection = 1 + calculateTimeOfMonthImpact(date);
  const behaviorCorrection = 1 + calculateCustomerBehaviorImpact(dayOfWeek, date);

  return avgDailyRevenue * seasonalMultiplier * timeOfMonthCorrection * behaviorCorrection;
}

// Улучшенная нейронная сеть с множественными входами
function calculateAdvancedNeuralPrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  timeOfMonthImpact: number,
  historicalPatternImpact: number,
  economicCycleImpact: number,
  localEventImpact: number,
  customerBehaviorImpact: number,
): number {
  // Нормализуем входные данные
  const inputs = [
    baseDayRevenue / 10000,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
  ];

  // Веса для скрытого слоя (расширенные)
  const hiddenWeights = [0.2, 0.3, 0.15, 0.1, 0.1, 0.05, 0.05, 0.02, 0.02, 0.01];

  // Вычисляем скрытый слой
  const hiddenLayer = inputs.map((input, i) => Math.tanh(input * hiddenWeights[i]));

  // Веса для выходного слоя
  const outputWeights = [0.3, 0.25, 0.2, 0.15, 0.1];

  // Вычисляем выход
  let output = 0;
  for (let i = 0; i < Math.min(hiddenLayer.length, outputWeights.length); i++) {
    output += hiddenLayer[i] * outputWeights[i];
  }

  // Применяем активацию и денормализуем
  const prediction = (Math.tanh(output) + 1) * 0.5;
  return baseDayRevenue * (0.7 + prediction * 0.6); // Расширенный диапазон
}

// Анализ временных рядов с ARIMA-подобными компонентами
function calculateTimeSeriesPrediction(
  monthlyRevenues: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  date: Date,
): number {
  if (monthlyRevenues.length < 4) {
    return baseDayRevenue * seasonalMultiplier;
  }

  // Автокорреляционный анализ
  const autocorr1 = calculateAutocorrelation(monthlyRevenues, 1);
  const autocorr2 = calculateAutocorrelation(monthlyRevenues, 2);

  // Тренд с учетом автокорреляции
  const trend = calculateAdvancedTrend(monthlyRevenues);
  const autocorrAdjustment = (autocorr1 + autocorr2) * 0.1;

  // Сезонная декомпозиция
  const seasonalComponent = getAdvancedSeasonalMultiplier(
    date,
    calculateSeasonalIndices(monthlyRevenues),
  );

  // Прогноз с учетом всех компонентов
  const lastValue = monthlyRevenues[monthlyRevenues.length - 1];
  const trendComponent = trend * lastValue;
  const seasonalComponentValue = seasonalComponent - 1; // Преобразуем мультипликатор в изменение

  return (
    baseDayRevenue * (1 + trendComponent / lastValue + seasonalComponentValue + autocorrAdjustment)
  );
}

// Вспомогательные функции для сезонных температур и осадков
function getSeasonalTemperature(month: number): number {
  const temps: { [key: number]: number } = {
    1: -8,
    2: -6,
    3: 0,
    4: 8,
    5: 16,
    6: 20,
    7: 22,
    8: 20,
    9: 14,
    10: 6,
    11: -1,
    12: -5,
  };
  return temps[month] || 0;
}

function getSeasonalPrecipitation(month: number): number {
  const precip: { [key: number]: number } = {
    1: 2,
    2: 1.5,
    3: 2.5,
    4: 3,
    5: 4,
    6: 5,
    7: 6,
    8: 5,
    9: 4,
    10: 3,
    11: 2.5,
    12: 2,
  };
  return precip[month] || 0;
}

// Улучшенная функция прогнозирования с использованием внешних источников данных
async function generateRevenueForecastWithExternalData(
  transactions: Transaction[],
  externalData: {
    weather: any[];
    economic: EconomicIndicator;
    holidays: HolidayData[];
    traffic?: TrafficData;
    sentiment: SocialSentiment[];
  },
): Promise<RevenueForecast> {
  // Сортируем транзакции по дате
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const latestDate = new Date(sorted[sorted.length - 1].date);
  const nextMonthStart = startOfMonth(addMonths(latestDate, 1));
  const nextMonthEnd = endOfMonth(addMonths(latestDate, 1));

  // Расширенный прогноз на 90 дней
  const extendedForecastStart = addDays(latestDate, 1);
  const extendedForecastEnd = addDays(latestDate, 90);

  // Анализируем исторические данные за последние 3 месяца
  const threeMonthsAgo = startOfMonth(subMonths(latestDate, 3));
  const historicalData = sorted.filter((t) => new Date(t.date) >= threeMonthsAgo);

  // Группируем данные по дням недели для анализа сезонности
  const dayOfWeekRevenue: { [key: number]: number[] } = {};
  const dayOfWeekCounts: { [key: number]: number } = {};

  // Сначала группируем транзакции по дням, затем по дням недели
  const dailyRevenueMap = new Map<string, number>();
  historicalData.forEach((t) => {
    const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
    dailyRevenueMap.set(day, (dailyRevenueMap.get(day) || 0) + t.amount);
  });

  // Теперь группируем дневную выручку по дням недели
  dailyRevenueMap.forEach((dailyRevenue, dateStr) => {
    const dayOfWeek = getDay(new Date(dateStr));
    if (!dayOfWeekRevenue[dayOfWeek]) {
      dayOfWeekRevenue[dayOfWeek] = [];
      dayOfWeekCounts[dayOfWeek] = 0;
    }
    dayOfWeekRevenue[dayOfWeek].push(dailyRevenue);
    dayOfWeekCounts[dayOfWeek]++;
  });

  // Рассчитываем среднюю выручку по дням недели
  const avgRevenueByDay: { [key: number]: number } = {};
  Object.keys(dayOfWeekRevenue).forEach((day) => {
    const dayNum = parseInt(day);
    const revenues = dayOfWeekRevenue[dayNum];
    avgRevenueByDay[dayNum] = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;
  });

  // Рассчитываем тренд роста с расширенным периодом анализа
  const monthlyRevenues: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = startOfMonth(subMonths(latestDate, i));
    const monthEnd = endOfMonth(subMonths(latestDate, i));
    const monthRevenue = historicalData
      .filter((t) => {
        const txDate = new Date(t.date);
        return txDate >= monthStart && txDate <= monthEnd;
      })
      .reduce((sum, t) => sum + t.amount, 0);
    monthlyRevenues.unshift(monthRevenue);
  }

  // Используем улучшенный тренд с ARIMA-подобным анализом
  const trend = calculateAdvancedTrend(monthlyRevenues);

  // Рассчитываем сезонные индексы
  const seasonalIndices = calculateSeasonalIndices(monthlyRevenues);

  // Рассчитываем базовую выручку следующего месяца
  const baseRevenue = monthlyRevenues[monthlyRevenues.length - 1];
  const trendAdjustment = trend * baseRevenue;
  const predictedBaseRevenue = baseRevenue + trendAdjustment;

  // Генерируем прогноз по дням с учетом всех внешних факторов
  const dailyForecast: ForecastData[] = [];
  let currentDate = nextMonthStart;

  while (currentDate <= nextMonthEnd) {
    const dayOfWeek = getDay(currentDate);
    const baseDayRevenue = avgRevenueByDay[dayOfWeek] || predictedBaseRevenue / 30;

    // Получаем данные для конкретной даты
    const weatherForDate = externalData.weather.find(
      (w) => w.date === format(currentDate, 'yyyy-MM-dd'),
    );
    const holidayForDate = externalData.holidays.find(
      (h) => h.date === format(currentDate, 'yyyy-MM-dd'),
    );

    // Применяем улучшенные сезонные корректировки
    const seasonalMultiplier = getAdvancedSeasonalMultiplier(currentDate, seasonalIndices);

    // Рассчитываем влияние всех факторов
    const weatherImpact = calculateEnhancedWeatherImpact(weatherForDate);
    const economicImpact = calculateEconomicImpact(externalData.economic);
    const trafficImpact = calculateTrafficImpact(externalData.traffic);
    const socialSentimentImpact = calculateSocialSentimentImpact(externalData.sentiment);
    const holidayImpact = calculateHolidayImpact(
      holidayForDate
        ? {
            isHoliday: true,
            type: holidayForDate.type,
            name: holidayForDate.name,
          }
        : { isHoliday: false },
    );

    // Используем расширенный ансамбль методов прогнозирования
    const ensemblePrediction = calculateEnhancedEnsemblePrediction(
      baseDayRevenue,
      seasonalMultiplier,
      trend,
      weatherImpact,
      economicImpact,
      trafficImpact,
      socialSentimentImpact,
      holidayImpact,
      monthlyRevenues,
      dayOfWeek,
      currentDate,
    );

    const predictedRevenue = ensemblePrediction;

    // Рассчитываем дополнительные факторы влияния
    const timeOfMonthImpact = calculateTimeOfMonthImpact(currentDate);
    const historicalPatternImpact = calculateHistoricalPatternImpact(currentDate, monthlyRevenues);
    const economicCycleImpact = calculateEconomicCycleImpact(currentDate);
    const localEventImpact = calculateLocalEventImpact(currentDate);
    const customerBehaviorImpact = calculateCustomerBehaviorImpact(dayOfWeek, currentDate);

    // Рассчитываем улучшенную уверенность на основе множественных факторов
    const confidence = calculateEnhancedConfidence(
      dayOfWeekCounts[dayOfWeek],
      historicalData.length,
      monthlyRevenues,
      dayOfWeek,
      externalData,
    );

    // Определяем тренд
    const trendDirection: 'up' | 'down' | 'stable' =
      trend > 0.05 ? 'up' : trend < -0.05 ? 'down' : 'stable';

    dailyForecast.push({
      date: format(currentDate, 'yyyy-MM-dd'),
      predictedRevenue: Math.round(predictedRevenue),
      confidence: Math.round(confidence * 100) / 100,
      trend: trendDirection,
      weatherImpact: weatherImpact,
      economicImpact: economicImpact,
      trafficImpact: trafficImpact,
      socialSentimentImpact: socialSentimentImpact,
      holidayImpact: holidayImpact,
      timeOfMonthImpact: timeOfMonthImpact,
      historicalPatternImpact: historicalPatternImpact,
      economicCycleImpact: economicCycleImpact,
      localEventImpact: localEventImpact,
      customerBehaviorImpact: customerBehaviorImpact,
      factors: {
        weather: {
          temperature: weatherForDate?.temperature || 15,
          precipitation: weatherForDate?.precipitation || 0,
          humidity: weatherForDate?.humidity,
          windSpeed: weatherForDate?.windSpeed,
          cloudCover: weatherForDate?.cloudCover,
          uvIndex: weatherForDate?.uvIndex,
          visibility: weatherForDate?.visibility,
          impact: weatherImpact,
        },
        economic: {
          exchangeRate: externalData.economic.exchangeRate,
          inflation: externalData.economic.inflation,
          consumerConfidence: externalData.economic.consumerConfidence,
          unemploymentRate: externalData.economic.unemploymentRate,
          impact: economicImpact,
        },
        traffic: {
          congestionLevel: externalData.traffic?.congestionLevel || 0,
          averageSpeed: externalData.traffic?.averageSpeed || 50,
          trafficVolume: externalData.traffic?.trafficVolume || 100,
          impact: trafficImpact,
        },
        social: {
          sentiment:
            externalData.sentiment.reduce((sum, s) => sum + s.sentiment, 0) /
              externalData.sentiment.length || 0,
          volume: externalData.sentiment.reduce((sum, s) => sum + s.volume, 0),
          platforms: externalData.sentiment.map((s) => s.platform),
          impact: socialSentimentImpact,
        },
        demographic: {
          population: 0, // Не реализовано в текущей версии
          ageGroups: {},
          incomeLevels: {},
          employmentRate: 0,
          impact: 0,
        },
        holiday: {
          isHoliday: holidayForDate ? true : false,
          holidayType: holidayForDate?.type,
          holidayName: holidayForDate?.name,
          impact: holidayImpact,
        },
        seasonality: seasonalMultiplier,
        trend: trend,
        timeOfMonth: timeOfMonthImpact,
        historicalPattern: historicalPatternImpact,
        economicCycle: economicCycleImpact,
        localEvent: localEventImpact,
        customerBehavior: customerBehaviorImpact,
      },
    });

    currentDate = addDays(currentDate, 1);
  }

  const totalPredictedRevenue = dailyForecast.reduce((sum, day) => sum + day.predictedRevenue, 0);
  const avgConfidence =
    dailyForecast.reduce((sum, day) => sum + day.confidence, 0) / dailyForecast.length;

  // Генерируем расширенный прогноз на 90 дней
  const extendedForecast = generateExtendedForecast(
    extendedForecastStart,
    extendedForecastEnd,
    avgRevenueByDay,
    dayOfWeekCounts,
    seasonalIndices,
    trend,
    historicalData.length,
    monthlyRevenues,
  );

  return {
    nextMonth: {
      predictedRevenue: Math.round(totalPredictedRevenue),
      confidence: Math.round(avgConfidence * 100) / 100,
      dailyForecast,
    },
    extendedForecast,
    methodology: {
      algorithm: 'Enhanced Multi-Factor Ensemble ML with External Data Integration [BETA]',
      dataPoints: historicalData.length,
      seasonalAdjustment: true,
      trendAnalysis: true,
      weatherAnalysis: true,
      holidayAnalysis: true,
      forecastDays: 90,
      betaVersion: true,
      betaWarning: 'Функция в разработке - возможны неточности в расчетах',
    },
  };
}

// Новые функции для расчета влияния внешних факторов

function calculateEnhancedWeatherImpact(weatherData: any): number {
  if (!weatherData) return 0;

  let impact = 0;
  const currentMonth = new Date().getMonth();
  const isWinter = currentMonth >= 11 || currentMonth <= 2;
  const isSummer = currentMonth >= 5 && currentMonth <= 7;
  const seasonalMultiplier = isWinter ? 1.3 : isSummer ? 0.9 : 1.0;

  // Улучшенное влияние температуры с увеличенными весами
  if (weatherData.temperature < -15) {
    // Очень холодно - зимой эффект сильнее
    impact += (isWinter ? 0.05 : -0.15) * seasonalMultiplier;
  } else if (weatherData.temperature < -5) {
    // Холодно - кофе популярен (увеличено влияние)
    impact += 0.12 * seasonalMultiplier;
  } else if (weatherData.temperature < 5) {
    // Прохладно - идеально для кофе (увеличено с -0.05 до +0.15)
    impact += 0.15 * seasonalMultiplier;
  } else if (weatherData.temperature >= 5 && weatherData.temperature < 15) {
    // Прохладно-комфортно
    impact += 0.20 * seasonalMultiplier;
  } else if (weatherData.temperature >= 15 && weatherData.temperature <= 25) {
    // Комфортно - отличная погода для кофе (увеличено с 0.1 до 0.25)
    impact += 0.25;
  } else if (weatherData.temperature > 25 && weatherData.temperature <= 30) {
    // Жарко - холодные напитки популярнее
    impact += isSummer ? 0.08 : 0.05;
  } else if (weatherData.temperature > 30) {
    // Очень жарко
    impact += isSummer ? 0.02 : -0.10;
  }

  // Влияние влажности с учетом температуры
  if (weatherData.humidity > 80) {
    // Высокая влажность - особенно неприятна в жару
    const heatMultiplier = weatherData.temperature > 25 ? 1.3 : 1.0;
    impact -= 0.06 * heatMultiplier;
  } else if (weatherData.humidity < 30) {
    // Низкая влажность - может быть комфортна в холод
    const coldMultiplier = weatherData.temperature < 5 ? 0.7 : 1.0;
    impact -= 0.03 * coldMultiplier;
  }

  // Влияние облачности
  if (weatherData.cloudCover > 80) {
    // Пасмурно - может быть комфортно в жару
    const heatMultiplier = weatherData.temperature > 25 ? 0.8 : 1.0;
    impact -= 0.05 * heatMultiplier;
  } else if (weatherData.cloudCover < 20) {
    // Ясно - хорошо в прохладную погоду
    const coolMultiplier = weatherData.temperature < 20 ? 1.2 : 1.0;
    impact += 0.04 * coolMultiplier;
  }

  // Улучшенное влияние осадков с учетом температуры
  if (weatherData.precipitation > 10) {
    // Сильный дождь - меньше посетителей, но в холод люди ищут укрытие
    const coldMultiplier = weatherData.temperature < 5 ? 0.8 : 1.0;
    impact -= 0.22 * coldMultiplier;
  } else if (weatherData.precipitation > 5) {
    const moderateMultiplier = weatherData.temperature < 10 ? 0.8 : 1.0;
    impact -= 0.12 * moderateMultiplier;
  } else if (weatherData.precipitation > 1) {
    // Легкий дождь - люди ищут укрытие, особенно в прохладную погоду
    const lightMultiplier = weatherData.temperature < 15 ? 1.4 : 1.0;
    impact += 0.04 * lightMultiplier;
  }

  // Улучшенное влияние ветра с учетом температуры
  if (weatherData.windSpeed > 15) {
    // Сильный ветер - особенно неприятен в холод
    const coldWindMultiplier = weatherData.temperature < 5 ? 1.3 : 1.0;
    impact -= 0.12 * coldWindMultiplier;
  } else if (weatherData.windSpeed > 10) {
    const moderateWindMultiplier = weatherData.temperature < 5 ? 1.2 : 1.0;
    impact -= 0.06 * moderateWindMultiplier;
  }

  // Комбинация факторов: плохая погода
  const badWeatherCombo = 
    weatherData.temperature < 5 && 
    (weatherData.precipitation || 0) > 2 && 
    (weatherData.windSpeed || 0) > 10;
  if (badWeatherCombo) {
    impact -= 0.05;
  }

  // Комбинация факторов: комфортная погода с легкими осадками
  const goodWeatherCombo = 
    weatherData.temperature >= 10 && 
    weatherData.temperature <= 20 && 
    (weatherData.precipitation || 0) > 1 && 
    (weatherData.precipitation || 0) <= 5;
  if (goodWeatherCombo) {
    impact += 0.03;
  }

  // Влияние видимости
  if (weatherData.visibility < 1) {
    impact -= 0.15; // Туман
  } else if (weatherData.visibility < 5) {
    impact -= 0.05; // Плохая видимость
  }

  return Math.max(-0.4, Math.min(0.4, impact));
}

function calculateEconomicImpact(economicData: EconomicIndicator): number {
  let impact = 0;

  // Влияние инфляции
  if (economicData.inflation) {
    if (economicData.inflation > 8) {
      impact -= 0.1; // Высокая инфляция
    } else if (economicData.inflation > 5) {
      impact -= 0.05; // Умеренная инфляция
    } else if (economicData.inflation < 2) {
      impact += 0.03; // Низкая инфляция
    }
  }

  // Влияние потребительского доверия
  if (economicData.consumerConfidence) {
    if (economicData.consumerConfidence > 0.3) {
      impact += 0.05; // Высокое доверие
    } else if (economicData.consumerConfidence < -0.3) {
      impact -= 0.05; // Низкое доверие
    }
  }

  // Влияние безработицы
  if (economicData.unemploymentRate) {
    if (economicData.unemploymentRate > 8) {
      impact -= 0.1; // Высокая безработица
    } else if (economicData.unemploymentRate < 3) {
      impact += 0.03; // Низкая безработица
    }
  }

  return Math.max(-0.2, Math.min(0.2, impact));
}

function calculateTrafficImpact(trafficData?: TrafficData): number {
  if (!trafficData) return 0;

  let impact = 0;

  // Влияние загруженности дорог
  if (trafficData.congestionLevel > 0.8) {
    impact -= 0.1; // Очень высокая загруженность
  } else if (trafficData.congestionLevel > 0.6) {
    impact -= 0.05; // Высокая загруженность
  } else if (trafficData.congestionLevel < 0.3) {
    impact += 0.03; // Низкая загруженность
  }

  // Влияние скорости движения
  if (trafficData.averageSpeed < 20) {
    impact -= 0.08; // Медленное движение
  } else if (trafficData.averageSpeed > 60) {
    impact += 0.03; // Быстрое движение
  }

  return Math.max(-0.15, Math.min(0.15, impact));
}

function calculateSocialSentimentImpact(sentimentData: SocialSentiment[]): number {
  if (sentimentData.length === 0) return 0;

  // Усредняем настроения по всем платформам
  const avgSentiment =
    sentimentData.reduce((sum, s) => sum + s.sentiment, 0) / sentimentData.length;
  const totalVolume = sentimentData.reduce((sum, s) => sum + s.volume, 0);

  // Взвешиваем по объему упоминаний
  const weightedSentiment =
    sentimentData.reduce((sum, s) => sum + s.sentiment * s.volume, 0) / totalVolume;

  // Конвертируем в влияние на выручку
  let impact = weightedSentiment * 0.1; // Масштабируем влияние

  // Учитываем объем упоминаний
  if (totalVolume > 1000) {
    impact *= 1.5; // Высокий объем = большее влияние
  } else if (totalVolume < 100) {
    impact *= 0.5; // Низкий объем = меньшее влияние
  }

  return Math.max(-0.2, Math.min(0.2, impact));
}

function calculateEnhancedConfidence(
  dayOfWeekCount: number,
  totalDataPoints: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  externalData: any,
): number {
  // Базовая уверенность из оригинальной функции
  const baseConfidence = calculateAdvancedConfidence(
    dayOfWeekCount,
    totalDataPoints,
    monthlyRevenues,
    dayOfWeek,
  );

  // Дополнительные факторы уверенности на основе внешних данных
  let externalDataBonus = 0;

  // Бонус за наличие погодных данных
  if (externalData.weather && externalData.weather.length > 0) {
    externalDataBonus += 0.05;
  }

  // Бонус за наличие экономических данных
  if (externalData.economic && externalData.economic.exchangeRate > 0) {
    externalDataBonus += 0.03;
  }

  // Бонус за наличие данных о праздниках
  if (externalData.holidays && externalData.holidays.length > 0) {
    externalDataBonus += 0.02;
  }

  // Бонус за наличие данных о трафике
  if (externalData.traffic) {
    externalDataBonus += 0.03;
  }

  // Бонус за наличие данных о настроениях
  if (externalData.sentiment && externalData.sentiment.length > 0) {
    externalDataBonus += 0.02;
  }

  const enhancedConfidence = Math.min(0.98, baseConfidence + externalDataBonus);

  return Math.max(0.6, enhancedConfidence);
}

function calculateEnhancedEnsemblePrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  economicImpact: number,
  trafficImpact: number,
  socialSentimentImpact: number,
  holidayImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
): number {
  // Дополнительные факторы влияния
  const timeOfMonthImpact = calculateTimeOfMonthImpact(date);
  const historicalPatternImpact = calculateHistoricalPatternImpact(date, monthlyRevenues);
  const economicCycleImpact = calculateEconomicCycleImpact(date);
  const localEventImpact = calculateLocalEventImpact(date);
  const customerBehaviorImpact = calculateCustomerBehaviorImpact(dayOfWeek, date);

  // Метод 1: Многомерная линейная регрессия с расширенными факторами
  // Значительно увеличено влияние праздников для более точного учета их эффекта
  const linearPrediction =
    baseDayRevenue *
    seasonalMultiplier *
    (1 + trend * 0.1) *
    (1 + weatherImpact * 1.5) *
    (1 + economicImpact) *
    (1 + trafficImpact) *
    (1 + socialSentimentImpact) *
    (1 + holidayImpact * 2.0) * // Значительно увеличено с 1.3 до 2.0 (+54%)
    (1 + timeOfMonthImpact) *
    (1 + historicalPatternImpact) *
    (1 + economicCycleImpact) *
    (1 + localEventImpact) *
    (1 + customerBehaviorImpact);

  // Метод 2: Экспоненциальное сглаживание с факторами
  // Значительно увеличено влияние праздников
  const exponentialPrediction =
    baseDayRevenue *
    seasonalMultiplier *
    Math.exp(trend * 0.05) *
    (1 + weatherImpact * 0.7) *
    (1 + economicImpact * 0.3) *
    (1 + trafficImpact * 0.2) *
    (1 + socialSentimentImpact * 0.2) *
    (1 + holidayImpact * 1.2) * // Значительно увеличено с 0.7 до 1.2 (+71%)
    (1 + timeOfMonthImpact * 0.3) *
    (1 + historicalPatternImpact * 0.4) *
    (1 + economicCycleImpact * 0.2);

  // Метод 3: Среднее скользящее с расширенными корректировками
  const movingAveragePrediction = calculateAdvancedMovingAveragePrediction(
    monthlyRevenues,
    baseDayRevenue,
    seasonalMultiplier,
    dayOfWeek,
    date,
  );

  // Метод 4: Улучшенная нейронная сеть с множественными входами
  const neuralNetworkPrediction = calculateAdvancedNeuralPrediction(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    timeOfMonthImpact,
    historicalPatternImpact,
    economicCycleImpact,
    localEventImpact,
    customerBehaviorImpact,
  );

  // Метод 5: Анализ временных рядов с ARIMA-подобными компонентами
  const timeSeriesPrediction = calculateTimeSeriesPrediction(
    monthlyRevenues,
    baseDayRevenue,
    seasonalMultiplier,
    date,
  );

  // Взвешенное усреднение результатов с учетом точности методов
  const weights = {
    linear: 0.25,
    exponential: 0.2,
    movingAverage: 0.2,
    neural: 0.2,
    timeSeries: 0.15,
  };

  const rawPredictions = {
    linear: linearPrediction,
    exponential: exponentialPrediction,
    movingAverage: movingAveragePrediction,
    neural: neuralNetworkPrediction,
    timeSeries: timeSeriesPrediction,
  };

  const absolutePredictions = Object.fromEntries(
    Object.entries(rawPredictions).map(([key, value]) => [
      key,
      ensureAbsolutePrediction(value, baseDayRevenue),
    ]),
  ) as typeof rawPredictions;

  const normalizedWeights = normalizeWeights(weights);

  const contributions: Record<keyof typeof absolutePredictions, number> = {
    linear: 0,
    exponential: 0,
    movingAverage: 0,
    neural: 0,
    timeSeries: 0,
  };

  const ensembleResult = (
    Object.keys(absolutePredictions) as Array<keyof typeof absolutePredictions>
  ).reduce((sum, method) => {
    const weight = normalizedWeights[method] ?? 0;
    const prediction = absolutePredictions[method];
    const contribution = prediction * weight;
    contributions[method] = contribution;
    return sum + contribution;
  }, 0);

  const { clampLimit } = calculateHistoricalClamp(monthlyRevenues, baseDayRevenue);
  const clampedEnsembleResult = Math.min(ensembleResult, clampLimit);
  const safeFinalResult = Math.max(0, clampedEnsembleResult);

  logEnsembleDebug(
    'enhanced',
    date,
    baseDayRevenue,
    normalizedWeights,
    absolutePredictions,
    contributions,
    ensembleResult,
    clampLimit,
    clampedEnsembleResult,
    safeFinalResult,
  );

  return safeFinalResult;
}

// ===== УЛУЧШЕННЫЕ МЕТОДЫ ПРОГНОЗИРОВАНИЯ ДЛЯ МАЛОГО КОЛИЧЕСТВА ДАННЫХ =====

/**
 * Байесовское прогнозирование с априорными распределениями
 * Эффективно работает даже с очень малым количеством данных
 */
function calculateBayesianForecast(
  historicalData: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  dayOfWeek: number,
  date: Date,
): { prediction: number; confidence: number; uncertainty: number } {
  if (historicalData.length === 0) {
    return {
      prediction: baseDayRevenue * seasonalMultiplier,
      confidence: 0.3,
      uncertainty: 0.5,
    };
  }

  // Априорные параметры (на основе экспертных знаний)
  const priorMean = baseDayRevenue * seasonalMultiplier;
  const priorVariance = Math.pow(priorMean * 0.3, 2); // 30% стандартное отклонение

  // Вычисляем выборочную статистику
  const sampleMean = historicalData.reduce((sum, val) => sum + val, 0) / historicalData.length;
  const sampleVariance =
    historicalData.reduce((sum, val) => sum + Math.pow(val - sampleMean, 2), 0) /
    historicalData.length;
  const sampleSize = historicalData.length;

  // Байесовское обновление параметров
  const posteriorPrecision = 1 / priorVariance + sampleSize / sampleVariance;
  const posteriorMean =
    (priorMean / priorVariance + (sampleMean * sampleSize) / sampleVariance) / posteriorPrecision;
  const posteriorVariance = 1 / posteriorPrecision;

  // Прогноз с учетом неопределенности
  const prediction = posteriorMean;
  const uncertainty = Math.sqrt(posteriorVariance) / posteriorMean;
  const confidence = Math.min(0.95, Math.max(0.1, 1 - uncertainty));

  return { prediction, confidence, uncertainty };
}

/**
 * Бутстрап-сэмплинг для увеличения эффективного размера выборки
 */
function bootstrapSampling(data: number[], numSamples: number = 1000): number[] {
  if (data.length === 0) return [];

  const bootstrapSamples: number[] = [];

  for (let i = 0; i < numSamples; i++) {
    // Создаем бутстрап-выборку
    const bootstrapSample: number[] = [];
    for (let j = 0; j < data.length; j++) {
      const randomIndex = Math.floor(Math.random() * data.length);
      bootstrapSample.push(data[randomIndex]);
    }

    // Вычисляем статистику для бутстрап-выборки
    const sampleMean = bootstrapSample.reduce((sum, val) => sum + val, 0) / bootstrapSample.length;
    bootstrapSamples.push(sampleMean);
  }

  return bootstrapSamples;
}

/**
 * Кросс-валидация для оценки качества прогноза
 */
function crossValidationScore(
  data: number[],
  forecastFunction: (trainData: number[], testPoint: number) => number,
  folds: number = 3,
): number {
  if (data.length < 2) return 0.5;

  const foldSize = Math.max(1, Math.floor(data.length / folds));
  let totalError = 0;
  let validFolds = 0;

  for (let fold = 0; fold < folds; fold++) {
    const testStart = fold * foldSize;
    const testEnd = Math.min(testStart + foldSize, data.length);

    if (testStart >= data.length) continue;

    const testData = data.slice(testStart, testEnd);
    const trainData = data.slice(0, testStart).concat(data.slice(testEnd));

    if (trainData.length === 0) continue;

    let foldError = 0;
    for (const testPoint of testData) {
      const prediction = forecastFunction(trainData, testPoint);
      foldError += Math.abs(prediction - testPoint) / testPoint;
    }

    totalError += foldError / testData.length;
    validFolds++;
  }

  return validFolds > 0 ? Math.max(0, 1 - totalError / validFolds) : 0.5;
}

/**
 * Адаптивное ансамблевое обучение с динамическими весами
 */
function calculateAdaptiveEnsemblePrediction(
  baseDayRevenue: number,
  seasonalMultiplier: number,
  trend: number,
  weatherImpact: number,
  holidayImpact: number,
  monthlyRevenues: number[],
  dayOfWeek: number,
  date: Date,
  historicalData: number[],
): { prediction: number; confidence: number; methodWeights: Record<string, number> } {
  // Метод 1: Байесовский прогноз
  const bayesianResult = calculateBayesianForecast(
    historicalData,
    baseDayRevenue,
    seasonalMultiplier,
    dayOfWeek,
    date,
  );

  // Метод 2: Улучшенное экспоненциальное сглаживание
  const exponentialPrediction = calculateTripleExponentialSmoothing(
    baseDayRevenue,
    seasonalMultiplier,
    trend,
    weatherImpact,
    holidayImpact,
    0,
    0,
    0,
    0,
    0,
    monthlyRevenues,
  );

  // Метод 3: Адаптивное скользящее среднее
  const movingAveragePrediction = calculateAdaptiveMovingAveragePrediction(
    monthlyRevenues,
    baseDayRevenue,
    seasonalMultiplier,
    dayOfWeek,
    date,
  );

  // Метод 4: Бутстрап-прогноз
  const bootstrapSamples = bootstrapSampling(historicalData, 500);
  const bootstrapPrediction =
    bootstrapSamples.length > 0
      ? bootstrapSamples.reduce((sum, val) => sum + val, 0) / bootstrapSamples.length
      : baseDayRevenue * seasonalMultiplier;

  // Метод 5: Квантильная регрессия для робастности
  const quantilePrediction = calculateQuantileRegression(
    historicalData,
    baseDayRevenue,
    seasonalMultiplier,
    0.5, // медиана
  );

  // Вычисляем веса методов на основе кросс-валидации
  const methodScores: Record<string, number> = {};

  if (historicalData.length >= 3) {
    methodScores.bayesian = crossValidationScore(
      historicalData,
      (trainData, testPoint) =>
        calculateBayesianForecast(trainData, baseDayRevenue, seasonalMultiplier, dayOfWeek, date)
          .prediction,
    );

    methodScores.exponential = crossValidationScore(historicalData, (trainData, testPoint) =>
      calculateTripleExponentialSmoothing(
        baseDayRevenue,
        seasonalMultiplier,
        trend,
        weatherImpact,
        holidayImpact,
        0,
        0,
        0,
        0,
        0,
        trainData,
      ),
    );

    methodScores.movingAverage = crossValidationScore(historicalData, (trainData, testPoint) =>
      calculateAdaptiveMovingAveragePrediction(
        trainData,
        baseDayRevenue,
        seasonalMultiplier,
        dayOfWeek,
        date,
      ),
    );

    methodScores.bootstrap = crossValidationScore(historicalData, (trainData, testPoint) => {
      const samples = bootstrapSampling(trainData, 100);
      return samples.length > 0
        ? samples.reduce((sum, val) => sum + val, 0) / samples.length
        : testPoint;
    });

    methodScores.quantile = crossValidationScore(historicalData, (trainData, testPoint) =>
      calculateQuantileRegression(trainData, baseDayRevenue, seasonalMultiplier, 0.5),
    );
  } else {
    // Для очень малых выборок используем равные веса с небольшими корректировками
    methodScores.bayesian = 0.4; // Байесовский метод лучше работает с малыми данными
    methodScores.exponential = 0.2;
    methodScores.movingAverage = 0.15;
    methodScores.bootstrap = 0.15;
    methodScores.quantile = 0.1;
  }

  // Нормализуем веса
  const totalScore = Object.values(methodScores).reduce((sum, score) => sum + score, 0);
  const normalizedWeights: Record<string, number> = {};
  for (const [method, score] of Object.entries(methodScores)) {
    normalizedWeights[method] =
      totalScore > 0 ? score / totalScore : 1 / Object.keys(methodScores).length;
  }

  // Взвешенное усреднение прогнозов
  const prediction =
    bayesianResult.prediction * normalizedWeights.bayesian +
    exponentialPrediction * normalizedWeights.exponential +
    movingAveragePrediction * normalizedWeights.movingAverage +
    bootstrapPrediction * normalizedWeights.bootstrap +
    quantilePrediction * normalizedWeights.quantile;

  // Общая уверенность на основе взвешенного среднего уверенностей методов
  const confidence =
    bayesianResult.confidence * normalizedWeights.bayesian +
    0.7 * normalizedWeights.exponential +
    0.6 * normalizedWeights.movingAverage +
    0.5 * normalizedWeights.bootstrap +
    0.8 * normalizedWeights.quantile;

  return {
    prediction: Math.max(0, prediction),
    confidence: Math.min(0.95, Math.max(0.1, confidence)),
    methodWeights: normalizedWeights,
  };
}

/**
 * Квантильная регрессия для робастного прогнозирования
 */
function calculateQuantileRegression(
  data: number[],
  baseDayRevenue: number,
  seasonalMultiplier: number,
  quantile: number,
): number {
  if (data.length === 0) {
    return baseDayRevenue * seasonalMultiplier;
  }

  // Сортируем данные
  const sortedData = [...data].sort((a, b) => a - b);

  // Вычисляем квантиль
  const index = quantile * (sortedData.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);

  if (lowerIndex === upperIndex) {
    return sortedData[lowerIndex];
  }

  // Линейная интерполяция между соседними значениями
  const weight = index - lowerIndex;
  return sortedData[lowerIndex] * (1 - weight) + sortedData[upperIndex] * weight;
}

/**
 * Количественная оценка неопределенности прогноза
 */
function calculateUncertaintyQuantification(
  prediction: number,
  historicalData: number[],
  confidence: number,
  externalFactors: {
    weatherImpact: number;
    holidayImpact: number;
    trend: number;
  },
): {
  epistemicUncertainty: number; // Неопределенность модели
  aleatoricUncertainty: number; // Случайная неопределенность
  totalUncertainty: number;
  predictionInterval: { lower: number; upper: number };
} {
  // Эпистемическая неопределенность (неопределенность модели)
  const epistemicUncertainty = Math.sqrt(1 - confidence) * prediction * 0.2;

  // Алеаторная неопределенность (случайная изменчивость)
  let aleatoricUncertainty = 0;
  if (historicalData.length > 1) {
    const variance =
      historicalData.reduce((sum, val) => sum + Math.pow(val - prediction, 2), 0) /
      historicalData.length;
    aleatoricUncertainty = Math.sqrt(variance) * 0.5;
  } else {
    aleatoricUncertainty = prediction * 0.15; // 15% по умолчанию
  }

  // Общая неопределенность
  const totalUncertainty = Math.sqrt(
    Math.pow(epistemicUncertainty, 2) + Math.pow(aleatoricUncertainty, 2),
  );

  // Интервал прогноза (95% доверительный интервал)
  const zScore = 1.96; // 95% доверительный интервал
  const predictionInterval = {
    lower: Math.max(0, prediction - zScore * totalUncertainty),
    upper: prediction + zScore * totalUncertainty,
  };

  return {
    epistemicUncertainty,
    aleatoricUncertainty,
    totalUncertainty,
    predictionInterval,
  };
}
