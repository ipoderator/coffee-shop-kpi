import { useMemo, useState } from 'react';
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
import { Maximize2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

export interface MetricDatum {
  period: string;
  value: number;
}

export interface MetricLineChartProps {
  data: MetricDatum[];
  title: string;
  tooltipLabel?: string;
  color?: string;
  periodType?: 'day' | 'month' | 'year';
  valueFormatter?: (value: number) => string;
  yTickFormatter?: (value: number) => string;
}

const defaultFormatter = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);

export function MetricLineChart({
  data,
  title,
  tooltipLabel,
  color = 'hsl(var(--primary))',
  periodType = 'day',
  valueFormatter = defaultFormatter,
  yTickFormatter,
}: MetricLineChartProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const resolveCssColor = (input: string) => {
    if (typeof window === 'undefined' || !input.includes('var(')) {
      return input;
    }

    const match = input.match(/var\(--([^)]+)\)/);
    if (!match) {
      return input;
    }

    const style = getComputedStyle(document.documentElement);
    const value = style.getPropertyValue(`--${match[1]}`).trim();
    if (!value) {
      return input;
    }

    return input.replace(match[0], value);
  };

  const applyAlpha = (baseColor: string, alpha: number) => {
    if (baseColor.startsWith('hsl(')) {
      if (baseColor.includes('/')) {
        return baseColor.replace(/\/[^)]+\)/, `/ ${alpha})`);
      }
      return baseColor.replace(/\)$/, ` / ${alpha})`);
    }

    if (baseColor.startsWith('#')) {
      const hex = baseColor.replace('#', '');
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return baseColor;
  };

  const chartData = useMemo(() => {
    if (data.length === 0) {
      return null;
    }

    const resolvedColor = resolveCssColor(color);

    const labels = data.map((datum) => {
      const date = new Date(datum.period);
      if (Number.isNaN(date.getTime())) {
        return datum.period;
      }

      if (periodType === 'day') {
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
      }
      if (periodType === 'month') {
        return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(date);
      }
      return new Intl.DateTimeFormat('ru-RU', { year: 'numeric' }).format(date);
    });

    return {
      labels,
      datasets: [
        {
          label: tooltipLabel ?? title,
          data: data.map((datum) => datum.value),
          borderColor: resolvedColor,
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              return applyAlpha(resolvedColor, 0.15);
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, applyAlpha(resolvedColor, 0.35));
            gradient.addColorStop(0.5, applyAlpha(resolvedColor, 0.15));
            gradient.addColorStop(1, applyAlpha(resolvedColor, 0.05));
            return gradient;
          },
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: resolvedColor,
          pointHoverBorderColor: 'hsl(var(--background))',
          pointHoverBorderWidth: 2.5,
        },
      ],
    };
  }, [color, data, periodType, title, tooltipLabel]);

  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: 'rgba(15, 15, 20, 0.9)',
          borderColor: 'hsl(var(--primary) / 0.4)',
          borderWidth: 2,
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          padding: 18,
          displayColors: false,
          callbacks: {
            title(context) {
              return context[0]?.label ?? '';
            },
            label(context) {
              const value = context.parsed.y ?? 0;
              return `${tooltipLabel ?? title}: ${valueFormatter(value)}`;
            },
          },
        },
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: {
            color: 'hsl(var(--border) / 0.25)',
            drawTicks: false,
            borderDash: [4, 6],
          },
          ticks: {
            color: 'hsl(var(--foreground) / 0.7)',
            font: {
              family: 'var(--font-sans)',
              size: 12,
              weight: 500,
            },
            padding: 10,
            callback(value) {
              if (typeof value !== 'number') {
                return value;
              }
              return yTickFormatter ? yTickFormatter(value) : defaultFormatter(value);
            },
          },
        },
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: 'hsl(var(--foreground) / 0.7)',
            font: {
              family: 'var(--font-sans)',
              size: 12,
              weight: 500,
            },
            maxRotation: 0,
            padding: 8,
          },
        },
      },
    }),
    [title, tooltipLabel, valueFormatter, yTickFormatter],
  );

  if (!chartData) {
    return (
      <Card className="relative p-6 border-border/50 shadow-sm">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">Недостаточно данных для построения графика.</p>
      </Card>
    );
  }

  return (
    <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className="relative p-6 border-border/50 shadow-lg overflow-hidden hover-elevate transition-shadow">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full border-border/60 bg-background/60 hover:bg-background/80"
              aria-label={`Развернуть график «${title}»`}
              onClick={() => setIsExpanded(true)}
            >
              <Maximize2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div className="w-full h-[260px]">
            <Line data={chartData} options={options} />
          </div>
        </div>
      </Card>

      <DialogContent className="max-w-[95vw] sm:max-w-[90vw] lg:max-w-[80vw] h-[90vh] overflow-hidden bg-background/95 p-6 sm:p-8 grid-rows-[auto,1fr]">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-2xl font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <div className="relative h-full min-h-[60vh] w-full overflow-hidden rounded-xl border border-border/40 bg-card shadow-inner">
          <Line key={`expanded-${title}`} data={chartData} options={options} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
