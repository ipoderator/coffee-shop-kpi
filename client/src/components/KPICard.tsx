import { ArrowUp, ArrowDown, Minus, CircleHelp } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface KPICardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  growth?: number;
  format?: 'currency' | 'number' | 'decimal';
  testId?: string;
  description?: string;
}

export function KPICard({ title, value, icon, growth, format = 'number', testId, description }: KPICardProps) {
  const formatValue = (val: number | string): string => {
    if (typeof val === 'string') return val;
    
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: 'RUB',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(val);
      case 'decimal':
        return new Intl.NumberFormat('ru-RU', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(val);
      default:
        return new Intl.NumberFormat('ru-RU').format(val);
    }
  };

  const getGrowthBadge = () => {
    if (growth === undefined || growth === null) return null;

    const isPositive = growth > 0;
    const isNeutral = growth === 0;

    const GrowthIcon = isNeutral ? Minus : isPositive ? ArrowUp : ArrowDown;
    const growthClass = isNeutral 
      ? 'bg-muted text-muted-foreground' 
      : isPositive 
        ? 'bg-chart-2/10 text-chart-2 border-chart-2/20' 
        : 'bg-destructive/10 text-destructive border-destructive/20';

    return (
      <Badge 
        variant="outline" 
        className={`gap-1 font-semibold border ${growthClass}`}
        data-testid={`${testId}-growth`}
      >
        <GrowthIcon className="w-3 h-3" />
        {Math.abs(growth).toFixed(1)}%
      </Badge>
    );
  };

  return (
    <Card className="relative p-6 hover-elevate group transition-all duration-300 border-border/50 shadow-md hover:shadow-xl hover:shadow-primary/10 overflow-hidden h-[180px] flex flex-col" data-testid={testId}>
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50 group-hover:opacity-70 transition-opacity" />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="p-3 bg-gradient-to-br from-primary to-primary/80 rounded-xl text-primary-foreground shadow-lg shadow-primary/25 group-hover:shadow-primary/40 transition-shadow">
            {icon}
          </div>
          {getGrowthBadge()}
        </div>
        
        <div className="space-y-2 flex-1 flex flex-col justify-end">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide" data-testid={`${testId}-label`}>
              {title}
            </p>
            {description && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <CircleHelp className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors cursor-help" data-testid={`${testId}-info`} />
                </TooltipTrigger>
                <TooltipContent side="top" align="center" sideOffset={5} className="max-w-lg z-50">
                  <p className="text-sm leading-relaxed">{description}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="text-2xl md:text-3xl font-extrabold font-mono tabular-nums bg-gradient-to-br from-foreground to-foreground/80 bg-clip-text text-transparent" data-testid={`${testId}-value`}>
            {formatValue(value)}
          </p>
        </div>
      </div>
    </Card>
  );
}
