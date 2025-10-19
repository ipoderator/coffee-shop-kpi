import { motion } from 'framer-motion';
import { DataTable } from '@/components/DataTable';
import { Card } from '@/components/ui/card';
import { FileSpreadsheet } from 'lucide-react';
import type { AnalyticsResponse } from '@shared/schema';

interface DataPageProps {
  analytics: AnalyticsResponse;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: "easeOut",
    },
  },
};

export default function DataPage({ analytics }: DataPageProps) {
  return (
    <div className="container mx-auto px-4 md:px-8 lg:px-12 py-8">
      <motion.div 
        className="space-y-8"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        <motion.div variants={itemVariants}>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
            Детализация данных
          </h1>
          <p className="text-muted-foreground">
            Полная таблица транзакций с возможностью сортировки и анализа
          </p>
        </motion.div>

        {/* Summary Card */}
        <motion.div variants={itemVariants}>
          <Card className="p-6 bg-gradient-to-br from-primary/5 to-transparent hover-elevate transition-all duration-300">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <FileSpreadsheet className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg mb-2">Сводка по данным</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Всего записей</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">
                      {analytics.transactions.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Общая выручка</p>
                    <p className="text-2xl font-bold tabular-nums mt-1">
                      {new Intl.NumberFormat('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(analytics.kpi.totalRevenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Период данных</p>
                    <p className="text-lg font-semibold mt-1">
                      {(() => {
                        if (analytics.transactions.length === 0) return '—';
                        const dates = analytics.transactions.map(t => new Date(t.date));
                        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
                        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
                        const formatter = new Intl.DateTimeFormat('ru-RU', { 
                          day: 'numeric', 
                          month: 'short', 
                          year: 'numeric' 
                        });
                        return `${formatter.format(minDate)} - ${formatter.format(maxDate)}`;
                      })()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Data Table */}
        <motion.div className="space-y-4" variants={itemVariants}>
          <h2 className="text-2xl font-bold">Транзакции</h2>
          <DataTable transactions={analytics.transactions} />
        </motion.div>
      </motion.div>
    </div>
  );
}
