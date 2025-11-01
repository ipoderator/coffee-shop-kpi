import React from 'react';

interface DayRow {
  date: string;
  receipts: number;
  revenueCash: number;
  revenueCashless: number;
  refundCash: number;
  refundCashless: number;
  corrCash: number;
  corrCashless: number;
  revenueNet: number;
  avgCheck: number;
  cogs?: number; // способы динамически скрыть столбцы
  grossProfit?: number;
  grossMarginPct?: number;
}

const demoData: DayRow[] = [
  {
    date: '2025-10-25',
    receipts: 20,
    revenueCash: 10000,
    revenueCashless: 8000,
    refundCash: 200,
    refundCashless: 100,
    corrCash: 0,
    corrCashless: 50,
    revenueNet: 17750,
    avgCheck: 887.5,
    cogs: 8000,
    grossProfit: 9750,
    grossMarginPct: 0.55,
  },
  {
    date: '2025-10-26',
    receipts: 17,
    revenueCash: 9000,
    revenueCashless: 9500,
    refundCash: 0,
    refundCashless: 0,
    corrCash: 0,
    corrCashless: 0,
    revenueNet: 18500,
    avgCheck: 1088.2,
  },
];

// Есть ли COGS/GP в данных?
const showCogs = demoData.some((row) => row.cogs !== undefined);
const showGp = demoData.some((row) => row.grossProfit !== undefined);
const showMargin = demoData.some((row) => row.grossMarginPct !== undefined);

export const DataByDaysTable: React.FC = () => (
  <div className="overflow-auto border rounded-md bg-white p-2">
    <table className="min-w-[950px] text-[13px] border">
      <thead>
        <tr>
          <th className="border p-1">Дата</th>
          <th className="border p-1">Чеки</th>
          <th className="border p-1">Выручка нал</th>
          <th className="border p-1">Выручка безнал</th>
          <th className="border p-1">Возврат нал</th>
          <th className="border p-1">Возврат безнал</th>
          <th className="border p-1">Коррекция нал</th>
          <th className="border p-1">Коррекция безнал</th>
          <th className="border p-1">Выручка чистая</th>
          <th className="border p-1">Средний чек</th>
          {showCogs && <th className="border p-1">COGS</th>}
          {showGp && <th className="border p-1">Валовая прибыль</th>}
          {showMargin && <th className="border p-1">Маржа %</th>}
        </tr>
      </thead>
      <tbody>
        {demoData.map((row, i) => (
          <tr key={i} className="even:bg-gray-50">
            <td className="border p-1 whitespace-nowrap">{row.date}</td>
            <td className="border p-1 text-center">{row.receipts}</td>
            <td className="border p-1 text-right">{row.revenueCash.toLocaleString()}</td>
            <td className="border p-1 text-right">{row.revenueCashless.toLocaleString()}</td>
            <td className="border p-1 text-right text-rose-700">{row.refundCash}</td>
            <td className="border p-1 text-right text-rose-700">{row.refundCashless}</td>
            <td className="border p-1 text-right text-blue-700">{row.corrCash}</td>
            <td className="border p-1 text-right text-blue-700">{row.corrCashless}</td>
            <td className="border p-1 text-right font-semibold">{row.revenueNet}</td>
            <td className="border p-1 text-right">{row.avgCheck}</td>
            {showCogs && <td className="border p-1 text-right">{row.cogs?.toLocaleString()}</td>}
            {showGp && (
              <td className="border p-1 text-right text-green-800">
                {row.grossProfit?.toLocaleString()}
              </td>
            )}
            {showMargin && (
              <td className="border p-1 text-right">
                {row.grossMarginPct !== undefined ? (row.grossMarginPct * 100).toFixed(1) : ''}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
