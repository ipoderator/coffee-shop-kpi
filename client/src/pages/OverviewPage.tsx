import { useMemo } from 'react';
import {
  DollarSign,
  Wallet,
  FileText,
  TrendingUp,
  Calendar,
  BarChart3,
  FileBarChart,
  LineChart,
  Percent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { KPICard } from '@/components/KPICard';
import { RevenueChart } from '@/components/RevenueChart';
import { DayOfWeekChart } from '@/components/DayOfWeekChart';
import { MetricLineChart } from '@/components/MetricLineChart';
import { Card } from '@/components/ui/card';
import type { AnalyticsResponse } from '@shared/schema';

interface OverviewPageProps {
  analytics: AnalyticsResponse;
}

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

function generateExecutiveSummary(analytics: AnalyticsResponse): string {
  const {
    totalRevenue,
    revenueGrowth,
    currentMonthTotalChecks,
    currentMonthAvgChecksPerDay,
    revenueGrowthDoD,
    averageCheckGrowth,
    averageCheck,
    totalChecks,
    checksGrowth,
    grossProfit,
    grossMargin,
    totalCostOfGoods,
    revenueGrowthYoY,
  } = analytics.kpi;

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);

  // Calculate payment method shares
  let totalCash = 0;
  let totalTerminal = 0;
  let totalPayments = 0;

  analytics.transactions.forEach((t) => {
    if (t.cashPayment) totalCash += t.cashPayment;
    if (t.terminalPayment) totalTerminal += t.terminalPayment;
    totalPayments += t.amount;
  });

  const cashShare = totalPayments > 0 ? (totalCash / totalPayments) * 100 : 0;
  const terminalShare = totalPayments > 0 ? (totalTerminal / totalPayments) * 100 : 0;

  // Determine trend
  let trendText = 'показывает стабильные результаты';
  if (revenueGrowth !== undefined) {
    if (revenueGrowth > 5) {
      trendText = 'демонстрирует положительную динамику роста';
    } else if (revenueGrowth < -5) {
      trendText = 'показывает снижение показателей';
    }
  }

  // Get current month data
  const currentMonthData = analytics.monthlyComparison?.currentMonth;
  const monthComparison = analytics.monthlyComparison?.comparison;
  const monthSummary =
    currentMonthData && currentMonthTotalChecks
      ? `В текущем месяце зафиксировано ${currentMonthTotalChecks} чеков на сумму ${formatCurrency(currentMonthData.metrics.revenue)}${
          monthComparison?.revenueGrowth !== undefined
            ? ` (${monthComparison.revenueGrowth > 0 ? '+' : ''}${monthComparison.revenueGrowth.toFixed(
                1,
              )}% к предыдущему месяцу)`
            : ''
        }.`
      : '';

  // Daily dynamics
  const validDailyRevenue = (analytics.daily ?? []).filter(
    (d) => typeof d?.revenue === 'number' && Number.isFinite(d.revenue),
  );
  const daysCount = validDailyRevenue.length;
  const averageDailyRevenue = daysCount > 0 ? totalRevenue / daysCount : undefined;

  const toShortDateLabel = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
    }).format(date);
  };

  const extremes =
    validDailyRevenue.length > 0
      ? {
          best: validDailyRevenue.reduce((best, current) =>
            current.revenue > best.revenue ? current : best,
          ),
          worst: validDailyRevenue.reduce((worst, current) =>
            current.revenue < worst.revenue ? current : worst,
          ),
        }
      : null;

  // Generate recommendations based on analysis
  const recommendations: string[] = [];
  const monthGrowth = monthComparison?.revenueGrowth;

  if (monthGrowth !== undefined && monthGrowth < -10) {
    recommendations.push(
      'пересмотреть ассортимент и промо, чтобы компенсировать недавнее падение выручки',
    );
  }
  if (revenueGrowthDoD !== undefined && Math.abs(revenueGrowthDoD) > 20) {
    recommendations.push(
      'сгладить волатильность спроса через точечные акции, CRM-рассылки и управление расписанием персонала',
    );
  }
  if (averageCheckGrowth !== undefined && averageCheckGrowth < -3 && (revenueGrowth || 0) >= 0) {
    recommendations.push(
      'усилить допродажи, бандлы и обучение бариста техникам upsell для роста среднего чека',
    );
  }
  if (checksGrowth !== undefined && checksGrowth < -3) {
    recommendations.push(
      'сфокусироваться на трафике: локальная реклама, коллаборации и специальные предложения в часы простоя',
    );
  }
  if (cashShare > 60) {
    recommendations.push(
      'мотивировать гостей переходить на безнал, чтобы ускорить обслуживание и сократить кассовые риски',
    );
  }
  if (grossMargin !== undefined && grossMargin < 20) {
    recommendations.push(
      'пересмотреть себестоимость: оптимизировать закупки, порции и долю высокомаржинальных позиций',
    );
  }
  if (revenueGrowth !== undefined && revenueGrowth > 8) {
    recommendations.push(
      'масштабировать удачные акции и закрепить рост за счет расширения продуктовых хитов',
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'продолжать фиксировать влияние инициатив на чек и поток гостей, чтобы масштабировать лучшие практики',
    );
  }

  const checkContext =
    totalChecks !== undefined
      ? `Оформлено ${totalChecks.toLocaleString('ru-RU')} чеков${
          checksGrowth !== undefined
            ? ` (${checksGrowth > 0 ? '+' : ''}${checksGrowth.toFixed(1)}% к предыдущему периоду)`
            : ''
        }${
          averageCheck !== undefined
            ? `, средний чек — ${formatCurrency(averageCheck)}${
                averageCheckGrowth !== undefined
                  ? ` (${averageCheckGrowth > 0 ? '+' : ''}${averageCheckGrowth.toFixed(
                      1,
                    )}% к предыдущему периоду)`
                  : ''
              }`
            : ''
        }.${
          currentMonthAvgChecksPerDay !== undefined
            ? ` Среднее число чеков в день — ${currentMonthAvgChecksPerDay.toFixed(1)}.`
            : ''
        }`
      : '';

  const profitContext =
    grossProfit !== undefined
      ? `Валовая прибыль составила ${formatCurrency(grossProfit)}${
          grossMargin !== undefined ? ` (маржа ${grossMargin.toFixed(1)}%)` : ''
        }${
          totalCostOfGoods !== undefined
            ? ` при себестоимости ${formatCurrency(totalCostOfGoods)}.`
            : '.'
        }`
      : '';

  // Используем ML анализ для более точного описания аномалий
  const mlAnalysis = analytics.mlAnalysis;
  let dailyContext = '';
  
  if (averageDailyRevenue !== undefined) {
    dailyContext = `Среднесуточная выручка — ${formatCurrency(averageDailyRevenue)}`;
    
    // Используем ML объяснения для аномалий, если доступны
    if (mlAnalysis?.minRevenueAnomaly && mlAnalysis?.maxRevenueAnomaly) {
      dailyContext += `. ${mlAnalysis.maxRevenueAnomaly.explanation} ${mlAnalysis.minRevenueAnomaly.explanation}`;
    } else if (extremes) {
      // Fallback на обычное описание, если ML анализ недоступен
      dailyContext += `; максимум ${formatCurrency(extremes.best.revenue)} (${toShortDateLabel(
                extremes.best.period,
              )}), минимум ${formatCurrency(extremes.worst.revenue)} (${toShortDateLabel(
                extremes.worst.period,
      )}).`;
    } else {
      dailyContext += '.';
    }
  }

  const yoyContext =
    revenueGrowthYoY !== undefined
      ? `Год-к-году выручка изменилась на ${revenueGrowthYoY > 0 ? '+' : ''}${revenueGrowthYoY.toFixed(
          1,
        )}%.`
      : '';

  // Добавляем рекомендации от ML модели, если доступны
  const mlRecommendations: string[] = [];
  if (mlAnalysis?.minRevenueAnomaly?.recommendations) {
    mlRecommendations.push(...mlAnalysis.minRevenueAnomaly.recommendations);
  }
  if (mlAnalysis?.maxRevenueAnomaly?.recommendations) {
    mlRecommendations.push(...mlAnalysis.maxRevenueAnomaly.recommendations);
  }
  
  // Объединяем рекомендации
  const allRecommendations = [...recommendations];
  if (mlRecommendations.length > 0) {
    // Добавляем уникальные ML рекомендации
    mlRecommendations.forEach((rec) => {
      if (!allRecommendations.some((r) => r.toLowerCase().includes(rec.toLowerCase().substring(0, 20)))) {
        allRecommendations.push(rec);
      }
    });
  }

  const recommendationText = `Чтобы увеличить прибыль, рекомендуем ${allRecommendations.join('; ')}.`;

  // Добавляем информацию о качестве ML модели, если доступна
  const mlModelInfo = mlAnalysis?.modelQuality?.overall
    ? ` Анализ выполнен с использованием ML модели (уверенность: ${(mlAnalysis.confidence * 100).toFixed(0)}%).`
    : '';

  const parts = [
    `Общий оборот кофейни за анализируемый период составил ${formatCurrency(totalRevenue)}${
      revenueGrowth !== undefined
        ? ` (${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(1)}% к предыдущему периоду)`
        : ''
    }.`,
    checkContext,
    profitContext,
    `Структура платежей: наличные — ${cashShare.toFixed(1)}%, терминал — ${terminalShare.toFixed(
      1,
    )}%.`,
    monthSummary,
    dailyContext,
    `Бизнес ${trendText}.`,
    yoyContext,
    recommendationText,
    mlModelInfo,
  ].filter(Boolean);

  return parts.join(' ');
}

export default function OverviewPage({ analytics }: OverviewPageProps) {
  const hasCostData = Boolean(analytics.hasCostData);
  const dailyData = analytics.daily ?? [];

  const sparklineData = useMemo(() => {
    const limit = 30;
    const slice = dailyData.slice(-limit);
    const formatLabel = (period: string) => {
      const date = new Date(period);
      if (Number.isNaN(date.getTime())) {
        return period;
      }
      return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date);
    };

    const revenue = slice.map((d) => ({
      label: formatLabel(d.period),
      value: d.revenue,
    }));

    const checks = slice.map((d) => ({
      label: formatLabel(d.period),
      value: d.checks,
    }));

    const averageCheck = slice.map((d) => ({
      label: formatLabel(d.period),
      value: d.averageCheck,
    }));

    const grossProfit = hasCostData
      ? slice
          .filter((d) => typeof d.grossProfit === 'number')
          .map((d) => ({
            label: formatLabel(d.period),
            value: d.grossProfit ?? 0,
          }))
      : [];

    const grossMargin = hasCostData
      ? slice
          .filter((d) => typeof d.grossMargin === 'number')
          .map((d) => ({
            label: formatLabel(d.period),
            value: d.grossMargin ?? 0,
          }))
      : [];

    return { revenue, checks, averageCheck, grossProfit, grossMargin };
  }, [dailyData, hasCostData]);

  const dailySeries = useMemo(() => {
    const toSeries = (
      getValue: (d: (typeof dailyData)[number]) => number | undefined,
    ): { period: string; value: number }[] =>
      dailyData
        .map((d) => {
          const value = getValue(d);
          if (typeof value === 'number' && Number.isFinite(value)) {
            return { period: d.period, value };
          }
          return null;
        })
        .filter((item): item is { period: string; value: number } => item !== null);

    return {
      revenue: toSeries((d) => d.revenue),
      checks: toSeries((d) => d.checks),
      averageCheck: toSeries((d) => d.averageCheck),
      grossProfit: hasCostData ? toSeries((d) => d.grossProfit) : [],
      grossMargin: hasCostData ? toSeries((d) => d.grossMargin) : [],
    };
  }, [dailyData, hasCostData]);

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
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [],
  );

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
            Общий обзор
          </h1>
          <p className="text-muted-foreground">Ключевые показатели эффективности вашего бизнеса</p>
        </motion.div>

        {/* Executive Summary */}
        <motion.div variants={itemVariants}>
          <Card
            className="relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden"
            data-testid="card-executive-summary"
          >
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-40" />

            <div className="relative z-10 space-y-3">
              <div className="flex items-center gap-2">
                <FileBarChart className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold text-foreground">Резюме</h3>
              </div>
              <p
                className="text-base md:text-lg leading-relaxed text-muted-foreground/90"
                data-testid="text-executive-summary"
              >
                {generateExecutiveSummary(analytics)}
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Main KPI Cards */}
        <motion.div
          className={cn(
            'grid grid-cols-1 md:grid-cols-2 gap-4',
            hasCostData ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
          )}
          variants={containerVariants}
        >
          <motion.div variants={itemVariants} className="h-full">
            <KPICard
              title="Выручка (всего)"
              value={analytics.kpi.totalRevenue}
              icon={<DollarSign className="w-5 h-5" />}
              growth={analytics.kpi.revenueGrowth}
              format="currency"
              trendData={sparklineData.revenue}
              trendColor="hsl(var(--primary))"
              testId="card-revenue"
              description="Общая сумма выручки за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
          {hasCostData && typeof analytics.kpi.grossProfit === 'number' && (
            <motion.div variants={itemVariants} className="h-full">
              <KPICard
                title="Валовая прибыль"
                value={analytics.kpi.grossProfit}
                icon={<LineChart className="w-5 h-5" />}
                growth={analytics.kpi.grossProfitGrowth}
                format="currency"
                trendData={sparklineData.grossProfit}
                trendColor="hsl(var(--chart-2))"
                testId="card-gross-profit"
                description="Выручка за вычетом себестоимости. Рост — изменение по сравнению с предыдущим месяцем."
              />
            </motion.div>
          )}
          <motion.div variants={itemVariants} className="h-full">
            <KPICard
              title="Средний чек"
              value={analytics.kpi.averageCheck}
              icon={<Wallet className="w-5 h-5" />}
              growth={analytics.kpi.averageCheckGrowth}
              format="currency"
              trendData={sparklineData.averageCheck}
              trendColor="hsl(var(--chart-3))"
              testId="card-average-check"
              description="Средняя сумма одного чека (Общая выручка ÷ Количество чеков). Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-full">
            <KPICard
              title="Всего чеков"
              value={analytics.kpi.totalChecks}
              icon={<FileText className="w-5 h-5" />}
              growth={analytics.kpi.checksGrowth}
              format="number"
              trendData={sparklineData.checks}
              trendColor="hsl(var(--chart-4))"
              testId="card-total-checks"
              description="Общее количество чеков за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
        </motion.div>

        {/* Secondary KPIs */}
        <motion.div
          className={cn(
            'grid grid-cols-1 md:grid-cols-2 gap-4',
            hasCostData ? 'lg:grid-cols-4' : 'lg:grid-cols-3',
          )}
          variants={containerVariants}
        >
          <motion.div variants={itemVariants}>
            <KPICard
              title="Рост выручки (по дням)"
              value={
                analytics.kpi.revenueGrowthDoD !== undefined ? analytics.kpi.revenueGrowthDoD : '—'
              }
              icon={<TrendingUp className="w-5 h-5" />}
              format={typeof analytics.kpi.revenueGrowthDoD === 'number' ? 'percent' : 'number'}
              testId="card-growth-dod"
              description="Изменение выручки последнего дня по сравнению с предпоследним днём. Показывает краткосрочную динамику."
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <KPICard
              title="Чеков за месяц"
              value={analytics.kpi.currentMonthTotalChecks || 0}
              icon={<Calendar className="w-5 h-5" />}
              format="number"
              testId="card-month-checks"
              description="Количество чеков в текущем месяце (последний месяц в загруженных данных)."
            />
          </motion.div>
          <motion.div variants={itemVariants}>
            <KPICard
              title="Среднее чеков/день (месяц)"
              value={
                analytics.kpi.currentMonthAvgChecksPerDay !== undefined
                  ? analytics.kpi.currentMonthAvgChecksPerDay.toFixed(1)
                  : '—'
              }
              icon={<BarChart3 className="w-5 h-5" />}
              format="number"
              testId="card-avg-checks-per-day"
              description="Среднее количество чеков в день за текущий месяц (Чеков за месяц ÷ Количество дней с продажами)."
            />
          </motion.div>
          {hasCostData && typeof analytics.kpi.grossMargin === 'number' && (
            <motion.div variants={itemVariants}>
              <KPICard
                title="Валовая маржа"
                value={analytics.kpi.grossMargin}
                icon={<Percent className="w-5 h-5" />}
                growth={analytics.kpi.grossMarginChange}
                format="percent"
                growthSuffix=" п.п."
                trendData={sparklineData.grossMargin}
                trendColor="hsl(var(--chart-1))"
                testId="card-gross-margin"
                description="Доля валовой прибыли в выручке. Изменение — разница к предыдущему месяцу в процентных пунктах."
              />
            </motion.div>
          )}
        </motion.div>

        {/* Daily Metric Charts */}
        {dailyData.length > 0 && (
          <motion.div className="space-y-4" variants={itemVariants}>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-foreground/70 bg-clip-text text-transparent">
                Дневные метрики
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Отслеживайте ключевые показатели по дням для быстрого обнаружения трендов.
              </p>
            </div>
            <div
              className={cn(
                'grid grid-cols-1 gap-4',
                hasCostData ? 'lg:grid-cols-2 xl:grid-cols-3' : 'lg:grid-cols-2 xl:grid-cols-3',
              )}
            >
              <MetricLineChart
                data={dailySeries.revenue}
                title="Выручка по дням"
                tooltipLabel="Выручка"
                color="hsl(var(--primary))"
                valueFormatter={(value) => currencyFormatter.format(value)}
                yTickFormatter={(value) => currencyFormatter.format(value)}
              />
              <MetricLineChart
                data={dailySeries.checks}
                title="Чеки по дням"
                tooltipLabel="Чеков"
                color="hsl(var(--chart-4))"
                valueFormatter={(value) => numberFormatter.format(value)}
                yTickFormatter={(value) => numberFormatter.format(value)}
              />
              <MetricLineChart
                data={dailySeries.averageCheck}
                title="Средний чек по дням"
                tooltipLabel="Средний чек"
                color="hsl(var(--chart-3))"
                valueFormatter={(value) => currencyFormatter.format(value)}
                yTickFormatter={(value) => currencyFormatter.format(value)}
              />
              {hasCostData && dailySeries.grossProfit.length > 0 && (
                <MetricLineChart
                  data={dailySeries.grossProfit}
                  title="Валовая прибыль по дням"
                  tooltipLabel="Валовая прибыль"
                  color="hsl(var(--chart-2))"
                  valueFormatter={(value) => currencyFormatter.format(value)}
                  yTickFormatter={(value) => currencyFormatter.format(value)}
                />
              )}
              {hasCostData && dailySeries.grossMargin.length > 0 && (
                <MetricLineChart
                  data={dailySeries.grossMargin}
                  title="Валовая маржа по дням"
                  tooltipLabel="Валовая маржа"
                  color="hsl(var(--chart-1))"
                  valueFormatter={(value) => `${decimalFormatter.format(value)}%`}
                  yTickFormatter={(value) => `${decimalFormatter.format(value)}%`}
                />
              )}
            </div>
          </motion.div>
        )}

        {/* Monthly Revenue Chart */}
        <motion.div className="space-y-4" variants={itemVariants}>
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-foreground/70 bg-clip-text text-transparent">
              Динамика по месяцам
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Тренд выручки за последние месяцы</p>
          </div>
          <RevenueChart
            data={analytics.monthly || []}
            title="Выручка по месяцам"
            periodType="month"
          />
        </motion.div>

        {/* Day of Week Analysis */}
        {analytics.byDayOfWeek && analytics.byDayOfWeek.length > 0 && (
          <motion.div className="space-y-4" variants={itemVariants}>
            <div>
              <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-foreground/70 bg-clip-text text-transparent">
                Анализ по дням недели
              </h2>
              <p className="text-sm text-muted-foreground mt-1">Выручка в разрезе дней недели</p>
            </div>
            <DayOfWeekChart data={analytics.byDayOfWeek} title="Выручка по дням недели" />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
