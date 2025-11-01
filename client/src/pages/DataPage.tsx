import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { startOfDay } from 'date-fns';
import { DataTable } from '@/components/DataTable';
import { Card } from '@/components/ui/card';
import {
  FileSpreadsheet,
  BarChart3,
  Receipt,
  TrendingUp,
  TrendingDown,
  Info,
  AlertTriangle,
} from 'lucide-react';
import {
  buildRevenueThresholds,
  buildChecksThresholds,
  classifyDailyAnomalies,
  type AnomalyTag,
} from '@/lib/anomaly';
import type { AnalyticsResponse } from '@shared/schema';

interface DataPageProps {
  analytics: AnalyticsResponse;
}

type DailyInsight = {
  date: Date;
  revenue: number;
  checks: number;
  anomalyTags: AnomalyTag[];
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
};

export default function DataPage({ analytics }: DataPageProps) {
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0,
      }),
    [],
  );

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: 0,
      }),
    [],
  );

  const decimalFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
    [],
  );

  const fullDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [],
  );

  const formatDaysLabel = (count: number) => {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
      return `${count} день`;
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
      return `${count} дня`;
    }
    return `${count} дней`;
  };

  const insights = useMemo(() => {
    if (analytics.transactions.length === 0) {
      return {
        totalChecks: 0,
        uniqueDays: 0,
        analysedDays: 0,
        filteredDays: 0,
        averageChecksPerDay: 0,
        averageDailyRevenue: 0,
        bestDay: null as DailyInsight | null,
        worstDay: null as DailyInsight | null,
        revenueLowDays: [] as DailyInsight[],
        revenueHighDays: [] as DailyInsight[],
        checksLowDays: [] as DailyInsight[],
        checksHighDays: [] as DailyInsight[],
        thresholds: {
          revenue: {
            lower: 0,
            upper: 0,
            median: 0,
            q1: 0,
            q3: 0,
            iqr: 0,
            sampleSize: 0,
          },
          checks: {
            lower: 0,
            upper: 0,
            median: 0,
            q1: 0,
            q3: 0,
            iqr: 0,
            sampleSize: 0,
          },
        },
        usedFallback: false,
      };
    }

    const dailyMap = new Map<string, DailyInsight>();

    analytics.transactions.forEach((transaction) => {
      const dayDate = startOfDay(new Date(transaction.date));
      const key = dayDate.toISOString();
      const checksIncrement = transaction.checksCount ?? 1;
      const existing = dailyMap.get(key);

      if (existing) {
        existing.revenue += transaction.amount;
        existing.checks += checksIncrement;
      } else {
        dailyMap.set(key, {
          date: dayDate,
          revenue: transaction.amount,
          checks: checksIncrement,
          anomalyTags: [],
        });
      }
    });

    const aggregatedDays = Array.from(dailyMap.values());
    const revenueThresholds = buildRevenueThresholds(aggregatedDays.map((day) => day.revenue));
    const checksThresholds = buildChecksThresholds(aggregatedDays.map((day) => day.checks));

    const enrichedStats: DailyInsight[] = aggregatedDays.map((day) => ({
      ...day,
      anomalyTags: classifyDailyAnomalies(day.revenue, day.checks, {
        revenue: revenueThresholds,
        checks: checksThresholds,
      }),
    }));

    const revenueLowDays = enrichedStats.filter((day) => day.anomalyTags.includes('revenue-low'));
    const revenueHighDays = enrichedStats.filter((day) => day.anomalyTags.includes('revenue-high'));
    const checksLowDays = enrichedStats.filter((day) => day.anomalyTags.includes('checks-low'));
    const checksHighDays = enrichedStats.filter((day) => day.anomalyTags.includes('checks-high'));

    const stableDays = enrichedStats.filter((day) => day.anomalyTags.length === 0);

    const usedFallback = stableDays.length === 0;
    const baseDays = usedFallback ? enrichedStats : stableDays;
    const filteredDays = usedFallback ? 0 : enrichedStats.length - stableDays.length;

    const totalChecks = baseDays.reduce((sum, day) => sum + day.checks, 0);
    const totalRevenue = baseDays.reduce((sum, day) => sum + day.revenue, 0);
    const analysedDays = baseDays.length;
    const uniqueDays = enrichedStats.length;
    const averageChecksPerDay = analysedDays > 0 ? totalChecks / analysedDays : 0;
    const averageDailyRevenue = analysedDays > 0 ? totalRevenue / analysedDays : 0;
    const sortedByRevenueDesc = [...baseDays].sort((a, b) => b.revenue - a.revenue);
    const sortedByRevenueAsc = [...baseDays].sort((a, b) => a.revenue - b.revenue);

    return {
      totalChecks,
      uniqueDays,
      analysedDays,
      filteredDays,
      averageChecksPerDay,
      averageDailyRevenue,
      bestDay: sortedByRevenueDesc[0] ?? null,
      worstDay: sortedByRevenueAsc[0] ?? null,
      revenueLowDays,
      revenueHighDays,
      checksLowDays,
      checksHighDays,
      thresholds: {
        revenue: revenueThresholds,
        checks: checksThresholds,
      },
      usedFallback,
    };
  }, [analytics]);

  const bestDayDelta =
    insights.bestDay && insights.averageDailyRevenue > 0
      ? ((insights.bestDay.revenue - insights.averageDailyRevenue) / insights.averageDailyRevenue) *
        100
      : 0;

  const worstDayDelta =
    insights.worstDay && insights.averageDailyRevenue > 0
      ? ((insights.worstDay.revenue - insights.averageDailyRevenue) /
          insights.averageDailyRevenue) *
        100
      : 0;

  const describeDelta = (delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) {
      return 'Совпадает со средним днём';
    }
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(1)}% к среднему дню`;
  };

  const hasBestDelta = Math.abs(bestDayDelta) > 0.05;
  const hasWorstDelta = Math.abs(worstDayDelta) > 0.05;

  const periodLabel = useMemo(() => {
    if (analytics.transactions.length === 0) return '—';
    const dates = analytics.transactions.map((t) => new Date(t.date));
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `${formatter.format(minDate)} - ${formatter.format(maxDate)}`;
  }, [analytics.transactions]);

  const totalAnomalies =
    insights.revenueLowDays.length +
    insights.revenueHighDays.length +
    insights.checksLowDays.length +
    insights.checksHighDays.length;

  const revenueLowerLabel =
    insights.thresholds.revenue.lower > 0
      ? currencyFormatter.format(insights.thresholds.revenue.lower)
      : 'адаптивного порога';

  const revenueUpperLabel =
    insights.thresholds.revenue.upper > 0
      ? currencyFormatter.format(insights.thresholds.revenue.upper)
      : 'адаптивного порога';

  const checksLowerLabel =
    insights.thresholds.checks.lower > 0
      ? numberFormatter.format(Math.round(insights.thresholds.checks.lower))
      : 'адаптивного порога';

  const checksUpperLabel =
    insights.thresholds.checks.upper > 0
      ? numberFormatter.format(Math.round(insights.thresholds.checks.upper))
      : 'адаптивного порога';

  const revenueLowCount = insights.revenueLowDays.length;
  const revenueHighCount = insights.revenueHighDays.length;
  const checksLowCount = insights.checksLowDays.length;
  const checksHighCount = insights.checksHighDays.length;

  return (
    <div className="container mx-auto px-4 md:px-8 lg:px-12 py-8">
      <motion.div
        className="space-y-8"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
            Детализация данных
          </h1>
          <p className="text-muted-foreground">
            Полная таблица транзакций с возможностью сортировки и анализа
          </p>
        </motion.div>

        {/* Summary Card */}
        <motion.div variants={itemVariants}>
          <Card className="p-6 bg-gradient-to-br from-primary/5 to-transparent hover-elevate transition-all duration-300">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <FileSpreadsheet className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">Сводка по данным</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Всего записей</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">
                      {analytics.transactions.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Общая выручка</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">
                      {currencyFormatter.format(analytics.kpi.totalRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Период данных</p>
                    <p className="text-lg font-semibold mt-1">{periodLabel}</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Insight Cards */}
        <motion.div variants={itemVariants}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <Card className="p-5 hover-elevate transition-all duration-300 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Средняя выручка за день</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">
                    {insights.analysedDays > 0
                      ? currencyFormatter.format(insights.averageDailyRevenue)
                      : '—'}
                  </p>
                </div>
                <div className="p-2 bg-primary/10 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {insights.analysedDays > 0
                  ? `На основе ${formatDaysLabel(insights.analysedDays)}${
                      insights.filteredDays > 0 ? ' (без аномалий)' : ''
                    }`
                  : 'Загрузите данные, чтобы увидеть средние значения.'}
              </p>
            </Card>

            <Card className="p-5 hover-elevate transition-all duration-300 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Всего чеков</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">
                    {insights.analysedDays > 0 ? numberFormatter.format(insights.totalChecks) : '—'}
                  </p>
                </div>
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Receipt className="w-5 h-5 text-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {insights.analysedDays > 0
                  ? `В среднем ${decimalFormatter.format(insights.averageChecksPerDay)} чеков в день${
                      insights.filteredDays > 0 ? ' (аномалии исключены)' : ''
                    }`
                  : 'После загрузки данных появится динамика чеков.'}
              </p>
            </Card>

            <Card className="p-5 hover-elevate transition-all duration-300 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Лучший день по выручке</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">
                    {insights.bestDay ? currencyFormatter.format(insights.bestDay.revenue) : '—'}
                  </p>
                  {insights.bestDay && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {fullDateFormatter.format(insights.bestDay.date)} — чеков:{' '}
                      {numberFormatter.format(insights.bestDay.checks)}
                    </p>
                  )}
                </div>
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <p
                className={`text-xs mt-3 ${
                  insights.bestDay && hasBestDelta
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
              >
                {insights.bestDay ? describeDelta(bestDayDelta) : 'Данные появятся после загрузки.'}
              </p>
            </Card>

            <Card className="p-5 hover-elevate transition-all duration-300 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Самый спокойный день</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">
                    {insights.worstDay ? currencyFormatter.format(insights.worstDay.revenue) : '—'}
                  </p>
                  {insights.worstDay && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {fullDateFormatter.format(insights.worstDay.date)} — чеков:{' '}
                      {numberFormatter.format(insights.worstDay.checks)}
                    </p>
                  )}
                </div>
                <div className="p-2 bg-rose-500/10 rounded-lg">
                  <TrendingDown className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
              </div>
              <p
                className={`text-xs mt-3 ${
                  insights.worstDay && hasWorstDelta
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground'
                }`}
              >
                {insights.worstDay
                  ? describeDelta(worstDayDelta)
                  : 'Данные появятся после загрузки.'}
              </p>
            </Card>

            <Card className="p-5 hover-elevate transition-all duration-300 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Подозрительные смены</p>
                  <p className="text-2xl font-semibold tabular-nums mt-1">
                    {totalAnomalies > 0 ? numberFormatter.format(totalAnomalies) : '0'}
                  </p>
                </div>
                <div className="p-2 bg-amber-500/15 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300" />
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-3 space-y-1">
                {totalAnomalies > 0 ? (
                  <>
                    <p>
                      <span className="text-amber-600 dark:text-amber-300 font-medium">
                        {numberFormatter.format(revenueLowCount)}
                      </span>{' '}
                      смен с выручкой ниже {revenueLowerLabel}.
                    </p>
                    <p>
                      <span className="text-violet-600 dark:text-violet-300 font-medium">
                        {numberFormatter.format(revenueHighCount)}
                      </span>{' '}
                      смен с выручкой выше {revenueUpperLabel}.
                    </p>
                    <p>
                      <span className="text-sky-600 dark:text-sky-300 font-medium">
                        {numberFormatter.format(checksLowCount)}
                      </span>{' '}
                      смен с количеством чеков ниже {checksLowerLabel}.
                    </p>
                    <p>
                      <span className="text-indigo-600 dark:text-indigo-300 font-medium">
                        {numberFormatter.format(checksHighCount)}
                      </span>{' '}
                      смен с количеством чеков выше {checksUpperLabel}.
                    </p>
                    {insights.usedFallback && (
                      <p>
                        Все смены помечены как аномальные — расчёты временно учитывают весь период.
                      </p>
                    )}
                  </>
                ) : (
                  <p>Аномальные смены не обнаружены за выбранный период.</p>
                )}
                <p className="pt-1">
                  В расчётах метрик учитываются только стабильные смены, если они есть.
                </p>
              </div>
            </Card>
          </div>
        </motion.div>

        {/* Table Guide */}
        <motion.div variants={itemVariants}>
          <Card className="p-6 bg-muted/40 border border-dashed border-border/50">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="p-2 bg-muted rounded-lg w-fit">
                <Info className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Как читать таблицу</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Используйте сортировку по столбцам, чтобы находить дни с лучшей динамикой, и
                  сравнивайте показатели чеков с выручкой для выявления узких мест.
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  <li>«Кол-во чеков» отражает фактическую нагрузку на точку за день.</li>
                  <li>
                    «Средний чек за день» рассчитывается как выручка, делённая на количество чеков.
                  </li>
                  <li>
                    % отклонения показывает, насколько средний чек отличается от среднего значения
                    по месяцу.
                  </li>
                  <li>
                    Подозрительные смены (выручка ниже {revenueLowerLabel} или выше{' '}
                    {revenueUpperLabel}, а также заметные выбросы по количеству чеков) подсвечены
                    цветом и исключаются из расчётов при наличии стабильных дней.
                  </li>
                </ul>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Data Table */}
        <motion.div className="space-y-4" variants={itemVariants}>
          <h2 className="text-2xl font-bold">Транзакции</h2>
          <DataTable transactions={analytics.transactions} />
        </motion.div>
      </motion.div>
    </div>
  );
}
