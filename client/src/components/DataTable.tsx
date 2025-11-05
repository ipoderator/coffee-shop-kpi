import { useState, useMemo, useCallback, memo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Transaction } from '@shared/schema';
import { format, startOfDay, startOfMonth } from 'date-fns';
import {
  buildRevenueThresholds,
  buildChecksThresholds,
  classifyDailyAnomalies,
  type AnomalyTag,
} from '@/lib/anomaly';

interface DataTableProps {
  transactions: Transaction[];
}

type SortField = 'date' | 'amount' | 'dailyChecks' | 'dailyAvgCheck' | 'deviation';
type SortDirection = 'asc' | 'desc' | null;

interface TransactionWithMetrics extends Transaction {
  dailyAvgCheck: number;
  deviation: number;
  dailyChecksCount: number;
  anomalyTags: AnomalyTag[];
}

const anomalyBadgeConfig: Record<AnomalyTag, { label: string; className: string }> = {
  'revenue-low': {
    label: 'выручка ↓',
    className: 'text-amber-700 dark:text-amber-300',
  },
  'revenue-high': {
    label: 'выручка ↑',
    className: 'text-violet-700 dark:text-violet-300',
  },
  'checks-low': {
    label: 'чеки ↓',
    className: 'text-sky-700 dark:text-sky-300',
  },
  'checks-high': {
    label: 'чеки ↑',
    className: 'text-indigo-700 dark:text-indigo-300',
  },
};

const getRowHighlightClass = (tags: AnomalyTag[]) => {
  if (tags.includes('revenue-high')) {
    return 'bg-violet-50/70 dark:bg-violet-500/10';
  }
  if (tags.includes('revenue-low')) {
    return 'bg-amber-50/70 dark:bg-amber-500/10';
  }
  if (tags.includes('checks-high')) {
    return 'bg-blue-50/70 dark:bg-blue-500/10';
  }
  if (tags.includes('checks-low')) {
    return 'bg-cyan-50/70 dark:bg-cyan-500/10';
  }
  return '';
};

function DataTableComponent({ transactions }: DataTableProps) {
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Calculate daily average check and monthly average check
  const transactionsWithMetrics = useMemo((): TransactionWithMetrics[] => {
    if (transactions.length === 0) return [];

    // Group by day to calculate daily average check
    const dailyMap = new Map<string, { revenue: number; checks: number }>();
    transactions.forEach((t) => {
      const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
      const existing = dailyMap.get(day) || { revenue: 0, checks: 0 };
      dailyMap.set(day, {
        revenue: existing.revenue + t.amount,
        checks: existing.checks + (t.checksCount || 1),
      });
    });

    // Calculate daily average checks
    const dailyAvgChecks = new Map<string, number>();
    dailyMap.forEach((data, day) => {
      dailyAvgChecks.set(day, data.checks > 0 ? data.revenue / data.checks : 0);
    });

    // Group by month to calculate monthly average check for each month
    const monthlyMap = new Map<string, { revenue: number; checks: number }>();
    transactions.forEach((t) => {
      const month = format(startOfMonth(new Date(t.date)), 'yyyy-MM');
      const existing = monthlyMap.get(month) || { revenue: 0, checks: 0 };
      monthlyMap.set(month, {
        revenue: existing.revenue + t.amount,
        checks: existing.checks + (t.checksCount || 1),
      });
    });

    const dailyAggregates = Array.from(dailyMap.values());
    const dailyRevenues = dailyAggregates.map((entry) => entry.revenue);
    const dailyChecksCounts = dailyAggregates.map((entry) => entry.checks);
    const revenueThresholds = buildRevenueThresholds(dailyRevenues);
    const checksThresholds = buildChecksThresholds(dailyChecksCounts);

    // Calculate monthly average checks for each month
    const monthlyAvgChecks = new Map<string, number>();
    monthlyMap.forEach((data, month) => {
      monthlyAvgChecks.set(month, data.checks > 0 ? data.revenue / data.checks : 0);
    });

    // Map transactions with metrics
    return transactions.map((t) => {
      const day = format(startOfDay(new Date(t.date)), 'yyyy-MM-dd');
      const month = format(startOfMonth(new Date(t.date)), 'yyyy-MM');
      const dayMetrics = dailyMap.get(day);
      const dailyChecksCount = dayMetrics?.checks || 0;
      const dailyRevenue = dayMetrics?.revenue || 0;
      const dailyAvgCheck = dailyAvgChecks.get(day) || 0;
      const monthlyAvgCheck = monthlyAvgChecks.get(month) || 0;
      const deviation =
        monthlyAvgCheck > 0 ? ((dailyAvgCheck - monthlyAvgCheck) / monthlyAvgCheck) * 100 : 0;
      const anomalyTags = classifyDailyAnomalies(dailyRevenue, dailyChecksCount, {
        revenue: revenueThresholds,
        checks: checksThresholds,
      });

      return {
        ...t,
        dailyChecksCount,
        dailyAvgCheck,
        deviation,
        anomalyTags,
      };
    });
  }, [transactions]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortDirection(null);
        setSortField('date');
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField, sortDirection]);

  const sortedTransactions = useMemo(() => {
    if (!sortDirection) return transactionsWithMetrics;

    return [...transactionsWithMetrics].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case 'date':
          aVal = new Date(a.date).getTime();
          bVal = new Date(b.date).getTime();
          break;
        case 'amount':
          aVal = Number(a.amount);
          bVal = Number(b.amount);
          break;
        case 'dailyChecks':
          aVal = a.dailyChecksCount;
          bVal = b.dailyChecksCount;
          break;
        case 'dailyAvgCheck':
          aVal = a.dailyAvgCheck;
          bVal = b.dailyAvgCheck;
          break;
        case 'deviation':
          aVal = a.deviation;
          bVal = b.deviation;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [transactionsWithMetrics, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 opacity-50" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="w-4 h-4" />;
    }
    return <ArrowDown className="w-4 h-4" />;
  };

  return (
    <Card className="overflow-hidden" data-testid="table-transactions">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-muted border-b border-border">
            <tr>
              <th className="text-left p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSort('date')}
                  className="font-semibold hover-elevate gap-2"
                  data-testid="button-sort-date"
                >
                  Дата
                  <SortIcon field="date" />
                </Button>
              </th>
              <th className="text-right p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSort('amount')}
                  className="font-semibold hover-elevate gap-2 ml-auto"
                  data-testid="button-sort-amount"
                >
                  Сумма
                  <SortIcon field="amount" />
                </Button>
              </th>
              <th className="text-right p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSort('dailyChecks')}
                  className="font-semibold hover-elevate gap-2 ml-auto"
                  data-testid="button-sort-daily-checks"
                >
                  Кол-во чеков
                  <SortIcon field="dailyChecks" />
                </Button>
              </th>
              <th className="text-right p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSort('dailyAvgCheck')}
                  className="font-semibold hover-elevate gap-2 ml-auto"
                  data-testid="button-sort-daily-avg-check"
                >
                  Средний чек за день
                  <SortIcon field="dailyAvgCheck" />
                </Button>
              </th>
              <th className="text-right p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSort('deviation')}
                  className="font-semibold hover-elevate gap-2 ml-auto"
                  data-testid="button-sort-deviation"
                >
                  % отклонения
                  <SortIcon field="deviation" />
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTransactions.map((transaction, index) => (
              <tr
                key={transaction.id}
                className={`border-b border-border last:border-0 hover-elevate ${getRowHighlightClass(transaction.anomalyTags)}`}
                data-testid={`row-transaction-${index}`}
              >
                <td className="p-4 text-sm" data-testid={`cell-date-${index}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      {new Intl.DateTimeFormat('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(transaction.date))}
                    </span>
                    {transaction.anomalyTags.map((tag) => {
                      const badge = anomalyBadgeConfig[tag];
                      return (
                        <span
                          key={tag}
                          className={`text-[11px] uppercase tracking-wide font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td
                  className="p-4 text-sm font-mono text-right tabular-nums"
                  data-testid={`cell-amount-${index}`}
                >
                  {new Intl.NumberFormat('ru-RU', {
                    style: 'currency',
                    currency: 'RUB',
                    minimumFractionDigits: 0,
                  }).format(transaction.amount)}
                </td>
                <td
                  className="p-4 text-sm font-mono text-right tabular-nums"
                  data-testid={`cell-daily-checks-${index}`}
                >
                  {transaction.dailyChecksCount.toLocaleString('ru-RU')}
                </td>
                <td
                  className="p-4 text-sm font-mono text-right tabular-nums"
                  data-testid={`cell-daily-avg-check-${index}`}
                >
                  {new Intl.NumberFormat('ru-RU', {
                    style: 'currency',
                    currency: 'RUB',
                    minimumFractionDigits: 0,
                  }).format(transaction.dailyAvgCheck)}
                </td>
                <td
                  className={`p-4 text-sm font-mono text-right tabular-nums ${
                    transaction.deviation > 0
                      ? 'text-green-600 dark:text-green-400'
                      : transaction.deviation < 0
                        ? 'text-red-600 dark:text-red-400'
                        : ''
                  }`}
                  data-testid={`cell-deviation-${index}`}
                >
                  {transaction.deviation > 0 ? '+' : ''}
                  {transaction.deviation.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedTransactions.length === 0 && (
        <div className="p-8 text-center text-muted-foreground" data-testid="empty-state">
          <p>Нет данных для отображения</p>
        </div>
      )}
    </Card>
  );
}

export const DataTable = memo(DataTableComponent);
