import { addDays, differenceInCalendarDays, formatISO, parseISO, startOfDay } from 'date-fns';
import {
  type ProfitabilitySeriesResponse,
  type ProfitabilitySeriesPoint,
  type ProfitabilitySummaryResponse,
  type ProfitabilitySummaryKPI,
  type ProfitabilityKPIDelta,
  type ProfitabilityTableResponse,
  type ProfitabilityTableEntry,
} from '@shared/schema';
import { storage } from '../storage';

interface DailyAggregate {
  date: string;
  revenueGross: number;
  returns: number;
  corrections: number;
  revenueNet: number;
  receiptsCount: number;
  returnChecks: number;
  correctionsCount: number;
  averageCheck: number;
  returnRate: number;
  cogsTotal: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  movingAverage7: number | null;
  movingAverage28: number | null;
}

interface BuildOptions {
  from?: Date;
  to?: Date;
}

const clampRate = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
};

async function buildDailyAggregates(): Promise<DailyAggregate[]> {
  const records = await storage.listAllProfitabilityRecords();
  const cogsDaily = await storage.listCogsDaily();
  const cogsByDate = new Map<string, number>();

  cogsDaily.forEach((item) => {
    cogsByDate.set(item.reportDate, item.cogsTotal ?? 0);
  });

  const map = new Map<
    string,
    {
      revenueCash: number;
      revenueCashless: number;
      refundCash: number;
      refundCashless: number;
      correctionCash: number;
      correctionCashless: number;
      receiptsCount: number;
      returnChecks: number;
      correctionsCount: number;
      cogsAggregate: number;
      hasCogsFromRecords: boolean;
    }
  >();

  records.forEach((record) => {
    const dateKey = formatISO(startOfDay(record.reportDate), { representation: 'date' });
    if (!map.has(dateKey)) {
      map.set(dateKey, {
        revenueCash: 0,
        revenueCashless: 0,
        refundCash: 0,
        refundCashless: 0,
        correctionCash: 0,
        correctionCashless: 0,
        receiptsCount: 0,
        returnChecks: 0,
        correctionsCount: 0,
        cogsAggregate: 0,
        hasCogsFromRecords: false,
      });
    }

    const entry = map.get(dateKey)!;
    entry.revenueCash += record.cashIncome ?? 0;
    entry.revenueCashless += record.cashlessIncome ?? 0;
    entry.refundCash += record.cashReturn ?? 0;
    entry.refundCashless += record.cashlessReturn ?? 0;
    entry.correctionCash += record.correctionCash ?? 0;
    entry.correctionCashless += record.correctionCashless ?? 0;
    entry.receiptsCount += record.incomeChecks ?? 0;
    entry.returnChecks += record.returnChecks ?? 0;
    entry.correctionsCount += record.correctionChecks ?? 0;
    if (record.cogsTotal !== null && record.cogsTotal !== undefined) {
      entry.cogsAggregate += record.cogsTotal;
      entry.hasCogsFromRecords = true;
    }
  });

  const sortedDates = Array.from(map.keys()).sort();
  const aggregates: DailyAggregate[] = [];

  const ma7Window: number[] = [];
  const ma28Window: number[] = [];
  let sum7 = 0;
  let sum28 = 0;

  sortedDates.forEach((dateKey) => {
    const data = map.get(dateKey)!;
    const revenueGross = data.revenueCash + data.revenueCashless;
    const returns = data.refundCash + data.refundCashless;
    const corrections = data.correctionCash + data.correctionCashless;
    const revenueNet = revenueGross - returns + corrections;
    const averageCheck =
      data.receiptsCount > 0 ? revenueGross / data.receiptsCount : revenueGross || 0;
    const returnRate = revenueGross > 0 ? clampRate(returns / revenueGross) : 0;

    const cogsTotal = cogsByDate.has(dateKey)
      ? cogsByDate.get(dateKey)!
      : data.hasCogsFromRecords
        ? data.cogsAggregate
        : null;
    const grossProfit =
      cogsTotal === null
        ? null
        : Number.isFinite(revenueNet - cogsTotal)
          ? revenueNet - cogsTotal
          : null;
    // Валовая маржа рассчитывается от финальной выручки (revenueNet)
    // Формула: маржа = (выручка - себестоимость) / выручка × 100
    const grossMarginPct =
      grossProfit === null || revenueNet === 0 ? null : grossProfit / revenueNet;

    sum7 += revenueNet;
    ma7Window.push(revenueNet);
    if (ma7Window.length > 7) {
      sum7 -= ma7Window.shift() ?? 0;
    }

    sum28 += revenueNet;
    ma28Window.push(revenueNet);
    if (ma28Window.length > 28) {
      sum28 -= ma28Window.shift() ?? 0;
    }

    const ma7 = sum7 / ma7Window.length;
    const ma28 = sum28 / ma28Window.length;

    aggregates.push({
      date: dateKey,
      revenueGross,
      returns,
      corrections,
      revenueNet,
      receiptsCount: data.receiptsCount,
      returnChecks: data.returnChecks,
      correctionsCount: data.correctionsCount,
      averageCheck,
      returnRate,
      cogsTotal,
      grossProfit,
      grossMarginPct,
      movingAverage7: Number.isFinite(ma7) ? ma7 : null,
      movingAverage28: Number.isFinite(ma28) ? ma28 : null,
    });
  });

  return aggregates;
}

function filterAggregates(
  aggregates: DailyAggregate[],
  { from, to }: BuildOptions,
): DailyAggregate[] {
  if (!from && !to) {
    return aggregates;
  }

  return aggregates.filter((item) => {
    const date = parseISO(item.date);
    if (from && date < startOfDay(from)) {
      return false;
    }
    if (to && date > startOfDay(to)) {
      return false;
    }
    return true;
  });
}

function summarizePeriod(daily: DailyAggregate[]): ProfitabilitySummaryKPI {
  const totals = daily.reduce(
    (acc, day) => {
      acc.revenueGross += day.revenueGross;
      acc.returns += day.returns;
      acc.corrections += day.corrections;
      acc.revenueNet += day.revenueNet;
      acc.receiptsCount += day.receiptsCount;
      acc.returnChecks += day.returnChecks;
      if (day.cogsTotal !== null) {
        acc.cogsTotal += day.cogsTotal;
        acc.hasCogs = true;
      }
      acc.grossProfit += day.grossProfit ?? 0;
      if (day.grossProfit !== null) {
        acc.grossProfitCount += 1;
      }
      if (day.grossMarginPct !== null) {
        acc.grossMarginSum += day.grossMarginPct;
        acc.grossMarginCount += 1;
      }
      return acc;
    },
    {
      revenueGross: 0,
      returns: 0,
      corrections: 0,
      revenueNet: 0,
      receiptsCount: 0,
      returnChecks: 0,
      cogsTotal: 0,
      hasCogs: false,
      grossProfit: 0,
      grossProfitCount: 0,
      grossMarginSum: 0,
      grossMarginCount: 0,
    },
  );

  const averageCheck =
    totals.receiptsCount > 0
      ? totals.revenueGross / totals.receiptsCount
      : totals.revenueGross || 0;
  const returnRate = totals.revenueGross > 0 ? clampRate(totals.returns / totals.revenueGross) : 0;

  const lastDay = daily[daily.length - 1];

  const grossProfitValue =
    totals.hasCogs && totals.grossProfitCount > 0 ? totals.grossProfit : null;
  const grossMarginValue =
    totals.hasCogs && totals.grossMarginCount > 0
      ? totals.grossMarginSum / totals.grossMarginCount
      : null;

  return {
    revenueGross: totals.revenueGross,
    returns: totals.returns,
    corrections: totals.corrections,
    revenueNet: totals.revenueNet,
    receiptsCount: totals.receiptsCount,
    averageCheck,
    returnChecks: totals.returnChecks,
    returnRate,
    revenueGrowthRate: null,
    movingAverage7: lastDay?.movingAverage7 ?? null,
    movingAverage28: lastDay?.movingAverage28 ?? null,
    grossProfit: grossProfitValue,
    grossMarginPct: grossMarginValue,
  };
}

function computeDelta(
  current: ProfitabilitySummaryKPI,
  previous: ProfitabilitySummaryKPI | null,
): ProfitabilityKPIDelta {
  if (!previous) {
    return {
      revenueGross: null,
      returns: null,
      corrections: null,
      revenueNet: null,
      receiptsCount: null,
      averageCheck: null,
      returnChecks: null,
      returnRate: null,
      revenueGrowthRate: null,
      grossProfit: current.grossProfit === null ? undefined : null,
      grossMarginPct: current.grossMarginPct === null ? undefined : null,
    };
  }

  return {
    revenueGross: current.revenueGross - previous.revenueGross,
    returns: current.returns - previous.returns,
    corrections: current.corrections - previous.corrections,
    revenueNet: current.revenueNet - previous.revenueNet,
    receiptsCount: current.receiptsCount - previous.receiptsCount,
    averageCheck: current.averageCheck - previous.averageCheck,
    returnChecks: current.returnChecks - previous.returnChecks,
    returnRate: current.returnRate - previous.returnRate,
    revenueGrowthRate:
      current.revenueGrowthRate !== null && previous.revenueGrowthRate !== null
        ? current.revenueGrowthRate - previous.revenueGrowthRate
        : null,
    grossProfit:
      (current.grossProfit ?? null) !== null && (previous.grossProfit ?? null) !== null
        ? (current.grossProfit ?? 0) - (previous.grossProfit ?? 0)
        : (current.grossProfit ?? null) === null
          ? undefined
          : null,
    grossMarginPct:
      (current.grossMarginPct ?? null) !== null && (previous.grossMarginPct ?? null) !== null
        ? (current.grossMarginPct ?? 0) - (previous.grossMarginPct ?? 0)
        : (current.grossMarginPct ?? null) === null
          ? undefined
          : null,
  };
}

function resolvePeriodBounds(
  daily: DailyAggregate[],
  fallbackFrom?: Date,
  fallbackTo?: Date,
): { from: string; to: string } {
  if (daily.length === 0) {
    const from = fallbackFrom ? startOfDay(fallbackFrom) : new Date();
    const to = fallbackTo ? startOfDay(fallbackTo) : from;
    return {
      from: formatISO(startOfDay(from), { representation: 'date' }),
      to: formatISO(startOfDay(to), { representation: 'date' }),
    };
  }

  return {
    from: daily[0].date,
    to: daily[daily.length - 1].date,
  };
}

export async function calculateProfitabilitySummary(
  params: BuildOptions,
): Promise<ProfitabilitySummaryResponse> {
  const aggregates = await buildDailyAggregates();
  const currentDaily = filterAggregates(aggregates, params);

  const hasCogs = currentDaily.some((day) => day.cogsTotal !== null);
  const currentKpi = summarizePeriod(currentDaily);

  const periodInfo = resolvePeriodBounds(currentDaily, params.from, params.to);

  const daysInPeriod = Math.max(
    1,
    differenceInCalendarDays(parseISO(periodInfo.to), parseISO(periodInfo.from)) + 1,
  );

  const previousTo = addDays(parseISO(periodInfo.from), -1);
  const previousFrom = addDays(previousTo, -(daysInPeriod - 1));

  const previousDaily = filterAggregates(aggregates, {
    from: previousFrom,
    to: previousTo,
  });

  const previousKpi = previousDaily.length > 0 ? summarizePeriod(previousDaily) : null;

  if (previousKpi && previousKpi.revenueNet > 0) {
    currentKpi.revenueGrowthRate = clampRate(currentKpi.revenueNet / previousKpi.revenueNet - 1);
    previousKpi.revenueGrowthRate = 0;
  } else {
    currentKpi.revenueGrowthRate = null;
  }

  const delta = computeDelta(currentKpi, previousKpi);

  return {
    period: periodInfo,
    previousPeriod: resolvePeriodBounds(previousDaily, previousFrom, previousTo),
    current: currentKpi,
    previous: previousKpi,
    delta,
    hasCogs,
  };
}

export async function calculateProfitabilitySeries(
  params: BuildOptions,
): Promise<ProfitabilitySeriesResponse> {
  const aggregates = await buildDailyAggregates();
  const filtered = filterAggregates(aggregates, params);

  const points: ProfitabilitySeriesPoint[] = filtered.map((day) => ({
    date: day.date,
    revenueGross: day.revenueGross,
    returns: day.returns,
    corrections: day.corrections,
    revenueNet: day.revenueNet,
    receiptsCount: day.receiptsCount,
    averageCheck: day.averageCheck,
    returnChecks: day.returnChecks,
    returnRate: day.returnRate,
    cogsTotal: day.cogsTotal,
    grossProfit: day.grossProfit,
    grossMarginPct: day.grossMarginPct,
    movingAverage7: day.movingAverage7,
    movingAverage28: day.movingAverage28,
  }));

  return {
    period: resolvePeriodBounds(filtered, params.from, params.to),
    points,
    hasCogs: filtered.some((day) => day.cogsTotal !== null),
  };
}

export async function calculateProfitabilityTable(
  params: BuildOptions,
): Promise<ProfitabilityTableResponse> {
  const aggregates = await buildDailyAggregates();
  const filtered = filterAggregates(aggregates, params);

  const rows: ProfitabilityTableEntry[] = filtered.map((day) => ({
    date: day.date,
    revenueGross: day.revenueGross,
    returns: day.returns,
    corrections: day.corrections,
    revenueNet: day.revenueNet,
    receiptsCount: day.receiptsCount,
    returnChecks: day.returnChecks,
    correctionsCount: day.correctionsCount,
    averageCheck: day.averageCheck,
    refundRatio: day.returnRate,
    cogsTotal: day.cogsTotal,
    grossProfit: day.grossProfit,
    grossMarginPct: day.grossMarginPct,
  }));

  return {
    period: resolvePeriodBounds(filtered, params.from, params.to),
    rows,
    hasCogs: filtered.some((day) => day.cogsTotal !== null),
  };
}

// TODO: Extend with ABC/XYZ analysis, Pareto by days/categories, peak days/hours,
// and seasonality coefficients once foundational KPI endpoints are stable.
