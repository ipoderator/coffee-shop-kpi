import { FileUploadWizard } from '@/components/ImportData/FileUploadWizard';
import { ImportBatchTable } from '@/components/ImportData/ImportBatchTable';
import { ParsedDataPreview } from '@/components/ImportData/ParsedDataPreview';
import { useState } from 'react';

export default function ImportDataPage() {
  // Заглушки для пропсов
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  return (
    <div className="container mx-auto py-8 flex flex-col gap-8">
      <h1 className="text-2xl font-bold mb-4">Импорт данных Z-отчётов и себестоимости</h1>

      {/* Блок загрузки и прогресса */}
      <FileUploadWizard
        isUploading={isUploading}
        setIsUploading={setIsUploading}
        onImportLog={setImportLog}
        onPreview={setPreviewRows}
      />

      {/* Блок: Журнал недавних импортов */}
      <ImportBatchTable />

      {/* Блок: Preview данных */}
      <ParsedDataPreview rows={previewRows} errors={[]} />

      {/* Лог результата */}
      {importLog.length > 0 && (
        <div className="bg-gray-100 border rounded p-4 mt-4">
          <h2 className="font-semibold mb-2">Лог загрузки</h2>
          <ul className="space-y-1 text-xs">
            {importLog.map((log, i) => (
              <li key={i}>{log}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
