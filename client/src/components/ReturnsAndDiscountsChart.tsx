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
import type { ProfitabilityDailyPoint } from '@shared/schema';
import { Card } from '@/components/ui/card';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface ReturnsAndDiscountsChartProps {
  data: ProfitabilityDailyPoint[];
  totalDiscounts?: number;
}

export function ReturnsAndDiscountsChart({ data, totalDiscounts }: ReturnsAndDiscountsChartProps) {
  const chartData = useMemo(() => {
    const labels = data.map((point) =>
      new Date(point.date).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: 'short',
      }),
    );

    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const destructive = style?.getPropertyValue('--destructive').trim() ?? '0 84% 60%';
    const amber = style?.getPropertyValue('--amber').trim() ?? '38 92% 50%';

    // Распределяем общие скидки пропорционально выручке по дням
    const totalRevenue = data.reduce((sum, point) => sum + point.netRevenue, 0);
    const dailyDiscounts = totalDiscounts
      ? data.map((point) => (totalRevenue > 0 ? (point.netRevenue / totalRevenue) * totalDiscounts : 0))
      : [];

    return {
      labels,
      datasets: [
        {
          label: 'Возвраты',
          data: data.map((point) => point.returns),
          backgroundColor: `hsl(${destructive} / 0.7)`,
          borderColor: `hsl(${destructive})`,
          borderWidth: 1,
        },
        {
          label: 'Коррекции',
          data: data.map((point) => point.corrections),
          backgroundColor: `hsl(${amber} / 0.7)`,
          borderColor: `hsl(${amber})`,
          borderWidth: 1,
        },
        ...(totalDiscounts && totalDiscounts > 0
          ? [
              {
                label: 'Скидки (приблизительно)',
                data: dailyDiscounts,
                backgroundColor: `hsl(${amber} / 0.5)`,
                borderColor: `hsl(${amber})`,
                borderWidth: 1,
                borderDash: [4, 4],
              },
            ]
          : []),
      ],
    };
  }, [data, totalDiscounts]);

  const options: ChartOptions<'bar'> = {
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
      <h3 className="text-lg font-semibold mb-4">Возвраты и скидки по дням</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Показывает дни, когда маржа могла снизиться из-за возвратов и скидок
      </p>
      <div className="h-[280px]">
        <Bar data={chartData} options={options} />
      </div>
    </Card>
  );
}

