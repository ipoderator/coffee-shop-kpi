import React from 'react';

interface KpiLineChartsProps {
  period: { from: string; to: string };
}

export const KpiLineCharts: React.FC<KpiLineChartsProps> = ({ period }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
    <div className="bg-white border rounded p-3 min-h-[180px] flex items-center justify-center">
      [График: Выручка по дням]
    </div>
    <div className="bg-white border rounded p-3 min-h-[180px] flex items-center justify-center">
      [График: Чеки по дням]
    </div>
    <div className="bg-white border rounded p-3 min-h-[180px] flex items-center justify-center">
      [График: Средний чек по дням]
    </div>
    <div className="bg-white border rounded p-3 min-h-[180px] flex items-center justify-center">
      [График: Валовая прибыль по дням]
    </div>
    <div className="bg-white border rounded p-3 min-h-[180px] flex items-center justify-center">
      [График: Маржа % по дням]
    </div>
  </div>
);
