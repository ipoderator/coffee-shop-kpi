import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PeriodTabs, PeriodType } from '@/components/PeriodTabs';
import { RevenueChart } from '@/components/RevenueChart';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/StatCard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TrendingUp, TrendingDown, Target } from 'lucide-react';
import type { AnalyticsResponse, PeriodData } from '@shared/schema';
import {
  calculateMLAdjustedRevenueMetrics,
  calculateMLAdjustedChecksMetrics,
  formatDeviation,
} from '@/utils/mlMetrics';

interface SalesPageProps {
  analytics: AnalyticsResponse;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: 'easeOut',
    },
  },
};

export default function SalesPage({ analytics }: SalesPageProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('month');

  const getPeriodData = (): PeriodData[] => {
    switch (selectedPeriod) {
      case 'day':
        return analytics.daily || [];
      case 'month':
        return analytics.monthly || [];
      case 'year':
        return analytics.yearly || [];
      default:
        return [];
    }
  };

  const getPeriodTitle = () => {
    switch (selectedPeriod) {
      case 'day':
        return 'Выручка по дням';
      case 'month':
        return 'Выручка по месяцам';
      case 'year':
        return 'Выручка по годам';
      default:
        return 'Выручка';
    }
  };

  const periodData = getPeriodData();
  const hasTrend = periodData.length >= 2;

  // Рассчитываем ML-скорректированные метрики
  const mlRevenueMetrics = useMemo(
    () =>
      calculateMLAdjustedRevenueMetrics(
        periodData,
        analytics.forecast,
        analytics.advancedAnalytics?.anomalies,
      ),
    [periodData, analytics.forecast, analytics.advancedAnalytics?.anomalies],
  );

  // Рассчитываем ML-скорректированные метрики чеков
  const mlChecksMetrics = useMemo(
    () => calculateMLAdjustedChecksMetrics(periodData, analytics.forecast),
    [periodData, analytics.forecast],
  );

  const calculateTrend = () => {
    // For monthly period, use the corrected MoM growth from KPI which compares same periods
    if (selectedPeriod === 'month') {
      const change = analytics.kpi.revenueGrowth;

      // Validate that the growth value is usable
      if (change === undefined || change === null || !isFinite(change)) {
        return null;
      }

      return { change, isPositive: change >= 0 };
    }

    // For daily and yearly periods, compare last two periods
    if (!hasTrend) return null;
    const latest = periodData[periodData.length - 1];
    const previous = periodData[periodData.length - 2];

    if (!previous.revenue || previous.revenue === 0 || !isFinite(previous.revenue)) {
      return null;
    }

    const change = ((latest.revenue - previous.revenue) / previous.revenue) * 100;

    if (!isFinite(change)) {
      return null;
    }

    return { change, isPositive: change >= 0 };
  };

  const trend = calculateTrend();

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
            Аналитика продаж
          </h1>
          <p className="text-muted-foreground">
            Детальный анализ выручки и динамики продаж по периодам
          </p>
        </motion.div>

        {/* Period Selector */}
        <motion.div
          className="flex items-center justify-between flex-wrap gap-4"
          variants={itemVariants}
        >
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">Динамика выручки</h2>
            {trend && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3, type: 'spring' }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${
                  trend.isPositive
                    ? 'bg-chart-2/10 text-chart-2'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {trend.isPositive ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                <span className="font-semibold text-sm">{Math.abs(trend.change).toFixed(1)}%</span>
              </motion.div>
            )}
          </div>
          <PeriodTabs selected={selectedPeriod} onChange={setSelectedPeriod} />
        </motion.div>

        {/* Main Revenue Chart */}
        <motion.div variants={itemVariants}>
          <RevenueChart data={periodData} title={getPeriodTitle()} periodType={selectedPeriod} />
        </motion.div>

        {/* Statistics Grid */}
        {periodData.length > 0 && (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
            variants={containerVariants}
          >
            <motion.div variants={itemVariants}>
              <StatCard
                title="Максимальная выручка"
                value={new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(mlRevenueMetrics.maxRevenue.actual)}
                subtitle={mlRevenueMetrics.maxRevenue.date}
                icon={<TrendingUp className="w-5 h-5 text-chart-2" />}
                progress={{
                  value: mlRevenueMetrics.maxRevenue.actual,
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'chart-2',
                }}
                mlData={{
                  expectedValue: mlRevenueMetrics.maxRevenue.expected,
                  deviation: mlRevenueMetrics.maxRevenue.deviation,
                  isAnomaly: mlRevenueMetrics.maxRevenue.isAnomaly,
                  anomaly: mlRevenueMetrics.maxRevenue.anomaly,
                  confidence: analytics.forecast?.extendedForecast?.averageConfidence ||
                    analytics.forecast?.nextMonth?.confidence,
                }}
                testId="stat-max-revenue"
              />
            </motion.div>

            <motion.div variants={itemVariants}>
              <StatCard
                title="Минимальная выручка"
                value={new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(mlRevenueMetrics.minRevenue.actual)}
                subtitle={mlRevenueMetrics.minRevenue.date}
                icon={<TrendingDown className="w-5 h-5 text-destructive" />}
                progress={{
                  value: mlRevenueMetrics.minRevenue.actual,
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'destructive',
                }}
                mlData={{
                  expectedValue: mlRevenueMetrics.minRevenue.expected,
                  deviation: mlRevenueMetrics.minRevenue.deviation,
                  isAnomaly: mlRevenueMetrics.minRevenue.isAnomaly,
                  anomaly: mlRevenueMetrics.minRevenue.anomaly,
                  confidence: analytics.forecast?.extendedForecast?.averageConfidence ||
                    analytics.forecast?.nextMonth?.confidence,
                }}
                testId="stat-min-revenue"
              />
            </motion.div>

            <motion.div variants={itemVariants}>
              <StatCard
                title="Средняя выручка"
                value={new Intl.NumberFormat('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(mlRevenueMetrics.avgRevenue.actual)}
                subtitle={`За ${periodData.length} ${selectedPeriod === 'day' ? 'дней' : selectedPeriod === 'month' ? 'месяцев' : 'лет'}`}
                icon={<Target className="w-5 h-5 text-primary" />}
                progress={{
                  value: mlRevenueMetrics.avgRevenue.actual,
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'primary',
                }}
                mlData={{
                  expectedValue: mlRevenueMetrics.avgRevenue.expected,
                  deviation: mlRevenueMetrics.avgRevenue.deviation,
                  confidence: mlRevenueMetrics.avgRevenue.confidence,
                }}
                testId="stat-avg-revenue"
              />
            </motion.div>
          </motion.div>
        )}

        {/* Checks Analysis */}
        <motion.div className="space-y-4" variants={itemVariants}>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-foreground/70 bg-clip-text text-transparent">
            Анализ чеков
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6 hover-elevate transition-all duration-300">
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Общее количество чеков</h3>
                <p className="text-3xl font-bold tabular-nums">
                  {new Intl.NumberFormat('ru-RU').format(mlChecksMetrics.totalChecks)}
                </p>
                <div className="pt-2 border-t space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Средний чек (факт)</span>
                    <span className="font-semibold">
                      {new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(mlChecksMetrics.avgCheck.actual)}
                    </span>
                  </div>
                  {analytics.forecast && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Средний чек (ML ожидание)</span>
                      <span className="font-semibold text-muted-foreground">
                        {new Intl.NumberFormat('ru-RU', {
                          style: 'currency',
                          currency: 'RUB',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }).format(mlChecksMetrics.avgCheck.expected)}
                      </span>
                    </div>
                  )}
                  {mlChecksMetrics.avgCheck.deviation !== 0 && (
                    <div className="flex justify-between items-center text-xs pt-1">
                      <span className="text-muted-foreground">Отклонение</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={`font-medium cursor-help ${
                                Math.abs(mlChecksMetrics.avgCheck.deviation) > 10
                                  ? 'text-destructive'
                                  : Math.abs(mlChecksMetrics.avgCheck.deviation) > 5
                                    ? 'text-yellow-600 dark:text-yellow-500'
                                    : 'text-muted-foreground'
                              }`}
                            >
                              {formatDeviation(mlChecksMetrics.avgCheck.deviation)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <div className="space-y-1">
                              <p className="font-semibold text-xs">Отклонение среднего чека</p>
                              <p className="text-xs text-muted-foreground">
                                {mlChecksMetrics.avgCheck.deviation > 0
                                  ? `Фактический средний чек на ${formatDeviation(mlChecksMetrics.avgCheck.deviation)} выше ожидаемого`
                                  : `Фактический средний чек на ${formatDeviation(Math.abs(mlChecksMetrics.avgCheck.deviation))} ниже ожидаемого`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Ожидаемое значение рассчитывается на основе медианы и скользящего среднего исторических данных о средних чеках
                              </p>
                              <div className="text-xs text-muted-foreground mt-1 pt-1 border-t">
                                <p>Факт: {new Intl.NumberFormat('ru-RU', {
                                  style: 'currency',
                                  currency: 'RUB',
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                }).format(mlChecksMetrics.avgCheck.actual)}</p>
                                <p>Ожидание: {new Intl.NumberFormat('ru-RU', {
                                  style: 'currency',
                                  currency: 'RUB',
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 0,
                                }).format(mlChecksMetrics.avgCheck.expected)}</p>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card className="p-6 hover-elevate transition-all duration-300">
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Средние показатели</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Чеков за период</span>
                    <span className="font-semibold tabular-nums">
                      {mlChecksMetrics.avgChecksPerPeriod.toFixed(0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Макс. чек</span>
                    <span className="font-semibold">
                      {new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(mlChecksMetrics.maxCheck.actual)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Мин. чек</span>
                    <span className="font-semibold">
                      {new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(mlChecksMetrics.minCheck.actual)}
                    </span>
                  </div>
                  {analytics.forecast && (
                    <div className="pt-2 border-t space-y-1">
                      <div className="text-xs text-muted-foreground">
                        ML ожидание среднего чека: {new Intl.NumberFormat('ru-RU', {
                          style: 'currency',
                          currency: 'RUB',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }).format(mlChecksMetrics.avgCheck.expected)}
                      </div>
                      {analytics.forecast.extendedForecast?.averageConfidence && (
                        <div className="text-xs text-muted-foreground">
                          Уверенность модели: {(analytics.forecast.extendedForecast.averageConfidence * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
