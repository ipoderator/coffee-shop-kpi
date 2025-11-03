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
  TopProductsResponse,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DateRange } from 'react-day-picker';
import { TopProductsVisualization } from '@/components/TopProductsVisualization';
import { FinancialRecommendations } from '@/components/FinancialRecommendations';
import { RevenueMarginIssues } from '@/components/RevenueMarginIssues';

const formatCurrency = (value: number) => {
  if (!Number.isFinite(value)) return '0 ₽';
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatPercent = (value: number) => {
  if (!Number.isFinite(value)) return '0%';
  return `${(value * 100).toFixed(1)}%`;
};

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
  const [activeTab, setActiveTab] = useState<'import' | 'kpi'>('import');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [productsView, setProductsView] = useState<'top' | 'bottom'>('top');

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
        // Инвалидируем кеш для обновления данных
        queryClient.invalidateQueries({ queryKey: ['profitability', 'top-products'] });
      }
      return;
    }

    const firstId = datasetsQuery.data[0].id;
    setSelectedDatasetId(firstId);
    localStorage.setItem('profitability-dataset-id', firstId);
    // Инвалидируем кеш для обновления данных
    queryClient.invalidateQueries({ queryKey: ['profitability', 'top-products'] });
  }, [datasetsQuery.data, selectedDatasetId, queryClient]);

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

  const topProductsQuery = useQuery({
    queryKey: [
      'profitability',
      'top-products',
      selectedDatasetId,
      dateRange?.from?.toISOString(),
      dateRange?.to?.toISOString(),
    ],
    enabled: Boolean(selectedDatasetId),
    queryFn: async (): Promise<TopProductsResponse> => {
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
      const res = await fetch(`/api/profitability/${selectedDatasetId}/top-products${suffix}`);
      if (!res.ok) {
        throw new Error('Не удалось получить топ-5 позиций');
      }
      return (await res.json()) as TopProductsResponse;
    },
  });

  const analytics = analyticsQuery.data;
  const topProductsData = topProductsQuery.data;
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

      {/* Рекомендации по улучшению финансов */}
      {hasDatasetSelected && analytics && topProductsData && (
        <FinancialRecommendations analytics={analytics} topProductsData={topProductsData} />
      )}

      {/* Недочеты в выручке и марже */}
      {hasDatasetSelected && analytics && (
        <RevenueMarginIssues analytics={analytics} />
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'import' | 'kpi')}
        className="space-y-6"
      >
        <TabsList className="grid w-full sm:w-auto grid-cols-1 sm:grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1">
          <TabsTrigger value="import" className="text-sm sm:text-base">
            Импорт данных
          </TabsTrigger>
          <TabsTrigger value="kpi" className="text-sm sm:text-base">
            Сводка KPI
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
              {/* Итоги периода в хедере */}
              {topProductsData && (
                <motion.div
                  className="space-y-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold">Итоги периода</h2>
                      <p className="text-muted-foreground text-sm">
                        Период: {new Date(analytics.period.from).toLocaleDateString('ru-RU')} —{' '}
                        {new Date(analytics.period.to).toLocaleDateString('ru-RU')}
                      </p>
                    </div>
                  </div>

                  {/* Основные метрики в одном ряду */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard
                      title="Выручка"
                      value={formatCurrency(topProductsData.periodSummary.netRevenue)}
                      icon={<TrendingUp className="w-5 h-5 text-chart-2" />}
                      testId="period-summary-revenue"
                    />
                    <StatCard
                      title="Себестоимость (COGS)"
                      value={formatCurrency(topProductsData.periodSummary.cogs)}
                      icon={<Wallet className="w-5 h-5 text-primary" />}
                      testId="period-summary-cogs"
                    />
                    <StatCard
                      title="Валовая прибыль"
                      value={formatCurrency(topProductsData.periodSummary.grossProfit)}
                      icon={<TrendingUp className="w-5 h-5 text-chart-3" />}
                      testId="period-summary-profit"
                    />
                    <StatCard
                      title="Валовая маржа"
                      value={formatPercent(topProductsData.periodSummary.grossMargin / 100)}
                      icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
                      testId="period-summary-margin"
                    />
                  </div>

                </motion.div>
              )}

              {/* Top-5 / Bottom-5 позиций */}
              {topProductsData && (
                <motion.div
                  className="mt-6"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <Card className="p-6">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold mb-2">
                          {productsView === 'top' 
                            ? 'Топ-5 самых популярных позиций' 
                            : 'Позиции с наименьшей маржой'}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {productsView === 'bottom' 
                            ? 'Позиции с самой низкой валовой маржой прибыли. Отображаются только позиции, которые были проданы более 10 раз за выбранный период.'
                            : 'Самые популярные позиции, отсортированные по количеству продаж за период'}
                        </p>
                        {(dateRange?.from || dateRange?.to) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Период: {dateRange.from
                              ? `${dateRange.from.toLocaleDateString('ru-RU')} ${
                                  dateRange.to ? `— ${dateRange.to.toLocaleDateString('ru-RU')}` : ''
                                }`
                              : dateRange.to
                              ? `до ${dateRange.to.toLocaleDateString('ru-RU')}`
                              : 'Все данные'}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant={productsView === 'top' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setProductsView('top')}
                        >
                          Популярные
                        </Button>
                        <Button
                          variant={productsView === 'bottom' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setProductsView('bottom')}
                        >
                          Низкая маржа
                        </Button>
                      </div>
                    </div>
                    {(productsView === 'top' ? topProductsData.products : topProductsData.bottomProducts).length > 0 ? (
                      <>
                        {/* Графики визуализации */}
                        <div className="mb-6">
                          <TopProductsVisualization
                            products={productsView === 'top' ? topProductsData.products : topProductsData.bottomProducts}
                            viewType={productsView}
                          />
                        </div>

                        {/* Таблица с данными */}
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Наименование</TableHead>
                                <TableHead className="text-right">Кол-во продаж</TableHead>
                                <TableHead className="text-right">Себестоимость (за ед.)</TableHead>
                                <TableHead className="text-right">Средняя цена (за ед.)</TableHead>
                                <TableHead className="text-right">Прибыль (за ед.)</TableHead>
                                <TableHead className="text-right">Маржа (%)</TableHead>
                                <TableHead className="text-right">Совокупная прибыль</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(productsView === 'top' ? topProductsData.products : topProductsData.bottomProducts).map((product, index) => (
                                <TableRow key={index}>
                                  <TableCell className="font-medium">{product.itemName}</TableCell>
                                  <TableCell className="text-right">
                                    <Badge variant="secondary" className="font-mono">
                                      {product.salesCount ?? 0}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right">{formatCurrency(product.unitCost)}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(product.averagePrice)}</TableCell>
                                  <TableCell className={`text-right ${productsView === 'bottom' && product.averageProfit < 0 ? 'text-destructive' : ''}`}>
                                    {formatCurrency(product.averageProfit)}
                                  </TableCell>
                                  <TableCell className={`text-right ${productsView === 'bottom' && product.averageMargin < 0 ? 'text-destructive' : ''}`}>
                                    {formatPercent(product.averageMargin / 100)}
                                  </TableCell>
                                  <TableCell className={`text-right font-semibold ${productsView === 'bottom' && product.totalProfit < 0 ? 'text-destructive' : ''}`}>
                                    {formatCurrency(product.totalProfit)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-8">
                        <p className="text-sm text-muted-foreground mb-2">
                          {productsView === 'bottom' 
                            ? 'Нет позиций с низкой маржой для отображения' 
                            : 'Нет данных для отображения'}
                        </p>
                        {productsView === 'bottom' && (
                          <p className="text-xs text-muted-foreground">
                            Для отображения позиций с низкой маржой необходимо, чтобы они были проданы более 10 раз за выбранный период. Попробуйте выбрать другой период или убедитесь, что в данных есть такие позиции.
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                </motion.div>
              )}

              {/* Негативная маржа */}
              {topProductsData && topProductsData.negativeMarginProducts.length > 0 && (
                <motion.div
                  className="mt-6"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Card className="p-6 border-2 border-destructive/20 bg-destructive/5">
                    <h3 className="text-lg font-semibold mb-4 text-destructive">
                      Негативная маржа (GP &lt; 0)
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Позиции с отрицательной валовой прибылью. Проверьте цены, себестоимость или акции.
                    </p>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Наименование</TableHead>
                            <TableHead className="text-right">Себестоимость (за ед.)</TableHead>
                            <TableHead className="text-right">Средняя цена (за ед.)</TableHead>
                            <TableHead className="text-right">Прибыль (за ед.)</TableHead>
                            <TableHead className="text-right">Маржа (%)</TableHead>
                            <TableHead className="text-right">Совокупная прибыль</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {topProductsData.negativeMarginProducts.map((product, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-medium">{product.itemName}</TableCell>
                              <TableCell className="text-right">{formatCurrency(product.unitCost)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(product.averagePrice)}</TableCell>
                              <TableCell className="text-right text-destructive">{formatCurrency(product.averageProfit)}</TableCell>
                              <TableCell className="text-right text-destructive">{formatPercent(product.averageMargin / 100)}</TableCell>
                              <TableCell className="text-right font-semibold text-destructive">{formatCurrency(product.totalProfit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                </motion.div>
              )}

              {/* Справочно: детализация выручки */}
              {topProductsData && (
                <motion.div
                  className="mt-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <div className="text-xs text-muted-foreground border-t border-border/50 pt-3">
                    <span className="font-semibold text-foreground">Справочно:</span>{' '}
                    <span>Скидки за период: {formatCurrency(topProductsData.periodSummary.totalDiscounts ?? 0)}</span>
                    {' · '}
                    <span>
                      Списано бонусов: {formatCurrency(topProductsData.periodSummary.totalBonuses ?? 0)}
                      {' '}
                      ({((topProductsData.periodSummary.bonusesPercent ?? 0)).toFixed(1)}%)
                    </span>
                    {' · '}
                    <span>Возвраты: {formatCurrency(analytics.kpi.returns)}</span>
                    {' · '}
                    <span>Коррекции: {formatCurrency(analytics.kpi.corrections)}</span>
                  </div>
                </motion.div>
              )}

              {/* Карточка потерь от скидок и бонусов */}
              {topProductsData && (
                <motion.div
                  className="mt-6"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <Card className="p-6 border-2 border-amber-500/30 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-amber-900 dark:text-amber-100 mb-1">
                          Потери от скидок и бонусов
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Общие потери от применения скидок и списания бонусов за период.
                          Бонусы рассчитаны как разница между суммой всех значений столбца "цена" и суммой всех значений столбца "цена со скидкой".
                        </p>
                      </div>
                      <TrendingDown className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                      {/* Общие потери */}
                      <div className="space-y-3 p-4 bg-white/50 dark:bg-gray-900/30 rounded-lg border border-amber-200/50 dark:border-amber-800/50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Общие потери</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">
                            {formatCurrency(topProductsData.periodSummary.totalLosses ?? 0)}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">От выручки:</span>
                            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                              {((topProductsData.periodSummary.totalLossesPercent ?? 0)).toFixed(2)}%
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Скидки + Бонусы (списано)
                          </div>
                        </div>
                      </div>
                      
                      {/* Скидки */}
                      <div className="space-y-3 p-4 bg-white/50 dark:bg-gray-900/30 rounded-lg border border-orange-200/50 dark:border-orange-800/50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Скидки</span>
                          <span className="text-xs text-muted-foreground">руб.</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-2xl font-bold text-orange-700 dark:text-orange-300">
                            {formatCurrency(topProductsData.periodSummary.totalDiscounts ?? 0)}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {((topProductsData.periodSummary.discountsPercent ?? 0)).toFixed(1)}% от выручки
                            </span>
                          </div>
                          {topProductsData.periodSummary.totalLosses > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {((topProductsData.periodSummary.totalDiscounts ?? 0) / (topProductsData.periodSummary.totalLosses ?? 1) * 100).toFixed(1)}% от общих потерь
                            </div>
                          )}
                        </div>
                      </div>
                      
                      {/* Бонусы (списано) */}
                      <div className="space-y-3 p-4 bg-white/50 dark:bg-gray-900/30 rounded-lg border border-red-200/50 dark:border-red-800/50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Бонусы (списано)</span>
                          <span className="text-xs text-muted-foreground">руб.</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                            {formatCurrency(topProductsData.periodSummary.totalBonuses ?? 0)}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {((topProductsData.periodSummary.bonusesPercent ?? 0)).toFixed(1)}% от выручки
                            </span>
                          </div>
                          {topProductsData.periodSummary.totalLosses > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {((topProductsData.periodSummary.totalBonuses ?? 0) / (topProductsData.periodSummary.totalLosses ?? 1) * 100).toFixed(1)}% от общих потерь
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Начислено бонусов */}
                      <div className="space-y-3 p-4 bg-white/50 dark:bg-gray-900/30 rounded-lg border border-blue-200/50 dark:border-blue-800/50">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Начислено бонусов</span>
                          <span className="text-xs text-muted-foreground">руб.</span>
                        </div>
                        <div className="space-y-1">
                          <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                            {formatCurrency(topProductsData.periodSummary.totalBonusAccrued ?? 0)}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              Сумма столбца "Начислено бонусов"
                            </span>
                          </div>
                          {topProductsData.periodSummary.netRevenue > 0 && (
                            <div className="text-xs text-muted-foreground">
                              {((topProductsData.periodSummary.totalBonusAccrued ?? 0) / topProductsData.periodSummary.netRevenue * 100).toFixed(2)}% от выручки
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Дополнительная информация */}
                    <div className="mt-4 pt-4 border-t border-border/50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
                        <div>
                          <span className="font-semibold text-foreground">Формула расчета общих потерь:</span>
                          <span className="ml-2">Скидки + Бонусы (списано)</span>
                        </div>
                        <div>
                          <span className="font-semibold text-foreground">Формула расчета бонусов:</span>
                          <span className="ml-2">Сумма столбца "цена" - Сумма столбца "цена со скидкой"</span>
                        </div>
                        <div>
                          <span className="font-semibold text-foreground">Формула расчета скидок:</span>
                          <span className="ml-2">Сумма столбца "Скидка, руб" + пересчет из "Скидка, %"</span>
                        </div>
                        <div>
                          <span className="font-semibold text-foreground">Период:</span>
                          <span className="ml-2">
                            {new Date(analytics.period.from).toLocaleDateString('ru-RU')} — {new Date(analytics.period.to).toLocaleDateString('ru-RU')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
