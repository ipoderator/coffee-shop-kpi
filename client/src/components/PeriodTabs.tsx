import { Button } from '@/components/ui/button';

export type PeriodType = 'day' | 'month' | 'year';

interface PeriodTabsProps {
  selected: PeriodType;
  onChange: (period: PeriodType) => void;
}

export function PeriodTabs({ selected, onChange }: PeriodTabsProps) {
  const tabs: { value: PeriodType; label: string }[] = [
    { value: 'day', label: 'По дням' },
    { value: 'month', label: 'По месяцам' },
    { value: 'year', label: 'По годам' },
  ];

  return (
    <div className="inline-flex gap-1 p-1 bg-muted rounded-lg" data-testid="period-tabs">
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          variant={selected === tab.value ? 'default' : 'ghost'}
          size="sm"
          onClick={() => onChange(tab.value)}
          className={`
            px-4 rounded-md transition-all
            ${selected === tab.value ? '' : 'hover:bg-background'}
          `}
          data-testid={`button-period-${tab.value}`}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
