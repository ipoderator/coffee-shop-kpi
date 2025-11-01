import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  Upload,
  Wallet,
  FileText,
  Calendar,
} from 'lucide-react';
import { FileUpload } from '@/components/FileUpload';
import { KPICard } from '@/components/KPICard';
import { PeriodTabs, PeriodType } from '@/components/PeriodTabs';
import { RevenueChart } from '@/components/RevenueChart';
import { DayOfWeekChart } from '@/components/DayOfWeekChart';
import { DataTable } from '@/components/DataTable';
import { RevenueForecastCard } from '@/components/RevenueForecastCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import type { AnalyticsResponse, FileUploadResponse } from '@shared/schema';

export default function Dashboard() {
  const { toast } = useToast();
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodType>('month');

  const { data: analytics, isLoading } = useQuery<AnalyticsResponse>({
    queryKey: ['/api/analytics', uploadId],
    enabled: !!uploadId,
  });

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Ошибка загрузки файла');
      }

      const response: FileUploadResponse = await res.json();

      if (response.success) {
        setUploadId(response.uploadId);
        // Invalidate specific upload analytics query
        queryClient.invalidateQueries({ queryKey: ['/api/analytics', response.uploadId] });

        toast({
          title: 'Файл успешно загружен',
          description: `Обработано ${response.rowsProcessed} записей`,
        });
      }
    } catch (error) {
      toast({
        title: 'Ошибка загрузки',
        description: error instanceof Error ? error.message : 'Не удалось загрузить файл',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewUpload = () => {
    setUploadId(null);
  };

  const getPeriodData = () => {
    if (!analytics) return [];

    switch (selectedPeriod) {
      case 'day':
        return analytics.daily || [];
      case 'month':
        return analytics.monthly || [];
      case 'year':
        return analytics.yearly || [];
      default:
        return [];
    }
  };

  const getPeriodTitle = () => {
    switch (selectedPeriod) {
      case 'day':
        return 'Выручка по дням';
      case 'month':
        return 'Выручка по месяцам';
      case 'year':
        return 'Выручка по годам';
      default:
        return 'Выручка';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 shadow-sm">
        <div className="container mx-auto px-4 md:px-8 lg:px-12">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-primary to-primary/80 rounded-xl shadow-lg shadow-primary/20">
                <BarChart3 className="w-6 h-6 text-primary-foreground" />
              </div>
              <h1
                className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent"
                data-testid="text-title"
              >
                Coffee KPI Dashboard
              </h1>
            </div>

            {uploadId && (
              <Button
                onClick={handleNewUpload}
                variant="outline"
                className="gap-2 shadow-sm"
                data-testid="button-new-upload"
              >
                <Upload className="w-4 h-4" />
                Загрузить новый файл
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 md:px-8 lg:px-12 py-8">
        {!uploadId ? (
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-bold bg-gradient-to-r from-foreground via-foreground to-foreground/60 bg-clip-text text-transparent">
                Анализ показателей кофейни
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Загрузите Excel, CSV или PDF файл с данными о продажах для получения детальной
                аналитики с KPI метриками, графиками и сравнением периодов
              </p>
            </div>
            <FileUpload onFileSelect={handleFileSelect} isProcessing={isUploading} />
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
                <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0" />
              </div>
              <p className="text-muted-foreground font-medium">Анализируем данные...</p>
            </div>
          </div>
        ) : analytics ? (
          <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="h-[180px]">
                <KPICard
                  title="Выручка (всего)"
                  value={analytics.kpi.totalRevenue}
                  icon={<DollarSign className="w-5 h-5" />}
                  growth={analytics.kpi.revenueGrowth}
                  format="currency"
                  testId="card-revenue"
                  description="Общая сумма выручки за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
                />
              </div>
              <div className="h-[180px]">
                <KPICard
                  title="Средний чек"
                  value={analytics.kpi.averageCheck}
                  icon={<Wallet className="w-5 h-5" />}
                  growth={analytics.kpi.averageCheckGrowth}
                  format="currency"
                  testId="card-average-check"
                  description="Средняя сумма одного чека (Общая выручка ÷ Количество чеков). Процент роста — изменение по сравнению с предыдущим месяцем."
                />
              </div>
              <div className="h-[180px]">
                <KPICard
                  title="Всего чеков"
                  value={analytics.kpi.totalChecks}
                  icon={<FileText className="w-5 h-5" />}
                  growth={analytics.kpi.checksGrowth}
                  format="number"
                  testId="card-total-checks"
                  description="Общее количество чеков за весь период. Процент роста — изменение по сравнению с предыдущим месяцем."
                />
              </div>
              <div className="h-[180px]">
                <KPICard
                  title="Рост выручки (по дням)"
                  value={
                    analytics.kpi.revenueGrowthDoD !== undefined
                      ? `${analytics.kpi.revenueGrowthDoD.toFixed(1)}%`
                      : '—'
                  }
                  icon={<TrendingUp className="w-5 h-5" />}
                  format="number"
                  testId="card-growth-dod"
                  description="Изменение выручки последнего дня по сравнению с предпоследним днём. Показывает краткосрочную динамику."
                />
              </div>
              <div className="h-[180px]">
                <KPICard
                  title="Чеков за месяц"
                  value={analytics.kpi.currentMonthTotalChecks || 0}
                  icon={<Calendar className="w-5 h-5" />}
                  format="number"
                  testId="card-month-checks"
                  description="Количество чеков в текущем месяце (последний месяц в загруженных данных)."
                />
              </div>
              <div className="h-[180px]">
                <KPICard
                  title="Среднее чеков/день (месяц)"
                  value={
                    analytics.kpi.currentMonthAvgChecksPerDay !== undefined
                      ? analytics.kpi.currentMonthAvgChecksPerDay.toFixed(1)
                      : '—'
                  }
                  icon={<BarChart3 className="w-5 h-5" />}
                  format="number"
                  testId="card-avg-checks-per-day"
                  description="Среднее количество чеков в день за текущий месяц (Чеков за месяц ÷ Количество дней с продажами)."
                />
              </div>
            </div>

            {/* Chart Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Динамика выручки
                </h2>
                <PeriodTabs selected={selectedPeriod} onChange={setSelectedPeriod} />
              </div>

              <RevenueChart
                data={getPeriodData()}
                title={getPeriodTitle()}
                periodType={selectedPeriod}
              />
            </div>

            {/* Day of Week Analysis */}
            {analytics.byDayOfWeek && analytics.byDayOfWeek.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Анализ по дням недели
                </h2>
                <DayOfWeekChart data={analytics.byDayOfWeek} title="Выручка по дням недели" />
              </div>
            )}

            {/* Revenue Forecast */}
            {analytics.forecast && (
              <div className="space-y-4">
                <RevenueForecastCard forecast={analytics.forecast} />
              </div>
            )}

            {/* Data Table */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Детализация транзакций
              </h2>
              <DataTable transactions={analytics.transactions} />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
