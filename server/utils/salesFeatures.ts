import {
  differenceInCalendarDays,
  getDay,
  getDayOfYear,
  getISOWeek,
  getMonth,
  startOfDay,
} from 'date-fns';
import type { Transaction } from '@shared/schema';

interface DailyAggregate {
  date: Date;
  amount: number;
  checksCount: number;
  refundChecksCount: number;
}

interface AggregationResult {
  aggregates: DailyAggregate[];
  indexMap: Map<number, number[]>;
}

export interface FeatureEngineeringOptions {
  defaultRevenue?: number;
  defaultChecks?: number;
}

export interface FeatureEngineeringResult {
  aggregates: DailyAggregate[];
  featureMaps: Record<string, number>[];
  targets: number[];
  featureNames: string[];
  indexMap: Map<number, number[]>;
}

const FEATURE_NAMES: readonly string[] = [
  'dayOfWeekSin',
  'dayOfWeekCos',
  'isoWeekSin',
  'isoWeekCos',
  'monthSin',
  'monthCos',
  'dayOfMonthSin',
  'dayOfMonthCos',
  'isWeekend',
  'yearProgress',
  'daysSinceStart',
  'daysSinceStartSquared',
  'logChecksCount',
  'checksRollingMean7',
  'checksRollingMean30',
  'checksMomentum7',
  'refundRate',
  'revenueLag1',
  'revenueLag7',
  'revenueLag14',
  'revenueLag30',
  'revenueRollingMean7',
  'revenueRollingMean14',
  'revenueRollingMean30',
  'revenueRollingStd7',
  'revenueRollingStd14',
  'revenueMomentum7',
  'revenueMomentum14',
  'revenueMomentumTrend',
  'dowSeasonality',
  'dowDeviation',
  'monthSeasonality',
  'monthDeviation',
  'cumulativeMean',
  'cumulativeTrend',
];

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function aggregateTransactions(transactions: Transaction[]): AggregationResult {
  const dayMap = new Map<string, { aggregate: DailyAggregate; indices: number[] }>();

  transactions.forEach((transaction, index) => {
    const rawDate =
      transaction.date instanceof Date ? transaction.date : new Date(transaction.date);
    if (!rawDate || Number.isNaN(rawDate.getTime())) {
      return;
    }

    const day = startOfDay(rawDate);
    const key = day.toISOString();

    const amount = toNumber((transaction as any).amount);
    const checksCount = toNumber(transaction.checksCount ?? 1);
    const refundChecksCount = toNumber(transaction.refundChecksCount ?? 0);

    let entry = dayMap.get(key);

    if (!entry) {
      entry = {
        aggregate: {
          date: day,
          amount: 0,
          checksCount: 0,
          refundChecksCount: 0,
        },
        indices: [],
      };
      dayMap.set(key, entry);
    }

    entry.aggregate.amount += amount;
    entry.aggregate.checksCount += checksCount;
    entry.aggregate.refundChecksCount += refundChecksCount;
    entry.indices.push(index);
  });

  const sorted = Array.from(dayMap.values()).sort(
    (a, b) => a.aggregate.date.getTime() - b.aggregate.date.getTime(),
  );

  const aggregates = sorted.map((item) => item.aggregate);
  const indexMap = new Map<number, number[]>();

  sorted.forEach((item, index) => {
    indexMap.set(index, item.indices);
  });

  return { aggregates, indexMap };
}

function encodeCycle(value: number, period: number): { sin: number; cos: number } {
  const angle = (2 * Math.PI * value) / period;
  return {
    sin: Math.sin(angle),
    cos: Math.cos(angle),
  };
}

function meanOfLast(values: number[], window: number, fallback: number): number {
  if (values.length === 0) {
    return fallback;
  }

  const start = Math.max(0, values.length - window);
  const slice = values.slice(start);

  if (slice.length === 0) {
    return fallback;
  }

  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / slice.length;
}

function stdOfLast(values: number[], window: number): number {
  if (values.length === 0) {
    return 0;
  }

  const start = Math.max(0, values.length - window);
  const slice = values.slice(start);

  if (slice.length <= 1) {
    return 0;
  }

  const mean = slice.reduce((acc, value) => acc + value, 0) / slice.length;
  const variance =
    slice.reduce((acc, value) => acc + (value - mean) * (value - mean), 0) / (slice.length - 1);

  return Math.sqrt(Math.max(variance, 0));
}

function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  return numerator / denominator;
}

export function engineerDailyFeatures(
  transactions: Transaction[],
  options: FeatureEngineeringOptions = {},
): FeatureEngineeringResult {
  const { aggregates, indexMap } = aggregateTransactions(transactions);

  if (aggregates.length === 0) {
    return {
      aggregates: [],
      featureMaps: [],
      targets: [],
      featureNames: [...FEATURE_NAMES],
      indexMap,
    };
  }

  const defaultRevenue = Number.isFinite(options.defaultRevenue ?? undefined)
    ? Number(options.defaultRevenue)
    : aggregates.reduce((acc, record) => acc + record.amount, 0) / aggregates.length;

  const defaultChecks = Number.isFinite(options.defaultChecks ?? undefined)
    ? Number(options.defaultChecks)
    : aggregates.reduce((acc, record) => acc + record.checksCount, 0) / aggregates.length || 1;

  const fallbackRevenue = Number.isFinite(defaultRevenue) ? defaultRevenue : 0;
  const fallbackChecks = Number.isFinite(defaultChecks) && defaultChecks > 0 ? defaultChecks : 1;

  const firstDate = startOfDay(aggregates[0].date);
  const featureMaps: Record<string, number>[] = [];
  const targets: number[] = [];

  const revenueHistory: number[] = [];
  const checksHistory: number[] = [];
  const dowStats = new Map<number, { sum: number; count: number }>();
  const monthStats = new Map<number, { sum: number; count: number }>();

  let cumulativeRevenue = 0;

  aggregates.forEach((record, index) => {
    const features: Record<string, number> = {};
    const currentDate = startOfDay(record.date);
    const dayOfWeek = getDay(currentDate);
    const month = getMonth(currentDate);
    const isoWeek = getISOWeek(currentDate);
    const dayOfYear = getDayOfYear(currentDate);

    const { sin: dayOfWeekSin, cos: dayOfWeekCos } = encodeCycle(dayOfWeek, 7);
    const { sin: isoWeekSin, cos: isoWeekCos } = encodeCycle(isoWeek - 1, 52);
    const { sin: monthSin, cos: monthCos } = encodeCycle(month, 12);
    const { sin: dayOfMonthSin, cos: dayOfMonthCos } = encodeCycle(currentDate.getDate() - 1, 31);

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
    const daysSinceStart = differenceInCalendarDays(currentDate, firstDate);
    const daysSinceStartSquared = daysSinceStart * daysSinceStart;

    const checks = record.checksCount > 0 ? record.checksCount : fallbackChecks;
    const logChecksCount = Math.log1p(checks);
    const checksMean7 = meanOfLast(checksHistory, 7, fallbackChecks);
    const checksMean30 = meanOfLast(checksHistory, 30, fallbackChecks);
    const checksMomentum7 = logChecksCount - Math.log1p(checksMean7);

    const refundRate = safeDivide(record.refundChecksCount, Math.max(checks, 1), 0);

    const revenueLag1 =
      revenueHistory.length >= 1 ? revenueHistory[revenueHistory.length - 1] : fallbackRevenue;
    const revenueLag7 =
      revenueHistory.length >= 7 ? revenueHistory[revenueHistory.length - 7] : fallbackRevenue;
    const revenueLag14 =
      revenueHistory.length >= 14 ? revenueHistory[revenueHistory.length - 14] : fallbackRevenue;
    const revenueLag30 =
      revenueHistory.length >= 30 ? revenueHistory[revenueHistory.length - 30] : fallbackRevenue;

    const revenueMean7 = meanOfLast(revenueHistory, 7, fallbackRevenue);
    const revenueMean14 = meanOfLast(revenueHistory, 14, fallbackRevenue);
    const revenueMean30 = meanOfLast(revenueHistory, 30, fallbackRevenue);

    const revenueStd7 = stdOfLast(revenueHistory, 7);
    const revenueStd14 = stdOfLast(revenueHistory, 14);

    const revenueMomentum7 = revenueLag1 - revenueMean7;
    const revenueMomentum14 = revenueLag1 - revenueMean14;
    const revenueMomentumTrend = revenueMean7 - revenueMean30;

    const dowStat = dowStats.get(dayOfWeek);
    const dowSeasonality = dowStat ? dowStat.sum / Math.max(dowStat.count, 1) : revenueMean7;
    const monthStat = monthStats.get(month);
    const monthSeasonality = monthStat
      ? monthStat.sum / Math.max(monthStat.count, 1)
      : revenueMean30;

    const dowDeviation = revenueLag1 - dowSeasonality;
    const monthDeviation = revenueLag1 - monthSeasonality;

    const cumulativeMean =
      revenueHistory.length > 0 ? cumulativeRevenue / revenueHistory.length : fallbackRevenue;
    const cumulativeTrend = revenueLag1 - cumulativeMean;

    const yearProgress = safeDivide(dayOfYear - 1, 365, 0);

    const featureValues: Record<string, number> = {
      dayOfWeekSin,
      dayOfWeekCos,
      isoWeekSin,
      isoWeekCos,
      monthSin,
      monthCos,
      dayOfMonthSin,
      dayOfMonthCos,
      isWeekend,
      yearProgress,
      daysSinceStart,
      daysSinceStartSquared,
      logChecksCount,
      checksRollingMean7: checksMean7,
      checksRollingMean30: checksMean30,
      checksMomentum7,
      refundRate,
      revenueLag1,
      revenueLag7,
      revenueLag14,
      revenueLag30,
      revenueRollingMean7: revenueMean7,
      revenueRollingMean14: revenueMean14,
      revenueRollingMean30: revenueMean30,
      revenueRollingStd7: revenueStd7,
      revenueRollingStd14: revenueStd14,
      revenueMomentum7,
      revenueMomentum14,
      revenueMomentumTrend,
      dowSeasonality,
      dowDeviation,
      monthSeasonality,
      monthDeviation,
      cumulativeMean,
      cumulativeTrend,
    };

    FEATURE_NAMES.forEach((name) => {
      features[name] = Number.isFinite(featureValues[name]) ? featureValues[name] : 0;
    });

    featureMaps.push(features);
    targets.push(record.amount);

    revenueHistory.push(record.amount);
    checksHistory.push(checks);
    cumulativeRevenue += record.amount;

    const updatedDowStat = dowStats.get(dayOfWeek) ?? { sum: 0, count: 0 };
    updatedDowStat.sum += record.amount;
    updatedDowStat.count += 1;
    dowStats.set(dayOfWeek, updatedDowStat);

    const updatedMonthStat = monthStats.get(month) ?? { sum: 0, count: 0 };
    updatedMonthStat.sum += record.amount;
    updatedMonthStat.count += 1;
    monthStats.set(month, updatedMonthStat);
  });

  return {
    aggregates,
    featureMaps,
    targets,
    featureNames: [...FEATURE_NAMES],
    indexMap,
  };
}

export function engineerForecastFeatures(
  transactions: Transaction[],
  options: FeatureEngineeringOptions = {},
): FeatureEngineeringResult {
  return engineerDailyFeatures(transactions, options);
}
