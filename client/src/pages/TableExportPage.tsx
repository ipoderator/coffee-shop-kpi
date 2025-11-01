import { DataByDaysTable } from '@/components/TableExport/DataByDaysTable';
import { ExportButtons } from '@/components/TableExport/ExportButtons';

export default function TableExportPage() {
  return (
    <div className="container mx-auto py-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold mb-4">Отчёт по дням — данные и экспорт</h1>
      <div className="flex justify-end mb-2">
        <ExportButtons />
      </div>
      <DataByDaysTable />
    </div>
  );
}
