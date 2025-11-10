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

interface Insight {
  type: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  impact: 'positive' | 'negative' | 'warning' | 'neutral';
  recommendation: string;
}

export function EnhancedWeeklyForecastCard({ forecast }: EnhancedWeeklyForecastCardProps) {
  const { nextMonth, methodology } = forecast;
  const [activeTab, setActiveTab] = useState<'forecast' | 'analytics' | 'insights'>('forecast');
  const [selectedWeek, setSelectedWeek] = useState(0);
  
  // Получаем метрики качества моделей из methodology, если доступны
  const backendModelQuality = methodology.modelQualityMetrics || {};
  
  // Получаем статус LLM из methodology, если доступен
  const llmStatus = (methodology as any).llmStatus || { enabled: false, available: false };

  // Мемоизируем форматтер валюты для оптимизации
  const formatCurrency = useMemo(() => {
    const formatter = new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return (amount: number) => formatter.format(amount);
  }, []);

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
    // Порядок дней: Пн, Вт, Ср, Чт, Пт, Сб, Вс (как принято в России)
    const dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Пн=1, Вт=2, ..., Вс=0
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const dayOfWeekAnalysis = dayOrder.map((dayIndex, orderIndex) => {
      const dayData = allDays.filter((day) => new Date(day.date).getDay() === dayIndex);
      const avgRevenue =
        dayData.reduce((sum, day) => sum + day.predictedRevenue, 0) / dayData.length;
      const avgConfidence = dayData.reduce((sum, day) => sum + day.confidence, 0) / dayData.length;

      // Находим ближайшие даты для этого дня недели (первые 2-3)
      const sortedDates = dayData
        .map((day) => new Date(day.date))
        .sort((a, b) => a.getTime() - b.getTime())
        .slice(0, 3); // Берем первые 3 даты

      // Форматируем даты в читаемый формат (например, "16 ноя" или "16 ноября")
      const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
      const formattedDates = sortedDates.map((date) => {
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        return `${day} ${month}`;
      });

      // Вычисляем статистику
      const revenues = dayData.map((day) => day.predictedRevenue);
      const minRevenue = revenues.length > 0 ? Math.min(...revenues) : 0;
      const maxRevenue = revenues.length > 0 ? Math.max(...revenues) : 0;
      const sortedRevenues = [...revenues].sort((a, b) => a - b);
      const medianRevenue =
        sortedRevenues.length > 0
          ? sortedRevenues.length % 2 === 0
            ? (sortedRevenues[sortedRevenues.length / 2 - 1] + sortedRevenues[sortedRevenues.length / 2]) / 2
            : sortedRevenues[Math.floor(sortedRevenues.length / 2)]
          : 0;

      return {
        dayIndex,
        displayOrder: orderIndex, // Порядок отображения: 0=Пн, 1=Вт, ..., 6=Вс
        dayName: dayNames[orderIndex],
        avgRevenue,
        avgConfidence,
        count: dayData.length,
        dates: formattedDates, // Ближайшие даты
        minRevenue,
        maxRevenue,
        medianRevenue,
      };
    });

    // Расчет прямого влияния факторов на прогноз
    // Используем веса факторов из ML модели вместо корреляции Пирсона
    const revenues = allDays.map(day => day.predictedRevenue);
    const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    
    // Веса факторов из ML модели (из enhancedMLForecasting.ts)
    // Обновлены веса для отражения значительно увеличенного влияния праздников
    const isSmallDataset = allDays.length < 30;
    const factorWeights = {
      seasonal: isSmallDataset ? 0.30 : 0.25, // Обновлено для соответствия новой модели
      trend: isSmallDataset ? 0.15 : 0.18,
      weather: isSmallDataset ? 0.15 : 0.18, // Обновлено для соответствия новой модели
      holiday: isSmallDataset ? 0.22 : 0.25, // Значительно увеличено с 0.12/0.15 до 0.22/0.25 (+83%/+67%)
    };

    // Расчет прямого влияния факторов на прогноз
    // Влияние = среднее абсолютное значение фактора * вес * средняя выручка
    const weatherImpacts = allDays.map(day => day.weatherImpact || 0);
    const holidayImpacts = allDays.map(day => day.holidayImpact || 0);
    const seasonalFactors = allDays.map(day => {
      const seasonality = day.factors?.seasonality || 1;
      // Преобразуем множитель в влияние: (seasonality - 1) показывает отклонение от базового уровня
      return seasonality - 1;
    });
    const trendFactors = allDays.map(day => day.factors?.trend || 0);

    // Среднее абсолютное влияние каждого фактора
    const avgWeatherImpact = weatherImpacts.reduce((sum, val) => sum + Math.abs(val), 0) / weatherImpacts.length;
    
    // Улучшенный расчет влияния праздников: учитываем максимальное влияние и дни с праздниками
    const holidayDays = allDays.filter(day => day.holidayImpact && Math.abs(day.holidayImpact) > 0.01);
    const maxHolidayImpact = holidayImpacts.length > 0 ? Math.max(...holidayImpacts.map(Math.abs)) : 0;
    const avgHolidayImpact = holidayImpacts.reduce((sum, val) => sum + Math.abs(val), 0) / holidayImpacts.length;
    // Используем взвешенное среднее: если есть праздники, учитываем их максимальное влияние
    const effectiveHolidayImpact = holidayDays.length > 0 
      ? Math.max(avgHolidayImpact, maxHolidayImpact * 0.6) // Учитываем максимальное влияние
      : avgHolidayImpact;
    
    const avgSeasonalImpact = seasonalFactors.reduce((sum, val) => sum + Math.abs(val), 0) / seasonalFactors.length;
    const avgTrendImpact = trendFactors.reduce((sum, val) => sum + Math.abs(val), 0) / trendFactors.length;

    // Расчет влияния в рублях: влияние фактора * вес * средняя выручка
    // Для праздников используем эффективное влияние, которое лучше отражает их реальный эффект
    const correlations = {
      weatherRevenue: Math.abs(avgWeatherImpact) * factorWeights.weather * avgRevenue,
      holidayRevenue: Math.abs(effectiveHolidayImpact) * factorWeights.holiday * avgRevenue,
      seasonalRevenue: Math.abs(avgSeasonalImpact) * factorWeights.seasonal * avgRevenue,
      trendRevenue: Math.abs(avgTrendImpact) * factorWeights.trend * avgRevenue,
    };

    // Анализ трендов с ML
    const revenueTrend = allDays.map((day) => day.predictedRevenue);
    // Исправленная формула тренда: процентное изменение в день
    const trendSlope =
      revenueTrend.length > 1 && revenueTrend[0] > 0
        ? ((revenueTrend[revenueTrend.length - 1] - revenueTrend[0]) / revenueTrend[0]) / revenueTrend.length
        : 0;

    // Анализ волатильности (используем уже вычисленный avgRevenue)
    const variance =
      revenueTrend.reduce((sum, rev) => sum + Math.pow(rev - avgRevenue, 2), 0) /
      revenueTrend.length;
    const volatility = avgRevenue > 0 ? Math.sqrt(variance) / avgRevenue : 0;

    // Анализ качества ML моделей - используем метрики из бэкенда, если доступны
    // Если метрики из бэкенда недоступны, используем fallback расчет на основе факторов
    const mlModelQuality = {
      arima: backendModelQuality.arima ?? (() => {
        const arimaFactors = allDays.map((day) => day.factors?.historicalPattern || 0);
        return arimaFactors.length > 0
          ? Math.max(0, Math.min(1, (arimaFactors.reduce((sum, f) => sum + Math.abs(f), 0) / arimaFactors.length) * 2))
          : 0.5;
      })(),
      prophet: backendModelQuality.prophet ?? (() => {
        const prophetFactors = allDays.map((day) => day.factors?.seasonality || 1);
        const prophetAvg = prophetFactors.reduce((sum, f) => sum + f, 0) / prophetFactors.length;
        return Math.max(0, Math.min(1, 1 - Math.abs(prophetAvg - 1) * 2)); // Чем ближе к 1, тем лучше
      })(),
      lstm: backendModelQuality.lstm ?? (() => {
        const lstmFactors = allDays.map((day) => day.factors?.trend || 0);
        return lstmFactors.length > 0
          ? Math.max(0, Math.min(1, 0.5 + Math.abs(lstmFactors.reduce((sum, f) => sum + f, 0) / lstmFactors.length) * 0.5))
          : 0.5;
      })(),
      gru: backendModelQuality.gru ?? (() => {
        // GRU лучше работает с сезонностью, используем сезонность как индикатор
        const gruFactors = allDays.map((day) => day.factors?.seasonality || 1);
        const gruAvg = gruFactors.reduce((sum, f) => sum + f, 0) / gruFactors.length;
        return Math.max(0, Math.min(1, 0.5 + (1 - Math.abs(gruAvg - 1)) * 0.5));
      })(),
      nhits: backendModelQuality.nhits ?? (() => {
        // NHITS хорошо работает с трендами и сезонностью
        const nhitsTrendFactors = allDays.map((day) => day.factors?.trend || 0);
        const nhitsSeasonFactors = allDays.map((day) => day.factors?.seasonality || 1);
        const trendAvg = nhitsTrendFactors.reduce((sum, f) => sum + Math.abs(f), 0) / nhitsTrendFactors.length;
        const seasonAvg = nhitsSeasonFactors.reduce((sum, f) => sum + f, 0) / nhitsSeasonFactors.length;
        return Math.max(0, Math.min(1, 0.5 + (trendAvg * 0.3 + (1 - Math.abs(seasonAvg - 1)) * 0.2)));
      })(),
      llm: backendModelQuality.llm ?? 0, // Используем метрики из бэкенда для LLM
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
    const insightsList: Insight[] = [];

    // Проверка наличия данных
    if (!deepAnalytics || !deepAnalytics.dayOfWeekAnalysis || deepAnalytics.dayOfWeekAnalysis.length === 0) {
      return insightsList;
    }

    // Инсайт по дням недели
    const validDays = deepAnalytics.dayOfWeekAnalysis.filter(day => 
      day && typeof day.avgRevenue === 'number' && isFinite(day.avgRevenue)
    );

    if (validDays.length > 0) {
      const bestDay = validDays.reduce((best, day) =>
        day.avgRevenue > best.avgRevenue ? day : best,
        validDays[0]
      );
      const worstDay = validDays.reduce((worst, day) =>
        day.avgRevenue < worst.avgRevenue ? day : worst,
        validDays[0]
      );

      if (bestDay && worstDay) {
        insightsList.push({
          type: 'performance',
          icon: <Target className="h-4 w-4" />,
          title: 'Лучший день недели',
          description: `${bestDay.dayName} показывает среднюю выручку ${formatCurrency(bestDay.avgRevenue)}`,
          impact: 'positive',
          recommendation: `Сосредоточьтесь на максимизации продаж в ${bestDay.dayName}`,
        });

        // Добавляем инсайт о худшем дне, если разница значительна
        if (bestDay.avgRevenue > worstDay.avgRevenue * 1.2) {
          insightsList.push({
            type: 'performance',
            icon: <AlertTriangle className="h-4 w-4" />,
            title: 'День с низкой выручкой',
            description: `${worstDay.dayName} показывает среднюю выручку ${formatCurrency(worstDay.avgRevenue)}`,
            impact: 'warning',
            recommendation: `Рассмотрите специальные акции или мероприятия для ${worstDay.dayName}`,
          });
        }
      }
    }

    // Инсайт по трендам
    if (typeof deepAnalytics.trendSlope === 'number' && isFinite(deepAnalytics.trendSlope)) {
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
    }

    // Инсайт по волатильности
    if (typeof deepAnalytics.volatility === 'number' && isFinite(deepAnalytics.volatility)) {
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
    }

    // Инсайт по погодным факторам
    if (
      deepAnalytics.correlations &&
      typeof deepAnalytics.correlations.weatherRevenue === 'number' &&
      isFinite(deepAnalytics.correlations.weatherRevenue) &&
      typeof deepAnalytics.avgRevenue === 'number' &&
      isFinite(deepAnalytics.avgRevenue) &&
      deepAnalytics.avgRevenue > 0
    ) {
      const weatherImpactPercent = Math.abs(
        (deepAnalytics.correlations.weatherRevenue / deepAnalytics.avgRevenue) * 100
      );
      
      // Используем процентное влияние вместо абсолютного значения
      if (weatherImpactPercent > 5) {
        insightsList.push({
          type: 'weather',
          icon: <Cloud className="h-4 w-4" />,
          title: 'Погодная зависимость',
          description: `Погода влияет на выручку на ${weatherImpactPercent.toFixed(1)}%`,
          impact: deepAnalytics.correlations.weatherRevenue > 0 ? 'positive' : 'negative',
          recommendation: 'Учитывайте погодные условия в планировании',
        });
      }
    }

    // Инсайт по праздникам
    if (
      deepAnalytics.correlations &&
      typeof deepAnalytics.correlations.holidayRevenue === 'number' &&
      isFinite(deepAnalytics.correlations.holidayRevenue) &&
      typeof deepAnalytics.avgRevenue === 'number' &&
      isFinite(deepAnalytics.avgRevenue) &&
      deepAnalytics.avgRevenue > 0
    ) {
      const holidayImpactPercent = Math.abs(
        (deepAnalytics.correlations.holidayRevenue / deepAnalytics.avgRevenue) * 100
      );
      
      if (holidayImpactPercent > 10) {
        insightsList.push({
          type: 'holiday',
          icon: <Gift className="h-4 w-4" />,
          title: 'Влияние праздников',
          description: `Праздники влияют на выручку на ${holidayImpactPercent.toFixed(1)}%`,
          impact: deepAnalytics.correlations.holidayRevenue > 0 ? 'positive' : 'negative',
          recommendation: 'Планируйте специальные акции и увеличение запасов в праздничные дни',
        });
      }
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

  const chartOptions: ChartOptions<'line'> = useMemo(() => {
    const selectedWeekData = weeklyForecasts[selectedWeek];
    if (!selectedWeekData) {
      return {} as ChartOptions<'line'>;
    }

    // Вычисляем диапазоны для правильной настройки осей
    const revenueData = selectedWeekData.days.map((day) => day.predictedRevenue ?? 0);
    const confidenceData = selectedWeekData.days.map((day) => (day.confidence ?? 0) * 100);
    
    const minRevenue = Math.min(...revenueData);
    const maxRevenue = Math.max(...revenueData);
    const revenueRange = maxRevenue - minRevenue;
    const revenuePadding = revenueRange * 0.1; // 10% padding

    const minConfidence = Math.min(...confidenceData);
    const maxConfidence = Math.max(...confidenceData);
    const confidenceRange = maxConfidence - minConfidence;
    const confidencePadding = confidenceRange * 0.1; // 10% padding

    return {
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
          min: Math.max(0, minRevenue - revenuePadding),
          max: maxRevenue + revenuePadding,
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
          min: Math.max(0, minConfidence - confidencePadding),
          max: Math.min(100, maxConfidence + confidencePadding),
          ticks: {
            callback: function (value) {
              return `${Number(value).toFixed(0)}%`;
            },
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
  }, [weeklyForecasts, selectedWeek, formatCurrency]);

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
                {[...deepAnalytics.dayOfWeekAnalysis].sort((a, b) => (a.displayOrder ?? a.dayIndex) - (b.displayOrder ?? b.dayIndex)).map((day) => {
                  // Определяем лучший и худший день для цветовой индикации
                  const allRevenues = deepAnalytics.dayOfWeekAnalysis.map((d) => d.avgRevenue);
                  const maxRevenue = Math.max(...allRevenues);
                  const minRevenue = Math.min(...allRevenues);
                  const isBestDay = day.avgRevenue === maxRevenue;
                  const isWorstDay = day.avgRevenue === minRevenue;
                  
                  return (
                    <Card
                      key={day.dayIndex}
                      className={`p-3 text-center transition-all duration-200 hover:shadow-lg cursor-pointer ${
                        isBestDay
                          ? 'bg-green-50 border-green-200 border-2'
                          : isWorstDay
                            ? 'bg-red-50 border-red-200 border-2'
                            : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="font-bold text-sm mb-1">{day.dayName}</div>
                      
                      {/* Даты под названием дня */}
                      {day.dates && day.dates.length > 0 && (
                        <div className="text-sm font-medium text-muted-foreground mb-2 space-y-1">
                          {day.dates.map((date, idx) => (
                            <div key={idx} className="leading-tight">{date}</div>
                          ))}
                        </div>
                      )}
                      
                      <div
                        className={`text-lg font-bold mb-1 ${
                          isBestDay ? 'text-green-600' : isWorstDay ? 'text-red-600' : 'text-blue-600'
                        }`}
                      >
                        {formatCurrency(day.avgRevenue)}
                      </div>
                      
                      {/* Прогресс-бар для уверенности */}
                      <div className="mb-1">
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${
                              day.avgConfidence >= 0.7
                                ? 'bg-green-500'
                                : day.avgConfidence >= 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.round(day.avgConfidence * 100)}%` }}
                          />
                        </div>
                      </div>
                      
                      <div className="text-xs text-gray-500">
                        {Math.round(day.avgConfidence * 100)}% уверенность
                      </div>
                      
                      {/* Дополнительная статистика при hover */}
                      <div className="text-xs text-gray-400 mt-1">
                        {day.count} {day.count === 1 ? 'день' : day.count < 5 ? 'дня' : 'дней'}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Корреляции */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Корреляции факторов</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {(() => {
                  const avgRev = deepAnalytics.avgRevenue;
                  const weatherPercent =
                    avgRev && isFinite(avgRev) && avgRev > 0
                      ? Math.abs((deepAnalytics.correlations.weatherRevenue / avgRev) * 100)
                      : 0;
                  const weatherAmount = Math.abs(deepAnalytics.correlations.weatherRevenue);
                  const weatherNormalized = Math.min(weatherPercent / 100, 1); // Нормализуем до 0-1 для прогресс-бара

                  const holidayPercent =
                    avgRev && isFinite(avgRev) && avgRev > 0
                      ? Math.abs((deepAnalytics.correlations.holidayRevenue / avgRev) * 100)
                      : 0;
                  const holidayAmount = Math.abs(deepAnalytics.correlations.holidayRevenue);
                  const holidayNormalized = Math.min(holidayPercent / 100, 1);

                  const seasonalPercent =
                    avgRev && isFinite(avgRev) && avgRev > 0
                      ? Math.abs((deepAnalytics.correlations.seasonalRevenue / avgRev) * 100)
                      : 0;
                  const seasonalAmount = Math.abs(deepAnalytics.correlations.seasonalRevenue);
                  const seasonalNormalized = Math.min(seasonalPercent / 100, 1);

                  const trendPercent =
                    typeof deepAnalytics.trendSlope === 'number' && isFinite(deepAnalytics.trendSlope)
                      ? Math.abs(deepAnalytics.trendSlope * 100)
                      : 0;
                  // Улучшенная нормализация тренда: делитель увеличен с 10 до 5 для более точного отображения
                  const trendNormalized = Math.min(trendPercent / 5, 1); // Нормализуем тренд

                  return (
                    <>
                      <Card className="p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-3">
                          <Cloud className="h-5 w-5 text-blue-500" />
                          <span className="font-semibold">Погода</span>
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-gray-700">
                            Влияние: {weatherPercent.toFixed(1)}%
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-500 h-2 rounded-full transition-all"
                              style={{ width: `${weatherNormalized * 100}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrency(weatherAmount)} в день
                          </div>
                        </div>
                      </Card>
                      <Card className="p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-3">
                          <Gift className="h-5 w-5 text-yellow-500" />
                          <span className="font-semibold">Праздники</span>
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-gray-700">
                            Влияние: {holidayPercent.toFixed(1)}%
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-yellow-500 h-2 rounded-full transition-all"
                              style={{ width: `${holidayNormalized * 100}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrency(holidayAmount)} в день
                          </div>
                        </div>
                      </Card>
                      <Card className="p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-3">
                          <Sun className="h-5 w-5 text-orange-500" />
                          <span className="font-semibold">Сезонность</span>
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-gray-700">
                            Влияние: {seasonalPercent.toFixed(1)}%
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-orange-500 h-2 rounded-full transition-all"
                              style={{ width: `${seasonalNormalized * 100}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatCurrency(seasonalAmount)} в день
                          </div>
                        </div>
                      </Card>
                      <Card className="p-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-3">
                          <TrendingUp className="h-5 w-5 text-green-500" />
                          <span className="font-semibold">Тренд</span>
                        </div>
                        <div className="space-y-2">
                          <div className="text-sm font-medium text-gray-700">
                            Влияние:{' '}
                            {typeof deepAnalytics.trendSlope === 'number' &&
                            isFinite(deepAnalytics.trendSlope)
                              ? `${deepAnalytics.trendSlope > 0 ? '+' : ''}${(deepAnalytics.trendSlope * 100).toFixed(1)}%`
                              : '0.0%'}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                deepAnalytics.trendSlope > 0 ? 'bg-green-500' : 'bg-red-500'
                              }`}
                              style={{ width: `${trendNormalized * 100}%` }}
                            />
                          </div>
                          <div className="text-xs text-gray-500">в день</div>
                        </div>
                      </Card>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* ML Модели */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Качество ML моделей</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    name: 'ARIMA',
                    quality: Math.abs(deepAnalytics.mlModelQuality.arima),
                    icon: <BarChart3 className="h-5 w-5 text-purple-500" />,
                    description: 'Временные ряды',
                    color: 'purple',
                  },
                  {
                    name: 'Prophet',
                    quality: Math.abs(deepAnalytics.mlModelQuality.prophet),
                    icon: <Calendar className="h-5 w-5 text-blue-500" />,
                    description: 'Сезонность',
                    color: 'blue',
                  },
                  {
                    name: 'LSTM',
                    quality: Math.abs(deepAnalytics.mlModelQuality.lstm),
                    icon: <Brain className="h-5 w-5 text-green-500" />,
                    description: 'Нейросеть',
                    color: 'green',
                  },
                  {
                    name: 'GRU',
                    quality: Math.abs(deepAnalytics.mlModelQuality.gru ?? 0.5),
                    icon: <Zap className="h-5 w-5 text-orange-500" />,
                    description: 'Рекуррентная сеть',
                    color: 'orange',
                  },
                  {
                    name: 'NHITS',
                    quality: Math.abs(deepAnalytics.mlModelQuality.nhits ?? 0.5),
                    icon: <Activity className="h-5 w-5 text-teal-500" />,
                    description: 'Нейросетевая иерархическая модель',
                    color: 'teal',
                  },
                  {
                    name: 'LLM',
                    quality: Math.abs(deepAnalytics.mlModelQuality.llm ?? 0),
                    icon: <Brain className="h-5 w-5 text-indigo-500" />,
                    description: llmStatus.enabled 
                      ? (llmStatus.available ? 'LLM модель' : 'Недоступна')
                      : 'Отключена',
                    color: 'indigo',
                    isLLM: true,
                    llmStatus,
                  },
                ].map((model) => {
                  const qualityPercent = model.quality * 100;
                  const colorClasses = {
                    purple: 'bg-purple-500',
                    blue: 'bg-blue-500',
                    green: 'bg-green-500',
                    orange: 'bg-orange-500',
                    teal: 'bg-teal-500',
                    indigo: 'bg-indigo-500',
                  };
                  
                  // Для LLM показываем дополнительную информацию
                  const isLLM = (model as any).isLLM;
                  const llmStatusInfo = (model as any).llmStatus;

                  return (
                    <Card key={model.name} className={`p-4 hover:shadow-md transition-shadow ${
                      isLLM && !llmStatusInfo?.available ? 'opacity-60' : ''
                    }`}>
                      <div className="flex items-center gap-3 mb-3">
                        {model.icon}
                        <span className="font-semibold">{model.name}</span>
                        {isLLM && llmStatusInfo?.metrics && (
                          <Badge variant={llmStatusInfo.available ? 'default' : 'secondary'} className="ml-auto text-xs">
                            {llmStatusInfo.metrics.totalRequests > 0 
                              ? `${llmStatusInfo.metrics.successfulRequests}/${llmStatusInfo.metrics.totalRequests}`
                              : '0 запросов'}
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">Качество</span>
                          <span className="text-sm font-bold text-gray-900">
                            {qualityPercent.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`${colorClasses[model.color as keyof typeof colorClasses]} h-2.5 rounded-full transition-all`}
                            style={{ width: `${Math.max(0, Math.min(100, qualityPercent))}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{model.description}</div>
                        {isLLM && llmStatusInfo?.metrics && (
                          <div className="text-xs text-gray-400 space-y-0.5">
                            <div>Запросов: {llmStatusInfo.metrics.totalRequests}</div>
                            <div>Успешно: {llmStatusInfo.metrics.successfulRequests}</div>
                            {llmStatusInfo.metrics.averageResponseTime > 0 && (
                              <div>Ср. время: {Math.round(llmStatusInfo.metrics.averageResponseTime)}ms</div>
                            )}
                          </div>
                        )}
                        {!isLLM && (
                          <div className="text-xs text-gray-400 mt-1">
                            {qualityPercent >= 70
                              ? 'Отличное качество'
                              : qualityPercent >= 50
                                ? 'Хорошее качество'
                                : qualityPercent >= 30
                                  ? 'Среднее качество'
                                  : 'Требует улучшения'}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Статистика */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Статистика</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {deepAnalytics.trendSlope !== 0 && isFinite(deepAnalytics.trendSlope)
                      ? (deepAnalytics.trendSlope * 100).toFixed(2)
                      : '0.00'}%
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

            {insights.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Brain className="h-12 w-12 text-gray-400" />
                  <p className="text-gray-600">Недостаточно данных для генерации инсайтов</p>
                  <p className="text-sm text-gray-500">
                    Загрузите больше данных для получения персонализированных рекомендаций
                  </p>
                </div>
              </Card>
            ) : (
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
            )}

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
