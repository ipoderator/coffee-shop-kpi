import { Fragment, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  ProfitabilityAnalyticsResponse,
  ProfitabilityDatasetInfo,
  ProfitabilityImportLogEntry,
  ProfitabilityUploadResponse,
} from '@shared/schema';
import { FileUpload } from '@/components/FileUpload';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/hooks/use-toast';
import { Calendar } from '@/components/ui/calendar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ProfitabilityTrendChart } from '@/components/ProfitabilityTrendChart';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DateRange } from 'react-day-picker';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

function getInitialRange(): DateRange | undefined {
  const stored = localStorage.getItem('profitability-date-range');
  if (!stored) return undefined;
  try {
    const parsed = JSON.parse(stored) as { from?: string; to?: string };
    return {
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };
  } catch {
    return undefined;
  }
}

export default function ProfitabilityPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(() => {
    const stored = localStorage.getItem('profitability-dataset-id');
    return stored || null;
  });
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => getInitialRange());
  const [isUploading, setIsUploading] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'kpi' | 'tables'>('import');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const datasetsQuery = useQuery({
    queryKey: ['profitability', 'datasets'],
    queryFn: async (): Promise<ProfitabilityDatasetInfo[]> => {
      const res = await fetch('/api/profitability/datasets');
      if (!res.ok) {
        throw new Error('Не удалось загрузить список наборов данных');
      }
      const json = await res.json();
      return json.datasets as ProfitabilityDatasetInfo[];
    },
  });

  const importLogsQuery = useQuery({
    queryKey: ['profitability', 'importLogs'],
    queryFn: async (): Promise<ProfitabilityImportLogEntry[]> => {
      const res = await fetch('/api/profitability/import-logs');
      if (!res.ok) {
        throw new Error('Не удалось загрузить журнал импортов');
      }
      const json = await res.json();
      return (json.logs as ProfitabilityImportLogEntry[]) ?? [];
    },
  });

  useEffect(() => {
    if (!datasetsQuery.data || datasetsQuery.data.length === 0) {
      setSelectedDatasetId(null);
      localStorage.removeItem('profitability-dataset-id');
      return;
    }

    if (selectedDatasetId) {
      const exists = datasetsQuery.data.some((dataset) => dataset.id === selectedDatasetId);
      if (!exists) {
        const fallbackId = datasetsQuery.data[0].id;
        setSelectedDatasetId(fallbackId);
        localStorage.setItem('profitability-dataset-id', fallbackId);
      }
      return;
    }

    const firstId = datasetsQuery.data[0].id;
    setSelectedDatasetId(firstId);
    localStorage.setItem('profitability-dataset-id', firstId);
  }, [datasetsQuery.data, selectedDatasetId]);

  useEffect(() => {
    if (dateRange?.from || dateRange?.to) {
      localStorage.setItem(
        'profitability-date-range',
        JSON.stringify({
          from: dateRange.from?.toISOString(),
          to: dateRange.to?.toISOString(),
        }),
      );
    } else {
      localStorage.removeItem('profitability-date-range');
    }
  }, [dateRange]);

  const analyticsQuery = useQuery({
    queryKey: [
      'profitability',
      'analytics',
      selectedDatasetId,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
    ],
    enabled: Boolean(selectedDatasetId),
    queryFn: async (): Promise<ProfitabilityAnalyticsResponse> => {
      if (!selectedDatasetId) {
        throw new Error('Набор данных не выбран');
      }

      const params = new URLSearchParams();
      if (dateRange?.from) {
        params.set('from', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        params.set('to', dateRange.to.toISOString());
      }

      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(`/api/profitability/${selectedDatasetId}${suffix}`);
      if (!res.ok) {
        throw new Error('Не удалось получить аналитические данные');
      }
      return (await res.json()) as ProfitabilityAnalyticsResponse;
    },
  });

  const analytics = analyticsQuery.data;
  const datasets = datasetsQuery.data ?? [];
  const logs = importLogsQuery.data ?? [];

  const chartData = useMemo(() => analytics?.daily ?? [], [analytics]);
  const datasetNameById = useMemo(() => {
    const map = new Map<string, string>();
    datasets.forEach((dataset) => {
      map.set(dataset.id, dataset.name);
    });
    return map;
  }, [datasets]);

  useEffect(() => {
    if (expandedLogId && !logs.some((log) => log.id === expandedLogId)) {
      setExpandedLogId(null);
    }
  }, [expandedLogId, logs]);

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);
    let responseBody: any = null;
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/profitability/upload', {
        method: 'POST',
        body: formData,
      });

      responseBody = await res.json().catch(() => null);

      if (!res.ok || !responseBody || responseBody.success !== true) {
        const errorMessage = responseBody?.error || 'Не удалось импортировать Z-отчеты';
        throw new Error(errorMessage);
      }

      const response = responseBody as ProfitabilityUploadResponse;
      const hasErrors = (response.errors?.length ?? 0) > 0;
      const hasWarnings = (response.warnings?.length ?? 0) > 0;

      toast({
        title: hasErrors
          ? 'Импорт завершён с ошибками'
          : hasWarnings
            ? 'Импорт завершён с предупреждениями'
            : 'Импорт завершён',
        description: [
          `Загружено строк: ${response.rowsProcessed}`,
          hasWarnings ? 'Есть предупреждения. Проверьте журнал импортов.' : null,
          hasErrors ? 'Некоторые строки были пропущены.' : null,
        ]
          .filter(Boolean)
          .join('\n'),
        variant: hasErrors ? 'destructive' : undefined,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profitability', 'datasets'] }),
        queryClient.invalidateQueries({ queryKey: ['profitability', 'importLogs'] }),
      ]);

      setSelectedDatasetId(response.dataset.id);
      localStorage.setItem('profitability-dataset-id', response.dataset.id);
      setExpandedLogId(response.log.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось обработать файл';
      const warningsHint =
        Array.isArray(responseBody?.warnings) && responseBody.warnings.length > 0
          ? ' Подробности в журнале импортов.'
          : '';
      toast({
        title: 'Ошибка импорта',
        description: `${message}${warningsHint}`,
        variant: 'destructive',
      });
      await queryClient.invalidateQueries({ queryKey: ['profitability', 'importLogs'] });
      if (responseBody?.log?.id) {
        setExpandedLogId(responseBody.log.id as string);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const formatLogTimestamp = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString('ru-RU', { hour12: false });
  };

  const formatLogPeriod = (log: ProfitabilityImportLogEntry): string => {
    const parseDate = (input?: string) => {
      if (!input) return null;
      const date = new Date(input);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const from = parseDate(log.periodStart);
    const to = parseDate(log.periodEnd);

    if (!from && !to) {
      return '—';
    }

    if (from && to) {
      const fromStr = from.toLocaleDateString('ru-RU');
      const toStr = to.toLocaleDateString('ru-RU');
      return fromStr === toStr ? fromStr : `${fromStr} — ${toStr}`;
    }

    const single = from ?? to;
    return single ? single.toLocaleDateString('ru-RU') : '—';
  };

  const statusStyles: Record<
    ProfitabilityImportLogEntry['status'],
    { label: string; className: string }
  > = {
    success: {
      label: 'Успех',
      className: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700',
    },
    partial: {
      label: 'Частично',
      className: 'border border-amber-500/20 bg-amber-500/10 text-amber-700',
    },
    failed: {
      label: 'Ошибка',
      className: 'border border-destructive/30 bg-destructive/10 text-destructive',
    },
  };

  const handleDatasetChange = (datasetId: string) => {
    setSelectedDatasetId(datasetId);
    localStorage.setItem('profitability-dataset-id', datasetId);
  };

  const resetFilters = () => {
    setDateRange(undefined);
  };

  const handleExport = async (format: 'csv' | 'pdf') => {
    if (!selectedDatasetId) {
      return;
    }

    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (dateRange?.from) params.set('from', dateRange.from.toISOString());
      if (dateRange?.to) params.set('to', dateRange.to.toISOString());
      const suffix = params.size > 0 ? `?${params.toString()}` : '';

      const res = await fetch(`/api/profitability/${selectedDatasetId}/export.${format}${suffix}`);
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Не удалось подготовить файл');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const dataset = datasets.find((item) => item.id === selectedDatasetId);
      const filename = dataset
        ? `profitability-${dataset.name}.${format}`
        : `profitability-report.${format}`;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: 'Ошибка экспорта',
        description: error instanceof Error ? error.message : 'Не удалось скачать отчет',
        variant: 'destructive',
      });
    } finally {
      setExporting(null);
    }
  };

  const renderDatasetInfo = () => {
    if (!selectedDatasetId) {
      return (
        <Card className="p-6">
          <p className="text-muted-foreground">
            Загрузите файл Z-отчетов, чтобы начать работу с модулем рентабельности.
          </p>
        </Card>
      );
    }

    const dataset = datasets.find((item) => item.id === selectedDatasetId);
    if (!dataset) return null;

    return (
      <Card className="p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Текущий набор данных</p>
            <h3 className="text-xl font-semibold mt-1">{dataset.name}</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Период: {new Date(dataset.periodStart).toLocaleDateString('ru-RU')} —{' '}
              {new Date(dataset.periodEnd).toLocaleDateString('ru-RU')}
            </p>
            <p className="text-sm text-muted-foreground">Количество строк: {dataset.rows}</p>
            {dataset.sourceFile && (
              <p className="text-sm text-muted-foreground">Источник: {dataset.sourceFile}</p>
            )}
          </div>
          <div className="flex gap-3 flex-wrap">
            <Select value={selectedDatasetId} onValueChange={handleDatasetChange}>
              <SelectTrigger className="w-60">
                <SelectValue placeholder="Выберите набор данных" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  <CalendarRange className="w-4 h-4" />
                  {dateRange?.from
                    ? `${dateRange.from.toLocaleDateString('ru-RU')} ${
                        dateRange.to ? `— ${dateRange.to.toLocaleDateString('ru-RU')}` : ''
                      }`
                    : 'Фильтр по датам'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="range"
                  selected={dateRange}
                  onSelect={(range) => setDateRange(range)}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              onClick={resetFilters}
              className="flex items-center gap-2"
              disabled={!dateRange?.from && !dateRange?.to}
            >
              <RefreshCcw className="w-4 h-4" />
              Сбросить
            </Button>
          </div>
        </div>
      </Card>
    );
  };

  const hasDatasetSelected = Boolean(
    selectedDatasetId && datasets.some((item) => item.id === selectedDatasetId),
  );

  const datasetsErrorMessage =
    datasetsQuery.isError && datasetsQuery.error instanceof Error
      ? datasetsQuery.error.message
      : datasetsQuery.isError
        ? 'Не удалось загрузить список наборов данных'
        : null;

  const analyticsErrorMessage =
    analyticsQuery.isError && analyticsQuery.error instanceof Error
      ? analyticsQuery.error.message
      : analyticsQuery.isError
        ? 'Не удалось рассчитать показатели'
        : null;

  const showNoDatasetsMessage = !datasetsQuery.isLoading && (datasetsQuery.data?.length ?? 0) === 0;

  return (
    <div className="container mx-auto px-4 md:px-8 lg:px-12 py-8 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="space-y-2"
      >
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-chart-3 to-foreground bg-clip-text text-transparent">
          Рентабельность
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Анализ Z-отчетов: чистая выручка, возвраты, доля наличных и динамика показателей.
          Импортируйте данные и следите за эффективностью смен.
        </p>
      </motion.div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'import' | 'kpi' | 'tables')}
        className="space-y-6"
      >
        <TabsList className="grid w-full sm:w-auto grid-cols-1 sm:grid-cols-3 gap-1 rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="import" className="text-sm sm:text-base">
            Импорт данных
          </TabsTrigger>
          <TabsTrigger value="kpi" className="text-sm sm:text-base">
            Сводка KPI
          </TabsTrigger>
          <TabsTrigger value="tables" className="text-sm sm:text-base">
            Таблицы и экспорт
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-6 focus-visible:outline-none">
          <motion.div
            className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-2">Импорт Z-отчетов</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Загрузите Excel файл с листом «Z-отчеты». Первая строка должна содержать заголовки
                колонок.
              </p>
              <FileUpload onFileSelect={handleFileSelect} isProcessing={isUploading} />
            </Card>

            {renderDatasetInfo()}
          </motion.div>

          {datasetsQuery.isLoading && (
            <Card className="p-6">
              <p className="text-muted-foreground">Загружаем наборы данных...</p>
            </Card>
          )}

          {datasetsErrorMessage && (
            <Card className="p-6">
              <p className="text-destructive">{datasetsErrorMessage}</p>
            </Card>
          )}

          {showNoDatasetsMessage && (
            <Card className="p-6">
              <p className="text-muted-foreground">
                Пока нет загруженных наборов данных. Импортируйте Z-отчеты, чтобы увидеть показатели
                рентабельности.
              </p>
            </Card>
          )}

          <Card className="p-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Журнал импортов</h3>
                  <p className="text-sm text-muted-foreground">
                    История загрузок файлов Z-отчетов и результатов обработки.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => importLogsQuery.refetch()}
                    disabled={importLogsQuery.isFetching}
                  >
                    <RefreshCcw className="w-4 h-4" />
                    Обновить
                  </Button>
                </div>
              </div>

              {importLogsQuery.isLoading ? (
                <p className="text-muted-foreground">Загружаем журнал импортов...</p>
              ) : importLogsQuery.isError ? (
                <p className="text-destructive">
                  Не удалось загрузить журнал импортов. Попробуйте обновить страницу.
                </p>
              ) : logs.length === 0 ? (
                <p className="text-muted-foreground">
                  Журнал пуст. После импорта файлов здесь появится история загрузок и сообщений об
                  ошибках.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Время</TableHead>
                        <TableHead>Статус</TableHead>
                        <TableHead>Файл</TableHead>
                        <TableHead>Набор данных</TableHead>
                        <TableHead>Период</TableHead>
                        <TableHead>Строк</TableHead>
                        <TableHead>Автор</TableHead>
                        <TableHead>Ошибки / Предупреждения</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => {
                        const errorCount = log.errors?.length ?? 0;
                        const warningCount = log.warnings?.length ?? 0;
                        const statusStyle = statusStyles[log.status];
                        const datasetName =
                          (log.datasetId && datasetNameById.get(log.datasetId)) || '—';

                        return (
                          <Fragment key={log.id}>
                            <TableRow>
                              <TableCell className="whitespace-nowrap">
                                {formatLogTimestamp(log.createdAt)}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={statusStyle.className}>
                                  {statusStyle.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {log.sourceFile ?? '—'}
                              </TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {datasetName}
                              </TableCell>
                              <TableCell>{formatLogPeriod(log)}</TableCell>
                              <TableCell>{log.rowsProcessed}</TableCell>
                              <TableCell>{log.author ?? '—'}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Badge
                                    variant="outline"
                                    className="border border-destructive/30 bg-destructive/10 text-destructive"
                                  >
                                    {errorCount}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className="border border-amber-500/20 bg-amber-500/10 text-amber-700"
                                  >
                                    {warningCount}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="flex items-center gap-1"
                                  onClick={() =>
                                    setExpandedLogId(expandedLogId === log.id ? null : log.id)
                                  }
                                >
                                  {expandedLogId === log.id ? (
                                    <ChevronUp className="w-4 h-4" />
                                  ) : (
                                    <ChevronDown className="w-4 h-4" />
                                  )}
                                  {expandedLogId === log.id ? 'Скрыть' : 'Подробнее'}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expandedLogId === log.id && (
                              <TableRow className="bg-muted/40">
                                <TableCell colSpan={9}>
                                  <div className="space-y-3">
                                    {errorCount > 0 && (
                                      <div>
                                        <p className="font-semibold text-destructive">Ошибки</p>
                                        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                                          {log.errors?.map((entry, index) => (
                                            <li key={`${log.id}-error-${index}`}>
                                              {entry.rowNumber ? `Строка ${entry.rowNumber}: ` : ''}
                                              {entry.message}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {warningCount > 0 && (
                                      <div>
                                        <p className="font-semibold text-amber-600">
                                          Предупреждения
                                        </p>
                                        <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                                          {log.warnings?.map((warning, index) => (
                                            <li key={`${log.id}-warning-${index}`}>{warning}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {errorCount === 0 && warningCount === 0 && (
                                      <p className="text-sm text-muted-foreground">
                                        Сообщения отсутствуют.
                                      </p>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="kpi" className="space-y-6 focus-visible:outline-none">
          {renderDatasetInfo()}

          {!hasDatasetSelected && !datasetsQuery.isLoading && datasets.length > 0 && (
            <Card className="p-6">
              <p className="text-muted-foreground">
                Выберите набор данных во вкладке «Импорт данных», чтобы просмотреть KPI.
              </p>
            </Card>
          )}

          {hasDatasetSelected && analyticsQuery.isLoading && (
            <Card className="p-6">
              <p className="text-muted-foreground">Рассчитываем KPI...</p>
            </Card>
          )}

          {analyticsErrorMessage && (
            <Card className="p-6">
              <p className="text-destructive">{analyticsErrorMessage}</p>
            </Card>
          )}

          {analytics && (
            <>
              <motion.div
                className="flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <div>
                  <h2 className="text-2xl font-bold">Ключевые показатели</h2>
                  <p className="text-muted-foreground text-sm">
                    Период: {new Date(analytics.period.from).toLocaleDateString('ru-RU')} —{' '}
                    {new Date(analytics.period.to).toLocaleDateString('ru-RU')}
                  </p>
                </div>
              </motion.div>

              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
              >
                <StatCard
                  title="Чистая выручка"
                  value={formatCurrency(analytics.kpi.netRevenue)}
                  icon={<TrendingUp className="w-5 h-5 text-chart-2" />}
                  testId="profitability-net-revenue"
                />
                <StatCard
                  title="Валовая выручка"
                  value={formatCurrency(analytics.kpi.grossRevenue)}
                  icon={<Wallet className="w-5 h-5 text-primary" />}
                  testId="profitability-gross-revenue"
                />
                <StatCard
                  title="Доля возвратов"
                  value={formatPercent(analytics.kpi.returnRate)}
                  icon={<TrendingDown className="w-5 h-5 text-destructive" />}
                  testId="profitability-return-rate"
                />
                <StatCard
                  title="Средний чек"
                  value={formatCurrency(analytics.kpi.averageCheck)}
                  icon={<TrendingUp className="w-5 h-5 text-chart-3" />}
                  testId="profitability-average-check"
                />
              </motion.div>

              <motion.div
                className="grid grid-cols-1 xl:grid-cols-[2.5fr_1.5fr] gap-6"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <ProfitabilityTrendChart data={chartData} />

                <Card className="p-6 space-y-3">
                  <h3 className="text-lg font-semibold">Структура платежей</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Наличные</span>
                      <span className="font-semibold">
                        {formatPercent(analytics.kpi.cashShare)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${analytics.kpi.cashShare * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Безналичные</span>
                      <span className="font-semibold">
                        {formatPercent(analytics.kpi.cashlessShare)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-chart-3"
                        style={{ width: `${analytics.kpi.cashlessShare * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border/50">
                    <p className="text-sm text-muted-foreground">Возвраты</p>
                    <p className="text-lg font-semibold">{formatCurrency(analytics.kpi.returns)}</p>
                    <p className="text-sm text-muted-foreground">
                      Коррекции: {formatCurrency(analytics.kpi.corrections)}
                    </p>
                  </div>
                </Card>
              </motion.div>
            </>
          )}
        </TabsContent>

        <TabsContent value="tables" className="space-y-6 focus-visible:outline-none">
          {renderDatasetInfo()}

          {hasDatasetSelected && analyticsQuery.isLoading && (
            <Card className="p-6">
              <p className="text-muted-foreground">Формируем таблицы...</p>
            </Card>
          )}

          {analyticsErrorMessage && (
            <Card className="p-6">
              <p className="text-destructive">{analyticsErrorMessage}</p>
            </Card>
          )}

          {!hasDatasetSelected && !datasetsQuery.isLoading && (
            <Card className="p-6">
              <p className="text-muted-foreground">
                Импортируйте Z-отчеты и выберите набор данных, чтобы перейти к экспорту.
              </p>
            </Card>
          )}

          {analytics && (
            <>
              <Card className="p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Экспорт отчётов</h3>
                  <p className="text-sm text-muted-foreground">
                    Скачайте сводный CSV или PDF отчёт с учётом выбранного периода.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="flex items-center gap-2"
                    onClick={() => handleExport('csv')}
                    disabled={exporting !== null}
                  >
                    <Download className="w-4 h-4" />
                    {exporting === 'csv' ? 'Экспорт...' : 'Экспорт CSV'}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex items-center gap-2"
                    onClick={() => handleExport('pdf')}
                    disabled={exporting !== null}
                  >
                    <Download className="w-4 h-4" />
                    {exporting === 'pdf' ? 'Экспорт...' : 'Экспорт PDF'}
                  </Button>
                </div>
              </Card>

              <Card className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Валовая выручка</TableHead>
                      <TableHead>Возвраты</TableHead>
                      <TableHead>Коррекции</TableHead>
                      <TableHead>Чистая выручка</TableHead>
                      <TableHead>Чеков прихода</TableHead>
                      <TableHead>Чеков возврата</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.table.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell>{new Date(row.date).toLocaleDateString('ru-RU')}</TableCell>
                        <TableCell>{formatCurrency(row.grossRevenue)}</TableCell>
                        <TableCell>{formatCurrency(row.returns)}</TableCell>
                        <TableCell>{formatCurrency(row.corrections)}</TableCell>
                        <TableCell>{formatCurrency(row.netRevenue)}</TableCell>
                        <TableCell>{row.incomeChecks}</TableCell>
                        <TableCell>{row.returnChecks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
