import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Minus, Calendar, TrendingUp, CreditCard, Receipt } from 'lucide-react';
import { EnhancedWeeklyForecastCard } from '@/components/EnhancedWeeklyForecastCard';
import type { AnalyticsResponse } from '@shared/schema';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, ChartOptions } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

interface MonthlyReportPageProps {
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
      ease: "easeOut",
    },
  },
};

export default function MonthlyReportPage({ analytics }: MonthlyReportPageProps) {
  const { monthlyComparison } = analytics;

  if (!monthlyComparison) {
    return (
      <div className="p-8">
        <Card className="p-12 text-center">
          <p className="text-muted-foreground text-lg">Недостаточно данных для отображения месячного отчета</p>
        </Card>
      </div>
    );
  }

  const { currentMonth, previousMonth, comparison } = monthlyComparison;

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number): string => {
    return new Intl.NumberFormat('ru-RU').format(value);
  };

  const formatDecimal = (value: number): string => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatMonthName = (period: string): string => {
    const [year, month] = period.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(date);
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  };

  const formatPeriodRange = (endDateStr: string): string => {
    const endDate = new Date(endDateStr);
    const startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    const endDay = endDate.getDate();
    const monthYear = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(endDate);
    return `С 1 по ${endDay} ${monthYear}`;
  };

  // Group daily data by weeks to reduce scatter
  const groupDataByWeeks = (dailyData: any[]) => {
    if (dailyData.length === 0) return [];
    
    const weeklyData: any[] = [];
    
    // Сортируем данные по дате
    const sortedData = [...dailyData].sort((a, b) => new Date(a.period).getTime() - new Date(b.period).getTime());
    
    // Группируем данные по неделям месяца (7 дней)
    const weeks: any[][] = [];
    let currentWeek: any[] = [];
    
    sortedData.forEach((day, index) => {
      currentWeek.push(day);
      
      // Если неделя заполнена (7 дней) или это последний день
      if (currentWeek.length === 7 || index === sortedData.length - 1) {
        weeks.push([...currentWeek]);
        currentWeek = [];
      }
    });
    
    // Обрабатываем каждую неделю
    weeks.forEach((days, weekIndex) => {
      if (days.length === 0) return;
      
      // Вычисляем агрегированные данные для недели
      const weekRevenue = days.reduce((sum, day) => sum + (day.revenue || 0), 0);
      const weekChecks = days.reduce((sum, day) => sum + (day.checks || 0), 0);
      const weekAverageCheck = weekChecks > 0 ? weekRevenue / weekChecks : 0;
      
      const weekPaymentBreakdown = {
        cash: days.reduce((sum, day) => sum + (day.paymentBreakdown?.cash || 0), 0),
        terminal: days.reduce((sum, day) => sum + (day.paymentBreakdown?.terminal || 0), 0),
        qr: days.reduce((sum, day) => sum + (day.paymentBreakdown?.qr || 0), 0),
        sbp: days.reduce((sum, day) => sum + (day.paymentBreakdown?.sbp || 0), 0)
      };
      
      // Агрессивное сглаживание данных для устранения резких спадов
      let smoothedRevenue = weekRevenue;
      
      if (weeks.length > 1) {
        // Вычисляем все недельные доходы для анализа
        const allWeekRevenues = weeks.map(week => 
          week.reduce((sum, day) => sum + (day.revenue || 0), 0)
        );
        
        // Находим среднее значение всех недель
        const averageRevenue = allWeekRevenues.reduce((sum, rev) => sum + rev, 0) / allWeekRevenues.length;
        
        // Вычисляем медиану для более устойчивого центрального значения
        const sortedRevenues = [...allWeekRevenues].sort((a, b) => a - b);
        const medianRevenue = sortedRevenues[Math.floor(sortedRevenues.length / 2)];
        
        // Определяем, является ли текущая неделя аномальной
        const isAnomaly = weekRevenue < (medianRevenue * 0.7) || weekRevenue > (medianRevenue * 1.3);
        
        if (isAnomaly) {
          // Для аномальных значений применяем более агрессивное сглаживание
          if (weekIndex === 0) {
            // Первая неделя - используем среднее с медианой
            smoothedRevenue = (weekRevenue * 0.3) + (medianRevenue * 0.7);
          } else if (weekIndex === weeks.length - 1) {
            // Последняя неделя - используем среднее с предыдущей неделей
            const prevWeekRevenue = allWeekRevenues[weekIndex - 1];
            smoothedRevenue = (weekRevenue * 0.3) + (prevWeekRevenue * 0.7);
          } else {
            // Средние недели - используем взвешенное среднее с соседними неделями
            const prevWeekRevenue = allWeekRevenues[weekIndex - 1];
            const nextWeekRevenue = allWeekRevenues[weekIndex + 1];
            smoothedRevenue = (weekRevenue * 0.2) + (prevWeekRevenue * 0.4) + (nextWeekRevenue * 0.4);
          }
        } else {
          // Для нормальных значений применяем легкое сглаживание
          if (weekIndex > 0 && weekIndex < weeks.length - 1) {
            const prevWeekRevenue = allWeekRevenues[weekIndex - 1];
            const nextWeekRevenue = allWeekRevenues[weekIndex + 1];
            smoothedRevenue = (weekRevenue * 0.6) + (prevWeekRevenue * 0.2) + (nextWeekRevenue * 0.2);
          }
        }
      }
      
      weeklyData.push({
        period: days[0].period, // Используем первый день недели
        weekLabel: `Неделя ${weekIndex + 1}`,
        revenue: smoothedRevenue,
        checks: weekChecks,
        averageCheck: weekAverageCheck,
        paymentBreakdown: weekPaymentBreakdown,
        daysCount: days.length,
        weekIndex: weekIndex + 1
      });
    });
    
    return weeklyData;
  };

  // Функция для определения номера недели в году
  const getWeekNumber = (date: Date): number => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };

  const getGrowthBadge = (growth: number) => {
    const isPositive = growth > 0;
    const isNeutral = growth === 0;

    const GrowthIcon = isNeutral ? Minus : isPositive ? ArrowUp : ArrowDown;
    const growthClass = isNeutral 
      ? 'bg-muted text-muted-foreground' 
      : isPositive 
        ? 'bg-green-50 text-green-700 border-green-200' 
        : 'bg-red-50 text-red-700 border-red-200';

    return (
      <Badge 
        variant="outline" 
        className={`gap-1 font-medium border ${growthClass}`}
      >
        <GrowthIcon className="w-3 h-3" />
        {Math.abs(growth).toFixed(1)}%
      </Badge>
    );
  };

  // Calculate payment breakdown for filtered period
  // Note: dayComparison.currentDay contains aggregated data for the period from start of month to current day
  const filteredCurrentPaymentBreakdown = useMemo(() => {
    if (monthlyComparison.dayComparison?.currentDay) {
      // This contains payment breakdown aggregated from day 1 to current day of the month
      return monthlyComparison.dayComparison.currentDay.paymentBreakdown;
    }
    return currentMonth.metrics.paymentBreakdown;
  }, [monthlyComparison.dayComparison, currentMonth.metrics.paymentBreakdown]);

  const currentPaymentChartData = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const chart1 = style.getPropertyValue('--chart-1').trim();
    const chart2 = style.getPropertyValue('--chart-2').trim();
    const chart3 = style.getPropertyValue('--chart-3').trim();
    const chart4 = style.getPropertyValue('--chart-4').trim();

    return {
      labels: ['Наличные', 'Терминал', 'QR-код', 'СБП'],
      datasets: [
        {
          data: [
            filteredCurrentPaymentBreakdown.cash,
            filteredCurrentPaymentBreakdown.terminal,
            filteredCurrentPaymentBreakdown.qr,
            filteredCurrentPaymentBreakdown.sbp,
          ],
          backgroundColor: [
            `hsl(${chart1} / 0.8)`,
            `hsl(${chart2} / 0.8)`,
            `hsl(${chart3} / 0.8)`,
            `hsl(${chart4} / 0.8)`,
          ],
          borderColor: [
            `hsl(${chart1})`,
            `hsl(${chart2})`,
            `hsl(${chart3})`,
            `hsl(${chart4})`,
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [filteredCurrentPaymentBreakdown]);

  const filteredPreviousPaymentBreakdown = useMemo(() => {
    if (monthlyComparison.dayComparison?.previousMonthSameDay) {
      // This contains payment breakdown aggregated from day 1 to same day number in previous month
      return monthlyComparison.dayComparison.previousMonthSameDay.paymentBreakdown;
    }
    return previousMonth.metrics.paymentBreakdown;
  }, [monthlyComparison.dayComparison, previousMonth.metrics.paymentBreakdown]);

  const previousPaymentChartData = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const chart1 = style.getPropertyValue('--chart-1').trim();
    const chart2 = style.getPropertyValue('--chart-2').trim();
    const chart3 = style.getPropertyValue('--chart-3').trim();
    const chart4 = style.getPropertyValue('--chart-4').trim();

    return {
      labels: ['Наличные', 'Терминал', 'QR-код', 'СБП'],
      datasets: [
        {
          data: [
            filteredPreviousPaymentBreakdown.cash,
            filteredPreviousPaymentBreakdown.terminal,
            filteredPreviousPaymentBreakdown.qr,
            filteredPreviousPaymentBreakdown.sbp,
          ],
          backgroundColor: [
            `hsl(${chart1} / 0.8)`,
            `hsl(${chart2} / 0.8)`,
            `hsl(${chart3} / 0.8)`,
            `hsl(${chart4} / 0.8)`,
          ],
          borderColor: [
            `hsl(${chart1})`,
            `hsl(${chart2})`,
            `hsl(${chart3})`,
            `hsl(${chart4})`,
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [filteredPreviousPaymentBreakdown]);

  const chartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 15,
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed || 0;
            return `${context.label}: ${formatCurrency(value)}`;
          },
        },
      },
    },
  };

  // Filter daily data to show only up to current day of month for fair comparison
  const filteredCurrentMonthData = useMemo(() => {
    if (!monthlyComparison.dayComparison?.currentDay) {
      return currentMonth.metrics.dailyData;
    }

    const currentDayDate = new Date(monthlyComparison.dayComparison.currentDay.date);
    const currentDayOfMonth = currentDayDate.getDate();

    return currentMonth.metrics.dailyData.filter(d => {
      const date = new Date(d.period);
      return date.getDate() <= currentDayOfMonth;
    });
  }, [currentMonth.metrics.dailyData, monthlyComparison.dayComparison?.currentDay]);

  const filteredPreviousMonthData = useMemo(() => {
    if (!monthlyComparison.dayComparison?.currentDay) {
      return previousMonth.metrics.dailyData;
    }

    const currentDayDate = new Date(monthlyComparison.dayComparison.currentDay.date);
    const currentDayOfMonth = currentDayDate.getDate();

    // Get the last day of the previous month to handle month overflow
    const previousMonthDate = new Date(previousMonth.period + '-01');
    const previousMonthLastDay = new Date(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1, 0).getDate();
    const targetDayOfMonth = Math.min(currentDayOfMonth, previousMonthLastDay);

    return previousMonth.metrics.dailyData.filter(d => {
      const date = new Date(d.period);
      return date.getDate() <= targetDayOfMonth;
    });
  }, [previousMonth.metrics.dailyData, previousMonth.period, monthlyComparison.dayComparison?.currentDay]);

  // Group filtered data by weeks to reduce scatter
  const weeklyCurrentMonthData = useMemo(() => {
    return groupDataByWeeks(filteredCurrentMonthData);
  }, [filteredCurrentMonthData]);

  const weeklyPreviousMonthData = useMemo(() => {
    return groupDataByWeeks(filteredPreviousMonthData);
  }, [filteredPreviousMonthData]);

  // Calculate filtered metrics for fair comparison
  const filteredCurrentMetrics = useMemo(() => {
    const revenue = filteredCurrentMonthData.reduce((sum, d) => sum + d.revenue, 0);
    const checks = filteredCurrentMonthData.reduce((sum, d) => sum + d.checks, 0);
    const averageCheck = checks > 0 ? revenue / checks : 0;
    return { revenue, checks, averageCheck };
  }, [filteredCurrentMonthData]);

  const filteredPreviousMetrics = useMemo(() => {
    const revenue = filteredPreviousMonthData.reduce((sum, d) => sum + d.revenue, 0);
    const checks = filteredPreviousMonthData.reduce((sum, d) => sum + d.checks, 0);
    const averageCheck = checks > 0 ? revenue / checks : 0;
    return { revenue, checks, averageCheck };
  }, [filteredPreviousMonthData]);

  // Calculate comparison for filtered data
  const filteredComparison = useMemo(() => {
    const revenueGrowth = filteredPreviousMetrics.revenue > 0
      ? ((filteredCurrentMetrics.revenue - filteredPreviousMetrics.revenue) / filteredPreviousMetrics.revenue) * 100
      : 0;
    const checksGrowth = filteredPreviousMetrics.checks > 0
      ? ((filteredCurrentMetrics.checks - filteredPreviousMetrics.checks) / filteredPreviousMetrics.checks) * 100
      : 0;
    const averageCheckGrowth = filteredPreviousMetrics.averageCheck > 0
      ? ((filteredCurrentMetrics.averageCheck - filteredPreviousMetrics.averageCheck) / filteredPreviousMetrics.averageCheck) * 100
      : 0;
    return { revenueGrowth, checksGrowth, averageCheckGrowth };
  }, [filteredCurrentMetrics, filteredPreviousMetrics]);

  return (
    <div className="p-8 space-y-8" data-testid="page-monthly-report">
      <motion.div
        initial="hidden"
        animate="visible"
        variants={containerVariants}
        className="space-y-8"
      >
        {/* Header */}
        <motion.div className="space-y-2" variants={itemVariants}>
          <h1 className="text-3xl font-bold text-foreground">
            Месячный отчет
          </h1>
          <p className="text-muted-foreground">
            Сравнение периодов с начала месяца до актуального дня
          </p>
        </motion.div>

        {/* Comparison Summary */}
        <motion.div variants={itemVariants}>
          <Card className="p-6" data-testid="card-comparison-summary">
        <div className="grid md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Рост выручки
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold" data-testid="text-revenue-growth">
                {filteredComparison.revenueGrowth > 0 ? '+' : ''}{filteredComparison.revenueGrowth.toFixed(1)}%
              </span>
              {getGrowthBadge(filteredComparison.revenueGrowth)}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Рост количества чеков
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold" data-testid="text-checks-growth">
                {filteredComparison.checksGrowth > 0 ? '+' : ''}{filteredComparison.checksGrowth.toFixed(1)}%
              </span>
              {getGrowthBadge(filteredComparison.checksGrowth)}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Рост среднего чека
            </div>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold" data-testid="text-avg-check-growth">
                {filteredComparison.averageCheckGrowth > 0 ? '+' : ''}{filteredComparison.averageCheckGrowth.toFixed(1)}%
              </span>
              {getGrowthBadge(filteredComparison.averageCheckGrowth)}
            </div>
          </div>
          </div>
          </Card>
        </motion.div>

        {/* Side-by-side Month Comparison */}
        <motion.div className="grid lg:grid-cols-2 gap-6" variants={containerVariants}>
          {/* Current Month */}
          <motion.div className="space-y-4" variants={itemVariants}>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{formatMonthName(currentMonth.period)}</h2>
            <Badge variant="default">Текущий месяц</Badge>
          </div>

          {/* Current Month KPIs */}
          <div className="grid gap-4">
            <Card className="p-6" data-testid="card-current-revenue">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Выручка</div>
                <div className="text-3xl font-bold text-primary" data-testid="text-current-revenue">
                  {formatCurrency(filteredCurrentMetrics.revenue)}
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-current-checks">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Количество чеков</div>
                <div className="text-3xl font-bold" data-testid="text-current-checks">
                  {formatNumber(filteredCurrentMetrics.checks)}
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-current-avg-check">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Средний чек</div>
                <div className="text-3xl font-bold" data-testid="text-current-avg-check">
                  {formatCurrency(filteredCurrentMetrics.averageCheck)}
                </div>
              </div>
            </Card>
          </div>

          {/* Current Month Payment Breakdown */}
          <Card className="p-6" data-testid="card-current-payments">
            <h3 className="text-lg font-semibold mb-4">Методы оплаты</h3>
            <div className="h-64 mb-4">
              <Doughnut data={currentPaymentChartData} options={chartOptions} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Наличные</p>
                <p className="font-semibold text-sm" data-testid="text-current-cash">
                  {formatCurrency(filteredCurrentPaymentBreakdown.cash)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Терминал</p>
                <p className="font-semibold text-sm" data-testid="text-current-terminal">
                  {formatCurrency(filteredCurrentPaymentBreakdown.terminal)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">QR-код</p>
                <p className="font-semibold text-sm" data-testid="text-current-qr">
                  {formatCurrency(filteredCurrentPaymentBreakdown.qr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">СБП</p>
                <p className="font-semibold text-sm" data-testid="text-current-sbp">
                  {formatCurrency(filteredCurrentPaymentBreakdown.sbp)}
                </p>
              </div>
            </div>
            </Card>
          </motion.div>

          {/* Previous Month */}
          <motion.div className="space-y-4" variants={itemVariants}>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{formatMonthName(previousMonth.period)}</h2>
            <Badge variant="secondary">Предыдущий месяц</Badge>
          </div>

          {/* Previous Month KPIs */}
          <div className="grid gap-4">
            <Card className="p-6" data-testid="card-previous-revenue">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Выручка</div>
                <div className="text-3xl font-bold text-primary" data-testid="text-previous-revenue">
                  {formatCurrency(filteredPreviousMetrics.revenue)}
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-previous-checks">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Количество чеков</div>
                <div className="text-3xl font-bold" data-testid="text-previous-checks">
                  {formatNumber(filteredPreviousMetrics.checks)}
                </div>
              </div>
            </Card>

            <Card className="p-6" data-testid="card-previous-avg-check">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Средний чек</div>
                <div className="text-3xl font-bold" data-testid="text-previous-avg-check">
                  {formatCurrency(filteredPreviousMetrics.averageCheck)}
                </div>
              </div>
            </Card>
          </div>

          {/* Previous Month Payment Breakdown */}
          <Card className="p-6" data-testid="card-previous-payments">
            <h3 className="text-lg font-semibold mb-4">Методы оплаты</h3>
            <div className="h-64 mb-4">
              <Doughnut data={previousPaymentChartData} options={chartOptions} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Наличные</p>
                <p className="font-semibold text-sm" data-testid="text-previous-cash">
                  {formatCurrency(filteredPreviousPaymentBreakdown.cash)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Терминал</p>
                <p className="font-semibold text-sm" data-testid="text-previous-terminal">
                  {formatCurrency(filteredPreviousPaymentBreakdown.terminal)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">QR-код</p>
                <p className="font-semibold text-sm" data-testid="text-previous-qr">
                  {formatCurrency(filteredPreviousPaymentBreakdown.qr)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">СБП</p>
                <p className="font-semibold text-sm" data-testid="text-previous-sbp">
                  {formatCurrency(filteredPreviousPaymentBreakdown.sbp)}
                </p>
              </div>
            </div>
            </Card>
          </motion.div>
        </motion.div>


        {/* Period-to-Period Comparison */}
        {monthlyComparison.dayComparison && (
          <motion.div className="space-y-4" variants={itemVariants}>
          <h2 className="text-2xl font-bold">Сравнение периода с начала месяца</h2>

          {monthlyComparison.dayComparison.comparison && (
            <Card className="p-6" data-testid="card-day-comparison-summary">
              <div className="grid md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Рост выручки</div>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold" data-testid="text-day-revenue-growth">
                      {monthlyComparison.dayComparison.comparison.revenueGrowth > 0 ? '+' : ''}
                      {monthlyComparison.dayComparison.comparison.revenueGrowth.toFixed(1)}%
                    </span>
                    {getGrowthBadge(monthlyComparison.dayComparison.comparison.revenueGrowth)}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Рост чеков</div>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold" data-testid="text-day-checks-growth">
                      {monthlyComparison.dayComparison.comparison.checksGrowth > 0 ? '+' : ''}
                      {monthlyComparison.dayComparison.comparison.checksGrowth.toFixed(1)}%
                    </span>
                    {getGrowthBadge(monthlyComparison.dayComparison.comparison.checksGrowth)}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Рост среднего чека</div>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold" data-testid="text-day-avg-check-growth">
                      {monthlyComparison.dayComparison.comparison.averageCheckGrowth > 0 ? '+' : ''}
                      {monthlyComparison.dayComparison.comparison.averageCheckGrowth.toFixed(1)}%
                    </span>
                    {getGrowthBadge(monthlyComparison.dayComparison.comparison.averageCheckGrowth)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Current Period */}
            {monthlyComparison.dayComparison.currentDay && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold">
                    {formatPeriodRange(monthlyComparison.dayComparison.currentDay.date)}
                  </h3>
                  <Badge variant="default">Текущий месяц</Badge>
                </div>

                <div className="grid gap-4">
                  <Card className="p-6" data-testid="card-current-day-revenue">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Выручка за период</div>
                      <div className="text-3xl font-bold text-primary" data-testid="text-current-day-revenue">
                        {formatCurrency(monthlyComparison.dayComparison.currentDay.revenue)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-current-day-checks">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Количество чеков</div>
                      <div className="text-3xl font-bold" data-testid="text-current-day-checks">
                        {formatNumber(monthlyComparison.dayComparison.currentDay.checks)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-current-day-avg">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Средний чек</div>
                      <div className="text-3xl font-bold" data-testid="text-current-day-avg">
                        {formatCurrency(monthlyComparison.dayComparison.currentDay.averageCheck)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-current-day-payments">
                    <h4 className="text-base font-semibold mb-3">Методы оплаты</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Наличные</p>
                        <p className="font-semibold text-sm" data-testid="text-current-day-cash">
                          {formatCurrency(monthlyComparison.dayComparison.currentDay.paymentBreakdown.cash)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Терминал</p>
                        <p className="font-semibold text-sm" data-testid="text-current-day-terminal">
                          {formatCurrency(monthlyComparison.dayComparison.currentDay.paymentBreakdown.terminal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">QR-код</p>
                        <p className="font-semibold text-sm" data-testid="text-current-day-qr">
                          {formatCurrency(monthlyComparison.dayComparison.currentDay.paymentBreakdown.qr)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">СБП</p>
                        <p className="font-semibold text-sm" data-testid="text-current-day-sbp">
                          {formatCurrency(monthlyComparison.dayComparison.currentDay.paymentBreakdown.sbp)}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* Previous Period */}
            {monthlyComparison.dayComparison.previousMonthSameDay && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold">
                    {formatPeriodRange(monthlyComparison.dayComparison.previousMonthSameDay.date)}
                  </h3>
                  <Badge variant="secondary">Предыдущий месяц</Badge>
                </div>

                <div className="grid gap-4">
                  <Card className="p-6" data-testid="card-previous-day-revenue">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Выручка за период</div>
                      <div className="text-3xl font-bold text-primary" data-testid="text-previous-day-revenue">
                        {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.revenue)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-previous-day-checks">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Количество чеков</div>
                      <div className="text-3xl font-bold" data-testid="text-previous-day-checks">
                        {formatNumber(monthlyComparison.dayComparison.previousMonthSameDay.checks)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-previous-day-avg">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Средний чек</div>
                      <div className="text-3xl font-bold" data-testid="text-previous-day-avg">
                        {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.averageCheck)}
                      </div>
                    </div>
                  </Card>

                  <Card className="p-6" data-testid="card-previous-day-payments">
                    <h4 className="text-base font-semibold mb-3">Методы оплаты</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Наличные</p>
                        <p className="font-semibold text-sm" data-testid="text-previous-day-cash">
                          {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.paymentBreakdown.cash)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Терминал</p>
                        <p className="font-semibold text-sm" data-testid="text-previous-day-terminal">
                          {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.paymentBreakdown.terminal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">QR-код</p>
                        <p className="font-semibold text-sm" data-testid="text-previous-day-qr">
                          {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.paymentBreakdown.qr)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">СБП</p>
                        <p className="font-semibold text-sm" data-testid="text-previous-day-sbp">
                          {formatCurrency(monthlyComparison.dayComparison.previousMonthSameDay.paymentBreakdown.sbp)}
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* No data message */}
            {!monthlyComparison.dayComparison.currentDay && !monthlyComparison.dayComparison.previousMonthSameDay && (
              <Card className="p-12 text-center col-span-2">
                <p className="text-muted-foreground">Нет данных для сравнения по дням</p>
              </Card>
            )}
          </div>
        </motion.div>
        )}

        {/* Revenue Forecast */}
        {analytics.forecast && (
          <motion.div variants={itemVariants}>
            <EnhancedWeeklyForecastCard forecast={analytics.forecast} />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
