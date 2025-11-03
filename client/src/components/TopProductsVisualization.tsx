import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
  Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, TrendingDown, Package, DollarSign, Percent, Award, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TopProduct } from '@shared/schema';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface TopProductsVisualizationProps {
  products: TopProduct[];
  viewType: 'top' | 'bottom';
}

const formatCurrency = (value: number) => {
  if (!Number.isFinite(value)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(1)}%`;
};

export function TopProductsVisualization({ products, viewType }: TopProductsVisualizationProps) {
  if (products.length === 0) {
    return null;
  }

  // Обрезаем названия продуктов для лучшей читаемости
  const getShortName = (name: string, maxLength = 30) => {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 3) + '...';
  };

  const labels = products.map((p) => getShortName(p.itemName));

  // Вычисляем статистику
  const stats = useMemo(() => {
    const margins = products.map((p) => p.averageMargin);
    const profits = products.map((p) => p.totalProfit);
    const sales = products.map((p) => p.salesCount);

    const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;
    const maxMargin = Math.max(...margins);
    const minMargin = Math.min(...margins);

    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const maxProfit = Math.max(...profits);
    const minProfit = Math.min(...profits);

    const totalSales = sales.reduce((a, b) => a + b, 0);
    const maxSales = Math.max(...sales);

    // Находим лучшие и худшие позиции
    const bestMarginIdx = margins.indexOf(maxMargin);
    const worstMarginIdx = margins.indexOf(minMargin);
    const bestProfitIdx = profits.indexOf(maxProfit);
    const worstProfitIdx = profits.indexOf(minProfit);

    return {
      avgMargin,
      maxMargin,
      minMargin,
      totalProfit,
      maxProfit,
      minProfit,
      totalSales,
      maxSales,
      bestMarginIdx,
      worstMarginIdx,
      bestProfitIdx,
      worstProfitIdx,
    };
  }, [products]);

  // Получаем цвета из CSS переменных
  const getChartColors = () => {
    if (typeof window === 'undefined') {
      return {
        primary: '220 70% 50%',
        chart1: '220 70% 50%',
        chart2: '160 84% 40%',
        chart3: '30 80% 50%',
        destructive: '0 84% 60%',
        success: '142 76% 36%',
        emerald: '142 76% 36%',
      };
    }
    const style = getComputedStyle(document.documentElement);
    return {
      primary: style.getPropertyValue('--primary').trim() || '220 70% 50%',
      chart1: style.getPropertyValue('--chart-1').trim() || '220 70% 50%',
      chart2: style.getPropertyValue('--chart-2').trim() || '160 84% 40%',
      chart3: style.getPropertyValue('--chart-3').trim() || '30 80% 50%',
      destructive: style.getPropertyValue('--destructive').trim() || '0 84% 60%',
      success: style.getPropertyValue('--emerald').trim() || '142 76% 36%',
      emerald: style.getPropertyValue('--emerald').trim() || '142 76% 36%',
    };
  };

  const colors = getChartColors();

  // График 1: Комбинированный - Маржа и Прибыль за единицу
  const combinedData = useMemo(() => {
    const isNegative = viewType === 'bottom';
    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const chartColor1 = style?.getPropertyValue('--chart-1').trim() || colors.chart1;
    const chartColor2 = style?.getPropertyValue('--chart-2').trim() || colors.chart2;
    
    return {
      labels,
      datasets: [
        {
          type: 'bar' as const,
          label: 'Маржа (%)',
          data: products.map((p) => p.averageMargin),
          backgroundColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].averageMargin;
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              if (value < 0) return `hsl(${colors.destructive} / 0.6)`;
              if (isNegative) return `hsl(${colors.destructive} / 0.4)`;
              if (idx === stats.bestMarginIdx) return `hsl(${colors.success} / 0.7)`;
              return `hsl(${chartColor1} / 0.6)`;
            }

            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            
            if (value < 0) {
              gradient.addColorStop(0, `hsl(${colors.destructive} / 0.9)`);
              gradient.addColorStop(1, `hsl(${colors.destructive} / 0.6)`);
            } else if (isNegative) {
              gradient.addColorStop(0, `hsl(${colors.destructive} / 0.7)`);
              gradient.addColorStop(1, `hsl(${colors.destructive} / 0.4)`);
            } else if (idx === stats.bestMarginIdx) {
              gradient.addColorStop(0, `hsl(${colors.success} / 0.9)`);
              gradient.addColorStop(1, `hsl(${colors.success} / 0.6)`);
            } else {
              gradient.addColorStop(0, `hsl(${chartColor1} / 0.7)`);
              gradient.addColorStop(1, `hsl(${chartColor1} / 0.4)`);
            }

            return gradient;
          },
          borderColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].averageMargin;
            if (value < 0) return `hsl(${colors.destructive})`;
            if (isNegative) return `hsl(${colors.destructive})`;
            if (idx === stats.bestMarginIdx) return `hsl(${colors.success})`;
            return `hsl(${chartColor1})`;
          },
          borderWidth: 2,
          borderRadius: 12,
          borderSkipped: false,
          yAxisID: 'y',
        },
        {
          type: 'line' as const,
          label: 'Прибыль за ед. (₽)',
          data: products.map((p) => p.averageProfit),
          borderColor: `hsl(${chartColor2})`,
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return `hsl(${chartColor2} / 0.1)`;
            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            gradient.addColorStop(0, `hsl(${chartColor2} / 0.15)`);
            gradient.addColorStop(1, `hsl(${chartColor2} / 0.05)`);
            return gradient;
          },
          borderWidth: 3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: `hsl(${chartColor2})`,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          fill: true,
          tension: 0.35,
          yAxisID: 'y1',
        },
      ],
    };
  }, [products, labels, viewType, colors, stats]);

  // График 2: Количество продаж
  const salesCountData = useMemo(() => {
    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const chartColor1 = style?.getPropertyValue('--chart-1').trim() || colors.chart1;
    const chartColor2 = style?.getPropertyValue('--chart-2').trim() || colors.chart2;
    const chartColor3 = style?.getPropertyValue('--chart-3').trim() || colors.chart3;
    
    return {
      labels,
      datasets: [
        {
          label: 'Количество продаж',
          data: products.map((p) => p.salesCount),
          backgroundColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].salesCount;
            const ratio = value / stats.maxSales;
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              if (ratio > 0.8) return `hsl(${chartColor2} / 0.8)`;
              if (ratio > 0.5) return `hsl(${chartColor1} / 0.7)`;
              return `hsl(${chartColor3} / 0.6)`;
            }

            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            
            if (ratio > 0.8) {
              gradient.addColorStop(0, `hsl(${chartColor2} / 0.9)`);
              gradient.addColorStop(1, `hsl(${chartColor2} / 0.6)`);
            } else if (ratio > 0.5) {
              gradient.addColorStop(0, `hsl(${chartColor1} / 0.7)`);
              gradient.addColorStop(1, `hsl(${chartColor1} / 0.4)`);
            } else {
              gradient.addColorStop(0, `hsl(${chartColor3} / 0.65)`);
              gradient.addColorStop(1, `hsl(${chartColor3} / 0.35)`);
            }

            return gradient;
          },
          borderColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].salesCount;
            const ratio = value / stats.maxSales;
            if (ratio > 0.8) return `hsl(${chartColor2})`;
            if (ratio > 0.5) return `hsl(${chartColor1})`;
            return `hsl(${chartColor3})`;
          },
          borderWidth: 2,
          borderRadius: 12,
          borderSkipped: false,
        },
      ],
    };
  }, [products, labels, colors, stats]);

  // График 3: Совокупная прибыль
  const totalProfitData = useMemo(() => {
    const isNegative = viewType === 'bottom';
    const style = typeof window !== 'undefined' ? getComputedStyle(document.documentElement) : null;
    const emeraldColor = style?.getPropertyValue('--emerald').trim() || colors.emerald;
    
    return {
      labels,
      datasets: [
        {
          label: 'Совокупная прибыль',
          data: products.map((p) => p.totalProfit),
          backgroundColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].totalProfit;
            const chart = context.chart;
            const { ctx, chartArea } = chart;

            if (!chartArea) {
              if (value < 0) return `hsl(${colors.destructive} / 0.7)`;
              if (isNegative) return `hsl(${colors.destructive} / 0.5)`;
              if (idx === stats.bestProfitIdx) return `hsl(${colors.success} / 0.8)`;
              return `hsl(${emeraldColor} / 0.7)`;
            }

            const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
            
            if (value < 0) {
              gradient.addColorStop(0, `hsl(${colors.destructive} / 0.9)`);
              gradient.addColorStop(1, `hsl(${colors.destructive} / 0.6)`);
            } else if (isNegative) {
              gradient.addColorStop(0, `hsl(${colors.destructive} / 0.7)`);
              gradient.addColorStop(1, `hsl(${colors.destructive} / 0.4)`);
            } else if (idx === stats.bestProfitIdx) {
              gradient.addColorStop(0, `hsl(${colors.success} / 0.9)`);
              gradient.addColorStop(1, `hsl(${colors.success} / 0.6)`);
            } else {
              gradient.addColorStop(0, `hsl(${emeraldColor} / 0.75)`);
              gradient.addColorStop(1, `hsl(${emeraldColor} / 0.4)`);
            }

            return gradient;
          },
          borderColor: (context: any) => {
            const idx = context.dataIndex;
            const value = products[idx].totalProfit;
            if (value < 0) return `hsl(${colors.destructive})`;
            if (isNegative) return `hsl(${colors.destructive})`;
            if (idx === stats.bestProfitIdx) return `hsl(${colors.success})`;
            return `hsl(${emeraldColor})`;
          },
          borderWidth: 2,
          borderRadius: 12,
          borderSkipped: false,
        },
      ],
    };
  }, [products, labels, viewType, colors, stats]);

  // Опции для графиков в стиле других компонентов
  const commonOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: 13,
            weight: 'bold',
          },
          filter: (item) => item.text !== '',
        },
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
          title: (context) => {
            const index = context[0].dataIndex;
            return products[index].itemName;
          },
          label: (context) => {
            const index = context.dataIndex;
            const product = products[index];
            const datasetLabel = context.dataset.label || '';

            if (datasetLabel.includes('Маржа')) {
              return [
                `Маржа: ${formatPercent(product.averageMargin / 100)}`,
                `Цена: ${formatCurrency(product.averagePrice)}`,
                `Себестоимость: ${formatCurrency(product.unitCost)}`,
              ];
            }
            if (datasetLabel.includes('Прибыль за ед')) {
              return [
                `Прибыль за ед.: ${formatCurrency(product.averageProfit)}`,
                `Продано: ${product.salesCount} шт.`,
                `Всего прибыль: ${formatCurrency(product.totalProfit)}`,
              ];
            }
            if (datasetLabel.includes('Количество продаж')) {
              return [
                `Продано: ${product.salesCount} шт.`,
                `Маржа: ${formatPercent(product.averageMargin / 100)}`,
                `Прибыль: ${formatCurrency(product.totalProfit)}`,
              ];
            }
            if (datasetLabel.includes('Совокупная прибыль')) {
              return [
                `Прибыль: ${formatCurrency(product.totalProfit)}`,
                `Продано: ${product.salesCount} шт.`,
                `Прибыль за ед.: ${formatCurrency(product.averageProfit)}`,
                `Маржа: ${formatPercent(product.averageMargin / 100)}`,
              ];
            }
            return '';
          },
        },
      },
    },
    scales: {
      x: {
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
          callback: function (value) {
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
      y1: {
        type: 'linear' as const,
        display: true,
        position: 'right' as const,
        beginAtZero: true,
        border: {
          display: false,
        },
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: 'hsl(var(--foreground) / 0.8)',
          font: {
            size: 13,
            weight: 'bold',
          },
          padding: 10,
          callback: function (value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return value;
          },
        },
      },
    },
  };

  const combinedOptions: ChartOptions<'bar'> = {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales?.y,
        ticks: {
          ...commonOptions.scales?.y?.ticks,
          callback: function (value) {
            if (typeof value === 'number') {
              return formatPercent(value / 100);
            }
            return value;
          },
        },
      },
    },
  };

  const salesOptions: ChartOptions<'bar'> = {
    ...commonOptions,
  };

  const profitOptions: ChartOptions<'bar'> = {
    ...commonOptions,
    scales: {
      ...commonOptions.scales,
      y: {
        ...commonOptions.scales?.y,
        ticks: {
          ...commonOptions.scales?.y?.ticks,
          callback: function (value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return value;
          },
        },
      },
    },
  };

  return (
    <div className="space-y-6">
      {/* Статистические карточки */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-40" />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Средняя маржа</p>
              <p className="text-2xl font-bold text-primary">{formatPercent(stats.avgMargin / 100)}</p>
            </div>
            <Percent className="w-5 h-5 text-primary/60" />
          </div>
        </Card>
        <Card className="relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent opacity-40" />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Общая прибыль</p>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(stats.totalProfit)}</p>
            </div>
            <DollarSign className="w-5 h-5 text-emerald-600/60" />
          </div>
        </Card>
        <Card className="relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-chart-2/5 via-transparent to-transparent opacity-40" />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Всего продаж</p>
              <p className="text-2xl font-bold text-chart-2">{stats.totalSales.toLocaleString()}</p>
            </div>
            <Package className="w-5 h-5 text-chart-2/60" />
          </div>
        </Card>
        <Card className={`relative p-6 hover-elevate border-border/50 shadow-sm overflow-hidden ${viewType === 'bottom' ? 'border-destructive/20' : 'border-success/20'}`}>
          <div className={`absolute inset-0 bg-gradient-to-br ${viewType === 'bottom' ? 'from-destructive/5' : 'from-success/5'} via-transparent to-transparent opacity-40`} />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {viewType === 'bottom' ? 'Худшая маржа' : 'Лучшая маржа'}
              </p>
              <p className={`text-2xl font-bold ${viewType === 'bottom' ? 'text-destructive' : 'text-success'}`}>
                {formatPercent((viewType === 'bottom' ? stats.minMargin : stats.maxMargin) / 100)}
              </p>
            </div>
            {viewType === 'bottom' ? (
              <TrendingDown className="w-5 h-5 text-destructive/60" />
            ) : (
              <TrendingUp className="w-5 h-5 text-success/60" />
            )}
          </div>
        </Card>
      </div>

      {/* Графики */}
      <Tabs defaultValue="combined" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="combined" className="flex items-center gap-2 text-sm">
            <Percent className="w-4 h-4" />
            <span className="hidden sm:inline">Маржа и прибыль</span>
            <span className="sm:hidden">Маржа</span>
          </TabsTrigger>
          <TabsTrigger value="sales" className="flex items-center gap-2 text-sm">
            <Package className="w-4 h-4" />
            <span>Продажи</span>
          </TabsTrigger>
          <TabsTrigger value="profit" className="flex items-center gap-2 text-sm">
            <DollarSign className="w-4 h-4" />
            <span>Прибыль</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="combined" className="space-y-0 mt-6">
          <Card className="relative p-6 border-border/50 shadow-sm overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
            <div className="relative z-10 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Percent className="w-5 h-5 text-primary" />
                  <h4 className="text-xl font-bold bg-gradient-to-r from-foreground via-primary/80 to-foreground/70 bg-clip-text text-transparent">
                    Маржа и прибыль за единицу
                  </h4>
                </div>
                {stats.bestMarginIdx >= 0 && (
                  <Badge variant="secondary" className="gap-1.5">
                    <Award className="w-3 h-3" />
                    Лучшая: {getShortName(products[stats.bestMarginIdx].itemName, 15)}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-chart-1"></span>
                  <span>Маржа (%)</span>
                </span>
                <span className="text-border">•</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-chart-2"></span>
                  <span>Прибыль за ед. (₽)</span>
                </span>
              </p>
            </div>
            <div className="relative z-10 w-full">
              <Bar data={combinedData} options={combinedOptions} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="sales" className="space-y-0 mt-6">
          <Card className="relative p-6 border-border/50 shadow-sm overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-chart-2/5 via-transparent to-transparent pointer-events-none" />
            <div className="relative z-10 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-chart-2" />
                  <h4 className="text-xl font-bold bg-gradient-to-r from-foreground via-chart-2/80 to-foreground/70 bg-clip-text text-transparent">
                    Популярность позиций
                  </h4>
                </div>
                <Badge variant="secondary" className="gap-1.5">
                  Всего: {stats.totalSales.toLocaleString()} шт.
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Количество продаж за период
              </p>
            </div>
            <div className="relative z-10 w-full">
              <Bar data={salesCountData} options={salesOptions} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="profit" className="space-y-0 mt-6">
          <Card className="relative p-6 border-border/50 shadow-sm overflow-hidden">
            <div className={`absolute inset-0 bg-gradient-to-br ${viewType === 'bottom' ? 'from-destructive/5' : 'from-emerald-500/5'} via-transparent to-transparent pointer-events-none`} />
            <div className="relative z-10 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <DollarSign className={`w-5 h-5 ${viewType === 'bottom' ? 'text-destructive' : 'text-emerald-600'}`} />
                  <h4 className="text-xl font-bold bg-gradient-to-r from-foreground via-emerald-600/80 to-foreground/70 bg-clip-text text-transparent">
                    Совокупная прибыль
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  {stats.bestProfitIdx >= 0 && (
                    <Badge variant="secondary" className="gap-1.5">
                      <Award className="w-3 h-3" />
                      Лучшая
                    </Badge>
                  )}
                  {products.some((p) => p.totalProfit < 0) && (
                    <Badge variant="destructive" className="gap-1.5">
                      <AlertCircle className="w-3 h-3" />
                      Убытки
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Общая прибыль по позициям
              </p>
            </div>
            <div className="relative z-10 w-full">
              <Bar data={totalProfitData} options={profitOptions} />
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
