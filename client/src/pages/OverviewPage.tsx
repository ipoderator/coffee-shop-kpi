import { DollarSign, Wallet, FileText, TrendingUp, Calendar, BarChart3, FileBarChart } from 'lucide-react';
import { motion } from 'framer-motion';
import { KPICard } from '@/components/KPICard';
import { RevenueChart } from '@/components/RevenueChart';
import { DayOfWeekChart } from '@/components/DayOfWeekChart';
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
      ease: "easeOut",
    },
  },
};

function generateExecutiveSummary(analytics: AnalyticsResponse): string {
  const { totalRevenue, revenueGrowth, currentMonthTotalChecks, currentMonthAvgChecksPerDay, revenueGrowthDoD, averageCheckGrowth } = analytics.kpi;
  
  // Calculate payment method shares
  let totalCash = 0;
  let totalTerminal = 0;
  let totalPayments = 0;
  
  analytics.transactions.forEach(t => {
    if (t.cashPayment) totalCash += t.cashPayment;
    if (t.terminalPayment) totalTerminal += t.terminalPayment;
    totalPayments += t.amount;
  });
  
  const cashShare = totalPayments > 0 ? (totalCash / totalPayments * 100) : 0;
  const terminalShare = totalPayments > 0 ? (totalTerminal / totalPayments * 100) : 0;
  
  // Determine trend
  let trendText = 'показывает стабильные результаты';
  if (revenueGrowth !== undefined) {
    if (revenueGrowth > 5) {
      trendText = 'демонстрирует положительную динамику роста';
    } else if (revenueGrowth < -5) {
      trendText = 'показывает снижение показателей';
    }
  }
  
  const formatCurrency = (value: number) => 
    new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
  
  // Get current month data
  const currentMonthData = analytics.monthlyComparison?.currentMonth;
  let monthSummary = '';
  if (currentMonthData && currentMonthTotalChecks) {
    const monthRevenue = currentMonthData.metrics.revenue;
    const monthGrowth = analytics.monthlyComparison?.comparison.revenueGrowth;
    monthSummary = ` В текущем месяце зафиксировано ${currentMonthTotalChecks} чеков на сумму ${formatCurrency(monthRevenue)}${monthGrowth !== undefined ? ` (${monthGrowth > 0 ? '+' : ''}${monthGrowth.toFixed(1)}% к предыдущему месяцу)` : ''}.`;
  }
  
  // Generate recommendations based on analysis
  let recommendation = '';
  const monthGrowth = analytics.monthlyComparison?.comparison.revenueGrowth;
  
  if (monthGrowth !== undefined && monthGrowth < -10) {
    recommendation = ' Рекомендуется проанализировать причины снижения выручки: пересмотреть ассортимент, усилить маркетинг или улучшить качество обслуживания.';
  } else if (revenueGrowthDoD !== undefined && Math.abs(revenueGrowthDoD) > 20) {
    recommendation = ' Выявлена высокая волатильность продаж по дням — рекомендуется стабилизировать поток клиентов через акции или программу лояльности.';
  } else if (averageCheckGrowth !== undefined && averageCheckGrowth < -5 && (revenueGrowth || 0) > 0) {
    recommendation = ' Средний чек снижается при росте выручки — стоит внедрить допродажи и кросс-продажи для увеличения среднего чека.';
  } else if (cashShare > 70) {
    recommendation = ' Доля наличных высокая — рекомендуется стимулировать безналичные платежи для повышения удобства и скорости обслуживания.';
  } else if (monthGrowth !== undefined && monthGrowth > 10) {
    recommendation = ' Позитивная динамика роста — рекомендуется масштабировать успешные практики и закрепить достигнутые результаты.';
  } else {
    recommendation = ' Рекомендуется отслеживать динамику среднего чека и количества клиентов для выявления точек роста.';
  }
  
  return `Общий оборот кофейни за анализируемый период составил ${formatCurrency(totalRevenue)}${revenueGrowth !== undefined ? ` (${revenueGrowth > 0 ? '+' : ''}${revenueGrowth.toFixed(1)}% к предыдущему периоду)` : ''}. Структура платежей: наличные — ${cashShare.toFixed(1)}%, терминал — ${terminalShare.toFixed(1)}%.${monthSummary} Бизнес ${trendText}.${recommendation}`;
}

export default function OverviewPage({ analytics }: OverviewPageProps) {
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
          <p className="text-muted-foreground">
            Ключевые показатели эффективности вашего бизнеса
          </p>
        </motion.div>

        {/* Executive Summary */}
        <motion.div variants={itemVariants}>
          <Card className="relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden" data-testid="card-executive-summary">
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-40" />
            
            <div className="relative z-10 space-y-3">
              <div className="flex items-center gap-2">
                <FileBarChart className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Резюме</h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground" data-testid="text-executive-summary">
                {generateExecutiveSummary(analytics)}
              </p>
            </div>
          </Card>
        </motion.div>

        {/* Main KPI Cards */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={containerVariants}
        >
          <motion.div variants={itemVariants} className="h-[180px]">
            <KPICard
              title="Выручка (всего)"
              value={analytics.kpi.totalRevenue}
              icon={<DollarSign className="w-5 h-5" />}
              growth={analytics.kpi.revenueGrowth}
              format="currency"
              testId="card-revenue"
              description="Общая сумма выручки за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-[180px]">
            <KPICard
              title="Средний чек"
              value={analytics.kpi.averageCheck}
              icon={<Wallet className="w-5 h-5" />}
              growth={analytics.kpi.averageCheckGrowth}
              format="currency"
              testId="card-average-check"
              description="Средняя сумма одного чека (Общая выручка ÷ Количество чеков). Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
          <motion.div variants={itemVariants} className="h-[180px]">
            <KPICard
              title="Всего чеков"
              value={analytics.kpi.totalChecks}
              icon={<FileText className="w-5 h-5" />}
              growth={analytics.kpi.checksGrowth}
              format="number"
              testId="card-total-checks"
              description="Общее количество чеков за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
            />
          </motion.div>
        </motion.div>

        {/* Secondary KPIs */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
          variants={containerVariants}
        >
          <motion.div variants={itemVariants}>
            <KPICard
              title="Рост выручки (по дням)"
              value={analytics.kpi.revenueGrowthDoD !== undefined ? `${analytics.kpi.revenueGrowthDoD.toFixed(1)}%` : '—'}
              icon={<TrendingUp className="w-5 h-5" />}
              format="number"
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
              value={analytics.kpi.currentMonthAvgChecksPerDay !== undefined ? analytics.kpi.currentMonthAvgChecksPerDay.toFixed(1) : '—'}
              icon={<BarChart3 className="w-5 h-5" />}
              format="number"
              testId="card-avg-checks-per-day"
              description="Среднее количество чеков в день за текущий месяц (Чеков за месяц ÷ Количество дней с продажами)."
            />
          </motion.div>
        </motion.div>

        {/* Monthly Revenue Chart */}
        <motion.div className="space-y-4" variants={itemVariants}>
          <div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-foreground/70 bg-clip-text text-transparent">
              Динамика по месяцам
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Тренд выручки за последние месяцы
            </p>
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
              <p className="text-sm text-muted-foreground mt-1">
                Выручка в разрезе дней недели
              </p>
            </div>
            <DayOfWeekChart
              data={analytics.byDayOfWeek}
              title="Выручка по дням недели"
            />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
