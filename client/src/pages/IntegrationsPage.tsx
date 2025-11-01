import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import UploadTrainingDataButton from '@/components/UploadTrainingDataButton';

export default function IntegrationsPage() {
  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <Card className="bg-card/80 backdrop-blur-sm border-primary/20 shadow-md">
        <CardHeader>
          <CardTitle>Интеграции</CardTitle>
          <CardDescription>
            Загрузите Excel-файл с историей продаж, чтобы пересчитать ML-модель выручки напрямую из
            интеграционного сервиса.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            После загрузки файл попадет в серверную папку интеграций, будет запущен скрипт обучения
            и обновится <span className="font-medium text-primary">salesModel.json</span>. Проверьте
            логи сервера, чтобы убедиться, что обучение прошло успешно.
          </p>
        </CardContent>
      </Card>

      <UploadTrainingDataButton />
    </div>
  );
}
