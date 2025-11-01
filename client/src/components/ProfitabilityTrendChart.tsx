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
import type { ProfitabilityDailyPoint } from '@shared/schema';
import { Card } from '@/components/ui/card';

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

interface ProfitabilityTrendChartProps {
  data: ProfitabilityDailyPoint[];
}

export function ProfitabilityTrendChart({ data }: ProfitabilityTrendChartProps) {
  const chartData = useMemo(() => {
    const labels = data.map((point) =>
      new Date(point.date).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'short',
      }),
    );

    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const primary = style?.getPropertyValue('--primary').trim() ?? '220 70% 50%';
    const destructive = style?.getPropertyValue('--destructive').trim() ?? '0 84% 60%';
    const chart3 = style?.getPropertyValue('--chart-3').trim() ?? '160 84% 40%';

    return {
      labels,
      datasets: [
        {
          label: 'Чистая выручка',
          data: data.map((point) => point.netRevenue),
          borderColor: `hsl(${primary})`,
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) {
              return `hsl(${primary} / 0.3)`;
            }
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, `hsl(${primary} / 0.35)`);
            gradient.addColorStop(1, `hsl(${primary} / 0.05)`);
            return gradient;
          },
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: 'Возвраты',
          data: data.map((point) => point.returns),
          borderColor: `hsl(${destructive})`,
          backgroundColor: `hsl(${destructive} / 0.2)`,
          borderDash: [6, 4],
          tension: 0.2,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
        {
          label: 'Коррекции',
          data: data.map((point) => point.corrections),
          borderColor: `hsl(${chart3})`,
          backgroundColor: `hsl(${chart3} / 0.2)`,
          borderDash: [4, 4],
          tension: 0.2,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    };
  }, [data]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
      tooltip: {
        backgroundColor: 'rgba(15, 15, 20, 0.9)',
        borderColor: 'hsl(var(--border))',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#fff',
        titleFont: {
          weight: 'bold',
          size: 14,
        },
        bodyFont: {
          size: 13,
        },
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            return `${context.dataset.label}: ${new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(value)}`;
          },
        },
      },
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
      },
      y: {
        grid: {
          color: 'hsl(var(--border) / 0.2)',
        },
        beginAtZero: true,
      },
    },
  };

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Динамика чистой выручки и возвратов</h3>
      <div className="h-[320px]">
        <Line data={chartData} options={options} />
      </div>
    </Card>
  );
}
