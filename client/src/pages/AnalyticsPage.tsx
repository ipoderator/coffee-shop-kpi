import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RevenueChart } from "@/components/RevenueChart";
import { DayOfWeekChart } from "@/components/DayOfWeekChart";
import { RevenueForecastCard } from "@/components/RevenueForecastCard";
import { CustomerClustersCard } from "@/components/CustomerClustersCard";
import { AnomaliesCard } from "@/components/AnomaliesCard";
import { TrendAnalysisCard } from "@/components/TrendAnalysisCard";
import { MonthlyReportCard } from "@/components/MonthlyReportCard";
import type { AnalyticsResponse } from "@shared/schema";
import { TrendingUp, TrendingDown, Calendar, Target, BarChart3, Users, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface AnalyticsPageProps {
  analytics: AnalyticsResponse;
}

export default function AnalyticsPage({ analytics }: AnalyticsPageProps) {
  const { kpi, daily, monthly, byDayOfWeek, forecast, advancedAnalytics } = analytics;

  // Расчет периода данных
  const startDate = daily.length > 0 ? new Date(daily[0].period) : new Date();
  const endDate = daily.length > 0 ? new Date(daily[daily.length - 1].period) : new Date();
  const dataRangeText = `${format(startDate, 'd MMMM yyyy', { locale: ru })} - ${format(endDate, 'd MMMM yyyy', { locale: ru })}`;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Заголовок страницы */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Аналитика</h1>
        <p className="text-muted-foreground">
          Детальный анализ показателей бизнеса и прогнозы
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>{dataRangeText}</span>
        </div>
      </div>

      {/* Основные метрики */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Общая выручка</CardDescription>
            <CardTitle className="text-2xl">
              {kpi.totalRevenue.toLocaleString('ru-RU')} ₽
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              {kpi.revenueGrowth !== undefined ? (
                kpi.revenueGrowth >= 0 ? (
                  <>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-green-500 font-medium">
                      +{kpi.revenueGrowth.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-red-500 font-medium">
                      {kpi.revenueGrowth.toFixed(1)}%
                    </span>
                  </>
                )
              ) : (
                <span className="text-muted-foreground font-medium">—</span>
              )}
              <span className="text-muted-foreground">к прошлому месяцу</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Средний чек</CardDescription>
            <CardTitle className="text-2xl">
              {kpi.averageCheck.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              {kpi.averageCheckGrowth !== undefined ? (
                kpi.averageCheckGrowth >= 0 ? (
                  <>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-green-500 font-medium">
                      +{kpi.averageCheckGrowth.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-red-500 font-medium">
                      {kpi.averageCheckGrowth.toFixed(1)}%
                    </span>
                  </>
                )
              ) : (
                <span className="text-muted-foreground font-medium">—</span>
              )}
              <span className="text-muted-foreground">к прошлому месяцу</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Количество чеков</CardDescription>
            <CardTitle className="text-2xl">
              {kpi.totalChecks.toLocaleString('ru-RU')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              {kpi.checksGrowth !== undefined ? (
                kpi.checksGrowth >= 0 ? (
                  <>
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-green-500 font-medium">
                      +{kpi.checksGrowth.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 text-red-500" />
                    <span className="text-red-500 font-medium">
                      {kpi.checksGrowth.toFixed(1)}%
                    </span>
                  </>
                )
              ) : (
                <span className="text-muted-foreground font-medium">—</span>
              )}
              <span className="text-muted-foreground">к прошлому месяцу</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Рост бизнеса</CardDescription>
            <CardTitle className="text-2xl flex items-center gap-2">
              {kpi.revenueGrowthYoY !== undefined ? (
                kpi.revenueGrowthYoY >= 0 ? (
                  <>
                    <TrendingUp className="w-6 h-6 text-green-500" />
                    <span className="text-green-500">
                      +{kpi.revenueGrowthYoY.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-6 h-6 text-red-500" />
                    <span className="text-red-500">
                      {kpi.revenueGrowthYoY.toFixed(1)}%
                    </span>
                  </>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="w-4 h-4" />
              <span>год к году (YoY)</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Прогноз выручки */}
      {forecast && (
        <div className="min-h-[400px]">
          <RevenueForecastCard forecast={forecast} />
        </div>
      )}

      {/* Графики */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* График динамики выручки */}
        <Card className="h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>Динамика выручки</CardTitle>
            <CardDescription>
              Изменение выручки по дням
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <RevenueChart data={daily} />
          </CardContent>
        </Card>

        {/* График по дням недели */}
        <Card className="h-[400px] flex flex-col">
          <CardHeader>
            <CardTitle>Выручка по дням недели</CardTitle>
            <CardDescription>
              Средняя выручка в разные дни недели
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <DayOfWeekChart data={byDayOfWeek} />
          </CardContent>
        </Card>
      </div>

      {/* Улучшенный месячный отчет */}
      {monthly && monthly.length > 0 && (
        <MonthlyReportCard monthlyData={monthly} />
      )}

      {/* Продвинутая аналитика */}
      {advancedAnalytics && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BarChart3 className="h-6 w-6" />
              Углубленный анализ
              <span className="ml-2 px-2 py-1 text-xs font-semibold bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full animate-pulse">
                BETA
              </span>
            </h2>
            <p className="text-muted-foreground">
              Продвинутая аналитика с использованием машинного обучения и внешних данных
              <br />
              <span className="text-orange-600 font-medium">⚠️ Функция в разработке - возможны неточности в расчетах</span>
            </p>
          </div>

          {/* Анализ трендов */}
          <div className="min-h-[400px]">
            <TrendAnalysisCard trendAnalysis={advancedAnalytics.trendAnalysis} />
          </div>

          {/* Аномалии */}
          <div className="min-h-[400px]">
            <AnomaliesCard anomalies={advancedAnalytics.anomalies} />
          </div>

          {/* Сегменты клиентов */}
          <div className="min-h-[400px]">
            <CustomerClustersCard clusters={advancedAnalytics.customerClusters} />
          </div>
        </div>
      )}
    </div>
  );
}

