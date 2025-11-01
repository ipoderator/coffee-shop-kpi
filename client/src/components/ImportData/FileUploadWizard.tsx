import React from 'react';

interface FileUploadWizardProps {
  isUploading: boolean;
  setIsUploading: (val: boolean) => void;
  onImportLog: (log: string[]) => void;
  onPreview: (rows: any[]) => void;
}

export const FileUploadWizard: React.FC<FileUploadWizardProps> = ({
  isUploading,
  setIsUploading,
  onImportLog,
  onPreview,
}) => {
  // Пока заглушка
  return (
    <div className="border rounded-md p-4 bg-white flex flex-col gap-4">
      <p className="text-sm">[Здесь будет загрузка файла, обработка и прогресс-лог]</p>
      <button
        disabled={isUploading}
        className="btn btn-primary px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60"
        onClick={() => {
          setIsUploading(true);
          setTimeout(() => {
            onPreview([{ mock: 'row1' }, { mock: 'row2' }]);
            onImportLog(['Импорт завершён успешно (заглушка).']);
            setIsUploading(false);
          }, 1000);
        }}
      >
        Загрузить файл (заглушка)
      </button>
    </div>
  );
};
