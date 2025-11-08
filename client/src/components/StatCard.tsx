import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ProgressBar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, TrendingUp, TrendingDown, Target } from 'lucide-react';
import type { Anomaly } from '@shared/schema';
import { formatDeviation, getAnomalyIndicatorColor } from '@/utils/mlMetrics';

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  progress?: {
    value: number;
    max: number;
    color?: 'primary' | 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'destructive';
  };
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  testId?: string;
  // ML и аномалии
  mlData?: {
    expectedValue?: number;
    deviation?: number;
    confidence?: number;
    isAnomaly?: boolean;
    anomaly?: Anomaly;
  };
}

export function StatCard({ title, value, icon, progress, subtitle, trend, testId, mlData }: StatCardProps) {
  const hasMLData = mlData && (mlData.expectedValue !== undefined || mlData.isAnomaly);
  const deviation = mlData?.deviation ?? 0;
  const indicatorColor = hasMLData
    ? getAnomalyIndicatorColor(deviation, mlData.isAnomaly ?? false, mlData.anomaly?.severity)
    : 'default';

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(val);

  return (
    <Card
      className={`p-6 ${mlData?.isAnomaly ? 'border-destructive/20' : ''}`}
      data-testid={testId}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              {mlData?.isAnomaly && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant={indicatorColor === 'destructive' ? 'destructive' : 'outline'}
                        className="text-xs cursor-help"
                      >
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        Аномалия
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="space-y-1">
                        <p className="font-semibold">
                          {mlData.anomaly?.severity === 'critical'
                            ? 'Критическая аномалия'
                            : mlData.anomaly?.severity === 'high'
                              ? 'Высокая аномалия'
                              : 'Аномалия'}
                        </p>
                        {mlData.anomaly?.description && (
                          <p className="text-xs">{mlData.anomaly.description}</p>
                        )}
                        {mlData.expectedValue !== undefined && (
                          <p className="text-xs text-muted-foreground">
                            Ожидаемое значение: {formatCurrency(mlData.expectedValue)}
                          </p>
                        )}
                        {mlData.anomaly?.recommendations && mlData.anomaly.recommendations.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-semibold mb-1">Рекомендации:</p>
                            <ul className="text-xs space-y-0.5 list-disc list-inside">
                              {mlData.anomaly.recommendations.slice(0, 2).map((rec, idx) => (
                                <li key={idx}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
            {hasMLData && mlData.expectedValue !== undefined && (
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  Ожидаемое: {formatCurrency(mlData.expectedValue)}
                </p>
                {mlData.confidence !== undefined && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs cursor-help">
                          <Target className="w-3 h-3 mr-1" />
                          {(mlData.confidence * 100).toFixed(0)}%
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">Уверенность ML-модели в прогнозе</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
          {icon && <div className="p-2.5 bg-primary/10 rounded-lg">{icon}</div>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {trend && (
            <div
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium ${
                trend.isPositive ? 'bg-chart-2/10 text-chart-2' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {trend.isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{Math.abs(trend.value).toFixed(1)}%</span>
            </div>
          )}

          {hasMLData && deviation !== 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium cursor-help ${
                      indicatorColor === 'destructive'
                        ? 'bg-destructive/10 text-destructive'
                        : indicatorColor === 'warning'
                          ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {deviation > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    <span>{formatDeviation(deviation)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-semibold text-xs">Отклонение от ожидаемого значения</p>
                    <p className="text-xs text-muted-foreground">
                      {deviation > 0
                        ? `Фактическое значение на ${formatDeviation(deviation)} выше ожидаемого`
                        : `Фактическое значение на ${formatDeviation(Math.abs(deviation))} ниже ожидаемого`}
                    </p>
                    {mlData.expectedValue !== undefined && (
                      <p className="text-xs text-muted-foreground">
                        Ожидаемое значение рассчитывается на основе медианы и скользящего среднего исторических данных
                        {mlData.isAnomaly && ', с учетом обнаруженных аномалий'}
                      </p>
                    )}
                    {mlData.isAnomaly && (
                      <p className="text-xs text-destructive mt-1">
                        ⚠️ Обнаружена аномалия в данных
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {progress && (
          <ProgressBar value={progress.value} max={progress.max} color={progress.color} />
        )}
      </div>
    </Card>
  );
}
