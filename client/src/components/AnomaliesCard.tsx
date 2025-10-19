import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, Calendar, ExternalLink } from 'lucide-react';
import type { Anomaly } from '@shared/schema';

interface AnomaliesCardProps {
  anomalies: Anomaly[];
}

export function AnomaliesCard({ anomalies }: AnomaliesCardProps) {
  if (!anomalies || anomalies.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Аномалии и отклонения
          </CardTitle>
          <CardDescription>
            Обнаруженные необычные паттерны в данных
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Activity className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Аномалий не обнаружено. Данные выглядят стабильно.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
  const highAnomalies = anomalies.filter(a => a.severity === 'high');
  const mediumAnomalies = anomalies.filter(a => a.severity === 'medium');
  const lowAnomalies = anomalies.filter(a => a.severity === 'low');

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'high':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'medium':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'low':
        return <AlertTriangle className="h-4 w-4 text-blue-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'destructive';
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'revenue':
        return <TrendingUp className="h-4 w-4" />;
      case 'volume':
        return <Activity className="h-4 w-4" />;
      case 'pattern':
        return <Calendar className="h-4 w-4" />;
      case 'seasonal':
        return <Calendar className="h-4 w-4" />;
      case 'external':
        return <ExternalLink className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'revenue':
        return 'Выручка';
      case 'volume':
        return 'Объем';
      case 'pattern':
        return 'Паттерн';
      case 'seasonal':
        return 'Сезонность';
      case 'external':
        return 'Внешние факторы';
      default:
        return type;
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'Критическая';
      case 'high':
        return 'Высокая';
      case 'medium':
        return 'Средняя';
      case 'low':
        return 'Низкая';
      default:
        return severity;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Аномалии и отклонения
        </CardTitle>
        <CardDescription>
          Обнаруженные необычные паттерны в данных ({anomalies.length} найдено)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Статистика по серьезности */}
        <div className="grid grid-cols-4 gap-2">
          {criticalAnomalies.length > 0 && (
            <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded-lg">
              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                {criticalAnomalies.length}
              </div>
              <div className="text-xs text-red-600 dark:text-red-400">Критические</div>
            </div>
          )}
          {highAnomalies.length > 0 && (
            <div className="text-center p-2 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
              <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                {highAnomalies.length}
              </div>
              <div className="text-xs text-orange-600 dark:text-orange-400">Высокие</div>
            </div>
          )}
          {mediumAnomalies.length > 0 && (
            <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
              <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
                {mediumAnomalies.length}
              </div>
              <div className="text-xs text-yellow-600 dark:text-yellow-400">Средние</div>
            </div>
          )}
          {lowAnomalies.length > 0 && (
            <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                {lowAnomalies.length}
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400">Низкие</div>
            </div>
          )}
        </div>

        {/* Список аномалий */}
        <div className="space-y-3">
          {anomalies.map((anomaly, index) => (
            <Alert key={anomaly.id} className="border-l-4 border-l-primary/20">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getSeverityIcon(anomaly.severity)}
                </div>
                <div className="flex-1 min-w-0">
                  <AlertTitle className="flex items-center gap-2 mb-2">
                    <span>{anomaly.description}</span>
                    <Badge variant={getSeverityColor(anomaly.severity)} className="text-xs">
                      {getSeverityLabel(anomaly.severity)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {getTypeIcon(anomaly.type)}
                      {getTypeLabel(anomaly.type)}
                    </Badge>
                  </AlertTitle>
                  
                  <AlertDescription className="space-y-2">
                    <div className="text-sm">
                      <strong>Дата:</strong> {new Date(anomaly.date).toLocaleDateString('ru-RU')}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <strong>Фактическое значение:</strong> {anomaly.value.toLocaleString()}
                      </div>
                      <div>
                        <strong>Ожидаемое значение:</strong> {anomaly.expectedValue.toLocaleString()}
                      </div>
                    </div>
                    
                    <div className="text-sm">
                      <strong>Отклонение:</strong> 
                      <span className={`ml-1 ${anomaly.deviation > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {anomaly.deviation > 0 ? '+' : ''}{(anomaly.deviation * 100).toFixed(1)}%
                      </span>
                    </div>
                    
                    <div className="text-sm">
                      <strong>Влияние:</strong> {(anomaly.impact * 100).toFixed(1)}%
                    </div>
                    
                    {anomaly.recommendations && anomaly.recommendations.length > 0 && (
                      <div>
                        <strong className="text-sm">Рекомендации:</strong>
                        <ul className="mt-1 space-y-1">
                          {anomaly.recommendations.map((recommendation, recIndex) => (
                            <li key={recIndex} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-primary mt-1">•</span>
                              <span>{recommendation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
