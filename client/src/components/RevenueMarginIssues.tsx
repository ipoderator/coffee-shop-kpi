import { useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Percent,
  BarChart3,
  ArrowDown,
  ArrowUp,
  Calendar,
  AlertTriangle,
  Target,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ProfitabilityAnalyticsResponse } from '@shared/schema';

interface RevenueMarginIssuesProps {
  analytics: ProfitabilityAnalyticsResponse | null;
}

interface Issue {
  type: 'revenue' | 'margin' | 'volatility' | 'anomaly';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedDays: Array<{ date: string; value: number; deviation: number }>;
  rootCause: string;
  solution: string;
  expectedImpact: string;
}

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

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

function RevenueMarginIssuesComponent({ analytics }: RevenueMarginIssuesProps) {
  const issues = useMemo(() => {
    if (!analytics || !analytics.daily || analytics.daily.length === 0) return [];

    const daily = analytics.daily;
    const issues: Issue[] = [];

    // Рассчитываем средние показатели (оптимизировано - один проход для фильтрации)
    const daysWithMargin = daily.filter((d) => d.margin != null);
    const avgRevenue = daily.reduce((sum, d) => sum + d.netRevenue, 0) / daily.length;
    const avgMargin = daysWithMargin.length > 0 
      ? daysWithMargin.reduce((sum, d) => sum + (d.margin ?? 0), 0) / daysWithMargin.length
      : 0;
    
    // Рассчитываем стандартное отклонение для выявления аномалий
    const revenueStdDev = Math.sqrt(
      daily.reduce((sum, d) => sum + Math.pow(d.netRevenue - avgRevenue, 2), 0) / daily.length
    );
    const marginStdDev = daysWithMargin.length > 0
      ? Math.sqrt(
          daysWithMargin.reduce((sum, d) => sum + Math.pow((d.margin ?? 0) - avgMargin, 2), 0) / 
          daysWithMargin.length
        )
      : 0;

    // 1. Анализ дней с резким падением выручки (более чем на 30% от среднего)
    const lowRevenueDays = daily
      .filter((d) => d.netRevenue < avgRevenue * 0.7 && d.netRevenue > 0)
      .map((d) => ({
        date: d.date,
        value: d.netRevenue,
        deviation: ((d.netRevenue - avgRevenue) / avgRevenue) * 100,
      }))
      .sort((a, b) => a.deviation - b.deviation);

    if (lowRevenueDays.length > 0) {
      const avgProblemRevenue = lowRevenueDays.reduce((sum, d) => sum + d.value, 0) / lowRevenueDays.length;
      
      // Анализ по дням недели для проблемных дней
      const dayOfWeekAnalysis = lowRevenueDays.reduce((acc, d) => {
        const day = new Date(d.date).getDay();
        const dayName = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][day];
        if (!acc[dayName]) {
          acc[dayName] = 0;
        }
        acc[dayName] += 1;
        return acc;
      }, {} as Record<string, number>);
      const mostProblematicDay = Object.entries(dayOfWeekAnalysis).reduce((max, [day, count]) => 
        count > max.count ? { day, count } : max, 
        { day: '', count: 0 }
      );

      // Анализ паттернов (повторяются ли проблемы)
      const problemDates = lowRevenueDays.map(d => new Date(d.date));
      const problemDays = problemDates.map(d => d.getDay());
      const dayPattern = problemDays.reduce((acc, day) => {
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      const hasPattern = Object.values(dayPattern).some(count => count >= 2);

      // Сравнение с нормальными днями (90-110% от среднего)
      const normalDays = daily.filter(d => d.netRevenue >= avgRevenue * 0.9 && d.netRevenue <= avgRevenue * 1.1);
      const avgNormalRevenue = normalDays.length > 0 
        ? normalDays.reduce((sum, d) => sum + d.netRevenue, 0) / normalDays.length 
        : avgRevenue;
      const avgNormalChecks = normalDays.length > 0
        ? normalDays.reduce((sum, d) => sum + d.incomeChecks, 0) / normalDays.length
        : 0;
      const avgProblemChecks = lowRevenueDays.reduce((sum, d) => {
        const dayData = daily.find(day => day.date === d.date);
        return sum + (dayData?.incomeChecks || 0);
      }, 0) / lowRevenueDays.length;

      // Потерянная выручка: разница между нормальной и проблемной выручкой за проблемные дни
      const totalLoss = lowRevenueDays.reduce((sum, d) => sum + (avgNormalRevenue - d.value), 0);

      // Разница с нормальными днями в среднем за день
      const dailyDifference = avgNormalRevenue - avgProblemRevenue;

      // Расчет месячного эффекта:
      // 1. Оцениваем количество проблемных дней в месяц на основе частоты в анализируемом периоде
      // 2. Умножаем на разницу в выручке за день
      // 3. Применяем коэффициент восстановления 60% (RECOVERY_RATE):
      //    Это консервативная оценка, учитывающая, что не все проблемы можно решить на 100%.
      //    Некоторые факторы (погода, внешние обстоятельства, сезонность) могут остаться вне контроля.
      //    60% означает, что мы ожидаем восстановить примерно 60% от потенциальной выгоды.
      const RECOVERY_RATE = 0.6; // 60% - консервативная оценка восстановления
      const problemDaysPerMonth = (lowRevenueDays.length / daily.length) * 30;
      const monthlyRecovery = dailyDifference * problemDaysPerMonth * RECOVERY_RATE;

      // Потенциальный максимальный эффект (100% восстановление) для сравнения
      const maxPotentialRecovery = dailyDifference * problemDaysPerMonth;

      issues.push({
        type: 'revenue',
        severity: lowRevenueDays.length >= daily.length * 0.2 ? 'critical' : 'high',
        title: 'Дни с критически низкой выручкой',
        description: `Обнаружено ${lowRevenueDays.length} дней с выручкой ниже среднего на ${Math.abs(
          Math.round(lowRevenueDays.reduce((sum, d) => sum + d.deviation, 0) / lowRevenueDays.length),
        )}%. Потерянная выручка: ${formatCurrency(totalLoss)}.`,
        affectedDays: lowRevenueDays.slice(0, 10), // Показываем топ-10 худших дней
        rootCause: `Возможные причины: плохая погода, проблемы с персоналом, технические сбои, недостаточная реклама в эти дни. Средняя выручка в проблемные дни: ${formatCurrency(
          avgProblemRevenue,
        )} против среднего ${formatCurrency(avgRevenue)}. ${mostProblematicDay.count > 0 ? `Проблемы чаще возникают в ${mostProblematicDay.day} (${mostProblematicDay.count} случаев).` : ''} ${hasPattern ? 'Обнаружен паттерн: проблемы повторяются в определенные дни недели.' : ''}`,
        solution:
          `1) Проверьте календарь событий и внешние факторы в проблемные дни${mostProblematicDay.count > 0 ? `, особенно в ${mostProblematicDay.day}` : ''}. 2) Усильте рекламу перед ожидаемыми слабыми днями. 3) Внедрите специальные акции для привлечения клиентов. 4) Проверьте работу персонала и оборудования в эти дни. 5) Рассмотрите сокращение рабочего времени в непродуктивные дни. ${avgProblemChecks < avgNormalChecks * 0.8 ? '6) Обратите внимание на низкое количество чеков в проблемные дни - возможно, проблема в трафике клиентов.' : ''}`,
        expectedImpact: `Устранение проблем с выручкой может добавить ${formatCurrency(
          monthlyRecovery,
        )} в месяц (реалистичная оценка, учитывающая что не все факторы можно контролировать). Максимальный потенциальный эффект при полном устранении: ${formatCurrency(maxPotentialRecovery)}. Разница с нормальными днями в среднем: ${formatCurrency(dailyDifference)}.`,
      });
    }

    // 2. Анализ дней с аномально высокой выручкой (возможные ошибки учета)
    const highRevenueDays = daily
      .filter((d) => d.netRevenue > avgRevenue * 1.5)
      .map((d) => ({
        date: d.date,
        value: d.netRevenue,
        deviation: ((d.netRevenue - avgRevenue) / avgRevenue) * 100,
      }))
      .sort((a, b) => b.deviation - a.deviation);

    if (highRevenueDays.length > 0) {
      issues.push({
        type: 'anomaly',
        severity: 'medium',
        title: 'Дни с аномально высокой выручкой',
        description: `Обнаружено ${highRevenueDays.length} дней с выручкой значительно выше среднего (на ${Math.round(
          highRevenueDays.reduce((sum, d) => sum + d.deviation, 0) / highRevenueDays.length,
        )}%). Возможны ошибки учета или особые события.`,
        affectedDays: highRevenueDays.slice(0, 5),
        rootCause:
          'Возможные причины: особые события/праздники, ошибки при вводе данных, накопленные продажи за несколько дней, специальные акции. Необходимо проверить корректность данных.',
        solution:
          '1) Проверьте корректность данных в эти дни. 2) Если выручка реальная - проанализируйте факторы успеха и воспроизведите их. 3) Если это ошибка - исправьте учет. 4) Используйте успешные дни как эталон для других периодов.',
        expectedImpact:
          'Корректировка учета и применение лучших практик может стабилизировать выручку и предотвратить будущие проблемы.',
      });
    }

    // 3. Анализ волатильности выручки
    const coefficientOfVariation = revenueStdDev / avgRevenue;
    if (coefficientOfVariation > 0.4) {
      issues.push({
        type: 'volatility',
        severity: coefficientOfVariation > 0.6 ? 'high' : 'medium',
        title: 'Высокая волатильность выручки',
        description: `Коэффициент вариации выручки составляет ${formatPercent(
          coefficientOfVariation,
        )}, что указывает на нестабильность. Средняя выручка: ${formatCurrency(
          avgRevenue,
        )}, стандартное отклонение: ${formatCurrency(revenueStdDev)}.`,
        affectedDays: [],
        rootCause:
          'Высокая волатильность может быть вызвана: отсутствием стабильных клиентских потоков, зависимостью от внешних факторов (погода, события), нестабильным персоналом, отсутствием прогнозирования продаж.',
        solution:
          '1) Внедрите систему прогнозирования продаж на основе исторических данных. 2) Разработайте планы на разные сценарии (рабочие дни, выходные, праздники). 3) Стабилизируйте персонал и улучшите обучение. 4) Диверсифицируйте источники клиентов. 5) Создайте резервные планы для слабых дней.',
        expectedImpact: `Стабилизация выручки может увеличить средний показатель на ${formatCurrency(
          avgRevenue * 0.1,
        )} за счет устранения экстремальных падений.`,
      });
    }

    // 4. Анализ дней с низкой маржой (если есть данные COGS)
    const daysWithMarginData = daysWithMargin.filter((d) => d.netRevenue > 0);
    if (daysWithMarginData.length > 0) {
      const lowMarginDays = daysWithMarginData
        .filter((d) => (d.margin ?? 0) < avgMargin * 0.8 && (d.margin ?? 0) >= 0)
        .map((d) => ({
          date: d.date,
          value: d.margin ?? 0,
          deviation: ((d.margin ?? 0) - avgMargin) / avgMargin,
        }))
        .sort((a, b) => a.deviation - b.deviation);

      if (lowMarginDays.length > 0) {
        const avgLossPerDay =
          (lowMarginDays.reduce((sum, d) => {
            const dayData = daily.find((day) => day.date === d.date);
            const expectedProfit = (dayData?.netRevenue ?? 0) * avgMargin;
            const actualProfit = (dayData?.netRevenue ?? 0) * d.value;
            return sum + (expectedProfit - actualProfit);
          }, 0) / lowMarginDays.length);

        issues.push({
          type: 'margin',
          severity: lowMarginDays.length >= daysWithMarginData.length * 0.2 ? 'critical' : 'high',
          title: 'Дни с низкой валовой маржой',
          description: `Обнаружено ${lowMarginDays.length} дней с маржой ниже среднего на ${formatPercent(
            Math.abs(
              lowMarginDays.reduce((sum, d) => sum + d.deviation, 0) / lowMarginDays.length,
            ),
          )}. Средняя маржа в проблемные дни: ${formatPercent(
            lowMarginDays.reduce((sum, d) => sum + d.value, 0) / lowMarginDays.length,
          )} против ${formatPercent(avgMargin)}.`,
          affectedDays: lowMarginDays.slice(0, 10),
          rootCause:
            'Низкая маржа может быть вызвана: высоким процентом скидок/бонусов, закупкой товаров по завышенным ценам, продажей преимущественно низкомаржинальных позиций, ошибками в ценообразовании.',
          solution:
            '1) Проанализируйте структуру продаж в эти дни - какие позиции преобладали. 2) Проверьте размер скидок и бонусов. 3) Пересмотрите закупочные цены и условия с поставщиками. 4) Оптимизируйте ассортимент - увеличьте долю высокомаржинальных позиций. 5) Скорректируйте цены на низкомаржинальные позиции.',
          expectedImpact: `Повышение маржи до среднего уровня может добавить ${formatCurrency(
            avgLossPerDay * lowMarginDays.length,
          )} прибыли за период.`,
        });
      }

      // 5. Анализ дней с отрицательной маржой
      const negativeMarginDays = daysWithMarginData
        .filter((d) => (d.margin ?? 0) < 0)
        .map((d) => ({
          date: d.date,
          value: d.margin ?? 0,
          deviation: (d.margin ?? 0) - avgMargin,
        }));

      if (negativeMarginDays.length > 0) {
        const totalLoss = negativeMarginDays.reduce((sum, d) => {
          const dayData = daily.find((day) => day.date === d.date);
          return sum + Math.abs((dayData?.grossProfit ?? 0));
        }, 0);

        issues.push({
          type: 'margin',
          severity: 'critical',
          title: 'Критично: дни с отрицательной маржой',
          description: `Обнаружено ${negativeMarginDays.length} дней с отрицательной маржой! Убыток составляет ${formatCurrency(
            totalLoss,
          )}. Это критическая ситуация.`,
          affectedDays: negativeMarginDays,
          rootCause:
            'Отрицательная маржа означает, что выручка не покрывает себестоимость. Возможные причины: экстремальные скидки, ошибки в себестоимости, неправильное ценообразование, брак/списания.',
          solution:
            '1) НЕМЕДЛЕННО: Проверьте корректность данных о себестоимости. 2) Отключите или ограничьте скидки, которые приводят к убыткам. 3) Пересмотрите цены на проблемные позиции. 4) Проверьте наличие списаний/брака. 5) Временно приостановите продажи убыточных позиций до решения проблемы.',
          expectedImpact: `Устранение убыточных дней предотвратит потерю ${formatCurrency(
            totalLoss,
          )} и восстановит прибыльность.`,
        });
      }

      // 6. Анализ волатильности маржи
      if (marginStdDev > 0) {
        const marginCoefficientOfVariation = marginStdDev / Math.abs(avgMargin);
        if (marginCoefficientOfVariation > 0.3) {
          issues.push({
            type: 'volatility',
            severity: marginCoefficientOfVariation > 0.5 ? 'high' : 'medium',
            title: 'Нестабильная валовая маржа',
            description: `Маржа сильно колеблется от дня ко дню. Средняя маржа: ${formatPercent(
              avgMargin,
            )}, стандартное отклонение: ${formatPercent(marginStdDev)}.`,
            affectedDays: [],
            rootCause:
              'Нестабильность маржи указывает на отсутствие контроля над ценообразованием, нерегулярное применение скидок, изменение структуры продаж без планирования.',
            solution:
              '1) Стандартизируйте политику ценообразования. 2) Ограничьте право персонала применять скидки. 3) Внедрите систему контроля маржи в реальном времени. 4) Планируйте структуру продаж (долю высокомаржинальных позиций). 5) Регулярно отслеживайте маржу и принимайте меры при отклонениях.',
            expectedImpact: `Стабилизация маржи позволит более точно прогнозировать прибыль и повысить среднюю маржу на ${formatPercent(
              0.02,
            )} за счет исключения экстремальных значений.`,
          });
        }
      }
    }

    // 7. Анализ связи возвратов и выручки
    const daysWithHighReturns = daily
      .filter((d) => d.netRevenue > 0 && d.returns / d.netRevenue > 0.05)
      .map((d) => ({
        date: d.date,
        value: d.returns / d.netRevenue,
        deviation: (d.returns / d.netRevenue - 0.02) * 100, // 2% - норма
      }));

    if (daysWithHighReturns.length > 0) {
      const avgReturnLoss = daysWithHighReturns.reduce((sum, d) => {
        const dayData = daily.find((day) => day.date === d.date);
        return sum + (dayData?.returns ?? 0);
      }, 0);

      issues.push({
        type: 'revenue',
        severity: daysWithHighReturns.length >= daily.length * 0.15 ? 'high' : 'medium',
        title: 'Дни с высоким процентом возвратов',
        description: `В ${daysWithHighReturns.length} днях возвраты превышают 5% от выручки. Общая сумма возвратов: ${formatCurrency(
          avgReturnLoss,
        )}.`,
          affectedDays: daysWithHighReturns.slice(0, 5).map((d) => ({
            date: d.date,
            value: d.value, // Оставляем как число для консистентности
            deviation: d.deviation,
          })),
        rootCause:
          'Высокие возвраты могут быть вызваны: проблемами с качеством продукции, ошибками персонала при приеме заказов, недовольством клиентов сервисом, техническими проблемами с оборудованием.',
        solution:
          '1) Проанализируйте причины каждого возврата в проблемные дни. 2) Улучшите обучение персонала. 3) Внедрите систему контроля качества перед выдачей заказа. 4) Оптимизируйте процессы для снижения ошибок. 5) Соберите обратную связь от клиентов.',
        expectedImpact: `Снижение возвратов до нормы (2%) вернет ${formatCurrency(
          avgReturnLoss * 0.6,
        )} выручки.`,
      });
    }

    // Сортируем по severity: critical > high > medium > low
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }, [analytics]);

  if (!analytics || issues.length === 0) {
    return null;
  }

  const getSeverityStyles = (severity: Issue['severity']) => {
    switch (severity) {
      case 'critical':
        return 'border-destructive/50 bg-destructive/10';
      case 'high':
        return 'border-orange-500/30 bg-orange-50/50 dark:bg-orange-950/20';
      case 'medium':
        return 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20';
      case 'low':
        return 'border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20';
    }
  };

  const getSeverityBadge = (severity: Issue['severity']) => {
    const variants = {
      critical: 'destructive',
      high: 'default',
      medium: 'default',
      low: 'secondary',
    } as const;
    const labels = {
      critical: 'Критично',
      high: 'Высокий',
      medium: 'Средний',
      low: 'Низкий',
    };
    return (
      <Badge variant={variants[severity]} className="text-xs">
        {labels[severity]}
      </Badge>
    );
  };

  const getTypeIcon = (type: Issue['type']) => {
    switch (type) {
      case 'revenue':
        return <DollarSign className="w-5 h-5 text-blue-600" />;
      case 'margin':
        return <Percent className="w-5 h-5 text-purple-600" />;
      case 'volatility':
        return <BarChart3 className="w-5 h-5 text-orange-600" />;
      case 'anomaly':
        return <AlertTriangle className="w-5 h-5 text-amber-600" />;
    }
  };

  const criticalIssues = issues.filter((i) => i.severity === 'critical');
  const otherIssues = issues.filter((i) => i.severity !== 'critical');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="flex items-center gap-3 mb-2">
        <AlertCircle className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold">Недочеты в выручке и марже</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Детальный анализ ежедневных показателей выявляет проблемы в выручке и марже, а также
        предлагает конкретные способы их исправления.
      </p>

      {criticalIssues.length > 0 && (
        <div className="space-y-4 mb-6">
          <h3 className="text-lg font-semibold text-destructive flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Критические недочеты
          </h3>
          {criticalIssues.map((issue, idx) => (
            <Card key={`critical-${idx}`} className={`p-5 ${getSeverityStyles(issue.severity)}`}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-0.5">{getTypeIcon(issue.type)}</div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-semibold text-base">{issue.title}</h4>
                    {getSeverityBadge(issue.severity)}
                  </div>
                  <p className="text-sm text-muted-foreground">{issue.description}</p>
                  
                  {issue.affectedDays.length > 0 && (
                    <div className="bg-muted/50 p-3 rounded-md space-y-3">
                      <div>
                        <p className="text-xs font-semibold mb-2 flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Проблемные дни ({issue.affectedDays.length}):
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {issue.affectedDays.map((day, dayIdx) => {
                            const dayName = new Date(day.date).toLocaleDateString('ru-RU', { weekday: 'short' });
                            return (
                              <Badge key={dayIdx} variant="outline" className="text-xs">
                                {formatDate(day.date)} ({dayName}): {typeof day.value === 'number' && day.value < 1 ? formatPercent(day.value) : formatCurrency(day.value as number)}{' '}
                                {day.deviation < 0 && (
                                  <ArrowDown className="w-3 h-3 inline ml-1 text-destructive" />
                                )}
                                {day.deviation > 0 && (
                                  <ArrowUp className="w-3 h-3 inline ml-1 text-emerald-600" />
                                )}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                      
                      {/* Анализ паттернов по дням недели */}
                      {issue.type === 'revenue' && issue.affectedDays.length > 0 && (() => {
                        const dayOfWeekCounts = issue.affectedDays.reduce((acc, d) => {
                          const day = new Date(d.date).getDay();
                          const dayName = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day];
                          acc[dayName] = (acc[dayName] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>);
                        const maxDay = Object.entries(dayOfWeekCounts).reduce((max, [day, count]) => 
                          count > max.count ? { day, count } : max, 
                          { day: '', count: 0 }
                        );
                        
                        if (maxDay.count > 1) {
                          return (
                            <div className="border-t pt-2 mt-2">
                              <p className="text-xs font-semibold mb-1 text-muted-foreground">
                                Паттерн: большинство проблемных дней приходится на {maxDay.day} ({maxDay.count} из {issue.affectedDays.length})
                              </p>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        Возможная причина:
                      </p>
                      <p className="text-sm">{issue.rootCause}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <Target className="w-4 h-4 text-blue-600" />
                        Способ исправления:
                      </p>
                      <p className="text-sm whitespace-pre-line">{issue.solution}</p>
                    </div>
                    {issue.expectedImpact && (
                      <div className="bg-primary/5 dark:bg-primary/10 p-3 rounded-md border border-primary/20">
                        <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" />
                          Ожидаемый эффект:
                        </p>
                        <p className="text-sm">{issue.expectedImpact}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {otherIssues.length > 0 && (
        <div className="space-y-4">
          {criticalIssues.length > 0 && (
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Дополнительные проблемы
            </h3>
          )}
          {otherIssues.map((issue, idx) => (
            <Card key={`other-${idx}`} className={`p-5 ${getSeverityStyles(issue.severity)}`}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-0.5">{getTypeIcon(issue.type)}</div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-semibold text-base">{issue.title}</h4>
                    {getSeverityBadge(issue.severity)}
                  </div>
                  <p className="text-sm text-muted-foreground">{issue.description}</p>
                  
                  {issue.affectedDays.length > 0 && (
                    <div className="bg-muted/50 p-3 rounded-md">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Проблемные дни:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {issue.affectedDays.map((day, dayIdx) => (
                          <Badge key={dayIdx} variant="outline" className="text-xs">
                            {formatDate(day.date)}: {typeof day.value === 'number' && day.value < 1 ? formatPercent(day.value) : formatCurrency(day.value as number)}
                            {day.deviation < 0 && (
                              <ArrowDown className="w-3 h-3 inline ml-1 text-destructive" />
                            )}
                            {day.deviation > 0 && (
                              <ArrowUp className="w-3 h-3 inline ml-1 text-emerald-600" />
                            )}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div>
                      <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        Возможная причина:
                      </p>
                      <p className="text-sm">{issue.rootCause}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                        <Target className="w-4 h-4 text-blue-600" />
                        Способ исправления:
                      </p>
                      <p className="text-sm whitespace-pre-line">{issue.solution}</p>
                    </div>
                    {issue.expectedImpact && (
                      <div className="bg-primary/5 dark:bg-primary/10 p-3 rounded-md border border-primary/20">
                        <p className="text-xs font-semibold mb-1 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-primary" />
                          Ожидаемый эффект:
                        </p>
                        <p className="text-sm">{issue.expectedImpact}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export const RevenueMarginIssues = memo(RevenueMarginIssuesComponent);
