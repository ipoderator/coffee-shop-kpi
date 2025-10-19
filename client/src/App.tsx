import { useState } from 'react';
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { FileUpload } from "@/components/FileUpload";
import { AnimatedBackground } from "@/components/AnimatedBackground";
import { AuthPage } from "@/components/auth/AuthPage";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/OverviewPage";
import SalesPage from "@/pages/SalesPage";
import PaymentsPage from "@/pages/PaymentsPage";
import DataPage from "@/pages/DataPage";
import MonthlyReportPage from "@/pages/MonthlyReportPage";
import { motion } from 'framer-motion';
import { Coffee, TrendingUp, BarChart3 } from 'lucide-react';
import type { AnalyticsResponse, FileUploadResponse } from '@shared/schema';

function DashboardLayout() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [uploadId, setUploadId] = useState<string | null>(() => {
    // Restore uploadId from localStorage on mount
    return localStorage.getItem('coffee-kpi-uploadId');
  });
  const [isUploading, setIsUploading] = useState(false);

  const { data: analytics, isLoading, isError, error } = useQuery<AnalyticsResponse>({
    queryKey: ['/api/analytics', uploadId],
    enabled: !!uploadId,
    retry: false,
  });

  // If there's an error loading analytics (e.g., 404 after server restart), clear the uploadId
  if (isError && uploadId) {
    console.error('Failed to load analytics:', error);
    localStorage.removeItem('coffee-kpi-uploadId');
    setUploadId(null);
    toast({
      title: 'Данные устарели',
      description: 'Пожалуйста, загрузите файл снова',
      variant: 'destructive',
    });
  }

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
        const errorData = await res.json();
        throw new Error(errorData.error || 'Ошибка загрузки файла');
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
      toast({
        title: 'Ошибка загрузки',
        description: error instanceof Error ? error.message : 'Не удалось загрузить файл',
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
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

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

  if (!uploadId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4 relative overflow-hidden">
        <AnimatedBackground />
        
        <div className="max-w-4xl w-full space-y-10 relative z-10">
          <motion.div 
            className="text-center space-y-6"
            initial={{ opacity: 0, y: -30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6, type: "spring" }}
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
              Загрузите Excel, CSV или PDF файл с данными о продажах для получения детальной аналитики 
              с KPI метриками, графиками и сравнением периодов
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
                  transition={{ delay: 0.7 + index * 0.1, type: "spring" }}
                  whileHover={{ scale: 1.1 }}
                >
                  <div className={`p-3 rounded-full bg-gradient-to-br from-card to-card/50 border border-border/50 ${feature.color}`}>
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
        <Toaster />
        <DashboardLayout />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
