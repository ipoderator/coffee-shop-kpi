import { ChangeEvent, useMemo, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ForecastTurnoverResponse {
  success: boolean;
  predictions?: number[];
  message?: string;
}

export function UploadTurnoverButton() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<number[]>([]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      setSelectedFile(null);
      return;
    }

    setPredictions([]);
    setError(null);
    setSelectedFile(event.target.files[0]);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Пожалуйста, выберите файл Excel с обороткой.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/ml/forecast-turnover', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const payload = (await response.json()) as ForecastTurnoverResponse;

      if (!response.ok || !payload.success) {
        throw new Error(payload.message || 'Не удалось получить прогноз.');
      }

      setPredictions(Array.isArray(payload.predictions) ? payload.predictions : []);
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : 'Произошла неизвестная ошибка при загрузке файла.';
      setError(message);
      setPredictions([]);
    } finally {
      setIsUploading(false);
    }
  };

  const summary = useMemo(() => {
    if (predictions.length === 0) {
      return null;
    }

    const total = predictions.reduce((sum, value) => sum + value, 0);
    const average = total / predictions.length;

    return {
      total,
      average,
      min: Math.min(...predictions),
      max: Math.max(...predictions),
    };
  }, [predictions]);

  return (
    <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-md">
      <CardHeader>
        <CardTitle>Загрузить оборотку</CardTitle>
        <CardDescription>
          Импортируйте Excel-файл, чтобы получить прогноз выручки от ML-модели.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="turnover-upload">
              Файл с оборотом (.xlsx, .xls)
            </label>
            <input
              id="turnover-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="text-sm file:mr-4 file:rounded-md file:border file:border-primary/40 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
              disabled={isUploading}
            />
            {selectedFile && (
              <span className="text-xs text-muted-foreground">Выбрано: {selectedFile.name}</span>
            )}
          </div>

          <Button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || !selectedFile}
            className="md:self-start"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <UploadCloud className="mr-2 h-4 w-4" />
                Загрузить оборотку
              </>
            )}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {summary && (
          <div className="grid gap-3 rounded-lg border border-primary/10 bg-muted/30 p-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Всего прогноз</p>
              <p className="text-base font-semibold">{summary.total.toLocaleString('ru-RU')} ₽</p>
            </div>
            <div>
              <p className="text-muted-foreground">Среднее значение</p>
              <p className="text-base font-semibold">
                {summary.average.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Минимум</p>
              <p className="text-base font-semibold">{summary.min.toLocaleString('ru-RU')} ₽</p>
            </div>
            <div>
              <p className="text-muted-foreground">Максимум</p>
              <p className="text-base font-semibold">{summary.max.toLocaleString('ru-RU')} ₽</p>
            </div>
          </div>
        )}

        {predictions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Прогноз по периодам</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">#</TableHead>
                  <TableHead>Прогнозируемая выручка</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.map((prediction, index) => (
                  <TableRow key={`${prediction}-${index}`}>
                    <TableCell className="font-medium">Период {index + 1}</TableCell>
                    <TableCell>{prediction.toLocaleString('ru-RU')} ₽</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UploadTurnoverButton;
