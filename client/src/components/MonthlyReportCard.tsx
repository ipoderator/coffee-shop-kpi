import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Calendar, TrendingUp, TrendingDown, BarChart3, Target, Users, CreditCard, Clock } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import type { PeriodData } from "@shared/schema";

interface MonthlyReportCardProps {
  monthlyData: PeriodData[];
}

export function MonthlyReportCard({ monthlyData }: MonthlyReportCardProps) {
  if (!monthlyData || monthlyData.length === 0) {
    return null;
  }

  // Сортируем данные по периоду (новые сначала)
  const sortedData = [...monthlyData].reverse();
  const recentMonths = sortedData.slice(0, 12); // Последние 12 месяцев
  
  // Находим лучший и худший месяцы
  const bestMonth = recentMonths.reduce((best, current) => 
    current.revenue > best.revenue ? current : best
  );
  const worstMonth = recentMonths.reduce((worst, current) => 
    current.revenue < worst.revenue ? current : worst
  );

  // Рассчитываем средние показатели
  const avgRevenue = recentMonths.reduce((sum, month) => sum + month.revenue, 0) / recentMonths.length;
  const avgChecks = recentMonths.reduce((sum, month) => sum + month.checks, 0) / recentMonths.length;
  const avgCheckAmount = recentMonths.reduce((sum, month) => sum + month.averageCheck, 0) / recentMonths.length;

  // Рассчитываем тренд (рост/падение за последние 3 месяца)
  const last3Months = recentMonths.slice(0, 3);
  const first3Months = recentMonths.slice(-3);
  const recentAvgRevenue = last3Months.reduce((sum, month) => sum + month.revenue, 0) / 3;
  const olderAvgRevenue = first3Months.reduce((sum, month) => sum + month.revenue, 0) / 3;
  const trendPercentage = olderAvgRevenue > 0 ? ((recentAvgRevenue - olderAvgRevenue) / olderAvgRevenue) * 100 : 0;

  // Рассчитываем волатильность (стандартное отклонение)
  const variance = recentMonths.reduce((sum, month) => sum + Math.pow(month.revenue - avgRevenue, 2), 0) / recentMonths.length;
  const volatility = Math.sqrt(variance);
  const volatilityPercentage = avgRevenue > 0 ? (volatility / avgRevenue) * 100 : 0;

  const getVolatilityLevel = (volatility: number) => {
    if (volatility < 10) return { level: 'Низкая', color: 'text-green-600', bgColor: 'bg-green-50' };
    if (volatility < 20) return { level: 'Умеренная', color: 'text-yellow-600', bgColor: 'bg-yellow-50' };
    return { level: 'Высокая', color: 'text-red-600', bgColor: 'bg-red-50' };
  };

  const volatilityInfo = getVolatilityLevel(volatilityPercentage);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Детальная месячная статистика
        </CardTitle>
        <CardDescription>
          Анализ выручки, чеков и трендов по месяцам за последний год
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Ключевые метрики */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-medium text-muted-foreground">Средняя выручка</span>
            </div>
            <p className="text-xl font-bold">{avgRevenue.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-muted-foreground">Среднее чеков</span>
            </div>
            <p className="text-xl font-bold">{avgChecks.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-muted-foreground">Средний чек</span>
            </div>
            <p className="text-xl font-bold">{avgCheckAmount.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {trendPercentage >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
              <span className="text-sm font-medium text-muted-foreground">Тренд (3м)</span>
            </div>
            <p className={`text-xl font-bold ${trendPercentage >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trendPercentage >= 0 ? '+' : ''}{trendPercentage.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Индикаторы производительности */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Волатильность выручки</span>
              <Badge className={`${volatilityInfo.bgColor} ${volatilityInfo.color} border-0`}>
                {volatilityInfo.level}
              </Badge>
            </div>
            <Progress 
              value={Math.min(volatilityPercentage, 50)} 
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              Отклонение: {volatilityPercentage.toFixed(1)}% от среднего
            </p>
          </div>
          
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Стабильность бизнеса</span>
              <Badge variant={volatilityPercentage < 15 ? 'default' : volatilityPercentage < 25 ? 'secondary' : 'destructive'}>
                {volatilityPercentage < 15 ? 'Стабильный' : volatilityPercentage < 25 ? 'Умеренный' : 'Нестабильный'}
              </Badge>
            </div>
            <Progress 
              value={Math.max(0, 100 - volatilityPercentage)} 
              className="h-2"
            />
            <p className="text-xs text-muted-foreground">
              Чем выше, тем стабильнее бизнес
            </p>
          </div>
        </div>

        {/* Лучший и худший месяцы */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-600" />
              <span className="font-medium text-green-800">Лучший месяц</span>
            </div>
            <p className="text-lg font-bold text-green-900">
              {format(parseISO(bestMonth.period), 'LLLL yyyy', { locale: ru })}
            </p>
            <p className="text-sm text-green-700">
              {bestMonth.revenue.toLocaleString('ru-RU')} ₽ • {bestMonth.checks} чеков
            </p>
          </div>
          
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-600" />
              <span className="font-medium text-red-800">Худший месяц</span>
            </div>
            <p className="text-lg font-bold text-red-900">
              {format(parseISO(worstMonth.period), 'LLLL yyyy', { locale: ru })}
            </p>
            <p className="text-sm text-red-700">
              {worstMonth.revenue.toLocaleString('ru-RU')} ₽ • {worstMonth.checks} чеков
            </p>
          </div>
        </div>

        {/* Детальная таблица месяцев */}
        <div className="space-y-3">
          <h4 className="font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4" />
            История по месяцам
          </h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentMonths.map((month, index) => {
              const monthDate = parseISO(month.period);
              const isRecent = index < 3;
              const isBest = month.revenue === bestMonth.revenue;
              const isWorst = month.revenue === worstMonth.revenue;
              
              return (
                <div 
                  key={month.period}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isRecent ? 'bg-primary/5 border-primary/20' : 'bg-muted/30'
                  } ${isBest ? 'ring-2 ring-green-200' : ''} ${isWorst ? 'ring-2 ring-red-200' : ''}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        {format(monthDate, 'LLLL yyyy', { locale: ru })}
                      </p>
                      {isRecent && (
                        <Badge variant="secondary" className="text-xs">Недавний</Badge>
                      )}
                      {isBest && (
                        <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Лучший</Badge>
                      )}
                      {isWorst && (
                        <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">Худший</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {month.checks} чеков • средний чек {month.averageCheck.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">
                      {month.revenue.toLocaleString('ru-RU')} ₽
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {((month.revenue / avgRevenue) * 100).toFixed(0)}% от среднего
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
