import React from 'react';

export const ExportButtons: React.FC = () => (
  <div className="flex gap-2">
    <button className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded text-white text-xs font-medium">
      Экспорт CSV
    </button>
    <button className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 rounded text-white text-xs font-medium">
      Экспорт PDF
    </button>
  </div>
);
