import { useState } from 'react';
import { motion } from 'framer-motion';
import { PeriodTabs, PeriodType } from '@/components/PeriodTabs';
import { RevenueChart } from '@/components/RevenueChart';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/StatCard';
import { TrendingUp, TrendingDown, Target } from 'lucide-react';
import type { AnalyticsResponse, PeriodData } from '@shared/schema';

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
                }).format(Math.max(...periodData.map((d) => d.revenue)))}
                subtitle={
                  periodData.find(
                    (d) => d.revenue === Math.max(...periodData.map((p) => p.revenue)),
                  )?.period
                }
                icon={<TrendingUp className="w-5 h-5 text-chart-2" />}
                progress={{
                  value: Math.max(...periodData.map((d) => d.revenue)),
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'chart-2',
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
                }).format(Math.min(...periodData.map((d) => d.revenue)))}
                subtitle={
                  periodData.find(
                    (d) => d.revenue === Math.min(...periodData.map((p) => p.revenue)),
                  )?.period
                }
                icon={<TrendingDown className="w-5 h-5 text-destructive" />}
                progress={{
                  value: Math.min(...periodData.map((d) => d.revenue)),
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'destructive',
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
                }).format(periodData.reduce((sum, d) => sum + d.revenue, 0) / periodData.length)}
                subtitle={`За ${periodData.length} ${selectedPeriod === 'day' ? 'дней' : selectedPeriod === 'month' ? 'месяцев' : 'лет'}`}
                icon={<Target className="w-5 h-5 text-primary" />}
                progress={{
                  value: periodData.reduce((sum, d) => sum + d.revenue, 0) / periodData.length,
                  max: Math.max(...periodData.map((d) => d.revenue)),
                  color: 'primary',
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
                  {new Intl.NumberFormat('ru-RU').format(
                    periodData.reduce((sum, d) => sum + d.checks, 0),
                  )}
                </p>
                <div className="pt-2 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Средний чек</span>
                    <span className="font-semibold">
                      {new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(
                        periodData.reduce((sum, d) => sum + d.revenue, 0) /
                          periodData.reduce((sum, d) => sum + d.checks, 0),
                      )}
                    </span>
                  </div>
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
                      {(
                        periodData.reduce((sum, d) => sum + d.checks, 0) / periodData.length
                      ).toFixed(0)}
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
                      }).format(Math.max(...periodData.map((d) => d.averageCheck)))}
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
                      }).format(Math.min(...periodData.map((d) => d.averageCheck)))}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
