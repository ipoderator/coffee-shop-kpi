import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ProgressBar';
import { LucideIcon } from 'lucide-react';

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
}

export function StatCard({ title, value, icon, progress, subtitle, trend, testId }: StatCardProps) {
  return (
    <Card className="p-6" data-testid={testId}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {icon && <div className="p-2.5 bg-primary/10 rounded-lg">{icon}</div>}
        </div>

        {trend && (
          <div
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm font-medium ${
              trend.isPositive ? 'bg-chart-2/10 text-chart-2' : 'bg-destructive/10 text-destructive'
            }`}
          >
            <span>{trend.isPositive ? '↑' : '↓'}</span>
            <span>{Math.abs(trend.value).toFixed(1)}%</span>
          </div>
        )}

        {progress && (
          <ProgressBar value={progress.value} max={progress.max} color={progress.color} />
        )}
      </div>
    </Card>
  );
}
