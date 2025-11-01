import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { TrendingUp, Users, DollarSign, Calendar, Star } from 'lucide-react';
import type { CustomerCluster } from '@shared/schema';

interface CustomerClustersCardProps {
  clusters: CustomerCluster[];
}

export function CustomerClustersCard({ clusters }: CustomerClustersCardProps) {
  if (!clusters || clusters.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Сегменты клиентов
          </CardTitle>
          <CardDescription>Анализ клиентских сегментов на основе поведения</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-4">
            Недостаточно данных для анализа сегментов
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalCustomers = clusters.reduce((sum, cluster) => sum + cluster.size, 0);
  const totalRevenue = clusters.reduce(
    (sum, cluster) => sum + cluster.avgCheck * cluster.frequency * cluster.size,
    0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Сегменты клиентов
        </CardTitle>
        <CardDescription>
          Анализ клиентских сегментов на основе поведения и предпочтений
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Общая статистика */}
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-primary">{totalCustomers}</div>
            <div className="text-sm text-muted-foreground">Всего клиентов</div>
          </div>
          <div className="text-center p-3 bg-muted/50 rounded-lg">
            <div className="text-2xl font-bold text-primary">
              {Math.round(totalRevenue).toLocaleString()} ₽
            </div>
            <div className="text-sm text-muted-foreground">Общая выручка</div>
          </div>
        </div>

        {/* Кластеры */}
        <div className="space-y-4">
          {clusters.map((cluster, index) => {
            const percentage = totalCustomers > 0 ? (cluster.size / totalCustomers) * 100 : 0;
            const revenue = cluster.avgCheck * cluster.frequency * cluster.size;
            const revenuePercentage = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;

            return (
              <div key={cluster.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{cluster.name}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {cluster.size} клиентов
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {Math.round(revenue).toLocaleString()} ₽
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {revenuePercentage.toFixed(1)}% от общей выручки
                    </div>
                  </div>
                </div>

                {/* Прогресс-бар размера сегмента */}
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Размер сегмента</span>
                    <span>{percentage.toFixed(1)}%</span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>

                {/* Метрики */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" />
                      <span>Средний чек</span>
                    </div>
                    <div className="font-semibold">{Math.round(cluster.avgCheck)} ₽</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Частота</span>
                    </div>
                    <div className="font-semibold">{cluster.frequency.toFixed(1)}</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3 w-3" />
                      <span>Выручка</span>
                    </div>
                    <div className="font-semibold">{Math.round(revenue).toLocaleString()} ₽</div>
                  </div>
                </div>

                {/* Характеристики */}
                <div className="flex flex-wrap gap-2">
                  {cluster.characteristics.isHighValue && (
                    <Badge variant="default" className="text-xs">
                      <Star className="h-3 w-3 mr-1" />
                      VIP
                    </Badge>
                  )}
                  {cluster.characteristics.isFrequent && (
                    <Badge variant="secondary" className="text-xs">
                      Постоянные
                    </Badge>
                  )}
                  {cluster.characteristics.isSeasonal && (
                    <Badge variant="outline" className="text-xs">
                      Сезонные
                    </Badge>
                  )}
                </div>

                {/* Предпочтения */}
                {(cluster.characteristics.preferredDays.length > 0 ||
                  cluster.characteristics.preferredMonths.length > 0) && (
                  <div className="space-y-2">
                    {cluster.characteristics.preferredDays.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          Предпочитаемые дни:
                        </div>
                        <div className="flex gap-1">
                          {cluster.characteristics.preferredDays.map((day) => (
                            <Badge key={day} variant="outline" className="text-xs">
                              {['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day]}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {cluster.characteristics.preferredMonths.length > 0 && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          Предпочитаемые месяцы:
                        </div>
                        <div className="flex gap-1">
                          {cluster.characteristics.preferredMonths.map((month) => (
                            <Badge key={month} variant="outline" className="text-xs">
                              {
                                [
                                  'Янв',
                                  'Фев',
                                  'Мар',
                                  'Апр',
                                  'Май',
                                  'Июн',
                                  'Июл',
                                  'Авг',
                                  'Сен',
                                  'Окт',
                                  'Ноя',
                                  'Дек',
                                ][month]
                              }
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Сезонность */}
                <div>
                  <div className="text-xs text-muted-foreground mb-2">
                    Сезонность по дням недели:
                  </div>
                  <div className="flex gap-1">
                    {cluster.seasonality.map((value, day) => {
                      const intensity = Math.min(
                        100,
                        (value / Math.max(...cluster.seasonality)) * 100,
                      );
                      return (
                        <div key={day} className="flex flex-col items-center gap-1">
                          <div className="text-xs text-muted-foreground">
                            {['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day]}
                          </div>
                          <div
                            className="w-4 bg-primary/20 rounded-sm"
                            style={{ height: `${Math.max(4, intensity)}px` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
