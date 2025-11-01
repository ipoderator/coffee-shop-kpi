export const MIN_REVENUE_ANCHOR = 20000;
export const MAX_REVENUE_ANCHOR = 60000;

export type AnomalyTag = 'revenue-low' | 'revenue-high' | 'checks-low' | 'checks-high';

export interface RevenueThresholds {
  lower: number;
  upper: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  sampleSize: number;
}

export interface ChecksThresholds {
  lower: number;
  upper: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  sampleSize: number;
}

export interface DailyThresholds {
  revenue: RevenueThresholds;
  checks: ChecksThresholds;
}

const isPositiveNumber = (value: number | undefined | null) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export const getPercentile = (values: number[], percentile: number) => {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const rank = (values.length - 1) * percentile;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  if (upper >= values.length) {
    return values[values.length - 1];
  }

  return values[lower] * (1 - weight) + values[upper] * weight;
};

const computeDistribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = getPercentile(sorted, 0.25);
  const median = getPercentile(sorted, 0.5);
  const q3 = getPercentile(sorted, 0.75);
  const iqr = q3 - q1;

  return {
    sorted,
    q1,
    median,
    q3,
    iqr,
    sampleSize: sorted.length,
  };
};

export const buildRevenueThresholds = (values: number[]): RevenueThresholds => {
  if (values.length === 0) {
    return {
      lower: 0,
      upper: 0,
      median: 0,
      q1: 0,
      q3: 0,
      iqr: 0,
      sampleSize: 0,
    };
  }

  const { q1, median, q3, iqr, sampleSize } = computeDistribution(values);

  const lowerCandidates = [q1, median * 0.6].filter(isPositiveNumber) as number[];
  const dynamicLower =
    lowerCandidates.length > 0 ? Math.min(...lowerCandidates) : MIN_REVENUE_ANCHOR;
  const lower =
    sampleSize < 6
      ? Math.max(MIN_REVENUE_ANCHOR, dynamicLower)
      : Math.max(dynamicLower, MIN_REVENUE_ANCHOR * 0.5);

  const upperCandidates = [
    q3,
    median * 1.6,
    q3 + iqr * 1.5,
    MIN_REVENUE_ANCHOR * 3, // ориентир около 60к при малом количестве данных
  ].filter(isPositiveNumber) as number[];
  const dynamicUpper =
    upperCandidates.length > 0 ? Math.max(...upperCandidates) : MAX_REVENUE_ANCHOR;
  const upper =
    sampleSize < 6
      ? Math.max(MAX_REVENUE_ANCHOR, dynamicUpper)
      : Math.max(dynamicUpper, MAX_REVENUE_ANCHOR * 0.5);

  // Ensure lower is always less than upper
  const safeLower = lower >= upper ? upper * 0.7 : lower;

  return {
    lower: safeLower,
    upper,
    median,
    q1,
    q3,
    iqr,
    sampleSize,
  };
};

export const buildChecksThresholds = (values: number[]): ChecksThresholds => {
  if (values.length === 0) {
    return {
      lower: 0,
      upper: 0,
      median: 0,
      q1: 0,
      q3: 0,
      iqr: 0,
      sampleSize: 0,
    };
  }

  const { q1, median, q3, iqr, sampleSize } = computeDistribution(values);

  const lowerCandidates = [q1, median * 0.6].filter(isPositiveNumber) as number[];
  const dynamicLower =
    lowerCandidates.length > 0 ? Math.min(...lowerCandidates) : Math.max(1, median * 0.5);
  const lower = Math.max(dynamicLower, Math.max(1, median * 0.4));

  const upperCandidates = [q3, median * 1.6, q3 + iqr * 1.5].filter(isPositiveNumber) as number[];
  const dynamicUpper =
    upperCandidates.length > 0 ? Math.max(...upperCandidates) : Math.max(5, median * 1.8);
  const upper =
    sampleSize < 6 && isPositiveNumber(median)
      ? Math.max(dynamicUpper, median * 1.8)
      : dynamicUpper;

  const safeLower = lower >= upper ? Math.max(upper * 0.7, 1) : lower;

  return {
    lower: safeLower,
    upper,
    median,
    q1,
    q3,
    iqr,
    sampleSize,
  };
};

export const classifyDailyAnomalies = (
  revenue: number,
  checks: number,
  thresholds: DailyThresholds,
): AnomalyTag[] => {
  const tags: AnomalyTag[] = [];

  if (
    isPositiveNumber(thresholds.revenue.lower) &&
    revenue > 0 &&
    revenue < thresholds.revenue.lower
  ) {
    tags.push('revenue-low');
  }

  if (isPositiveNumber(thresholds.revenue.upper) && revenue > thresholds.revenue.upper) {
    tags.push('revenue-high');
  }

  if (isPositiveNumber(thresholds.checks.lower) && checks > 0 && checks < thresholds.checks.lower) {
    tags.push('checks-low');
  }

  if (isPositiveNumber(thresholds.checks.upper) && checks > thresholds.checks.upper) {
    tags.push('checks-high');
  }

  return tags;
};
