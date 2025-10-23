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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface RevenueChartProps {
  data: PeriodData[];
  title?: string;
  periodType?: 'day' | 'month' | 'year';
}

export function RevenueChart({ data, title = 'Динамика выручки', periodType = 'day' }: RevenueChartProps) {
  const chartData = useMemo(() => {
    const labels = data.map(d => {
      if (periodType === 'day') {
        const date = new Date(d.period);
        return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(date);
      } else if (periodType === 'month') {
        // Period format: "yyyy-MM", parse as first day of month
        const [year, month] = d.period.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        return new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' }).format(date);
      } else {
        // Period format: "yyyy", just return the year
        return d.period;
      }
    });

    // Get computed colors from CSS variables
    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--primary').trim();
    const cardColor = style.getPropertyValue('--card').trim();

    return {
      labels,
      datasets: [
        {
          label: 'Выручка',
          data: data.map(d => d.revenue),
          borderColor: `hsl(${primaryColor})`,
          // Use scriptable backgroundColor for gradient
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const {ctx, chartArea} = chart;
            
            if (!chartArea) {
              return `hsl(${primaryColor} / 0.2)`;
            }
            
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, `hsl(${primaryColor} / 0.4)`);
            gradient.addColorStop(0.5, `hsl(${primaryColor} / 0.2)`);
            gradient.addColorStop(1, `hsl(${primaryColor} / 0.05)`);
            return gradient;
          },
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: `hsl(${primaryColor})`,
          pointBorderColor: `hsl(${cardColor})`,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 3,
          pointHoverBackgroundColor: `hsl(${primaryColor})`,
          pointHoverBorderColor: `hsl(${cardColor})`,
        },
      ],
    };
  }, [data, periodType]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: 'hsl(var(--primary) / 0.6)',
        borderWidth: 2,
        padding: 20,
        displayColors: false,
        cornerRadius: 16,
        titleFont: {
          size: 15,
          weight: 'bold',
        },
        bodyFont: {
          size: 14,
          weight: 'bold',
        },
        callbacks: {
          title: function(context) {
            return context[0].label;
          },
          label: function(context) {
            const dataIndex = context.dataIndex;
            const periodData = data[dataIndex];
            
            const revenue = new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(periodData.revenue);

            const checks = new Intl.NumberFormat('ru-RU').format(periodData.checks);
            
            const avgCheck = new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(periodData.averageCheck);

            return [
              `Выручка: ${revenue}`,
              `Количество чеков: ${checks}`,
              `Средний чек: ${avgCheck}`,
            ];
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: 'hsl(var(--border) / 0.3)',
          lineWidth: 1,
        },
        border: {
          display: false,
          dash: [5, 5],
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.8)',
          font: {
            family: 'var(--font-mono)',
            size: 13,
            weight: 'bold',
          },
          padding: 12,
          callback: function(value) {
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
          color: 'hsl(var(--foreground) / 0.8)',
          font: {
            size: 12,
            weight: 'bold',
          },
          padding: 10,
          maxRotation: 45,
          minRotation: 0,
        },
      },
    },
  };

  return (
    <Card className="relative p-6 shadow-lg border-border/50 overflow-hidden" data-testid="chart-revenue">
      {/* Enhanced gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent" />
      
      {/* Content */}
      <div className="relative z-10">
        <h3 className="text-xl font-bold mb-6 bg-gradient-to-r from-foreground via-primary/80 to-foreground/70 bg-clip-text text-transparent">
          {title}
        </h3>
        <div className="w-full">
          <Line data={chartData} options={options} />
        </div>
      </div>
    </Card>
  );
}
