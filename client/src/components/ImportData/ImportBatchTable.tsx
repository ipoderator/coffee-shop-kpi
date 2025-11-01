import React from 'react';

export const ImportBatchTable: React.FC = () => {
  // Пока заглушка
  const mock = [
    { id: '1', filename: 'z_report_oct.xlsx', status: 'success', rows: 123, date: '2025-10-01' },
    { id: '2', filename: 'cogs_sep.xlsx', status: 'success', rows: 54, date: '2025-09-20' },
  ];

  return (
    <div className="border rounded-md bg-white p-3 mt-4">
      <h2 className="font-semibold mb-2">Последние 10 импортов</h2>
      <table className="w-full text-sm border">
        <thead>
          <tr>
            <th className="p-1 text-left">Файл</th>
            <th className="p-1">Дата</th>
            <th className="p-1">Строк</th>
            <th className="p-1">Статус</th>
          </tr>
        </thead>
        <tbody>
          {mock.map((batch) => (
            <tr key={batch.id} className="even:bg-gray-50">
              <td className="p-1">{batch.filename}</td>
              <td className="p-1 text-center">{batch.date}</td>
              <td className="p-1 text-center">{batch.rows}</td>
              <td
                className={`p-1 text-center ${batch.status === 'success' ? 'text-green-600' : 'text-red-600'}`}
              >
                {batch.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
