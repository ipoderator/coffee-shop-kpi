import { endOfDay, formatISO, max, min, startOfDay } from 'date-fns';
import type {
  ProfitabilityAnalyticsResponse,
  ProfitabilityDailyPoint,
  ProfitabilityDatasetInfo,
  ProfitabilityKPIs,
  ProfitabilityRecord,
} from '@shared/schema';

const toNumber = (value: number | null | undefined): number =>
  Number.isFinite(value) ? Number(value) : 0;

const clampRate = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

interface BuildAnalyticsOptions {
  dataset: ProfitabilityDatasetInfo;
  records: ProfitabilityRecord[];
  filter?: {
    from?: Date;
    to?: Date;
  };
}

interface AggregatedDay {
  key: string;
  date: Date;
  cashIncome: number;
  cashlessIncome: number;
  cashReturn: number;
  cashlessReturn: number;
  correctionCash: number;
  correctionCashless: number;
  incomeChecks: number;
  returnChecks: number;
  correctionChecks: number;
  cogsTotal: number;
}

function aggregateByDay(records: ProfitabilityRecord[]): AggregatedDay[] {
  const map = new Map<string, AggregatedDay>();

  records.forEach((record) => {
    const date = startOfDay(record.reportDate);
    const key = formatISO(date, { representation: 'date' });

    if (!map.has(key)) {
      map.set(key, {
        key,
        date,
        cashIncome: 0,
        cashlessIncome: 0,
        cashReturn: 0,
        cashlessReturn: 0,
        correctionCash: 0,
        correctionCashless: 0,
        incomeChecks: 0,
        returnChecks: 0,
        correctionChecks: 0,
        cogsTotal: 0,
      });
    }

    const entry = map.get(key)!;
    entry.cashIncome += toNumber(record.cashIncome);
    entry.cashlessIncome += toNumber(record.cashlessIncome);
    entry.cashReturn += toNumber(record.cashReturn);
    entry.cashlessReturn += toNumber(record.cashlessReturn);
    entry.correctionCash += toNumber(record.correctionCash);
    entry.correctionCashless += toNumber(record.correctionCashless);
    entry.incomeChecks += toNumber(record.incomeChecks);
    entry.returnChecks += toNumber(record.returnChecks);
    entry.correctionChecks += toNumber(record.correctionChecks);
    entry.cogsTotal += toNumber(record.cogsTotal);
  });

  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

function buildDailyPoints(aggregated: AggregatedDay[]): ProfitabilityDailyPoint[] {
  return aggregated.map((entry) => {
    const grossRevenue = entry.cashIncome + entry.cashlessIncome;
    const returns = entry.cashReturn + entry.cashlessReturn;
    const corrections = entry.correctionCash + entry.correctionCashless;
    const netRevenue = grossRevenue - returns + corrections;
    const cogsTotal = entry.cogsTotal;
    const grossProfit = netRevenue - cogsTotal;
    const margin = grossRevenue > 0 ? grossProfit / grossRevenue : 0;

    return {
      date: formatISO(entry.date, { representation: 'date' }),
      grossRevenue,
      netRevenue,
      returns,
      corrections,
      cashIncome: entry.cashIncome,
      cashlessIncome: entry.cashlessIncome,
      cashReturn: entry.cashReturn,
      cashlessReturn: entry.cashlessReturn,
      incomeChecks: entry.incomeChecks,
      returnChecks: entry.returnChecks,
      correctionChecks: entry.correctionChecks,
      cogsTotal,
      grossProfit,
      margin,
    };
  });
}

function buildKPIs(daily: ProfitabilityDailyPoint[]): ProfitabilityKPIs {
  const totals = daily.reduce(
    (acc, day) => {
      acc.grossRevenue += day.grossRevenue;
      acc.netRevenue += day.netRevenue;
      acc.returns += day.returns;
      acc.corrections += day.corrections;
      acc.cashIncome += day.cashIncome;
      acc.cashlessIncome += day.cashlessIncome;
      acc.incomeChecks += day.incomeChecks;
      acc.returnChecks += day.returnChecks;
      acc.correctionChecks += day.correctionChecks;
      acc.cogsTotal += toNumber(day.cogsTotal);
      return acc;
    },
    {
      grossRevenue: 0,
      netRevenue: 0,
      returns: 0,
      corrections: 0,
      cashIncome: 0,
      cashlessIncome: 0,
      incomeChecks: 0,
      returnChecks: 0,
      correctionChecks: 0,
      cogsTotal: 0,
    },
  );

  const averageCheck =
    totals.incomeChecks > 0 ? totals.netRevenue / totals.incomeChecks : totals.netRevenue;
  const returnRate = totals.grossRevenue > 0 ? totals.returns / totals.grossRevenue : 0;
  const cashShare = totals.grossRevenue > 0 ? totals.cashIncome / totals.grossRevenue : 0;
  const cashlessShare = totals.grossRevenue > 0 ? totals.cashlessIncome / totals.grossRevenue : 0;
  const grossProfit = totals.netRevenue - totals.cogsTotal;
  const margin = totals.grossRevenue > 0 ? grossProfit / totals.grossRevenue : 0;

  return {
    grossRevenue: totals.grossRevenue,
    netRevenue: totals.netRevenue,
    returns: totals.returns,
    corrections: totals.corrections,
    averageCheck,
    incomeChecks: totals.incomeChecks,
    returnRate: clampRate(returnRate),
    cashShare: clampRate(cashShare),
    cashlessShare: clampRate(cashlessShare),
    cogsTotal: totals.cogsTotal,
    grossProfit,
    margin,
  };
}

export function buildProfitabilityAnalytics({
  dataset,
  records,
  filter,
}: BuildAnalyticsOptions): ProfitabilityAnalyticsResponse {
  const fromBoundary = filter?.from ? startOfDay(filter.from) : null;
  const toBoundary = filter?.to ? endOfDay(filter.to) : null;

  const filtered = records.filter((record) => {
    const ts = record.reportDate.getTime();
    if (fromBoundary && ts < fromBoundary.getTime()) {
      return false;
    }
    if (toBoundary && ts > toBoundary.getTime()) {
      return false;
    }
    return true;
  });

  const effectiveRecords = filtered.length > 0 ? filtered : [];
  const aggregated = aggregateByDay(effectiveRecords);
  const daily = buildDailyPoints(aggregated);
  const kpi = buildKPIs(daily);

  let periodFrom: Date | null = null;
  let periodTo: Date | null = null;

  if (effectiveRecords.length > 0) {
    periodFrom = effectiveRecords[0].reportDate;
    periodTo = effectiveRecords[effectiveRecords.length - 1].reportDate;

    effectiveRecords.forEach((record) => {
      periodFrom = periodFrom ? min([periodFrom, record.reportDate]) : record.reportDate;
      periodTo = periodTo ? max([periodTo, record.reportDate]) : record.reportDate;
    });
  }

  if (!periodFrom) {
    periodFrom = fromBoundary ?? new Date(dataset.periodStart);
  }

  if (!periodTo) {
    periodTo = toBoundary ?? new Date(dataset.periodEnd);
  }

  return {
    dataset,
    period: {
      from: startOfDay(periodFrom).toISOString(),
      to: endOfDay(periodTo).toISOString(),
    },
    kpi,
    daily,
    table: daily,
  };
}
