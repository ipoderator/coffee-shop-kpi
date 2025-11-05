import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Target,
  Lightbulb,
  AlertTriangle,
  BarChart3,
  Calendar,
  Package,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Activity,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ProfitabilityAnalyticsResponse, TopProductsResponse } from '@shared/schema';

interface FinancialRecommendationsProps {
  analytics: ProfitabilityAnalyticsResponse | null;
  topProductsData: TopProductsResponse | null;
}

interface Recommendation {
  type: 'success' | 'warning' | 'error' | 'info';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  impact?: string;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    value: number;
    period: string;
  };
  metrics?: {
    label: string;
    value: string;
    comparison?: string;
  }[];
  roi?: {
    investment: string;
    return: string;
    timeframe: string;
  };
  category?: 'margin' | 'revenue' | 'costs' | 'operations' | 'pricing';
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

export function FinancialRecommendations({
  analytics,
  topProductsData,
}: FinancialRecommendationsProps) {
  const recommendations = useMemo(() => {
    if (!analytics || !topProductsData) return [];

    const recs: Recommendation[] = [];
    const kpi = analytics.kpi;
    const summary = topProductsData.periodSummary;
    const daily = analytics.daily || [];

    // Анализ трендов
    const calculateTrend = (values: number[]): { direction: 'up' | 'down' | 'stable'; value: number; period: string } | null => {
      if (values.length < 2) return null;
      const firstHalf = values.slice(0, Math.floor(values.length / 2));
      const secondHalf = values.slice(Math.floor(values.length / 2));
      const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
      const change = ((secondAvg - firstAvg) / firstAvg) * 100;
      return {
        direction: (change > 2 ? 'up' : change < -2 ? 'down' : 'stable') as 'up' | 'down' | 'stable',
        value: Math.abs(change),
        period: 'за период',
      };
    };

    // Анализ волатильности выручки
    const revenueValues = daily.map((d) => d.netRevenue).filter((v) => v > 0);
    const revenueTrend = revenueValues.length > 0 ? calculateTrend(revenueValues) : null;
    const revenueStdDev = revenueValues.length > 0
      ? Math.sqrt(
          revenueValues.reduce((sum, val) => {
            const avg = revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length;
            return sum + Math.pow(val - avg, 2);
          }, 0) / revenueValues.length,
        )
      : 0;
    const avgRevenue = revenueValues.length > 0
      ? revenueValues.reduce((a, b) => a + b, 0) / revenueValues.length
      : 0;

    // Анализ тренда маржи (если есть данные по дням)
    const marginValues = daily
      .filter((d) => d.margin != null && d.margin > 0)
      .map((d) => d.margin!);
    const marginTrend = marginValues.length > 0 ? calculateTrend(marginValues) : null;

    // Расчет средних значений для метрик (используем в других местах)
    const avgMargin = marginValues.length > 0
      ? marginValues.reduce((a, b) => a + b, 0) / marginValues.length
      : summary.grossMargin / 100;
    const marginStdDev = marginValues.length > 0
      ? Math.sqrt(
          marginValues.reduce((sum, val) => sum + Math.pow(val - avgMargin, 2), 0) /
            marginValues.length,
        )
      : 0;

    // Анализ маржи с расширенной аналитикой
    if (summary.grossMargin < 30) {
      const lowMarginProducts = topProductsData.bottomProducts.filter((p) => p.averageMargin < 15);
      const potentialGain = (summary.netRevenue * 0.35 - summary.grossProfit) * 0.85;
      
      recs.push({
        type: 'error',
        priority: 'high',
        category: 'margin',
        title: 'Низкая валовая маржа',
        description: `Текущая валовая маржа составляет ${formatPercent(
          summary.grossMargin / 100,
        )}, что ниже рекомендуемого уровня в 30-40% для кофейни.`,
        action:
          'Пересмотрите ценообразование или оптимизируйте себестоимость. Рассмотрите возможность повышения цен на позиции с низкой маржой или поиск более дешевых поставщиков.',
        impact: `Увеличение маржи до 35% принесет дополнительно ${formatCurrency(
          potentialGain,
        )} чистой прибыли.`,
        trend: marginTrend || undefined,
        metrics: [
          {
            label: 'Текущая маржа',
            value: formatPercent(summary.grossMargin / 100),
            comparison: 'Целевая: 35-40%',
          },
          {
            label: 'Позиций с низкой маржой (<15%)',
            value: lowMarginProducts.length.toString(),
          },
          {
            label: 'Средняя маржа низкомаржинальных позиций',
            value: lowMarginProducts.length > 0
              ? formatPercent(
                  lowMarginProducts.reduce((sum, p) => sum + p.averageMargin, 0) /
                    lowMarginProducts.length /
                    100,
                )
              : '—',
          },
          {
            label: 'Волатильность маржи',
            value: marginStdDev > 0 && avgMargin > 0
              ? formatPercent(marginStdDev / avgMargin)
              : '—',
          },
        ],
        roi: {
          investment: 'Ревизия цен и поставщиков (20-40 часов)',
          return: formatCurrency(potentialGain),
          timeframe: '1-2 месяца',
        },
      });
    } else if (summary.grossMargin >= 30 && summary.grossMargin < 40) {
      const lowMarginProducts = topProductsData.bottomProducts.filter((p) => p.averageMargin < 20);
      const potentialGain = (summary.netRevenue * 0.38 - summary.grossProfit) * 0.85;
      
      recs.push({
        type: 'warning',
        priority: 'medium',
        category: 'margin',
        title: 'Маржа ниже оптимального уровня',
        description: `Валовая маржа ${formatPercent(
          summary.grossMargin / 100,
        )} находится в приемлемом диапазоне, но есть потенциал для роста.`,
        action:
          'Проанализируйте позиции с низкой маржой и рассмотрите возможность их оптимизации или замены более прибыльными альтернативами.',
        trend: marginTrend || undefined,
        metrics: [
          {
            label: 'Текущая маржа',
            value: formatPercent(summary.grossMargin / 100),
            comparison: 'Оптимальная: 35-40%',
          },
          {
            label: 'Позиций с маржой <20%',
            value: lowMarginProducts.length.toString(),
          },
        ],
        impact: `Повышение маржи до 38% добавит ${formatCurrency(potentialGain)} прибыли.`,
        roi: {
          investment: 'Оптимизация ассортимента (10-20 часов)',
          return: formatCurrency(potentialGain),
          timeframe: '1 месяц',
        },
      });
    } else {
      recs.push({
        type: 'success',
        priority: 'low',
        category: 'margin',
        title: 'Хорошая валовая маржа',
        description: `Валовая маржа ${formatPercent(
          summary.grossMargin / 100,
        )} находится на оптимальном уровне.`,
        action: 'Продолжайте поддерживать текущий уровень маржи и ищите возможности для дальнейшей оптимизации.',
        trend: marginTrend || undefined,
        metrics: [
          {
            label: 'Текущая маржа',
            value: formatPercent(summary.grossMargin / 100),
            comparison: 'В оптимальном диапазоне ✓',
          },
        ],
      });
    }

    // Анализ потерь от скидок и бонусов с расширенной аналитикой
    if (summary.totalLossesPercent > 15) {
      const potentialSavings = summary.totalLosses - summary.netRevenue * 0.1;
      const discountRate = summary.netRevenue > 0 ? (summary.totalDiscounts / summary.netRevenue) * 100 : 0;
      const bonusRate = summary.netRevenue > 0 ? (summary.totalBonuses / summary.netRevenue) * 100 : 0;
      recs.push({
        type: 'error',
        priority: 'high',
        category: 'costs',
        title: 'Высокие потери от скидок и бонусов',
        description: `Потери от скидок и бонусов составляют ${formatPercent(
          summary.totalLossesPercent / 100,
        )} от выручки (${formatCurrency(summary.totalLosses)}). Это критически высокий уровень.`,
        action:
          'Пересмотрите политику скидок и бонусной программы. Ограничьте размер скидок, ужесточите условия начисления бонусов. Рассмотрите замену скидок на дополнительные услуги.',
        impact: `Снижение потерь до 10% даст дополнительно ${formatCurrency(
          potentialSavings,
        )} выручки.`,
        metrics: [
          {
            label: 'Общие потери',
            value: formatCurrency(summary.totalLosses),
            comparison: `Норма: ${formatCurrency(summary.netRevenue * 0.1)}`,
          },
          {
            label: 'Доля скидок',
            value: formatPercent(discountRate / 100),
            comparison: 'Норма: 5-8%',
          },
          {
            label: 'Доля бонусов',
            value: formatPercent(bonusRate / 100),
            comparison: 'Норма: 3-5%',
          },
          {
            label: 'Процент потерь',
            value: formatPercent(summary.totalLossesPercent / 100),
            comparison: 'Критично: >15%',
          },
        ],
        roi: {
          investment: 'Ревизия программ лояльности (10-15 часов)',
          return: formatCurrency(potentialSavings),
          timeframe: '1 месяц',
        },
      });
    } else if (summary.totalLossesPercent > 10 && summary.totalLossesPercent <= 15) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Повышенные потери от скидок и бонусов',
        description: `Потери составляют ${formatPercent(
          summary.totalLossesPercent / 100,
        )} (${formatCurrency(summary.totalLosses)}). Рекомендуется снизить до 8-10%.`,
        action:
          'Проанализируйте эффективность скидок и бонусов. Возможно, стоит уменьшить частоту или размер акций.',
      });
    }

    // Анализ бонусов
    if (summary.bonusesPercent > 8) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Высокое списание бонусов',
        description: `Списание бонусов составляет ${formatPercent(
          summary.bonusesPercent / 100,
        )} от выручки (${formatCurrency(summary.totalBonuses)}).`,
        action:
          'Пересмотрите условия списания бонусов. Увеличьте срок действия, снизьте размер списания или ограничьте применение бонусов определенными категориями товаров.',
      });
    }

    // Анализ скидок
    if (summary.discountsPercent > 8) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Высокий уровень скидок',
        description: `Скидки составляют ${formatPercent(
          summary.discountsPercent / 100,
        )} от выручки (${formatCurrency(summary.totalDiscounts)}).`,
        action:
          'Оцените эффективность скидочных акций. Возможно, стоит уменьшить размер или частоту скидок, фокусируясь на более прибыльных позициях.',
      });
    }

    // Анализ позиций с негативной маржой
    if (topProductsData.negativeMarginProducts.length > 0) {
      const totalLoss = topProductsData.negativeMarginProducts.reduce(
        (sum, p) => sum + Math.abs(p.totalProfit),
        0,
      );
      recs.push({
        type: 'error',
        priority: 'high',
        title: 'Позиции с убыточной маржой',
        description: `Обнаружено ${topProductsData.negativeMarginProducts.length} позиций с отрицательной маржой, которые генерируют убыток ${formatCurrency(
          totalLoss,
        )}.`,
        action:
          'Немедленно пересмотрите цены или себестоимость этих позиций. Либо поднимите цены, либо найдите более дешевых поставщиков, либо исключите эти позиции из ассортимента.',
        impact: `Устранение убыточных позиций добавит ${formatCurrency(totalLoss)} к прибыли.`,
      });
    }

    // Анализ позиций с низкой маржой
    if (topProductsData.bottomProducts.length > 0) {
      const lowMarginProducts = topProductsData.bottomProducts.filter(
        (p) => p.averageMargin < 15,
      );
      if (lowMarginProducts.length > 0) {
        recs.push({
          type: 'warning',
          priority: 'medium',
          title: 'Позиции с низкой маржой',
          description: `Обнаружено ${lowMarginProducts.length} позиций с маржой менее 15%.`,
          action:
            'Проанализируйте эти позиции: возможно, стоит повысить цены или оптимизировать закупки. Рассмотрите замену на более прибыльные альтернативы.',
        });
      }
    }

    // Анализ возвратов
    if (kpi.returnRate > 0.05) {
      recs.push({
        type: 'error',
        priority: 'high',
        title: 'Высокий процент возвратов',
        description: `Процент возвратов составляет ${formatPercent(kpi.returnRate)}, что выше нормы (норма < 3%). Возвраты составляют ${formatCurrency(
          kpi.returns,
        )}.`,
        action:
          'Проанализируйте причины возвратов: качество продукции, обслуживание, ошибки при заказе. Улучшите контроль качества и обучение персонала.',
        impact: `Снижение возвратов до 2% сэкономит ${formatCurrency(
          kpi.returns - kpi.grossRevenue * 0.02,
        )}.`,
      });
    } else if (kpi.returnRate > 0.03 && kpi.returnRate <= 0.05) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Повышенный уровень возвратов',
        description: `Процент возвратов ${formatPercent(kpi.returnRate)} немного выше нормы.`,
        action:
          'Следите за причинами возвратов и принимайте превентивные меры для их снижения.',
      });
    }

    // Анализ тренда среднего чека
    const avgCheckValues = daily
      .filter((d) => d.incomeChecks > 0)
      .map((d) => d.netRevenue / d.incomeChecks);
    const avgCheckTrend = avgCheckValues.length > 0 ? calculateTrend(avgCheckValues) : null;

    // Анализ среднего чека с расширенной аналитикой
    const avgCheckTarget = 350; // Целевой средний чек для кофейни
    const avgCheckStdDev = avgCheckValues.length > 0
      ? Math.sqrt(
          avgCheckValues.reduce((sum, val) => {
            const avg = avgCheckValues.reduce((a, b) => a + b, 0) / avgCheckValues.length;
            return sum + Math.pow(val - avg, 2);
          }, 0) / avgCheckValues.length,
        )
      : 0;
    const avgCheckVariation = kpi.averageCheck > 0 ? (avgCheckStdDev / kpi.averageCheck) * 100 : 0;

    if (kpi.averageCheck < avgCheckTarget * 0.8) {
      const potentialRevenue = (avgCheckTarget - kpi.averageCheck) * kpi.incomeChecks;
      const topProducts = topProductsData.products.slice(0, 5);
      const avgTopProductPrice = topProducts.reduce((sum, p) => sum + p.averagePrice, 0) / topProducts.length;

      recs.push({
        type: 'warning',
        priority: 'medium',
        category: 'revenue',
        title: 'Низкий средний чек',
        description: `Средний чек ${formatCurrency(
          kpi.averageCheck,
        )} ниже целевого уровня (${formatCurrency(avgCheckTarget)}).`,
        action:
          'Внедрите программы upselling и cross-selling. Предлагайте дополнительные позиции, комбо-наборы, десерты. Обучите персонал предлагать дополнения к заказу.',
        impact: `Увеличение среднего чека до ${formatCurrency(
          avgCheckTarget,
        )} при текущем количестве чеков даст дополнительно ${formatCurrency(potentialRevenue)} выручки.`,
        trend: avgCheckTrend || undefined,
        metrics: [
          {
            label: 'Текущий средний чек',
            value: formatCurrency(kpi.averageCheck),
            comparison: `Целевой: ${formatCurrency(avgCheckTarget)}`,
          },
          {
            label: 'Волатильность чека',
            value: formatPercent(avgCheckVariation / 100),
            comparison: 'Норма: <15%',
          },
          {
            label: 'Средняя цена топ-позиций',
            value: formatCurrency(avgTopProductPrice),
            comparison: `Текущий чек: ${formatCurrency(kpi.averageCheck)}`,
          },
          {
            label: 'Потенциал роста',
            value: formatCurrency(avgCheckTarget - kpi.averageCheck),
            comparison: `${formatPercent(((avgCheckTarget - kpi.averageCheck) / kpi.averageCheck) / 100)} роста`,
          },
        ],
        roi: {
          investment: 'Обучение персонала и акции (5-10 часов)',
          return: formatCurrency(potentialRevenue),
          timeframe: '1 месяц',
        },
      });
    } else if (kpi.averageCheck >= avgCheckTarget) {
      recs.push({
        type: 'success',
        priority: 'low',
        category: 'revenue',
        title: 'Хороший средний чек',
        description: `Средний чек ${formatCurrency(kpi.averageCheck)} на хорошем уровне.`,
        action: 'Продолжайте поддерживать качество обслуживания и предлагать дополнительные позиции.',
        trend: avgCheckTrend || undefined,
        metrics: [
          {
            label: 'Текущий средний чек',
            value: formatCurrency(kpi.averageCheck),
            comparison: `Целевой: ${formatCurrency(avgCheckTarget)} ✓`,
          },
          {
            label: 'Волатильность',
            value: formatPercent(avgCheckVariation / 100),
          },
        ],
      });
    }

    // Анализ доли наличных
    if (kpi.cashShare > 0.5) {
      recs.push({
        type: 'info',
        priority: 'low',
        title: 'Высокая доля наличных платежей',
        description: `Доля наличных платежей составляет ${formatPercent(
          kpi.cashShare,
        )}. Это может создавать риски и неудобства.`,
        action:
          'Стимулируйте безналичные платежи: предлагайте скидки за оплату картой, установите минимальную сумму для карт. Это снизит риски и упростит учет.',
      });
    }

    // Анализ коррекций
    if (kpi.corrections > kpi.netRevenue * 0.02) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Высокий уровень коррекций',
        description: `Коррекции составляют ${formatCurrency(
          kpi.corrections,
        )} (${formatPercent(kpi.corrections / kpi.netRevenue)} от выручки).`,
        action:
          'Проанализируйте причины коррекций. Возможно, нужно улучшить обучение персонала работе с кассой или обновить оборудование.',
      });
    }

    // Анализ волатильности выручки
    const revenueCoefficientOfVariation = avgRevenue > 0 ? (revenueStdDev / avgRevenue) * 100 : 0;
    if (revenueCoefficientOfVariation > 40) {
      const lowDays = daily.filter((d) => d.netRevenue < avgRevenue * 0.7).length;
      const potentialStabilization = avgRevenue * 0.1 * (daily.length / 30); // Оценка на месяц
      
      recs.push({
        type: 'warning',
        priority: 'high',
        category: 'revenue',
        title: 'Высокая волатильность выручки',
        description: `Выручка сильно колеблется от дня ко дню (коэффициент вариации ${formatPercent(
          revenueCoefficientOfVariation / 100,
        )}). Это указывает на нестабильность бизнеса.`,
        action:
          'Внедрите систему прогнозирования и планирования. Анализируйте факторы, влияющие на выручку (день недели, погода, события). Создайте резервные планы для слабых дней.',
        trend: revenueTrend || undefined,
        metrics: [
          {
            label: 'Коэффициент вариации',
            value: formatPercent(revenueCoefficientOfVariation / 100),
            comparison: 'Норма: <30%',
          },
          {
            label: 'Средняя выручка',
            value: formatCurrency(avgRevenue),
          },
          {
            label: 'Стандартное отклонение',
            value: formatCurrency(revenueStdDev),
          },
          {
            label: 'Дней с низкой выручкой',
            value: `${lowDays} из ${daily.length}`,
            comparison: `${formatPercent((lowDays / daily.length) / 100)} от периода`,
          },
        ],
        impact: `Стабилизация выручки может увеличить средний показатель на ${formatCurrency(
          avgRevenue * 0.1,
        )} за счет устранения экстремальных падений.`,
        roi: {
          investment: 'Внедрение прогнозирования (15-25 часов)',
          return: formatCurrency(potentialStabilization),
          timeframe: '2-3 месяца',
        },
      });
    }

    // Анализ по дням недели
    const dayOfWeekAnalysis = daily.reduce((acc, d) => {
      const day = new Date(d.date).getDay();
      const dayName = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][day];
      if (!acc[dayName]) {
        acc[dayName] = { revenue: 0, count: 0 };
      }
      acc[dayName].revenue += d.netRevenue;
      acc[dayName].count += 1;
      return acc;
    }, {} as Record<string, { revenue: number; count: number }>);

    const dayAverages = Object.entries(dayOfWeekAnalysis).map(([day, data]) => ({
      day,
      avg: data.revenue / data.count,
    }));
    const weakestDay = dayAverages.reduce((min, curr) => (curr.avg < min.avg ? curr : min), dayAverages[0]);
    const strongestDay = dayAverages.reduce((max, curr) => (curr.avg > max.avg ? curr : max), dayAverages[0]);

    if (weakestDay && strongestDay && strongestDay.avg > weakestDay.avg * 1.5) {
      const potentialGain = (strongestDay.avg - weakestDay.avg) * (weakestDay.avg / strongestDay.avg) * 52; // Оценка на год
      
      recs.push({
        type: 'info',
        priority: 'medium',
        category: 'operations',
        title: 'Значительная разница по дням недели',
        description: `Выручка в ${weakestDay.day} в среднем на ${formatPercent(
          ((strongestDay.avg - weakestDay.avg) / strongestDay.avg) / 100,
        )} ниже, чем в ${strongestDay.day}.`,
        action:
          `Проанализируйте причины низкой выручки в ${weakestDay.day}. Возможно, нужны специальные акции, изменение расписания персонала или маркетинговые активности для привлечения клиентов в эти дни.`,
        metrics: [
          {
            label: `Средняя выручка в ${weakestDay.day}`,
            value: formatCurrency(weakestDay.avg),
          },
          {
            label: `Средняя выручка в ${strongestDay.day}`,
            value: formatCurrency(strongestDay.avg),
          },
          {
            label: 'Разница',
            value: formatCurrency(strongestDay.avg - weakestDay.avg),
            comparison: formatPercent(
              ((strongestDay.avg - weakestDay.avg) / strongestDay.avg) / 100,
            ),
          },
        ],
        impact: `Выравнивание выручки может добавить ${formatCurrency(potentialGain)} в год.`,
        roi: {
          investment: 'Анализ и оптимизация (10-15 часов)',
          return: formatCurrency(potentialGain),
          timeframe: '1 год',
        },
      });
    }

    // Общие рекомендации по оптимизации
    if (summary.grossProfit > 0 && summary.netRevenue > 0) {
      const profitMargin = (summary.grossProfit / summary.netRevenue) * 100;
      if (profitMargin < 25) {
        const topHighMarginProducts = topProductsData.products
          .filter((p) => p.averageMargin > 40)
          .slice(0, 5);
        const potentialGain = (summary.netRevenue * 0.28 - summary.grossProfit) * 0.85;
        
        recs.push({
          type: 'info',
          priority: 'medium',
          category: 'margin',
          title: 'Потенциал роста прибыльности',
          description: `Текущая рентабельность по валовой прибыли ${formatPercent(
            profitMargin / 100,
          )}. Есть потенциал для роста до 28-30%.`,
          action:
            'Комплексный подход: оптимизируйте цены на топ-позиции, снизьте потери от скидок, улучшите ассортиментную политику. Фокусируйтесь на позициях с высокой маржой.',
          metrics: [
            {
              label: 'Текущая рентабельность',
              value: formatPercent(profitMargin / 100),
              comparison: 'Целевая: 28-30%',
            },
            {
              label: 'Высокомаржинальных позиций (>40%)',
              value: topHighMarginProducts.length.toString(),
            },
          ],
          impact: `Повышение рентабельности до 28% добавит ${formatCurrency(potentialGain)} прибыли.`,
          roi: {
            investment: 'Комплексная оптимизация (30-50 часов)',
            return: formatCurrency(potentialGain),
            timeframe: '2-3 месяца',
          },
        });
      }
    }

    // Сортируем по приоритету: error > warning > info > success, затем по high > medium > low
    const priorityOrder = { error: 0, warning: 1, info: 2, success: 3 };
    const importanceOrder = { high: 0, medium: 1, low: 2 };

    return recs.sort((a, b) => {
      const typeDiff = priorityOrder[a.type] - priorityOrder[b.type];
      if (typeDiff !== 0) return typeDiff;
      return importanceOrder[a.priority] - importanceOrder[b.priority];
    });
  }, [analytics, topProductsData]);

  if (!analytics || !topProductsData) {
    return null;
  }

  if (recommendations.length === 0) {
    return null;
  }

  const getIcon = (type: Recommendation['type']) => {
    switch (type) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-600" />;
      case 'success':
        return <TrendingUp className="w-5 h-5 text-emerald-600" />;
      case 'info':
        return <Lightbulb className="w-5 h-5 text-blue-600" />;
    }
  };

  const getTypeStyles = (type: Recommendation['type']) => {
    switch (type) {
      case 'error':
        return 'border-destructive/30 bg-destructive/5';
      case 'warning':
        return 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20';
      case 'success':
        return 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20';
      case 'info':
        return 'border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20';
    }
  };

  const getPriorityBadge = (priority: Recommendation['priority']) => {
    const variants = {
      high: 'destructive',
      medium: 'default',
      low: 'secondary',
    } as const;
    const labels = {
      high: 'Высокий',
      medium: 'Средний',
      low: 'Низкий',
    };
    return (
      <Badge variant={variants[priority]} className="text-xs">
        {labels[priority]}
      </Badge>
    );
  };

  const highPriorityRecs = recommendations.filter((r) => r.priority === 'high');
  const otherRecs = recommendations.filter((r) => r.priority !== 'high');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="space-y-4"
    >
      <div className="flex items-center gap-3 mb-2">
        <Target className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold">Рекомендации по улучшению финансов</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        На основе анализа всех показателей рентабельности формируются конкретные рекомендации
        для оптимизации финансовых результатов кофейни.
      </p>

      {highPriorityRecs.length > 0 && (
        <div className="space-y-4 mb-6">
          <h3 className="text-lg font-semibold text-destructive flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Критические проблемы (требуют немедленного внимания)
          </h3>
          {highPriorityRecs.map((rec, idx) => (
            <Card key={`high-${idx}`} className={`p-5 ${getTypeStyles(rec.type)}`}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-0.5">{getIcon(rec.type)}</div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-semibold text-base">{rec.title}</h4>
                    {getPriorityBadge(rec.priority)}
                  </div>
                  <p className="text-sm text-muted-foreground">{rec.description}</p>
                  {rec.trend && (
                    <div className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded-md">
                      {rec.trend.direction === 'up' ? (
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                      ) : rec.trend.direction === 'down' ? (
                        <TrendingDown className="w-4 h-4 text-destructive" />
                      ) : (
                        <Activity className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">
                        Тренд: {rec.trend.direction === 'up' ? 'рост' : rec.trend.direction === 'down' ? 'падение' : 'стабильно'}{' '}
                        на {rec.trend.value.toFixed(1)}% {rec.trend.period}
                      </span>
                    </div>
                  )}

                  {rec.metrics && rec.metrics.length > 0 && (
                    <div className="bg-muted/30 p-3 rounded-md space-y-2">
                      <p className="text-xs font-semibold flex items-center gap-2 mb-2">
                        <BarChart3 className="w-4 h-4" />
                        Детальные метрики:
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {rec.metrics.map((metric, idx) => (
                          <div key={idx} className="text-sm">
                            <p className="font-medium text-foreground">{metric.label}:</p>
                            <p className="text-muted-foreground">
                              <span className="font-semibold">{metric.value}</span>
                              {metric.comparison && (
                                <span className="text-xs ml-2 text-muted-foreground">
                                  ({metric.comparison})
                                </span>
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm font-medium">{rec.action}</p>
                    </div>
                    {rec.impact && (
                      <div className="flex items-start gap-2 bg-primary/5 dark:bg-primary/10 p-3 rounded-md border border-primary/20">
                        <DollarSign className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                        <p className="text-sm">
                          <span className="font-semibold">Потенциальный эффект:</span>{' '}
                          {rec.impact}
                        </p>
                      </div>
                    )}
                    {rec.roi && (
                      <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-md border border-emerald-200/30 dark:border-emerald-800/30">
                        <p className="text-xs font-semibold mb-2 flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
                          <Sparkles className="w-4 h-4" />
                          ROI анализ:
                        </p>
                        <div className="space-y-1 text-sm">
                          <p>
                            <span className="font-medium">Инвестиции:</span>{' '}
                            <span className="text-muted-foreground">{rec.roi.investment}</span>
                          </p>
                          <p>
                            <span className="font-medium">Возврат:</span>{' '}
                            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{rec.roi.return}</span>
                          </p>
                          <p>
                            <span className="font-medium">Срок:</span>{' '}
                            <span className="text-muted-foreground">{rec.roi.timeframe}</span>
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {otherRecs.length > 0 && (
        <div className="space-y-4">
          {highPriorityRecs.length > 0 && (
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Дополнительные рекомендации для оптимизации
            </h3>
          )}
          {otherRecs.map((rec, idx) => (
            <Card key={`other-${idx}`} className={`p-5 ${getTypeStyles(rec.type)}`}>
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-0.5">{getIcon(rec.type)}</div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="font-semibold text-base">{rec.title}</h4>
                    {getPriorityBadge(rec.priority)}
                  </div>
                  <p className="text-sm text-muted-foreground">{rec.description}</p>
                  
                  {rec.trend && (
                    <div className="flex items-center gap-2 text-sm bg-muted/50 p-2 rounded-md">
                      {rec.trend.direction === 'up' ? (
                        <TrendingUp className="w-4 h-4 text-emerald-600" />
                      ) : rec.trend.direction === 'down' ? (
                        <TrendingDown className="w-4 h-4 text-destructive" />
                      ) : (
                        <Activity className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">
                        Тренд: {rec.trend.direction === 'up' ? 'рост' : rec.trend.direction === 'down' ? 'падение' : 'стабильно'}{' '}
                        на {rec.trend.value.toFixed(1)}% {rec.trend.period}
                      </span>
                    </div>
                  )}

                  {rec.metrics && rec.metrics.length > 0 && (
                    <div className="bg-muted/30 p-3 rounded-md space-y-2">
                      <p className="text-xs font-semibold flex items-center gap-2 mb-2">
                        <BarChart3 className="w-4 h-4" />
                        Детальные метрики:
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {rec.metrics.map((metric, idx) => (
                          <div key={idx} className="text-sm">
                            <p className="font-medium text-foreground">{metric.label}:</p>
                            <p className="text-muted-foreground">
                              <span className="font-semibold">{metric.value}</span>
                              {metric.comparison && (
                                <span className="text-xs ml-2 text-muted-foreground">
                                  ({metric.comparison})
                                </span>
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm font-medium">{rec.action}</p>
                  </div>
                  {rec.impact && (
                    <div className="flex items-start gap-2 bg-primary/5 dark:bg-primary/10 p-3 rounded-md border border-primary/20 mt-2">
                      <DollarSign className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <p className="text-sm">
                        <span className="font-semibold">Потенциальный эффект:</span> {rec.impact}
                      </p>
                    </div>
                  )}
                  {rec.roi && (
                    <div className="bg-emerald-50/50 dark:bg-emerald-950/20 p-3 rounded-md border border-emerald-200/30 dark:border-emerald-800/30 mt-2">
                      <p className="text-xs font-semibold mb-2 flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
                        <Sparkles className="w-4 h-4" />
                        ROI анализ:
                      </p>
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="font-medium">Инвестиции:</span>{' '}
                          <span className="text-muted-foreground">{rec.roi.investment}</span>
                        </p>
                        <p>
                          <span className="font-medium">Возврат:</span>{' '}
                          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{rec.roi.return}</span>
                        </p>
                        <p>
                          <span className="font-medium">Срок:</span>{' '}
                          <span className="text-muted-foreground">{rec.roi.timeframe}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {recommendations.length === 0 && (
        <Card className="p-6 border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <div>
              <h4 className="font-semibold text-emerald-900 dark:text-emerald-100">
                Отличные показатели!
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Все финансовые показатели находятся в оптимальном диапазоне. Продолжайте
                поддерживать текущий уровень операционной эффективности.
              </p>
            </div>
          </div>
        </Card>
      )}
    </motion.div>
  );
}

