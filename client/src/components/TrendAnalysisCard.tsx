import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { TrendingUp, TrendingDown, Minus, BarChart3, Target, Calendar } from 'lucide-react';
import type { TrendAnalysis } from '@shared/schema';

interface TrendAnalysisCardProps {
  trendAnalysis: TrendAnalysis;
}

export function TrendAnalysisCard({ trendAnalysis }: TrendAnalysisCardProps) {
  if (!trendAnalysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Анализ трендов
          </CardTitle>
          <CardDescription>Анализ направлений и силы трендов</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            Недостаточно данных для анализа трендов
          </p>
        </CardContent>
      </Card>
    );
  }

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      case 'volatile':
        return <BarChart3 className="h-4 w-4 text-yellow-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case 'up':
        return 'bg-green-500';
      case 'down':
        return 'bg-red-500';
      case 'volatile':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getDirectionLabel = (direction: string) => {
    switch (direction) {
      case 'up':
        return 'Рост';
      case 'down':
        return 'Спад';
      case 'volatile':
        return 'Волатильность';
      default:
        return 'Стабильно';
    }
  };

  const getFactorIcon = (factor: string) => {
    switch (factor) {
      case 'seasonal':
        return <Calendar className="h-3 w-3" />;
      case 'economic':
        return <BarChart3 className="h-3 w-3" />;
      case 'weather':
        return <Calendar className="h-3 w-3" />;
      case 'social':
        return <BarChart3 className="h-3 w-3" />;
      case 'internal':
        return <Target className="h-3 w-3" />;
      default:
        return <BarChart3 className="h-3 w-3" />;
    }
  };

  const getFactorLabel = (factor: string) => {
    switch (factor) {
      case 'seasonal':
        return 'Сезонность';
      case 'economic':
        return 'Экономика';
      case 'weather':
        return 'Погода';
      case 'social':
        return 'Социальные';
      case 'internal':
        return 'Внутренние';
      default:
        return factor;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Анализ трендов
        </CardTitle>
        <CardDescription>
          Анализ направлений и силы трендов за {trendAnalysis.period}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Основные показатели */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Направление тренда */}
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center gap-2 mb-2">
              {getDirectionIcon(trendAnalysis.direction)}
              <span className="font-semibold">{getDirectionLabel(trendAnalysis.direction)}</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              {trendAnalysis.direction === 'up'
                ? '+'
                : trendAnalysis.direction === 'down'
                  ? '-'
                  : '~'}
            </div>
            <div className="text-sm text-muted-foreground">Направление</div>
          </div>

          {/* Сила тренда */}
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4" />
              <span className="font-semibold">Сила</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              {(trendAnalysis.strength * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-muted-foreground">Интенсивность</div>
          </div>

          {/* Уверенность */}
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Target className="h-4 w-4" />
              <span className="font-semibold">Уверенность</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              {(trendAnalysis.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-sm text-muted-foreground">Надежность</div>
          </div>
        </div>

        {/* Визуализация силы тренда */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Сила тренда</span>
            <span>{(trendAnalysis.strength * 100).toFixed(0)}%</span>
          </div>
          <Progress value={trendAnalysis.strength * 100} className="h-3" />
        </div>

        {/* Визуализация уверенности */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Уверенность в прогнозе</span>
            <span>{(trendAnalysis.confidence * 100).toFixed(0)}%</span>
          </div>
          <Progress value={trendAnalysis.confidence * 100} className="h-3" />
        </div>

        {/* Факторы влияния */}
        <div>
          <h4 className="font-semibold mb-3">Факторы влияния</h4>
          <div className="space-y-3">
            {Object.entries(trendAnalysis.factors).map(([factor, value]) => (
              <div key={factor} className="flex items-center gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {getFactorIcon(factor)}
                  <span className="text-sm font-medium">{getFactorLabel(factor)}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Progress value={Math.abs(value) * 100} className="h-2 flex-1" />
                  <span className="text-sm text-muted-foreground min-w-0">
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Прогнозы */}
        <div>
          <h4 className="font-semibold mb-3">Прогнозы</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-lg font-bold text-primary">
                {trendAnalysis.forecast.nextWeek.toLocaleString()} ₽
              </div>
              <div className="text-sm text-muted-foreground">Следующая неделя</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-lg font-bold text-primary">
                {trendAnalysis.forecast.nextMonth.toLocaleString()} ₽
              </div>
              <div className="text-sm text-muted-foreground">Следующий месяц</div>
            </div>
            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-lg font-bold text-primary">
                {trendAnalysis.forecast.nextQuarter.toLocaleString()} ₽
              </div>
              <div className="text-sm text-muted-foreground">Следующий квартал</div>
            </div>
          </div>
        </div>

        {/* Рекомендации на основе тренда */}
        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-semibold mb-2">Рекомендации</h4>
          <div className="space-y-1 text-sm text-muted-foreground">
            {trendAnalysis.direction === 'up' && (
              <>
                <p>• Тренд положительный - рассмотрите возможность расширения</p>
                <p>• Увеличьте запасы и персонал для поддержания роста</p>
                <p>• Анализируйте факторы успеха для их усиления</p>
              </>
            )}
            {trendAnalysis.direction === 'down' && (
              <>
                <p>• Тренд отрицательный - требуется анализ причин спада</p>
                <p>• Проверьте качество обслуживания и продуктов</p>
                <p>• Рассмотрите маркетинговые акции для стимулирования</p>
              </>
            )}
            {trendAnalysis.direction === 'volatile' && (
              <>
                <p>• Высокая волатильность - требуется стабилизация</p>
                <p>• Анализируйте внешние факторы влияния</p>
                <p>• Разработайте стратегию сглаживания колебаний</p>
              </>
            )}
            {trendAnalysis.direction === 'stable' && (
              <>
                <p>• Стабильный тренд - хорошая основа для развития</p>
                <p>• Рассмотрите возможности для роста</p>
                <p>• Поддерживайте текущие показатели качества</p>
              </>
            )}
            {trendAnalysis.confidence < 0.7 && (
              <p className="text-yellow-600 dark:text-yellow-400">
                • Низкая уверенность в прогнозе - требуется больше данных
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
