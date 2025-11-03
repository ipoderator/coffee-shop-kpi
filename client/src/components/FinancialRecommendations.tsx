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

    // Анализ маржи
    if (summary.grossMargin < 30) {
      recs.push({
        type: 'error',
        priority: 'high',
        title: 'Низкая валовая маржа',
        description: `Текущая валовая маржа составляет ${formatPercent(
          summary.grossMargin / 100,
        )}, что ниже рекомендуемого уровня в 30-40% для кофейни.`,
        action:
          'Пересмотрите ценообразование или оптимизируйте себестоимость. Рассмотрите возможность повышения цен на позиции с низкой маржой или поиск более дешевых поставщиков.',
        impact: `Увеличение маржи до 35% принесет дополнительно ${formatCurrency(
          (summary.netRevenue * 0.35 - summary.grossProfit) * 0.85,
        )} чистой прибыли.`,
      });
    } else if (summary.grossMargin >= 30 && summary.grossMargin < 40) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Маржа ниже оптимального уровня',
        description: `Валовая маржа ${formatPercent(
          summary.grossMargin / 100,
        )} находится в приемлемом диапазоне, но есть потенциал для роста.`,
        action:
          'Проанализируйте позиции с низкой маржой и рассмотрите возможность их оптимизации или замены более прибыльными альтернативами.',
      });
    } else {
      recs.push({
        type: 'success',
        priority: 'low',
        title: 'Хорошая валовая маржа',
        description: `Валовая маржа ${formatPercent(
          summary.grossMargin / 100,
        )} находится на оптимальном уровне.`,
        action: 'Продолжайте поддерживать текущий уровень маржи и ищите возможности для дальнейшей оптимизации.',
      });
    }

    // Анализ потерь от скидок и бонусов
    if (summary.totalLossesPercent > 15) {
      recs.push({
        type: 'error',
        priority: 'high',
        title: 'Высокие потери от скидок и бонусов',
        description: `Потери от скидок и бонусов составляют ${formatPercent(
          summary.totalLossesPercent / 100,
        )} от выручки (${formatCurrency(summary.totalLosses)}). Это критически высокий уровень.`,
        action:
          'Пересмотрите политику скидок и бонусной программы. Ограничьте размер скидок, ужесточите условия начисления бонусов. Рассмотрите замену скидок на дополнительные услуги.',
        impact: `Снижение потерь до 10% даст дополнительно ${formatCurrency(
          summary.totalLosses - summary.netRevenue * 0.1,
        )} выручки.`,
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

    // Анализ среднего чека
    const avgCheckTarget = 350; // Целевой средний чек для кофейни
    if (kpi.averageCheck < avgCheckTarget * 0.8) {
      recs.push({
        type: 'warning',
        priority: 'medium',
        title: 'Низкий средний чек',
        description: `Средний чек ${formatCurrency(
          kpi.averageCheck,
        )} ниже целевого уровня (${formatCurrency(avgCheckTarget)}).`,
        action:
          'Внедрите программы upselling и cross-selling. Предлагайте дополнительные позиции, комбо-наборы, десерты. Обучите персонал предлагать дополнения к заказу.',
        impact: `Увеличение среднего чека до ${formatCurrency(
          avgCheckTarget,
        )} при текущем количестве чеков даст дополнительно ${formatCurrency(
          (avgCheckTarget - kpi.averageCheck) * kpi.incomeChecks,
        )} выручки.`,
      });
    } else if (kpi.averageCheck >= avgCheckTarget) {
      recs.push({
        type: 'success',
        priority: 'low',
        title: 'Хороший средний чек',
        description: `Средний чек ${formatCurrency(kpi.averageCheck)} на хорошем уровне.`,
        action: 'Продолжайте поддерживать качество обслуживания и предлагать дополнительные позиции.',
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

    // Общие рекомендации по оптимизации
    if (summary.grossProfit > 0 && summary.netRevenue > 0) {
      const profitMargin = (summary.grossProfit / summary.netRevenue) * 100;
      if (profitMargin < 25) {
        recs.push({
          type: 'info',
          priority: 'medium',
          title: 'Потенциал роста прибыльности',
          description: `Текущая рентабельность по валовой прибыли ${formatPercent(
            profitMargin / 100,
          )}.`,
          action:
            'Комплексный подход: оптимизируйте цены на топ-позиции, снизьте потери от скидок, улучшите ассортиментную политику. Фокусируйтесь на позициях с высокой маржой.',
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

