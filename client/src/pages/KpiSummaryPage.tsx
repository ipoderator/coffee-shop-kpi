import { useState } from 'react';
import { KpiCard } from '@/components/KPI/KpiCard';
import { DateRangeSelector } from '@/components/KPI/DateRangeSelector';
import { KpiLineCharts } from '@/components/KPI/KpiLineCharts';

export default function KpiSummaryPage() {
  // Общий выбранный период для всех графиков и метрик
  const [period, setPeriod] = useState<{ from: string; to: string }>({ from: '', to: '' });

  // Заглушка по метрикам (потом получим из api)
  const mockKpi = {
    revenue: 123456,
    receipts: 234,
    avgCheck: 527.3,
    refunds: 1_230,
    grossProfit: 50_000,
    grossMargin: 0.41,
  };

  return (
    <div className="container mx-auto py-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold mb-4">Сводка KPI (Z-отчёты + COGS)</h1>

      {/* Селектор периода + KPI карточки (группировка) */}
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <DateRangeSelector period={period} setPeriod={setPeriod} />
        <div className="flex flex-wrap gap-2">
          <KpiCard label="Чистая выручка" value={mockKpi.revenue} />
          <KpiCard label="Чеки" value={mockKpi.receipts} />
          <KpiCard label="Средний чек" value={mockKpi.avgCheck} />
          <KpiCard label="Возвраты" value={mockKpi.refunds} />
          <KpiCard label="Валовая прибыль" value={mockKpi.grossProfit} />
          <KpiCard label="Маржа %" value={mockKpi.grossMargin * 100} />
        </div>
      </div>

      {/* Линии-графики */}
      <KpiLineCharts period={period} />
    </div>
  );
}
