import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/card';
import { DayOfWeekData } from '@shared/schema';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface DayOfWeekChartProps {
  data: DayOfWeekData[];
  title?: string;
}

export function DayOfWeekChart({ data, title = 'Выручка по дням недели' }: DayOfWeekChartProps) {
  const chartData = useMemo(() => {
    const labels = data.map(d => d.dayName);
    
    // Get computed colors from CSS variables
    const style = getComputedStyle(document.documentElement);
    const chartColor2 = style.getPropertyValue('--chart-2').trim();
    const destructiveColor = style.getPropertyValue('--destructive').trim();
    const chartColor1 = style.getPropertyValue('--chart-1').trim();

    // Find min and max revenue
    const revenues = data.map(d => d.revenue);
    const maxRevenue = Math.max(...revenues);
    const minRevenue = Math.min(...revenues);
    
    // Find first index with max and min values
    const maxIndex = data.findIndex(d => d.revenue === maxRevenue);
    const minIndex = data.findIndex(d => d.revenue === minRevenue);

    // Single scriptable backgroundColor function for all bars
    const backgroundColor = (context: any) => {
      const index = context.dataIndex;
      const chart = context.chart;
      const {ctx, chartArea} = chart;
      
      if (!chartArea) {
        // Fallback colors
        if (index === maxIndex) return `hsl(${chartColor2} / 0.8)`;
        if (index === minIndex && maxIndex !== minIndex) return `hsl(${destructiveColor} / 0.8)`;
        return `hsl(${chartColor1} / 0.8)`;
      }
      
      const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      
      if (index === maxIndex) {
        gradient.addColorStop(0, `hsl(${chartColor2} / 0.9)`);
        gradient.addColorStop(1, `hsl(${chartColor2} / 0.6)`);
      } else if (index === minIndex && maxIndex !== minIndex) {
        gradient.addColorStop(0, `hsl(${destructiveColor} / 0.9)`);
        gradient.addColorStop(1, `hsl(${destructiveColor} / 0.6)`);
      } else {
        gradient.addColorStop(0, `hsl(${chartColor1} / 0.7)`);
        gradient.addColorStop(1, `hsl(${chartColor1} / 0.4)`);
      }
      
      return gradient;
    };

    const borderColor = (context: any) => {
      const index = context.dataIndex;
      if (index === maxIndex) return `hsl(${chartColor2})`;
      if (index === minIndex && maxIndex !== minIndex) return `hsl(${destructiveColor})`;
      return `hsl(${chartColor1})`;
    };

    const hoverBackgroundColor = (context: any) => {
      const index = context.dataIndex;
      if (index === maxIndex) return `hsl(${chartColor2})`;
      if (index === minIndex && maxIndex !== minIndex) return `hsl(${destructiveColor})`;
      return `hsl(${chartColor1})`;
    };

    return {
      labels,
      datasets: [
        {
          label: 'Выручка',
          data: data.map(d => d.revenue),
          backgroundColor: backgroundColor,
          borderColor: borderColor,
          borderWidth: 2,
          borderRadius: 12,
          borderSkipped: false,
          hoverBackgroundColor: hoverBackgroundColor,
        },
      ],
    };
  }, [data]);

  const options: ChartOptions<'bar'> = {
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
            const dayData = data[dataIndex];
            
            const revenue = new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(dayData.revenue);

            const checks = new Intl.NumberFormat('ru-RU').format(dayData.checks);
            
            const avgCheck = new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(dayData.averageCheck);

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
        border: {
          display: false,
        },
        grid: {
          color: 'hsl(var(--border) / 0.3)',
          lineWidth: 1,
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.8)',
          font: {
            size: 13,
            weight: 'bold',
          },
          padding: 10,
          callback: function(value) {
            if (typeof value === 'number') {
              return new Intl.NumberFormat('ru-RU', {
                notation: 'compact',
                compactDisplay: 'short',
              }).format(value);
            }
            return value;
          },
        },
      },
      x: {
        border: {
          display: false,
        },
        grid: {
          display: false,
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.9)',
          font: {
            size: 13,
            weight: 'bold',
          },
          padding: 10,
        },
      },
    },
  };

  return (
    <Card className="relative p-6 shadow-lg border-border/50 overflow-hidden" data-testid="card-day-of-week-chart">
      {/* Enhanced gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent" />
      
      {/* Content */}
      <div className="relative z-10">
        <div className="mb-6">
          <h3 className="text-xl font-bold mb-2 bg-gradient-to-r from-foreground via-primary/80 to-foreground/70 bg-clip-text text-transparent">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-chart-2"></span>
              <span>Самый прибыльный</span>
            </span>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-destructive"></span>
              <span>Наименее прибыльный</span>
            </span>
          </p>
        </div>
        <div className="w-full">
          <Bar data={chartData} options={options} data-testid="chart-day-of-week" />
        </div>
      </div>
    </Card>
  );
}
