import { useMemo } from 'react';
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
import { Card } from '@/components/ui/card';
import { PeriodData } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

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

interface ComparisonRevenueChartProps {
  currentData: PeriodData[];
  previousData: PeriodData[];
  currentLabel: string;
  previousLabel: string;
  title: string;
}

export function ComparisonRevenueChart({
  currentData,
  previousData,
  currentLabel,
  previousLabel,
  title,
}: ComparisonRevenueChartProps) {
  // Агрессивное сглаживание и фильтрация экстремальных значений
  const filterExtremeValues = useMemo(() => {
    return (data: number[]) => {
      if (data.length < 3) return data;

      // Вычисляем медиану для более устойчивого центрального значения
      const sorted = [...data].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];

      // Применяем многоуровневое сглаживание
      let smoothedData = [...data];

      // Первый проход: сглаживание скользящим средним
      smoothedData = smoothedData.map((value, index) => {
        if (index === 0 || index === data.length - 1) {
          return value;
        }

        const prevValue = data[index - 1];
        const nextValue = data[index + 1];

        // Определяем, является ли значение аномальным
        const isAnomaly = value < median * 0.6 || value > median * 1.4;

        if (isAnomaly) {
          // Для аномальных значений применяем более агрессивное сглаживание
          return prevValue * 0.4 + value * 0.2 + nextValue * 0.4;
        } else {
          // Для нормальных значений легкое сглаживание
          return prevValue * 0.2 + value * 0.6 + nextValue * 0.2;
        }
      });

      // Второй проход: дополнительное сглаживание для крайних значений
      smoothedData = smoothedData.map((value, index) => {
        if (index === 0 || index === smoothedData.length - 1) {
          // Для крайних значений используем медиану как базу
          return value * 0.7 + median * 0.3;
        }
        return value;
      });

      // Третий проход: финальная фильтрация выбросов
      const finalSorted = [...smoothedData].sort((a, b) => a - b);
      const q1 = finalSorted[Math.floor(finalSorted.length * 0.25)];
      const q3 = finalSorted[Math.floor(finalSorted.length * 0.75)];
      const iqr = q3 - q1;
      const lowerBound = q1 - 1.2 * iqr; // Более мягкие границы
      const upperBound = q3 + 1.2 * iqr;

      return smoothedData.map((value) => {
        if (value < lowerBound || value > upperBound) {
          // Заменяем экстремальные значения на медиану
          return median;
        }
        return value;
      });
    };
  }, []);

  const currentRevenues = useMemo(() => {
    return filterExtremeValues(currentData.map((d) => d.revenue));
  }, [currentData, filterExtremeValues]);

  const previousRevenues = useMemo(() => {
    return filterExtremeValues(previousData.map((d) => d.revenue));
  }, [previousData, filterExtremeValues]);

  const chartData = useMemo(() => {
    // Create labels based on data length and type
    const maxLength = Math.max(currentData.length, previousData.length);
    const labels = Array.from({ length: maxLength }, (_, i) => {
      const currentLabel = currentData[i]?.period;
      const previousLabel = previousData[i]?.period;

      if (currentLabel && currentLabel.trim().length > 0) {
        return currentLabel;
      }

      if (previousLabel && previousLabel.trim().length > 0) {
        return previousLabel;
      }

      return `Период ${i + 1}`;
    });

    return {
      labels,
      datasets: [
        {
          label: currentLabel,
          data: currentRevenues,
          borderColor: (context: any) => {
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const primaryColor = style.getPropertyValue('--primary').trim();
              return `hsl(${primaryColor})`;
            }
            return '#3b82f6';
          },
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              return 'rgba(59, 130, 246, 0.15)';
            }

            let primaryColor = '217, 70%, 60%';
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const colorValue = style.getPropertyValue('--primary').trim();
              // Convert "H S% L%" to "H, S%, L%" for hsla format
              primaryColor = colorValue.replace(/\s+/g, ', ');
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, `hsla(${primaryColor}, 0.3)`);
            gradient.addColorStop(0.5, `hsla(${primaryColor}, 0.15)`);
            gradient.addColorStop(1, `hsla(${primaryColor}, 0.05)`);
            return gradient;
          },
          fill: true,
          tension: 0.6, // Увеличиваем сглаживание кривой
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: (context: any) => {
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const primaryColor = style.getPropertyValue('--primary').trim();
              return `hsl(${primaryColor})`;
            }
            return '#3b82f6';
          },
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointHoverBorderWidth: 3,
        },
        {
          label: previousLabel,
          data: previousRevenues,
          borderColor: (context: any) => {
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const chart2Color = style.getPropertyValue('--chart-2').trim();
              return `hsl(${chart2Color})`;
            }
            return '#10b981';
          },
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              return 'rgba(16, 185, 129, 0.15)';
            }

            let chart2Color = '142, 71%, 45%';
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const colorValue = style.getPropertyValue('--chart-2').trim();
              // Convert "H S% L%" to "H, S%, L%" for hsla format
              chart2Color = colorValue.replace(/\s+/g, ', ');
            }

            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, `hsla(${chart2Color}, 0.3)`);
            gradient.addColorStop(0.5, `hsla(${chart2Color}, 0.15)`);
            gradient.addColorStop(1, `hsla(${chart2Color}, 0.05)`);
            return gradient;
          },
          fill: true,
          tension: 0.6, // Увеличиваем сглаживание кривой
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 7,
          pointBackgroundColor: (context: any) => {
            if (typeof document !== 'undefined') {
              const style = getComputedStyle(document.documentElement);
              const chart2Color = style.getPropertyValue('--chart-2').trim();
              return `hsl(${chart2Color})`;
            }
            return '#10b981';
          },
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointHoverBorderWidth: 3,
        },
      ],
    };
  }, [currentData, previousData, currentLabel, previousLabel, currentRevenues, previousRevenues]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2.2,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 15,
          font: {
            size: 13,
            weight: 'bold',
          },
          color: 'rgba(100, 100, 100, 0.9)',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: 'rgba(59, 130, 246, 0.6)',
        borderWidth: 2,
        padding: 16,
        cornerRadius: 12,
        titleFont: {
          size: 14,
          weight: 'bold',
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          title: function (context) {
            return `День ${context[0].label}`;
          },
          label: function (context) {
            const value = context.parsed.y ?? 0;
            const formatted = new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(value);
            return `${context.dataset.label}: ${formatted}`;
          },
          afterBody: function (context) {
            const dayIndex = context[0].dataIndex;

            // Safely get values, checking array bounds
            const currentValue =
              dayIndex < currentData.length ? currentData[dayIndex]?.revenue : null;
            const previousValue =
              dayIndex < previousData.length ? previousData[dayIndex]?.revenue : null;

            if (currentValue !== null && previousValue !== null) {
              const diff = currentValue - previousValue;
              const percentDiff = previousValue > 0 ? (diff / previousValue) * 100 : 0;
              const diffFormatted = new Intl.NumberFormat('ru-RU', {
                style: 'currency',
                currency: 'RUB',
                minimumFractionDigits: 0,
                signDisplay: 'always',
              }).format(diff);

              return [
                '',
                `Отклонение: ${diffFormatted}`,
                `Изменение: ${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(1)}%`,
              ];
            }
            return [];
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(200, 200, 200, 0.3)',
          lineWidth: 1,
        },
        border: {
          display: false,
        },
        ticks: {
          color: 'rgba(100, 100, 100, 0.8)',
          font: {
            size: 12,
            weight: 'bold',
          },
          padding: 10,
          callback: function (value) {
            if (typeof value === 'number') {
              return new Intl.NumberFormat('ru-RU', {
                notation: 'compact',
                compactDisplay: 'short',
              }).format(value);
            }
            return '';
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
          color: 'rgba(100, 100, 100, 0.8)',
          font: {
            size: 12,
            weight: 'bold',
          },
          padding: 8,
        },
      },
    },
  };

  // Calculate overall comparison metrics using filtered data
  const totalCurrentRevenue = useMemo(() => {
    return currentRevenues.reduce((sum, revenue) => sum + revenue, 0);
  }, [currentRevenues]);

  const totalPreviousRevenue = useMemo(() => {
    return previousRevenues.reduce((sum, revenue) => sum + revenue, 0);
  }, [previousRevenues]);

  const diff = useMemo(() => {
    return totalCurrentRevenue - totalPreviousRevenue;
  }, [totalCurrentRevenue, totalPreviousRevenue]);

  const percentDiff = useMemo(() => {
    return totalPreviousRevenue > 0 ? (diff / totalPreviousRevenue) * 100 : 0;
  }, [diff, totalPreviousRevenue]);

  const getGrowthBadge = (growth: number) => {
    const isPositive = growth > 0;
    const isNeutral = growth === 0;

    const GrowthIcon = isNeutral ? Minus : isPositive ? ArrowUp : ArrowDown;
    const growthClass = isNeutral
      ? 'bg-muted text-muted-foreground'
      : isPositive
        ? 'bg-chart-2/10 text-chart-2 border-chart-2/20'
        : 'bg-destructive/10 text-destructive border-destructive/20';

    return (
      <Badge
        variant="outline"
        className={`gap-1 font-semibold border ${growthClass}`}
        data-testid="badge-comparison-growth"
      >
        <GrowthIcon className="w-3 h-3" />
        {Math.abs(growth).toFixed(1)}%
      </Badge>
    );
  };

  return (
    <Card
      className="relative p-6 shadow-lg border-border/50 overflow-hidden"
      data-testid="chart-comparison-revenue"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold bg-gradient-to-r from-foreground via-primary/80 to-foreground/70 bg-clip-text text-transparent">
            {title}
          </h3>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Общее отклонение</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold" data-testid="text-total-diff">
                  {new Intl.NumberFormat('ru-RU', {
                    style: 'currency',
                    currency: 'RUB',
                    minimumFractionDigits: 0,
                    signDisplay: 'always',
                  }).format(diff)}
                </span>
                {getGrowthBadge(percentDiff)}
              </div>
            </div>
          </div>
        </div>
        <div className="w-full">
          <Line data={chartData} options={options} />
        </div>
      </div>
    </Card>
  );
}
