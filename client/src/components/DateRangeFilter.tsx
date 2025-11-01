import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { DateRange } from 'react-day-picker';
import { CalendarRange, ChevronDown } from 'lucide-react';

import { useDateFilter, type DateFilterPreset } from '@/hooks/use-date-filter';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { AnalyticsPeriod } from '@shared/schema';

const PRESETS: { value: Exclude<DateFilterPreset, 'custom'>; label: string }[] = [
  { value: 'last7', label: '7 дней' },
  { value: 'last28', label: '28 дней' },
  { value: 'last90', label: '90 дней' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
];

function formatRangeLabel(range: DateRange | undefined): string {
  if (!range?.from && !range?.to) {
    return 'Выберите период';
  }

  if (range.from && range.to) {
    return `${format(range.from, 'd MMM yyyy', { locale: ru })} — ${format(range.to, 'd MMM yyyy', {
      locale: ru,
    })}`;
  }

  if (range.from) {
    return `с ${format(range.from, 'd MMM yyyy', { locale: ru })}`;
  }

  if (range.to) {
    return `по ${format(range.to, 'd MMM yyyy', { locale: ru })}`;
  }

  return 'Выберите период';
}

interface DateRangeFilterProps {
  period?: AnalyticsPeriod;
}

export function DateRangeFilter({ period }: DateRangeFilterProps) {
  const { filter, setPreset, setCustomRange } = useDateFilter();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const selectedRange = useMemo<DateRange | undefined>(
    () =>
      filter.from || filter.to
        ? {
            from: filter.from,
            to: filter.to,
          }
        : undefined,
    [filter.from, filter.to],
  );

  const displayRange = useMemo<DateRange | undefined>(() => {
    if (period?.from || period?.to) {
      return {
        from: period.from ? new Date(period.from) : undefined,
        to: period.to ? new Date(period.to) : undefined,
      };
    }
    return selectedRange;
  }, [period?.from, period?.to, selectedRange]);

  const handleSelectRange = (range?: DateRange) => {
    if (!range) {
      setCustomRange({});
      return;
    }

    setCustomRange({
      from: range.from,
      to: range.to,
    });

    if (range.from && range.to) {
      setIsPopoverOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-full bg-muted/50 p-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.value}
            size="sm"
            variant={filter.preset === preset.value ? 'default' : 'ghost'}
            className={cn(
              'rounded-full px-3 text-xs font-medium transition-all',
              filter.preset !== preset.value && 'hover:bg-background',
            )}
            onClick={() => {
              setPreset(preset.value);
            }}
            data-testid={`date-filter-${preset.value}`}
          >
            {preset.label}
          </Button>
        ))}
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant={filter.preset === 'custom' ? 'default' : 'ghost'}
              className={cn(
                'rounded-full px-3 text-xs font-medium transition-all',
                filter.preset !== 'custom' && 'hover:bg-background',
              )}
              data-testid="date-filter-custom"
            >
              <CalendarRange className="mr-2 h-4 w-4" />
              Произвольный
              <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={selectedRange}
              onSelect={handleSelectRange}
              numberOfMonths={2}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        {filter.preset === 'custom'
          ? formatRangeLabel(displayRange ?? selectedRange)
          : period
            ? formatRangeLabel(displayRange)
            : (PRESETS.find((preset) => preset.value === filter.preset)?.label ??
              formatRangeLabel(displayRange ?? selectedRange))}
      </div>
    </div>
  );
}
