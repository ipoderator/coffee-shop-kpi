import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number;
  max: number;
  className?: string;
  showPercentage?: boolean;
  label?: string;
  color?: 'primary' | 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'destructive';
}

export function ProgressBar({ 
  value, 
  max, 
  className, 
  showPercentage = true, 
  label,
  color = 'primary'
}: ProgressBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  
  const colorClasses = {
    primary: 'bg-primary',
    'chart-1': 'bg-chart-1',
    'chart-2': 'bg-chart-2',
    'chart-3': 'bg-chart-3',
    'chart-4': 'bg-chart-4',
    destructive: 'bg-destructive',
  };

  return (
    <div className={cn("space-y-2", className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between text-sm">
          {label && <span className="font-medium">{label}</span>}
          {showPercentage && (
            <span className="text-muted-foreground tabular-nums">
              {percentage.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-500 ease-out rounded-full", colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
