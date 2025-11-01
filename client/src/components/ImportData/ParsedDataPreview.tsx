import React from 'react';

interface ParsedDataPreviewProps {
  rows: any[];
  errors: { rowIdx: number; field?: string; message: string }[];
}

export const ParsedDataPreview: React.FC<ParsedDataPreviewProps> = ({ rows, errors }) => {
  // Заглушка: rows - массив строк, errors - массив ошибок
  // Выделяем цветом строки, где есть ошибка
  // Используем только первые 3 строки и одну ошибку для demo
  const demoRows =
    rows.length > 0
      ? rows
      : [
          { date: '2025-10-01', amount: 1000, receipts: 23 },
          { date: '2025-10-02', amount: 0, receipts: 0 },
          { date: '2025-10-03', amount: 900, receipts: 15 },
        ];
  const demoErrors =
    errors.length > 0
      ? errors
      : [{ rowIdx: 1, field: 'amount', message: 'Сумма должна быть больше 0' }];

  return (
    <div className="border rounded-md bg-white p-3 mt-4">
      <h2 className="font-semibold mb-2">Превью распознанных данных (первые 50 строк)</h2>
      <table className="w-full text-xs border">
        <thead>
          <tr>
            <th className="p-1">Дата</th>
            <th className="p-1">Сумма</th>
            <th className="p-1">Чеков</th>
          </tr>
        </thead>
        <tbody>
          {demoRows.slice(0, 3).map((row, i) => {
            const err = demoErrors.find((e) => e.rowIdx === i);
            return (
              <tr key={i} className={err ? 'bg-red-100 border-red-400 border-2 animate-pulse' : ''}>
                <td className="p-1">{row.date}</td>
                <td className="p-1">{row.amount}</td>
                <td className="p-1">{row.receipts}</td>
                {err && (
                  <td className="text-red-600 text-xs pl-2 italic" colSpan={3}>
                    {err.message}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-gray-500">Ошибки подсвечиваются красным.</div>
    </div>
  );
};
