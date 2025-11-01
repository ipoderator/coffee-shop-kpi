import React from 'react';

interface KpiCardProps {
  label: string;
  value: number | string;
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value }) => (
  <div className="bg-white border rounded-md p-4 flex flex-col items-center min-w-[120px] shadow-sm">
    <div className="text-gray-600 text-xs uppercase tracking-wide mb-1">{label}</div>
    <div className="font-semibold text-xl text-gray-900">
      {typeof value === 'number'
        ? value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
        : value}
    </div>
  </div>
);
