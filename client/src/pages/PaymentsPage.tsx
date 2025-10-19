import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Banknote, CreditCard, Smartphone, Zap } from 'lucide-react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, ChartOptions } from 'chart.js';
import type { AnalyticsResponse } from '@shared/schema';

ChartJS.register(ArcElement, Tooltip, Legend);

interface PaymentsPageProps {
  analytics: AnalyticsResponse;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: "easeOut",
    },
  },
};

export default function PaymentsPage({ analytics }: PaymentsPageProps) {
  const paymentStats = useMemo(() => {
    let cash = 0;
    let terminal = 0;
    let qr = 0;
    let sbp = 0;

    analytics.transactions.forEach(t => {
      cash += t.cashPayment || 0;
      terminal += t.terminalPayment || 0;
      qr += t.qrPayment || 0;
      sbp += t.sbpPayment || 0;
    });

    const total = cash + terminal + qr + sbp;
    const hasData = total > 0;

    return {
      cash,
      terminal,
      qr,
      sbp,
      total,
      hasData,
    };
  }, [analytics.transactions]);

  const chartData = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const chart1 = style.getPropertyValue('--chart-1').trim();
    const chart2 = style.getPropertyValue('--chart-2').trim();
    const chart3 = style.getPropertyValue('--chart-3').trim();
    const chart4 = style.getPropertyValue('--chart-4').trim();

    return {
      labels: ['Наличные', 'Терминал', 'QR-код', 'СБП'],
      datasets: [
        {
          data: [
            paymentStats.cash,
            paymentStats.terminal,
            paymentStats.qr,
            paymentStats.sbp,
          ],
          backgroundColor: [
            `hsl(${chart1} / 0.8)`,
            `hsl(${chart2} / 0.8)`,
            `hsl(${chart3} / 0.8)`,
            `hsl(${chart4} / 0.8)`,
          ],
          borderColor: [
            `hsl(${chart1})`,
            `hsl(${chart2})`,
            `hsl(${chart3})`,
            `hsl(${chart4})`,
          ],
          borderWidth: 2,
        },
      ],
    };
  }, [paymentStats]);

  const chartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          font: {
            size: 14,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed;
            const percentage = ((value / paymentStats.total) * 100).toFixed(1);
            return `${context.label}: ${new Intl.NumberFormat('ru-RU', {
              style: 'currency',
              currency: 'RUB',
              minimumFractionDigits: 0,
            }).format(value)} (${percentage}%)`;
          },
        },
      },
    },
  };

  const paymentMethods = [
    {
      icon: <Banknote className="w-6 h-6" />,
      name: 'Наличные',
      value: paymentStats.cash,
      color: 'bg-chart-1',
      testId: 'card-cash',
    },
    {
      icon: <CreditCard className="w-6 h-6" />,
      name: 'Терминал',
      value: paymentStats.terminal,
      color: 'bg-chart-2',
      testId: 'card-terminal',
    },
    {
      icon: <Smartphone className="w-6 h-6" />,
      name: 'QR-код',
      value: paymentStats.qr,
      color: 'bg-chart-3',
      testId: 'card-qr',
    },
    {
      icon: <Zap className="w-6 h-6" />,
      name: 'СБП',
      value: paymentStats.sbp,
      color: 'bg-chart-4',
      testId: 'card-sbp',
    },
  ];

  if (!paymentStats.hasData) {
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
              Анализ платежей
            </h1>
            <p className="text-muted-foreground">
              Анализ способов оплаты и их распределение
            </p>
          </motion.div>
          <motion.div variants={itemVariants}>
            <Card className="p-12">
              <div className="text-center space-y-4">
                <div className="text-6xl">💳</div>
                <h3 className="text-xl font-semibold">Данные о способах оплаты отсутствуют</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  В загруженном файле не найдена информация о способах оплаты (наличные, терминал, QR, СБП).
                  Загрузите файл с детализацией платежей для просмотра этой аналитики.
                </p>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    );
  }

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
            Анализ платежей
          </h1>
          <p className="text-muted-foreground">
            Анализ способов оплаты и их распределение
          </p>
        </motion.div>

        {/* Payment Method Cards */}
        <motion.div 
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          variants={containerVariants}
        >
          {paymentMethods.map((method) => {
            const percentage = paymentStats.total > 0 
              ? ((method.value / paymentStats.total) * 100).toFixed(1) 
              : '0.0';
            
            return (
              <motion.div key={method.name} variants={itemVariants}>
                <Card className="p-6 hover-elevate transition-all duration-300" data-testid={method.testId}>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className={`p-3 ${method.color}/10 rounded-lg`}>
                        {method.icon}
                      </div>
                      <div className={`px-3 py-1 ${method.color}/20 rounded-full`}>
                        <span className="font-semibold text-sm">{percentage}%</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        {method.name}
                      </p>
                      <p className="text-2xl font-bold tabular-nums">
                        {new Intl.NumberFormat('ru-RU', {
                          style: 'currency',
                          currency: 'RUB',
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }).format(method.value)}
                      </p>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Chart and Stats */}
        <motion.div 
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          variants={containerVariants}
        >
          {/* Pie Chart */}
          <motion.div variants={itemVariants}>
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Распределение платежей</h3>
              <div className="h-[400px] flex items-center justify-center">
                <Doughnut data={chartData} options={chartOptions} />
              </div>
            </Card>
          </motion.div>

          {/* Statistics */}
          <motion.div variants={itemVariants}>
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Статистика</h3>
              <div className="space-y-6">
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Общая сумма платежей</p>
                  <p className="text-3xl font-bold tabular-nums">
                    {new Intl.NumberFormat('ru-RU', {
                      style: 'currency',
                      currency: 'RUB',
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 0,
                    }).format(paymentStats.total)}
                  </p>
                </div>

                <div className="pt-4 border-t space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-3">Самый популярный способ</p>
                    <div className="flex items-center gap-3">
                      {(() => {
                        const maxMethod = paymentMethods.reduce((max, method) => 
                          method.value > max.value ? method : max
                        );
                        return (
                          <>
                            <div className={`p-2 ${maxMethod.color}/10 rounded-lg`}>
                              {maxMethod.icon}
                            </div>
                            <div>
                              <p className="font-semibold">{maxMethod.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {((maxMethod.value / paymentStats.total) * 100).toFixed(1)}% от общей суммы
                              </p>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-3">Средний чек по способам</p>
                    <div className="space-y-2">
                      {paymentMethods.map((method) => {
                        const avgCheck = method.value > 0 
                          ? method.value / analytics.transactions.filter(t => {
                              if (method.name === 'Наличные') return (t.cashPayment || 0) > 0;
                              if (method.name === 'Терминал') return (t.terminalPayment || 0) > 0;
                              if (method.name === 'QR-код') return (t.qrPayment || 0) > 0;
                              if (method.name === 'СБП') return (t.sbpPayment || 0) > 0;
                              return false;
                            }).length
                          : 0;
                        
                        if (avgCheck === 0) return null;
                        
                        return (
                          <div key={method.name} className="flex justify-between items-center text-sm">
                            <span className="text-muted-foreground">{method.name}</span>
                            <span className="font-semibold tabular-nums">
                              {new Intl.NumberFormat('ru-RU', {
                                style: 'currency',
                                currency: 'RUB',
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0,
                              }).format(avgCheck)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
