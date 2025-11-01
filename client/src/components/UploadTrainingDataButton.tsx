import { ChangeEvent, useMemo, useState } from 'react';
import { UploadCloud, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface TrainingResponse {
  success: boolean;
  message?: string;
  modelUpdated?: boolean;
}

type TrainingStatus = 'idle' | 'uploading' | 'training' | 'success' | 'error';

const statusProgress: Record<TrainingStatus, number> = {
  idle: 0,
  uploading: 30,
  training: 70,
  success: 100,
  error: 100,
};

export function UploadTrainingDataButton() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<TrainingStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [completedAt, setCompletedAt] = useState<Date | null>(null);

  const progress = statusProgress[status];
  const isBusy = status === 'uploading' || status === 'training';

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFile(file ?? null);
    setError(null);
    setMessage(null);
    setStatus('idle');
    setStartedAt(null);
    setCompletedAt(null);
  };

  const statusText = useMemo(() => {
    switch (status) {
      case 'uploading':
        return 'Загрузка файла...';
      case 'training':
        return 'Обучаем модель...';
      case 'success':
        return message ?? 'Модель успешно обновлена.';
      case 'error':
        return error ?? 'Ошибка при обучении модели.';
      default:
        return null;
    }
  }, [status, message, error]);

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Пожалуйста, выберите Excel-файл (.xlsx или .xls).');
      setStatus('idle');
      return;
    }

    setError(null);
    setMessage(null);
    setStatus('uploading');
    setStartedAt(new Date());
    setCompletedAt(null);

    const trainingEndpoints = ['/api/integrations/train-sales-model', '/api/ml/train-from-upload'];

    const createFormData = () => {
      const formData = new FormData();
      formData.append('file', selectedFile);
      return formData;
    };

    const sendTrainingRequest = async (): Promise<TrainingResponse> => {
      let lastError: Error | null = null;

      for (let index = 0; index < trainingEndpoints.length; index += 1) {
        const endpoint = trainingEndpoints[index];
        if (index > 0) {
          setStatus('uploading');
        }

        try {
          const requestPromise = fetch(endpoint, {
            method: 'POST',
            body: createFormData(),
            credentials: 'include',
          });

          setStatus('training');

          const response = await requestPromise;
          let payload: TrainingResponse | null = null;

          try {
            payload = (await response.json()) as TrainingResponse;
          } catch (parseError) {
            const message =
              parseError instanceof Error
                ? parseError.message
                : 'Сервер вернул некорректный ответ.';
            throw new Error(message);
          }

          if (!response.ok || !payload?.success) {
            const errorMessage =
              payload?.message || `Не удалось обновить модель (${response.status}).`;
            throw new Error(errorMessage);
          }

          return payload;
        } catch (attemptError) {
          lastError =
            attemptError instanceof Error ? attemptError : new Error('Не удалось обновить модель.');

          console.warn(`[ML][train-upload] Ошибка при обращении к ${endpoint}:`, lastError);
        }
      }

      throw lastError ?? new Error('Не удалось обновить модель.');
    };

    try {
      const payload = await sendTrainingRequest();

      setStatus('success');
      setMessage(payload.message ?? 'Модель успешно обновлена.');
      setSelectedFile(null);
      setCompletedAt(new Date());
    } catch (uploadError) {
      const errorMessage =
        uploadError instanceof Error
          ? uploadError.message
          : 'Произошла неизвестная ошибка при загрузке файла.';
      setError(errorMessage);
      setStatus('error');
      setCompletedAt(new Date());
    }
  };

  return (
    <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-md">
      <CardHeader>
        <CardTitle>Загрузить обучающие данные</CardTitle>
        <CardDescription>
          Отправьте Excel-файл с ежедневной выручкой (минимум 3 месяца), чтобы переобучить
          ML-модель.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="training-upload">
              Файл с историей продаж (.xlsx, .xls)
            </label>
            <input
              id="training-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="text-sm file:mr-4 file:rounded-md file:border file:border-primary/40 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
              disabled={isBusy}
            />
            {selectedFile && (
              <span className="text-xs text-muted-foreground">Выбрано: {selectedFile.name}</span>
            )}
          </div>

          <Button
            type="button"
            onClick={handleUpload}
            disabled={isBusy || !selectedFile}
            className="md:self-start"
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {status === 'uploading' ? 'Отправка...' : 'Обучение...'}
              </>
            ) : (
              <>
                <UploadCloud className="mr-2 h-4 w-4" />
                Загрузить обучающие данные
              </>
            )}
          </Button>
        </div>

        {status !== 'idle' && status !== 'error' && (
          <div className="space-y-2">
            <Progress value={progress} />
            {statusText && (
              <div className="flex items-center gap-2 text-sm">
                {status === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                {isBusy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <span
                  className={status === 'success' ? 'text-emerald-600' : 'text-muted-foreground'}
                >
                  {statusText}
                </span>
              </div>
            )}
          </div>
        )}

        {status === 'error' && error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {message && status === 'success' && <p className="text-sm text-emerald-600">{message}</p>}

        {(startedAt || completedAt) && (
          <div className="rounded-md border border-primary/10 bg-muted/30 p-3 text-xs text-muted-foreground">
            {startedAt && <p>Начато: {startedAt.toLocaleString('ru-RU')}</p>}
            {completedAt && <p>Завершено: {completedAt.toLocaleString('ru-RU')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UploadTrainingDataButton;
