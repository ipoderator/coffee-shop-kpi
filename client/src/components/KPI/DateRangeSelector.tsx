import React from 'react';

interface DateRangeSelectorProps {
  period: { from: string; to: string };
  setPeriod: (p: { from: string; to: string }) => void;
}

export const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({ period, setPeriod }) => (
  <div className="flex items-center gap-2 py-2">
    <span className="text-xs font-medium">Период:</span>
    <input
      type="date"
      value={period.from}
      onChange={(e) => setPeriod({ ...period, from: e.target.value })}
      className="border rounded px-2 py-1 text-xs"
    />
    <span>-</span>
    <input
      type="date"
      value={period.to}
      onChange={(e) => setPeriod({ ...period, to: e.target.value })}
      className="border rounded px-2 py-1 text-xs"
    />
  </div>
);
