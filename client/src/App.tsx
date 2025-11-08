import { useEffect, useState, useMemo } from 'react';
import { Switch, Route, Redirect, useLocation } from 'wouter';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { FileUpload } from '@/components/FileUpload';
import { AppSidebar } from '@/components/AppSidebar';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { AnimatedBackground } from '@/components/AnimatedBackground';
import { AuthPage } from '@/components/auth/AuthPage';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { DateFilterProvider, useDateFilter } from '@/hooks/use-date-filter';
import NotFound from '@/pages/not-found';
import OverviewPage from '@/pages/OverviewPage';
import SalesPage from '@/pages/SalesPage';
import PaymentsPage from '@/pages/PaymentsPage';
import DataPage from '@/pages/DataPage';
import MonthlyReportPage from '@/pages/MonthlyReportPage';
import IntegrationsPage from '@/pages/IntegrationsPage';
import ProfitabilityPage from '@/pages/ProfitabilityPage';
import { motion } from 'framer-motion';
import { Coffee, TrendingUp, BarChart3 } from 'lucide-react';
import type { AnalyticsResponse, FileUploadResponse } from '@shared/schema';
import type { CSSProperties } from 'react';

function DashboardLayout() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { filter } = useDateFilter();
  const [location] = useLocation();
  const [uploadId, setUploadId] = useState<string | null>(() => {
    // Restore uploadId from localStorage on mount
    return localStorage.getItem('coffee-kpi-uploadId');
  });
  const [isUploading, setIsUploading] = useState(false);

  // Страницы, которые не требуют uploadId
  const pagesWithoutUploadId = useMemo(() => ['/profitability', '/integrations'], []);
  const isPageWithoutUploadId = useMemo(() => pagesWithoutUploadId.includes(location), [location, pagesWithoutUploadId]);

  const fromIso = useMemo(() => filter.from?.toISOString(), [filter.from]);
  const toIso = useMemo(() => filter.to?.toISOString(), [filter.to]);

  const {
    data: analytics,
    isLoading,
    isError,
    error,
  } = useQuery<AnalyticsResponse>({
    queryKey: ['/api/analytics', uploadId, { preset: filter.preset, from: fromIso, to: toIso }],
    enabled: !!uploadId && !isPageWithoutUploadId,
    retry: 1,
    queryFn: async (): Promise<AnalyticsResponse> => {
      if (!uploadId) {
        throw new Error('Отсутствует идентификатор набора данных');
      }

      try {
        const params = new URLSearchParams();
        params.set('preset', filter.preset);
        if (filter.preset === 'custom') {
          if (fromIso) {
            params.set('from', fromIso);
          }
          if (toIso) {
            params.set('to', toIso);
          }
        }

        // Добавляем параметр includeLLM для запуска фонового анализа
        params.set('includeLLM', 'true');
        
        const suffix = params.size > 0 ? `?${params.toString()}` : '';
        const res = await fetch(`/api/analytics/${uploadId}${suffix}`, {
          credentials: 'include',
        });

        if (!res.ok) {
          let errorMessage = 'Не удалось загрузить аналитику';
          try {
            const text = await res.text();
            if (text) {
              // Пытаемся распарсить как JSON
              try {
                const errorData = JSON.parse(text);
                errorMessage = errorData.error || errorData.message || text;
              } catch {
                errorMessage = text;
              }
            }
          } catch {
            // Если не удалось прочитать текст ошибки, используем статус
            errorMessage = `Ошибка сервера: ${res.status} ${res.statusText}`;
          }
          throw new Error(errorMessage);
        }

        return (await res.json()) as AnalyticsResponse;
      } catch (err) {
        // Обработка сетевых ошибок
        if (err instanceof TypeError && err.message.includes('fetch')) {
          throw new Error('Сервер недоступен. Убедитесь, что сервер запущен.');
        }
        // Пробрасываем другие ошибки как есть
        throw err;
      }
    },
  });

  // Polling для проверки статуса LLM анализа
  const {
    data: llmStatus,
  } = useQuery<{ status: string; data?: AnalyticsResponse; error?: string; message?: string }>({
    queryKey: ['/api/analytics/llm-status', uploadId, { preset: filter.preset, from: fromIso, to: toIso }],
    enabled: !!uploadId && !isPageWithoutUploadId && !!analytics,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Останавливаем polling если статус completed или failed
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      // Проверяем каждые 2 секунды
      return 2000;
    },
    queryFn: async () => {
      if (!uploadId) {
        throw new Error('Отсутствует идентификатор набора данных');
      }

      const params = new URLSearchParams();
      params.set('preset', filter.preset);
      if (filter.preset === 'custom') {
        if (fromIso) {
          params.set('from', fromIso);
        }
        if (toIso) {
          params.set('to', toIso);
        }
      }

      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const res = await fetch(`/api/analytics/${uploadId}/llm-status${suffix}`, {
        credentials: 'include',
      });

      if (!res.ok) {
        return { status: 'pending', message: 'Не удалось проверить статус' };
      }

      return (await res.json()) as { status: string; data?: AnalyticsResponse; error?: string; message?: string };
    },
  });

  // Показываем уведомление когда LLM анализ готов
  useEffect(() => {
    if (!llmStatus || llmStatus.status !== 'completed' || !llmStatus.data) {
      return;
    }

    // Если данные уже загружены с LLM анализом, не показываем уведомление
    if (analytics?.advancedAnalytics) {
      return;
    }

    // Проверяем, не показывали ли мы уже это уведомление
    const notificationKey = `llm-completed-${uploadId}-${filter.preset}-${fromIso}-${toIso}`;
    if (localStorage.getItem(notificationKey)) {
      return;
    }

    // Помечаем, что уведомление показано
    localStorage.setItem(notificationKey, 'true');

    toast({
      title: 'Углубленный анализ готов',
      description: 'LLM анализ завершен. Нажмите "Обновить" для загрузки данных с углубленным анализом.',
      action: (
        <button
          onClick={() => {
            // Инвалидируем запрос аналитики для перезагрузки с LLM данными
            queryClient.invalidateQueries({ 
              queryKey: ['/api/analytics', uploadId, { preset: filter.preset, from: fromIso, to: toIso }] 
            });
            // Также инвалидируем запрос статуса LLM, чтобы он перезагрузился
            queryClient.invalidateQueries({ 
              queryKey: ['/api/analytics/llm-status', uploadId, { preset: filter.preset, from: fromIso, to: toIso }] 
            });
            // Удаляем ключ из localStorage, чтобы при следующей загрузке данных с LLM уведомление не показывалось
            localStorage.removeItem(notificationKey);
          }}
          className="px-3 py-1 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Обновить
        </button>
      ),
      duration: 10000, // Показываем 10 секунд
    });
  }, [llmStatus, uploadId, filter.preset, fromIso, toIso, toast, analytics]);

  // Очищаем ключ уведомления, если данные с LLM анализом уже загружены
  useEffect(() => {
    if (analytics?.advancedAnalytics && uploadId) {
      const notificationKey = `llm-completed-${uploadId}-${filter.preset}-${fromIso}-${toIso}`;
      localStorage.removeItem(notificationKey);
    }
  }, [analytics?.advancedAnalytics, uploadId, filter.preset, fromIso, toIso]);

  useEffect(() => {
    if (!isError || !uploadId) {
      return;
    }

    console.error('Failed to load analytics:', error);
    
    // Получаем понятное сообщение об ошибке
    let errorMessage = 'Не удалось загрузить данные';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    }

    // Очищаем uploadId только если это не сетевая ошибка
    // При сетевой ошибке лучше оставить uploadId, чтобы пользователь мог попробовать снова
    const isNetworkError = errorMessage.includes('Сервер недоступен') || 
                          errorMessage.includes('Failed to fetch') ||
                          errorMessage.includes('NetworkError');
    
    if (!isNetworkError) {
      localStorage.removeItem('coffee-kpi-uploadId');
      setUploadId(null);
    }

    toast({
      title: isNetworkError ? 'Ошибка подключения' : 'Данные устарели',
      description: isNetworkError 
        ? 'Не удалось подключиться к серверу. Проверьте, что сервер запущен.'
        : 'Пожалуйста, загрузите файл снова',
      variant: 'destructive',
    });
  }, [isError, uploadId, error, toast]);

  const handleFileSelect = async (file: File) => {
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!res.ok) {
        let errorMessage = 'Ошибка загрузки файла';
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          errorMessage = `Ошибка сервера: ${res.status} ${res.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const response: FileUploadResponse = await res.json();

      if (response.success) {
        setUploadId(response.uploadId);
        // Persist uploadId to localStorage
        localStorage.setItem('coffee-kpi-uploadId', response.uploadId);
        queryClient.invalidateQueries({ queryKey: ['/api/analytics', response.uploadId] });

        toast({
          title: 'Файл успешно загружен',
          description: `Обработано ${response.rowsProcessed} записей`,
        });
      }
    } catch (error) {
      let errorMessage = 'Не удалось загрузить файл';
      if (error instanceof Error) {
        // Обработка сетевых ошибок
        if (error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
          errorMessage = 'Сервер недоступен. Убедитесь, что сервер запущен.';
        } else {
          errorMessage = error.message;
        }
      }
      
      toast({
        title: 'Ошибка загрузки',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleNewUpload = () => {
    setUploadId(null);
    // Clear uploadId from localStorage
    localStorage.removeItem('coffee-kpi-uploadId');
  };

  const style = {
    '--sidebar-width': '16rem',
    '--sidebar-width-icon': '3rem',
  } as CSSProperties;

  // Show auth page if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0" />
          </div>
          <p className="text-muted-foreground font-medium">Проверка авторизации...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage />;
  }

  // Показываем страницы без uploadId (profitability, integrations) даже без uploadId
  if (isPageWithoutUploadId) {
    return (
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full bg-gradient-to-br from-background via-background to-primary/5">
          <AppSidebar uploadId={uploadId} onNewUpload={handleNewUpload} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 shadow-sm">
              <div className="flex items-center h-14 px-4 gap-4">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <h1 className="text-lg font-semibold flex-1">Coffee KPI Dashboard</h1>
                {user && <LogoutButton user={user} />}
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              <Switch>
                <Route path="/profitability">
                  <ProfitabilityPage />
                </Route>
                <Route path="/integrations">
                  <IntegrationsPage />
                </Route>
                <Route path="/">
                  <Redirect to="/overview" />
                </Route>
                <Route component={NotFound} />
              </Switch>
            </main>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  if (!uploadId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4 relative overflow-hidden">
        <AnimatedBackground />

        <div className="max-w-4xl w-full space-y-10 relative z-10">
          <motion.div
            className="text-center space-y-6"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
              className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-gradient-to-r from-primary/20 via-chart-3/20 to-chart-4/20 border border-primary/30 backdrop-blur-sm"
            >
              <span className="text-sm font-semibold bg-gradient-to-r from-primary via-chart-3 to-chart-4 bg-clip-text text-transparent">
                Профессиональная аналитика кофейни
              </span>
            </motion.div>

            <motion.h1
              className="text-5xl md:text-6xl font-bold leading-tight"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
            >
              <span className="bg-gradient-to-r from-primary via-chart-3 to-chart-4 bg-clip-text text-transparent">
                Coffee KPI
              </span>
              <br />
              <span className="text-foreground">Dashboard</span>
            </motion.h1>

            <motion.h2
              className="text-2xl md:text-3xl font-semibold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              Анализ показателей кофейни
            </motion.h2>

            <motion.p
              className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              Загрузите Excel, CSV или PDF файл с данными о продажах для получения детальной
              аналитики с KPI метриками, графиками и сравнением периодов
            </motion.p>

            <motion.div
              className="flex items-center justify-center gap-8 pt-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6 }}
            >
              {[
                { icon: TrendingUp, label: 'Динамика продаж', color: 'text-chart-2' },
                { icon: BarChart3, label: 'KPI метрики', color: 'text-primary' },
                { icon: Coffee, label: 'Анализ товаров', color: 'text-chart-4' },
              ].map((feature, index) => (
                <motion.div
                  key={feature.label}
                  className="flex flex-col items-center gap-2"
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.7 + index * 0.1, type: 'spring' }}
                  whileHover={{ scale: 1.1 }}
                >
                  <div
                    className={`p-3 rounded-full bg-gradient-to-br from-card to-card/50 border border-border/50 ${feature.color}`}
                  >
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-muted-foreground font-medium">{feature.label}</span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          <FileUpload onFileSelect={handleFileSelect} isProcessing={isUploading} />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-primary/20 rounded-full" />
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0" />
          </div>
          <p className="text-muted-foreground font-medium">Анализируем данные...</p>
        </div>
      </div>
    );
  }

  // If analytics failed to load, the error handler above will reset uploadId
  // This will cause re-render and show the upload screen
  if (!analytics) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground font-medium">Загрузка данных...</p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-gradient-to-br from-background via-background to-primary/5">
        <AppSidebar uploadId={uploadId} onNewUpload={handleNewUpload} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80 shadow-sm">
            <div className="flex items-center h-14 px-4 gap-4">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <h1 className="text-lg font-semibold flex-1">Coffee KPI Dashboard</h1>
              <DateRangeFilter period={analytics.period} />
              {user && <LogoutButton user={user} />}
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Switch>
              <Route path="/overview">
                <OverviewPage analytics={analytics} />
              </Route>
              <Route path="/monthly-report">
                <MonthlyReportPage analytics={analytics} />
              </Route>
              <Route path="/sales">
                <SalesPage analytics={analytics} />
              </Route>
              <Route path="/payments">
                <PaymentsPage analytics={analytics} />
              </Route>
              <Route path="/data">
                <DataPage analytics={analytics} />
              </Route>
              <Route path="/profitability">
                <ProfitabilityPage />
              </Route>
              <Route path="/integrations">
                <IntegrationsPage />
              </Route>
              <Route path="/">
                <Redirect to="/overview" />
              </Route>
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200} skipDelayDuration={100}>
        <DateFilterProvider>
          <Toaster />
          <DashboardLayout />
        </DateFilterProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
