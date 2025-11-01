import { useMemo, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { PeriodData } from '@shared/schema';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface RevenueChartProps {
  data: PeriodData[];
  title?: string;
  periodType?: 'day' | 'month' | 'year';
}

export function RevenueChart({
  data,
  title = 'Динамика выручки',
  periodType = 'day',
}: RevenueChartProps) {
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
  const compactNumberFormatter = useMemo(
    () =>
      new Intl.NumberFormat('ru-RU', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1,
      }),
    [],
  );

  const formatSignedPercent = (value: number) => {
    if (!Number.isFinite(value)) {
      return '—';
    }
    const rounded = value.toFixed(1);
    if (value > 0) return `+${rounded}%`;
    if (value < 0) return `${rounded}%`;
    return `${rounded}%`;
  };

  const formatSignedCurrency = (value: number) => {
    if (!Number.isFinite(value)) {
      return '—';
    }
    if (value > 0) {
      return `+${currencyFormatter.format(value)}`;
    }
    return currencyFormatter.format(value);
  };

  const formatPeriodLabel = useCallback(
    (period: string) => {
      if (periodType === 'month') {
        const [year, month] = period.split('-');
        if (year && month) {
          const parsed = new Date(Number(year), Number(month) - 1, 1);
          if (!Number.isNaN(parsed.getTime())) {
            return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(
              parsed,
            );
          }
        }
      }

      if (periodType === 'year') {
        return period;
      }

      const date = new Date(period);
      if (!Number.isNaN(date.getTime())) {
        if (periodType === 'day') {
          return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
        }
        return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(date);
      }
      return period;
    },
    [periodType],
  );

  const summary = useMemo(() => {
    if (!data || data.length === 0) {
      return null;
    }

    const totalRevenue = data.reduce((acc, item) => acc + (item.revenue ?? 0), 0);
    const averageRevenue = totalRevenue / data.length;
    const totalChecks = data.reduce((acc, item) => acc + (item.checks ?? 0), 0);
    const averageChecks = totalChecks / data.length;
    const totalAvgCheck = data.reduce((acc, item) => acc + (item.averageCheck ?? 0), 0);
    const averageAverageCheck = totalAvgCheck / data.length;

    const latestIndex = data.length - 1;
    const latest = data[latestIndex];
    const previous = data.length > 1 ? data[latestIndex - 1] : null;

    const momAbsolute = previous ? latest.revenue - previous.revenue : null;
    const momGrowth =
      previous && previous.revenue
        ? ((latest.revenue - previous.revenue) / previous.revenue) * 100
        : null;

    const best = data.reduce(
      (acc, item, index) => (item.revenue > acc.revenue ? { revenue: item.revenue, index } : acc),
      { revenue: data[0].revenue, index: 0 },
    );
    const worst = data.reduce(
      (acc, item, index) => (item.revenue < acc.revenue ? { revenue: item.revenue, index } : acc),
      { revenue: data[0].revenue, index: 0 },
    );

    const bestVsAveragePct =
      averageRevenue > 0 ? ((best.revenue - averageRevenue) / averageRevenue) * 100 : null;
    const worstVsAveragePct =
      averageRevenue > 0 ? ((worst.revenue - averageRevenue) / averageRevenue) * 100 : null;

    const movingAverage = data.map((_, idx) => {
      if (idx < 2) {
        return null;
      }
      const slice = data.slice(idx - 2, idx + 1);
      const sum = slice.reduce((acc, item) => acc + item.revenue, 0);
      return sum / slice.length;
    });

    return {
      latestIndex,
      latest,
      previous,
      momAbsolute,
      momGrowth,
      bestIndex: best.index,
      best,
      worstIndex: worst.index,
      worst,
      averageRevenue,
      averageChecks,
      averageAverageCheck,
      movingAverage,
      bestVsAveragePct,
      worstVsAveragePct,
      bestLabel: formatPeriodLabel(data[best.index].period),
      worstLabel: formatPeriodLabel(data[worst.index].period),
      latestLabel: formatPeriodLabel(latest.period),
      previousLabel: previous ? formatPeriodLabel(previous.period) : null,
    };
  }, [data, formatPeriodLabel]);

  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      return { labels: [], datasets: [] };
    }

    const labels = data.map((d) => formatPeriodLabel(d.period));

    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const primaryColor = style?.getPropertyValue('--primary').trim() ?? '';
    const cardColor = style?.getPropertyValue('--card').trim() ?? '';
    const successColor =
      style?.getPropertyValue('--chart-2').trim() ??
      style?.getPropertyValue('--success').trim() ??
      primaryColor;
    const warningColor =
      style?.getPropertyValue('--chart-5').trim() ??
      style?.getPropertyValue('--destructive').trim() ??
      primaryColor;

    const baseColor = primaryColor ? `hsl(${primaryColor})` : '#2563eb';
    const cardColorHsl = cardColor ? `hsl(${cardColor})` : '#ffffff';
    const successColorHsl = successColor ? `hsl(${successColor})` : baseColor;
    const warningColorHsl = warningColor ? `hsl(${warningColor})` : baseColor;
    const baseAlpha = (alpha: number) =>
      primaryColor ? `hsl(${primaryColor} / ${alpha})` : `rgba(37, 99, 235, ${alpha})`;

    const movingAverageDataset =
      summary?.movingAverage && summary.movingAverage.some((value) => typeof value === 'number')
        ? [
            {
              label: '3-месячное среднее',
              data: summary.movingAverage,
              borderColor: baseAlpha(0.55),
              backgroundColor: 'transparent',
              borderWidth: 2,
              borderDash: [6, 6],
              pointRadius: 0,
              tension: 0.3,
              fill: false,
            },
          ]
        : [];

    const revenueDataset = {
      label: 'Выручка',
      data: data.map((d) => d.revenue),
      borderColor: baseColor,
      backgroundColor: (context: any) => {
        const chart = context.chart;
        const { ctx, chartArea } = chart;

        if (!chartArea) {
          return baseAlpha(0.2);
        }

        const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, baseAlpha(0.35));
        gradient.addColorStop(0.6, baseAlpha(0.18));
        gradient.addColorStop(1, baseAlpha(0.05));
        return gradient;
      },
      fill: true,
      tension: 0.35,
      borderWidth: 3,
      pointRadius: (ctx: any) => {
        if (!summary) return 4;
        if (ctx.dataIndex === summary.bestIndex) return 6;
        if (ctx.dataIndex === summary.worstIndex) return 5;
        if (ctx.dataIndex === summary.latestIndex) return 5;
        return 4;
      },
      pointHoverRadius: (ctx: any) => {
        if (!summary) return 7;
        if (ctx.dataIndex === summary.bestIndex) return 8;
        if (ctx.dataIndex === summary.worstIndex) return 8;
        if (ctx.dataIndex === summary.latestIndex) return 8;
        return 7;
      },
      pointBackgroundColor: (ctx: any) => {
        if (!summary) return baseColor;
        if (ctx.dataIndex === summary.bestIndex) return successColorHsl;
        if (ctx.dataIndex === summary.worstIndex) return warningColorHsl;
        return baseColor;
      },
      pointBorderColor: cardColorHsl,
      pointBorderWidth: (ctx: any) => (summary && ctx.dataIndex === summary.latestIndex ? 3 : 2),
      pointHoverBorderWidth: 3,
      pointHoverBackgroundColor: baseColor,
      pointHoverBorderColor: cardColorHsl,
    };

    return {
      labels,
      datasets: [revenueDataset, ...movingAverageDataset],
    };
  }, [data, formatPeriodLabel, summary]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(10, 14, 22, 0.92)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: 'hsl(var(--primary) / 0.6)',
        borderWidth: 2,
        padding: 18,
        displayColors: false,
        cornerRadius: 16,
        titleFont: {
          size: 15,
          weight: 'bold',
        },
        bodyFont: {
          size: 14,
          weight: '600',
        },
        callbacks: {
          title: (context) => context[0]?.label ?? '',
          label: (context) => {
            const label = context.dataset.label ?? '';
            const value = context.parsed.y ?? 0;
            const index = context.dataIndex;

            if (label === '3-месячное среднее') {
              return `${label}: ${currencyFormatter.format(value)}`;
            }

            const point = data[index];
            if (!point) {
              return `${label}: ${currencyFormatter.format(value)}`;
            }

            const prev = index > 0 ? data[index - 1] : null;
            const growth =
              prev && prev.revenue ? ((point.revenue - prev.revenue) / prev.revenue) * 100 : null;

            const lines = [
              `${label}: ${currencyFormatter.format(point.revenue)}`,
              `Количество чеков: ${numberFormatter.format(point.checks ?? 0)}`,
              `Средний чек: ${currencyFormatter.format(point.averageCheck ?? 0)}`,
            ];

            if (growth !== null && Number.isFinite(growth)) {
              lines.push(`Δ к предыдущему месяцу: ${formatSignedPercent(growth)}`);
            }

            return lines;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'hsl(var(--border) / 0.25)',
          lineWidth: 1,
          borderDash: [4, 6],
        },
        border: {
          display: false,
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.75)',
          font: {
            family: 'var(--font-sans)',
            size: 12,
            weight: 600,
          },
          padding: 12,
          callback: (value) => {
            if (typeof value === 'number') {
              return compactNumberFormatter.format(value);
            }
            return value;
          },
        },
      },
      x: {
        grid: {
          display: false,
        },
        border: {
          display: false,
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.7)',
          font: {
            family: 'var(--font-sans)',
            size: 12,
            weight: 600,
          },
          padding: 10,
          maxRotation: 0,
        },
      },
    },
  };

  return (
    <Card
      className="relative p-6 shadow-lg border-border/50 overflow-hidden"
      data-testid="chart-revenue"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent" />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-xl font-bold bg-gradient-to-r from-foreground via-primary/80 to-foreground/70 bg-clip-text text-transparent">
            {title}
          </h3>
          {summary?.momGrowth !== null && summary.previous && (
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium',
                summary.momGrowth > 0
                  ? 'border-emerald-400/60 text-emerald-600'
                  : summary.momGrowth < 0
                    ? 'border-red-400/60 text-red-500'
                    : 'border-border/60 text-muted-foreground',
              )}
            >
              {summary.momGrowth > 0
                ? 'Рост'
                : summary.momGrowth < 0
                  ? 'Снижение'
                  : 'Без изменений'}{' '}
              {formatSignedPercent(summary.momGrowth)}
            </span>
          )}
        </div>

        {summary && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/50 bg-background/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Последний месяц
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {currencyFormatter.format(summary.latest.revenue)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.latestLabel}
                {typeof summary.latest.averageCheck === 'number'
                  ? ` • Средний чек ${currencyFormatter.format(summary.latest.averageCheck)}`
                  : ''}
                {typeof summary.latest.checks === 'number'
                  ? ` • ${numberFormatter.format(summary.latest.checks)} чеков`
                  : ''}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Δ к предыдущему месяцу
              </p>
              <p
                className={cn(
                  'mt-2 text-lg font-semibold',
                  summary.momGrowth !== null && summary.momGrowth > 0
                    ? 'text-emerald-600'
                    : summary.momGrowth !== null && summary.momGrowth < 0
                      ? 'text-red-500'
                      : 'text-foreground',
                )}
              >
                {summary.momGrowth !== null ? formatSignedPercent(summary.momGrowth) : '—'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary.momAbsolute !== null ? formatSignedCurrency(summary.momAbsolute) : '—'}
                {summary.previousLabel ? ` • ${summary.previousLabel}` : ''}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Лучший месяц</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{summary.bestLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {currencyFormatter.format(summary.best.revenue)}
                {summary.bestVsAveragePct !== null
                  ? ` • ${formatSignedPercent(summary.bestVsAveragePct)} к среднему`
                  : ''}
              </p>
            </div>
            <div className="rounded-xl border border-border/50 bg-background/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Среднее за период
              </p>
              <p className="mt-2 text-lg font-semibold text-foreground">
                {currencyFormatter.format(summary.averageRevenue)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {numberFormatter.format(Math.round(summary.averageChecks))} чеков/мес • Средний чек{' '}
                {currencyFormatter.format(summary.averageAverageCheck)}
              </p>
            </div>
          </div>
        )}

        <div className="w-full">
          <Line data={chartData} options={options} />
        </div>

        {summary && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <div>
              Минимальный месяц:{' '}
              <span className="font-medium text-foreground">{summary.worstLabel}</span> —{' '}
              {currencyFormatter.format(summary.worst.revenue)}
              {summary.worstVsAveragePct !== null
                ? ` (${formatSignedPercent(summary.worstVsAveragePct)} к среднему)`
                : ''}
            </div>
            {summary.movingAverage &&
              summary.movingAverage.some((value) => typeof value === 'number') && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full bg-primary" />
                    Фактическая выручка
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-3 rounded-full border border-primary border-dashed" />
                    3-месячное среднее
                  </span>
                </div>
              )}
          </div>
        )}
      </div>
    </Card>
  );
}
