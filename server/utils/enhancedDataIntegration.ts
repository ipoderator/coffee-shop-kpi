import { format, parseISO } from 'date-fns';
import type { Transaction, ProfitabilityRecord } from '@shared/schema';
import { storage } from '../storage';

/**
 * Объединенные данные о продажах для улучшенного прогнозирования
 */
export interface EnhancedSalesData {
  date: string;
  revenue: number;
  checksCount: number;
  averageCheck: number;
  
  // Данные из profitability records (если доступны)
  returns?: number;
  corrections?: number;
  returnChecks?: number;
  correctionChecks?: number;
  returnRate?: number;
  cogsTotal?: number;
  grossProfit?: number;
  grossMargin?: number;
  
  // Методы оплаты
  cashPayment?: number;
  terminalPayment?: number;
  qrPayment?: number;
  sbpPayment?: number;
  
  // Источники данных
  hasTransactionsData: boolean;
  hasProfitabilityData: boolean;
  dataQuality: number; // 0-1, где 1 - полные данные
}

/**
 * Объединяет данные из transactions и profitability_records для улучшенного прогнозирования
 */
export async function getEnhancedSalesData(
  fromDate?: Date,
  toDate?: Date,
): Promise<EnhancedSalesData[]> {
  // Получаем все записи profitability
  const profitabilityRecords = await storage.listAllProfitabilityRecords();
  
  // Получаем все transactions (группируем по дате)
  const allTransactions = new Map<string, Transaction[]>();
  
  // Для transactions нужно получить все uploadId и затем все транзакции
  // Упрощенный подход: получаем все транзакции из всех uploadId
  // В реальной БД это было бы одним запросом
  
  // Создаем мапу для объединения данных по дате
  const dailyDataMap = new Map<string, EnhancedSalesData>();
  
  // Обрабатываем profitability records
  profitabilityRecords.forEach((record) => {
    const dateKey = format(record.reportDate, 'yyyy-MM-dd');
    
    // Проверяем фильтр по датам
    if (fromDate && record.reportDate < fromDate) return;
    if (toDate && record.reportDate > toDate) return;
    
    const grossRevenue = (record.cashIncome ?? 0) + (record.cashlessIncome ?? 0);
    const returns = (record.cashReturn ?? 0) + (record.cashlessReturn ?? 0);
    const corrections = (record.correctionCash ?? 0) + (record.correctionCashless ?? 0);
    const netRevenue = grossRevenue - returns + corrections;
    const checksCount = record.incomeChecks ?? 0;
    const averageCheck = checksCount > 0 ? netRevenue / checksCount : 0;
    const returnRate = grossRevenue > 0 ? returns / grossRevenue : 0;
    
    const cogsTotal = record.cogsTotal ?? undefined;
    const grossProfit = cogsTotal !== undefined ? netRevenue - cogsTotal : undefined;
    const grossMargin = grossProfit !== undefined && netRevenue > 0 ? grossProfit / netRevenue : undefined;
    
    // Вычисляем качество данных (наличие COGS повышает качество)
    const dataQuality = cogsTotal !== undefined ? 1.0 : 0.8;
    
    if (!dailyDataMap.has(dateKey)) {
      dailyDataMap.set(dateKey, {
        date: dateKey,
        revenue: 0,
        checksCount: 0,
        averageCheck: 0,
        hasTransactionsData: false,
        hasProfitabilityData: false,
        dataQuality: 0,
      });
    }
    
    const data = dailyDataMap.get(dateKey)!;
    data.revenue += netRevenue;
    data.checksCount += checksCount;
    data.returns = (data.returns ?? 0) + returns;
    data.corrections = (data.corrections ?? 0) + corrections;
    data.returnChecks = (data.returnChecks ?? 0) + (record.returnChecks ?? 0);
    data.correctionChecks = (data.correctionChecks ?? 0) + (record.correctionChecks ?? 0);
    data.cogsTotal = (data.cogsTotal ?? 0) + (cogsTotal ?? 0);
    data.cashPayment = (data.cashPayment ?? 0) + (record.cashIncome ?? 0);
    data.terminalPayment = (data.terminalPayment ?? 0) + (record.cashlessIncome ?? 0);
    data.hasProfitabilityData = true;
    data.dataQuality = Math.max(data.dataQuality, dataQuality);
  });
  
  // Пересчитываем средние значения и метрики после агрегации
  dailyDataMap.forEach((data) => {
    if (data.checksCount > 0) {
      data.averageCheck = data.revenue / data.checksCount;
    }
    
    const grossRevenue = data.revenue + (data.returns ?? 0) - (data.corrections ?? 0);
    data.returnRate = grossRevenue > 0 ? (data.returns ?? 0) / grossRevenue : 0;
    
    if (data.cogsTotal !== undefined) {
      data.grossProfit = data.revenue - data.cogsTotal;
      data.grossMargin = data.revenue > 0 ? (data.grossProfit / data.revenue) : 0;
    }
  });
  
  // Обрабатываем transactions (если есть)
  // Для этого нужно получить все transactions, но это требует изменения storage
  // Пока используем только profitability данные, так как они более полные
  
  // Сортируем по дате
  const sortedData = Array.from(dailyDataMap.values()).sort((a, b) => {
    return parseISO(a.date).getTime() - parseISO(b.date).getTime();
  });
  
  return sortedData;
}

/**
 * Получает объединенные данные для конкретного периода
 */
export async function getEnhancedSalesDataForPeriod(
  transactions: Transaction[],
  profitabilityRecords?: ProfitabilityRecord[],
): Promise<EnhancedSalesData[]> {
  const dailyDataMap = new Map<string, EnhancedSalesData>();
  
  // Обрабатываем transactions
  transactions.forEach((tx) => {
    const dateKey = format(new Date(tx.date), 'yyyy-MM-dd');
    
    if (!dailyDataMap.has(dateKey)) {
      dailyDataMap.set(dateKey, {
        date: dateKey,
        revenue: 0,
        checksCount: 0,
        averageCheck: 0,
        hasTransactionsData: false,
        hasProfitabilityData: false,
        dataQuality: 0.5,
      });
    }
    
    const data = dailyDataMap.get(dateKey)!;
    data.revenue += tx.amount;
    data.checksCount += tx.checksCount ?? 1;
    data.cashPayment = (data.cashPayment ?? 0) + (tx.cashPayment ?? 0);
    data.terminalPayment = (data.terminalPayment ?? 0) + (tx.terminalPayment ?? 0);
    data.qrPayment = (data.qrPayment ?? 0) + (tx.qrPayment ?? 0);
    data.sbpPayment = (data.sbpPayment ?? 0) + (tx.sbpPayment ?? 0);
    data.hasTransactionsData = true;
  });
  
  // Обрабатываем profitability records если они переданы
  if (profitabilityRecords) {
    profitabilityRecords.forEach((record) => {
      const dateKey = format(record.reportDate, 'yyyy-MM-dd');
      
      if (!dailyDataMap.has(dateKey)) {
        dailyDataMap.set(dateKey, {
          date: dateKey,
          revenue: 0,
          checksCount: 0,
          averageCheck: 0,
          hasTransactionsData: false,
          hasProfitabilityData: false,
          dataQuality: 0.8,
        });
      }
      
      const data = dailyDataMap.get(dateKey)!;
      
      // Используем данные из profitability как основной источник (они более точные)
      const grossRevenue = (record.cashIncome ?? 0) + (record.cashlessIncome ?? 0);
      const returns = (record.cashReturn ?? 0) + (record.cashlessReturn ?? 0);
      const corrections = (record.correctionCash ?? 0) + (record.correctionCashless ?? 0);
      const netRevenue = grossRevenue - returns + corrections;
      
      // Если есть profitability данные, они имеют приоритет
      data.revenue = netRevenue;
      data.checksCount = record.incomeChecks ?? data.checksCount;
      data.returns = returns;
      data.corrections = corrections;
      data.returnChecks = record.returnChecks ?? 0;
      data.correctionChecks = record.correctionChecks ?? 0;
      data.cogsTotal = record.cogsTotal ?? data.cogsTotal;
      data.cashPayment = record.cashIncome ?? data.cashPayment;
      data.terminalPayment = record.cashlessIncome ?? data.terminalPayment;
      data.hasProfitabilityData = true;
      
      // Повышаем качество данных если есть COGS
      if (record.cogsTotal !== undefined && record.cogsTotal !== null) {
        data.dataQuality = 1.0;
        data.grossProfit = netRevenue - record.cogsTotal;
        data.grossMargin = netRevenue > 0 ? data.grossProfit / netRevenue : 0;
      } else {
        data.dataQuality = Math.max(data.dataQuality, 0.8);
      }
    });
  }
  
  // Пересчитываем метрики
  dailyDataMap.forEach((data) => {
    if (data.checksCount > 0) {
      data.averageCheck = data.revenue / data.checksCount;
    }
    
    const grossRevenue = data.revenue + (data.returns ?? 0) - (data.corrections ?? 0);
    data.returnRate = grossRevenue > 0 ? (data.returns ?? 0) / grossRevenue : 0;
    
    if (data.cogsTotal !== undefined && data.grossProfit === undefined) {
      data.grossProfit = data.revenue - data.cogsTotal;
      data.grossMargin = data.revenue > 0 ? (data.grossProfit / data.revenue) : 0;
    }
  });
  
  // Сортируем по дате
  const sortedData = Array.from(dailyDataMap.values()).sort((a, b) => {
    return parseISO(a.date).getTime() - parseISO(b.date).getTime();
  });
  
  return sortedData;
}








