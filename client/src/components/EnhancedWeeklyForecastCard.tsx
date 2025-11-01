import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  BarChart3,
  Target,
  Cloud,
  Sun,
  CloudRain,
  Snowflake,
  Wind,
  Gift,
  Clock,
  CalendarDays,
  Brain,
  Activity,
  Zap,
  Eye,
  AlertTriangle,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react';
import { RevenueForecast } from '@shared/schema';
import { Line } from 'react-chartjs-2';
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

interface EnhancedWeeklyForecastCardProps {
  forecast: RevenueForecast;
}

export function EnhancedWeeklyForecastCard({ forecast }: EnhancedWeeklyForecastCardProps) {
  const { nextMonth, methodology } = forecast;
  const [activeTab, setActiveTab] = useState<'forecast' | 'analytics' | 'insights'>('forecast');
  const [selectedWeek, setSelectedWeek] = useState(0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Группируем прогноз по неделям
  const weeklyForecasts = useMemo(() => {
    const weeks = [];
    for (let i = 0; i < nextMonth.dailyForecast.length; i += 7) {
      const week = nextMonth.dailyForecast.slice(i, i + 7);
      const weekRevenue = week.reduce((sum, day) => sum + day.predictedRevenue, 0);
      const avgConfidence = week.reduce((sum, day) => sum + day.confidence, 0) / week.length;

      // Анализ трендов внутри недели
      const dailyRevenues = week.map((day) => day.predictedRevenue);
      const trend =
        dailyRevenues.length > 1
          ? (dailyRevenues[dailyRevenues.length - 1] - dailyRevenues[0]) / dailyRevenues[0]
          : 0;

      // Анализ волатильности
      const variance =
        dailyRevenues.reduce((sum, rev) => {
          return sum + Math.pow(rev - weekRevenue / 7, 2);
        }, 0) / dailyRevenues.length;
      const volatility = Math.sqrt(variance) / (weekRevenue / 7);

      // Анализ факторов влияния
      const weatherImpact = week.reduce((sum, day) => sum + (day.weatherImpact || 0), 0) / 7;
      const holidayImpact = week.reduce((sum, day) => sum + (day.holidayImpact || 0), 0) / 7;

      weeks.push({
        week: Math.floor(i / 7) + 1,
        revenue: weekRevenue,
        confidence: avgConfidence,
        days: week,
        trend,
        volatility,
        weatherImpact,
        holidayImpact,
        startDate: week[0]?.date,
        endDate: week[week.length - 1]?.date,
      });
    }
    return weeks;
  }, [nextMonth.dailyForecast]);

  // Глубокий анализ данных с ML инсайтами
  const deepAnalytics = useMemo(() => {
    const allDays = nextMonth.dailyForecast;

    // Анализ сезонности по дням недели
    const dayOfWeekAnalysis = [0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
      const dayData = allDays.filter((day) => new Date(day.date).getDay() === dayIndex);
      const avgRevenue =
        dayData.reduce((sum, day) => sum + day.predictedRevenue, 0) / dayData.length;
      const avgConfidence = dayData.reduce((sum, day) => sum + day.confidence, 0) / dayData.length;

      return {
        dayIndex,
        dayName: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dayIndex],
        avgRevenue,
        avgConfidence,
        count: dayData.length,
      };
    });

    // Анализ корреляций с ML факторами
    const correlations = {
      weatherRevenue:
        allDays.reduce((sum, day) => {
          return sum + (day.weatherImpact || 0) * day.predictedRevenue;
        }, 0) / allDays.length,
      holidayRevenue:
        allDays.reduce((sum, day) => {
          return sum + (day.holidayImpact || 0) * day.predictedRevenue;
        }, 0) / allDays.length,
      seasonalRevenue:
        allDays.reduce((sum, day) => {
          return sum + (day.factors?.seasonality || 1) * day.predictedRevenue;
        }, 0) / allDays.length,
      trendRevenue:
        allDays.reduce((sum, day) => {
          return sum + (day.factors?.trend || 0) * day.predictedRevenue;
        }, 0) / allDays.length,
    };

    // Анализ трендов с ML
    const revenueTrend = allDays.map((day) => day.predictedRevenue);
    const trendSlope =
      revenueTrend.length > 1
        ? (revenueTrend[revenueTrend.length - 1] - revenueTrend[0]) / revenueTrend.length
        : 0;

    // Анализ волатильности
    const avgRevenue = revenueTrend.reduce((sum, rev) => sum + rev, 0) / revenueTrend.length;
    const variance =
      revenueTrend.reduce((sum, rev) => sum + Math.pow(rev - avgRevenue, 2), 0) /
      revenueTrend.length;
    const volatility = Math.sqrt(variance) / avgRevenue;

    // Анализ качества ML моделей
    const mlModelQuality = {
      arima:
        allDays.reduce((sum, day) => sum + (day.factors?.historicalPattern || 0), 0) /
        allDays.length,
      prophet:
        allDays.reduce((sum, day) => sum + (day.factors?.seasonality || 1), 0) / allDays.length,
      lstm: allDays.reduce((sum, day) => sum + (day.factors?.trend || 0), 0) / allDays.length,
    };

    return {
      dayOfWeekAnalysis,
      correlations,
      trendSlope,
      volatility,
      avgRevenue,
      totalDays: allDays.length,
      mlModelQuality,
    };
  }, [nextMonth.dailyForecast]);

  // Генерация инсайтов
  const insights = useMemo(() => {
    const insightsList = [];

    // Инсайт по дням недели
    const bestDay = deepAnalytics.dayOfWeekAnalysis.reduce((best, day) =>
      day.avgRevenue > best.avgRevenue ? day : best,
    );
    const worstDay = deepAnalytics.dayOfWeekAnalysis.reduce((worst, day) =>
      day.avgRevenue < worst.avgRevenue ? day : worst,
    );

    insightsList.push({
      type: 'performance',
      icon: <Target className="h-4 w-4" />,
      title: 'Лучший день недели',
      description: `${bestDay.dayName} показывает среднюю выручку ${formatCurrency(bestDay.avgRevenue)}`,
      impact: 'positive',
      recommendation: `Сосредоточьтесь на максимизации продаж в ${bestDay.dayName}`,
    });

    // Инсайт по трендам
    if (deepAnalytics.trendSlope > 0.05) {
      insightsList.push({
        type: 'trend',
        icon: <TrendingUp className="h-4 w-4" />,
        title: 'Положительный тренд',
        description: `Выручка растет на ${(deepAnalytics.trendSlope * 100).toFixed(1)}% в день`,
        impact: 'positive',
        recommendation: 'Поддерживайте текущую стратегию развития',
      });
    } else if (deepAnalytics.trendSlope < -0.05) {
      insightsList.push({
        type: 'trend',
        icon: <TrendingDown className="h-4 w-4" />,
        title: 'Отрицательный тренд',
        description: `Выручка снижается на ${Math.abs(deepAnalytics.trendSlope * 100).toFixed(1)}% в день`,
        impact: 'negative',
        recommendation: 'Требуется корректировка стратегии',
      });
    }

    // Инсайт по волатильности
    if (deepAnalytics.volatility > 0.2) {
      insightsList.push({
        type: 'volatility',
        icon: <AlertTriangle className="h-4 w-4" />,
        title: 'Высокая волатильность',
        description: `Колебания выручки составляют ${(deepAnalytics.volatility * 100).toFixed(1)}%`,
        impact: 'warning',
        recommendation: 'Рассмотрите стабилизацию продаж',
      });
    } else {
      insightsList.push({
        type: 'stability',
        icon: <CheckCircle className="h-4 w-4" />,
        title: 'Стабильные продажи',
        description: `Низкая волатильность: ${(deepAnalytics.volatility * 100).toFixed(1)}%`,
        impact: 'positive',
        recommendation: 'Отличная стабильность бизнеса',
      });
    }

    // Инсайт по погодным факторам
    if (Math.abs(deepAnalytics.correlations.weatherRevenue) > 1000) {
      insightsList.push({
        type: 'weather',
        icon: <Cloud className="h-4 w-4" />,
        title: 'Погодная зависимость',
        description: `Погода влияет на выручку на ${Math.abs((deepAnalytics.correlations.weatherRevenue / deepAnalytics.avgRevenue) * 100).toFixed(1)}%`,
        impact: deepAnalytics.correlations.weatherRevenue > 0 ? 'positive' : 'negative',
        recommendation: 'Учитывайте погодные условия в планировании',
      });
    }

    return insightsList;
  }, [deepAnalytics, formatCurrency]);

  // Данные для графика трендов
  const chartData = useMemo(() => {
    const selectedWeekData = weeklyForecasts[selectedWeek];
    if (!selectedWeekData) return null;

    return {
      labels: selectedWeekData.days.map((day, index) => {
        const date = new Date(day.date);
        return `${date.getDate()}.${date.getMonth() + 1}`;
      }),
      datasets: [
        {
          label: 'Прогноз выручки',
          data: selectedWeekData.days.map((day) => day.predictedRevenue ?? 0),
          borderColor: 'rgb(59, 130, 246)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 6,
          pointHoverRadius: 8,
        },
        {
          label: 'Уверенность (%)',
          data: selectedWeekData.days.map((day) => (day.confidence ?? 0) * 100),
          borderColor: 'rgb(16, 185, 129)',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: false,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 4,
          yAxisID: 'y1',
        },
      ],
    };
  }, [weeklyForecasts, selectedWeek]);

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const value = context.parsed?.y;
            if (value == null) {
              return '';
            }
            if (context.datasetIndex === 0) {
              return `Выручка: ${formatCurrency(value)}`;
            }
            return `Уверенность: ${value.toFixed(1)}%`;
          },
        },
      },
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Выручка (₽)',
        },
        ticks: {
          callback: function (value) {
            return formatCurrency(Number(value));
          },
        },
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Уверенность (%)',
        },
        grid: {
          drawOnChartArea: false,
        },
      },
      x: {
        title: {
          display: true,
          text: 'Дни недели',
        },
      },
    },
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-purple-600" />
          Углубленный анализ и прогноз
          <span className="ml-2 px-2 py-1 text-xs font-semibold bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full animate-pulse">
            BETA
          </span>
        </CardTitle>
        <CardDescription>
          Глубокая аналитика с машинным обучением, анализом трендов и персонализированными инсайтами
          <br />
          <span className="text-orange-600 font-medium">
            ⚠️ Функция в разработке - возможны неточности в расчетах
          </span>
        </CardDescription>

        {/* Переключатели вкладок */}
        <div className="flex gap-2 mt-4">
          <Button
            variant={activeTab === 'forecast' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('forecast')}
            className="flex items-center gap-2"
          >
            <Target className="h-4 w-4" />
            Прогноз
          </Button>
          <Button
            variant={activeTab === 'analytics' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('analytics')}
            className="flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            Аналитика
          </Button>
          <Button
            variant={activeTab === 'insights' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('insights')}
            className="flex items-center gap-2"
          >
            <Eye className="h-4 w-4" />
            Инсайты
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Вкладка Прогноз */}
        {activeTab === 'forecast' && (
          <div className="space-y-6">
            {/* Выбор недели */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Прогноз по неделям</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedWeek(Math.max(0, selectedWeek - 1))}
                  disabled={selectedWeek === 0}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium">
                  Неделя {selectedWeek + 1} из {weeklyForecasts.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSelectedWeek(Math.min(weeklyForecasts.length - 1, selectedWeek + 1))
                  }
                  disabled={selectedWeek === weeklyForecasts.length - 1}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* График выбранной недели */}
            {chartData && (
              <div className="h-80">
                <Line data={chartData} options={chartOptions} />
              </div>
            )}

            {/* Карточки недель */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {weeklyForecasts.map((week, index) => (
                <Card
                  key={week.week}
                  className={`p-4 cursor-pointer transition-all duration-200 ${
                    index === selectedWeek ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:shadow-md'
                  }`}
                  onClick={() => setSelectedWeek(index)}
                >
                  <div className="text-center space-y-2">
                    <div className="font-bold text-lg">Неделя {week.week}</div>
                    <div className="text-sm text-gray-600">{formatCurrency(week.revenue)}</div>
                    <div className="flex items-center justify-center gap-1">
                      {week.trend > 0.05 ? (
                        <TrendingUp className="h-3 w-3 text-green-500" />
                      ) : week.trend < -0.05 ? (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      ) : (
                        <Minus className="h-3 w-3 text-gray-500" />
                      )}
                      <span className="text-xs text-gray-500">
                        {week.trend > 0 ? '+' : ''}
                        {(week.trend * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Уверенность: {Math.round(week.confidence * 100)}%
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Вкладка Аналитика */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Анализ по дням недели */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Анализ по дням недели</h3>
              <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                {deepAnalytics.dayOfWeekAnalysis.map((day) => (
                  <Card key={day.dayIndex} className="p-3 text-center">
                    <div className="font-bold text-sm mb-1">{day.dayName}</div>
                    <div className="text-lg font-bold text-blue-600">
                      {formatCurrency(day.avgRevenue)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {Math.round(day.avgConfidence * 100)}% уверенность
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Корреляции */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Корреляции факторов</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Cloud className="h-5 w-5 text-blue-500" />
                    <span className="font-semibold">Погода</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Влияние:{' '}
                    {Math.abs(
                      (deepAnalytics.correlations.weatherRevenue / deepAnalytics.avgRevenue) * 100,
                    ).toFixed(1)}
                    %
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Gift className="h-5 w-5 text-yellow-500" />
                    <span className="font-semibold">Праздники</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Влияние:{' '}
                    {Math.abs(
                      (deepAnalytics.correlations.holidayRevenue / deepAnalytics.avgRevenue) * 100,
                    ).toFixed(1)}
                    %
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Sun className="h-5 w-5 text-orange-500" />
                    <span className="font-semibold">Сезонность</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Влияние:{' '}
                    {Math.abs(
                      (deepAnalytics.correlations.seasonalRevenue / deepAnalytics.avgRevenue) * 100,
                    ).toFixed(1)}
                    %
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <TrendingUp className="h-5 w-5 text-green-500" />
                    <span className="font-semibold">Тренд</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Влияние:{' '}
                    {Math.abs(
                      (deepAnalytics.correlations.trendRevenue / deepAnalytics.avgRevenue) * 100,
                    ).toFixed(1)}
                    %
                  </div>
                </Card>
              </div>
            </div>

            {/* ML Модели */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Качество ML моделей</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <BarChart3 className="h-5 w-5 text-purple-500" />
                    <span className="font-semibold">ARIMA</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Качество: {(Math.abs(deepAnalytics.mlModelQuality.arima) * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Временные ряды</div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    <span className="font-semibold">Prophet</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Качество: {(Math.abs(deepAnalytics.mlModelQuality.prophet) * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Сезонность</div>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    <Brain className="h-5 w-5 text-green-500" />
                    <span className="font-semibold">LSTM</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Качество: {(Math.abs(deepAnalytics.mlModelQuality.lstm) * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Нейросеть</div>
                </Card>
              </div>
            </div>

            {/* Статистика */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Статистика</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {(deepAnalytics.trendSlope * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Тренд в день</div>
                </Card>
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {(deepAnalytics.volatility * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Волатильность</div>
                </Card>
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{deepAnalytics.totalDays}</div>
                  <div className="text-sm text-gray-600">Дней анализа</div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* Вкладка Инсайты */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Персонализированные инсайты</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insights.map((insight, index) => (
                <Card
                  key={index}
                  className={`p-4 ${
                    insight.impact === 'positive'
                      ? 'bg-green-50 border-green-200'
                      : insight.impact === 'negative'
                        ? 'bg-red-50 border-red-200'
                        : insight.impact === 'warning'
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        insight.impact === 'positive'
                          ? 'bg-green-100 text-green-600'
                          : insight.impact === 'negative'
                            ? 'bg-red-100 text-red-600'
                            : insight.impact === 'warning'
                              ? 'bg-yellow-100 text-yellow-600'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-1">{insight.title}</h4>
                      <p className="text-xs text-gray-600 mb-2">{insight.description}</p>
                      <div className="text-xs font-medium text-blue-600">
                        💡 {insight.recommendation}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Рекомендации по действиям */}
            <Card className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
              <div className="flex items-center gap-3 mb-3">
                <Zap className="h-5 w-5 text-blue-600" />
                <h4 className="font-semibold text-blue-900">Рекомендации по действиям</h4>
              </div>
              <div className="space-y-2 text-sm text-blue-800">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>Мониторинг ключевых метрик в реальном времени</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>Адаптация стратегии на основе погодных условий</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span>Планирование маркетинговых активностей</span>
                </div>
              </div>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
