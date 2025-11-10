import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  varchar,
  timestamp,
  real,
  integer,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

// Transaction/Sale record from uploaded file
export const transactions = pgTable('transactions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  date: timestamp('date').notNull(),
  year: integer('year'),
  month: integer('month'),
  amount: real('amount').notNull(),
  costOfGoods: real('cost_of_goods'),
  checksCount: integer('checks_count').default(1), // Количество чеков (по умолчанию 1)
  cashPayment: real('cash_payment'),
  terminalPayment: real('terminal_payment'),
  qrPayment: real('qr_payment'),
  sbpPayment: real('sbp_payment'),
  refundChecksCount: integer('refund_checks_count'), // Количество возвратов
  refundCashPayment: real('refund_cash_payment'), // Возврат наличными
  refundTerminalPayment: real('refund_terminal_payment'), // Возврат безналичными
  refundQrPayment: real('refund_qr_payment'), // Возврат QR
  refundSbpPayment: real('refund_sbp_payment'), // Возврат СБП
  category: text('category'),
  employee: text('employee'),
  uploadId: varchar('upload_id').notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

export const profitabilityRecords = pgTable('profitability_records', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  datasetId: varchar('dataset_id').notNull(),
  reportDate: timestamp('report_date').notNull(),
  shiftNumber: varchar('shift_number'),
  incomeChecks: integer('income_checks').default(0).notNull(),
  cashIncome: real('cash_income').default(0).notNull(),
  cashlessIncome: real('cashless_income').default(0).notNull(),
  returnChecks: integer('return_checks').default(0).notNull(),
  cashReturn: real('cash_return').default(0).notNull(),
  cashlessReturn: real('cashless_return').default(0).notNull(),
  correctionChecks: integer('correction_checks').default(0).notNull(),
  correctionCash: real('correction_cash').default(0).notNull(),
  correctionCashless: real('correction_cashless').default(0).notNull(),
  cogsTotal: real('cogs_total'),
  cogsDetails: jsonb('cogs_details').$type<ProfitabilityCogsItem[] | null>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type ProfitabilityRecord = typeof profitabilityRecords.$inferSelect;
export interface ProfitabilityCogsItem {
  sku: string;
  amount: number;
  name?: string | null;
  category?: string | null;
}

export interface ProfitabilityDatasetInfo {
  id: string;
  name: string;
  createdAt: string;
  sourceFile?: string;
  periodStart: string;
  periodEnd: string;
  rows: number;
  totalBonuses?: number;
  totalDiscounts?: number;
  totalBonusAccrued?: number;
}

export interface ProfitabilityKPIs {
  grossRevenue: number;
  netRevenue: number;
  returns: number;
  corrections: number;
  averageCheck: number;
  incomeChecks: number;
  returnRate: number;
  cashShare: number;
  cashlessShare: number;
  cogsTotal?: number;
  grossProfit?: number;
  margin?: number;
}

export interface ProfitabilityDailyPoint {
  date: string;
  grossRevenue: number;
  netRevenue: number;
  returns: number;
  corrections: number;
  cashIncome: number;
  cashlessIncome: number;
  cashReturn: number;
  cashlessReturn: number;
  incomeChecks: number;
  returnChecks: number;
  correctionChecks: number;
  cogsTotal?: number;
  grossProfit?: number;
  margin?: number;
}

export type ProfitabilityTableRow = ProfitabilityDailyPoint;

export interface ProfitabilityAnalyticsResponse {
  dataset: ProfitabilityDatasetInfo;
  period: {
    from: string;
    to: string;
  };
  kpi: ProfitabilityKPIs;
  daily: ProfitabilityDailyPoint[];
  table: ProfitabilityTableRow[];
}

export type ProfitabilityImportStatus = 'success' | 'partial' | 'failed';

export interface ProfitabilityImportError {
  rowNumber: number;
  field?: string;
  message: string;
  value?: string | number | null;
}

export interface ProfitabilityImportLogEntry {
  id: string;
  status: ProfitabilityImportStatus;
  datasetId?: string;
  sourceFile?: string;
  rowsProcessed: number;
  periodStart?: string;
  periodEnd?: string;
  author?: string;
  createdAt: string;
  errors?: ProfitabilityImportError[];
  warnings?: string[];
}

export const DEFAULT_PROFITABILITY_MAX_CHECKS_PER_DAY = 5000;

export interface ProfitabilityUploadResponse {
  success: true;
  dataset: ProfitabilityDatasetInfo;
  rowsProcessed: number;
  log: ProfitabilityImportLogEntry;
  errors?: ProfitabilityImportError[];
  warnings?: string[];
}

export interface ProfitabilityImportResult {
  batchId: string;
  rowsOk: number;
  rowsFailed: number;
  periodFrom: string | null;
  periodTo: string | null;
  errors: ProfitabilityImportError[];
  warnings?: string[];
  datasetId?: string;
}

export interface ProfitabilitySummaryKPI {
  revenueGross: number;
  returns: number;
  corrections: number;
  revenueNet: number;
  receiptsCount: number;
  averageCheck: number;
  returnChecks: number;
  returnRate: number;
  revenueGrowthRate: number | null;
  movingAverage7: number | null;
  movingAverage28: number | null;
  grossProfit?: number | null;
  grossMarginPct?: number | null;
}

export interface ProfitabilityKPIDelta {
  revenueGross: number | null;
  returns: number | null;
  corrections: number | null;
  revenueNet: number | null;
  receiptsCount: number | null;
  averageCheck: number | null;
  returnChecks: number | null;
  returnRate: number | null;
  revenueGrowthRate: number | null;
  grossProfit?: number | null;
  grossMarginPct?: number | null;
}

export interface ProfitabilitySummaryResponse {
  period: {
    from: string;
    to: string;
  };
  previousPeriod: {
    from: string;
    to: string;
  };
  current: ProfitabilitySummaryKPI;
  previous: ProfitabilitySummaryKPI | null;
  delta: ProfitabilityKPIDelta;
  hasCogs: boolean;
  warnings?: string[];
}

export interface ProfitabilitySeriesPoint {
  date: string;
  revenueGross: number;
  returns: number;
  corrections: number;
  revenueNet: number;
  receiptsCount: number;
  averageCheck: number;
  returnChecks: number;
  returnRate: number;
  cogsTotal: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  movingAverage7: number | null;
  movingAverage28: number | null;
}

export interface ProfitabilitySeriesResponse {
  period: {
    from: string;
    to: string;
  };
  points: ProfitabilitySeriesPoint[];
  hasCogs: boolean;
}

export interface ProfitabilityTableEntry {
  date: string;
  revenueGross: number;
  returns: number;
  corrections: number;
  revenueNet: number;
  receiptsCount: number;
  returnChecks: number;
  correctionsCount: number;
  averageCheck: number;
  refundRatio: number;
  cogsTotal: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
}

export interface ProfitabilityTableResponse {
  period: {
    from: string;
    to: string;
  };
  rows: ProfitabilityTableEntry[];
  hasCogs: boolean;
}

export interface TopProduct {
  itemName: string;
  unitCost: number; // Себестоимость за единицу (средняя)
  averagePrice: number; // Средняя итоговая цена за единицу (после скидок/бонусов)
  averageProfit: number; // Валовая прибыль за единицу (средняя)
  averageMargin: number; // Валовая маржа за единицу (%)
  totalProfit: number; // Совокупная валовая прибыль по позиции за период
  salesCount: number; // Количество продаж за период
}

export interface PeriodSummary {
  netRevenue: number; // Выручка после скидок и бонусов
  cogs: number; // Себестоимость (COGS)
  grossProfit: number; // Валовая прибыль
  grossMargin: number; // Валовая маржа (%)
  totalBonuses: number; // Списано бонусов за период
  totalDiscounts: number; // Скидки за период
  totalBonusAccrued: number; // Начислено бонусов за период
  totalLosses: number; // Общие потери (скидки + бонусы) в рублях
  totalLossesPercent: number; // Общие потери в процентах от выручки
  bonusesPercent: number; // Потери от бонусов в процентах от валовой выручки
  discountsPercent: number; // Потери от скидок в процентах от валовой выручки
}

export interface TopProductsResponse {
  products: TopProduct[];
  bottomProducts: TopProduct[];
  negativeMarginProducts: TopProduct[];
  periodSummary: PeriodSummary;
}

// Users table for authentication
export const users = pgTable('users', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: varchar('email').notNull().unique(),
  password: varchar('password').notNull(),
  name: varchar('name').notNull(),
  role: varchar('role').default('user'), // user, admin
  isActive: boolean('is_active').default(true),
  // Security fields
  twoFactorSecret: varchar('two_factor_secret'), // для 2FA
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  lastLoginAt: timestamp('last_login_at'),
  lastLoginIp: varchar('last_login_ip'),
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  lockedUntil: timestamp('locked_until'),
  passwordChangedAt: timestamp('password_changed_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Security logs table
export const securityLogs = pgTable('security_logs', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id),
  action: varchar('action').notNull(), // login, logout, password_change, etc.
  ip: varchar('ip').notNull(),
  userAgent: text('user_agent'),
  success: boolean('success').notNull(),
  details: text('details'), // JSON string with additional details
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type SecurityLog = typeof securityLogs.$inferSelect;
export type InsertSecurityLog = typeof securityLogs.$inferInsert;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User sessions table
export const userSessions = pgTable('user_sessions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionToken: varchar('session_token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
});

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'role'> & {
  isActive?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

// Enhanced Weather data interface
export interface WeatherData {
  date: string;
  temperature: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  humidity?: number;
  cloudCover?: number;
  uvIndex?: number;
  visibility?: number;
  pressure?: number;
  feelsLike?: number;
  dewPoint?: number;
}

// Enhanced Holiday data interface
export interface HolidayData {
  date: string;
  name: string;
  type: 'national' | 'religious' | 'regional' | 'unofficial';
  country?: string;
  impact: number; // -1 to 1, where 1 is positive impact
  description?: string;
  isWorkDay?: boolean;
}

// Economic indicators interface
export interface EconomicIndicator {
  date: string;
  currency: string;
  exchangeRate: number;
  inflation?: number;
  consumerConfidence?: number;
  unemploymentRate?: number;
  gdpGrowth?: number;
  interestRate?: number;
  stockMarketIndex?: number;
}

// Traffic and mobility data interface
export interface TrafficData {
  date: string;
  location: string;
  congestionLevel: number; // 0-1
  averageSpeed: number;
  trafficVolume: number;
  roadConditions?: string;
  incidentCount?: number;
}

// Social media sentiment interface
export interface SocialSentiment {
  date: string;
  platform: string;
  sentiment: number; // -1 to 1
  volume: number;
  keywords: string[];
  engagement?: number;
  reach?: number;
}

// Demographic data interface
export interface DemographicData {
  date: string;
  location: string;
  population: number;
  ageGroups: { [key: string]: number };
  incomeLevels: { [key: string]: number };
  educationLevels: { [key: string]: number };
  employmentRate: number;
}

// TypeScript interfaces for analytics (not stored in DB)
export interface KPIMetrics {
  totalRevenue: number;
  averageCheck: number;
  totalChecks: number;
  totalCostOfGoods?: number;
  grossProfit?: number;
  grossMargin?: number;
  previousRevenue?: number;
  previousAverageCheck?: number;
  previousChecks?: number;
  revenueGrowth?: number;
  revenueGrowthDoD?: number; // Day-over-Day рост выручки
  averageCheckGrowth?: number;
  checksGrowth?: number;
  currentMonthTotalChecks?: number; // Общее количество чеков за текущий месяц
  currentMonthAvgChecksPerDay?: number; // Среднее количество чеков в день за текущий месяц
  revenueGrowthYoY?: number;
  grossProfitGrowth?: number;
  grossMarginChange?: number;
}

export interface ForecastData {
  date: string;
  predictedRevenue: number;
  confidence: number; // Уровень уверенности в прогнозе (0-1)
  trend: 'up' | 'down' | 'stable';
  weatherImpact?: number; // Влияние погоды на прогноз (-1 до 1)
  holidayImpact?: number; // Влияние праздников на прогноз (-1 до 1)
  economicImpact?: number; // Влияние экономических факторов (-1 до 1)
  trafficImpact?: number; // Влияние трафика и мобильности (-1 до 1)
  socialSentimentImpact?: number; // Влияние настроений в соцсетях (-1 до 1)
  demographicImpact?: number; // Влияние демографических факторов (-1 до 1)
  timeOfMonthImpact?: number; // Влияние времени месяца (-1 до 1)
  historicalPatternImpact?: number; // Влияние исторических паттернов (-1 до 1)
  economicCycleImpact?: number; // Влияние экономических циклов (-1 до 1)
  localEventImpact?: number; // Влияние локальных событий (-1 до 1)
  customerBehaviorImpact?: number; // Влияние поведения клиентов (-1 до 1)
  factors?: {
    weather: {
      temperature: number;
      precipitation: number;
      humidity?: number;
      windSpeed?: number;
      cloudCover?: number;
      uvIndex?: number;
      visibility?: number;
      impact: number;
    };
    economic: {
      exchangeRate: number;
      inflation?: number;
      consumerConfidence?: number;
      unemploymentRate?: number;
      impact: number;
    };
    traffic: {
      congestionLevel: number;
      averageSpeed: number;
      trafficVolume: number;
      impact: number;
    };
    social: {
      sentiment: number;
      volume: number;
      platforms: string[];
      impact: number;
    };
    demographic: {
      population: number;
      ageGroups: { [key: string]: number };
      incomeLevels: { [key: string]: number };
      employmentRate: number;
      impact: number;
    };
    holiday: {
      isHoliday: boolean;
      holidayType?: string;
      holidayName?: string;
      impact: number;
    };
    seasonality: number;
    trend: number;
    timeOfMonth: number;
    historicalPattern: number;
    economicCycle: number;
    localEvent: number;
    customerBehavior: number;
  };
}

export interface RevenueForecast {
  nextMonth: {
    predictedRevenue: number;
    confidence: number;
    dailyForecast: ForecastData[];
  };
  extendedForecast: {
    totalPredictedRevenue: number;
    averageConfidence: number;
    dailyForecast: ForecastData[];
    weeklyForecast: WeeklyForecast[];
    monthlyForecast: MonthlyForecast[];
  };
  methodology: {
    algorithm: string;
    dataPoints: number;
    seasonalAdjustment: boolean;
    trendAnalysis: boolean;
    weatherAnalysis: boolean;
    holidayAnalysis: boolean;
    forecastDays: number;
    betaVersion?: boolean;
    betaWarning?: string;
    timeOfMonthAnalysis?: boolean;
    historicalPatternAnalysis?: boolean;
    economicCycleAnalysis?: boolean;
    localEventAnalysis?: boolean;
    customerBehaviorAnalysis?: boolean;
    modelQualityMetrics?: Record<string, number>; // Метрики качества ML моделей (arima, prophet, lstm, llm, etc.)
    llmStatus?: {
      enabled: boolean;
      available: boolean;
      metrics?: {
        totalRequests: number;
        successfulRequests: number;
        failedRequests: number;
        cacheHits: number;
        averageResponseTime: number;
        successRate: number;
      };
    };
  };
}

export interface WeeklyForecast {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  predictedRevenue: number;
  confidence: number;
  dailyForecast: ForecastData[];
}

export interface MonthlyForecast {
  month: string; // YYYY-MM format
  monthName: string;
  predictedRevenue: number;
  confidence: number;
  dailyCount: number;
}

export interface PeriodData {
  period: string; // date string or month/year identifier
  revenue: number;
  checks: number;
  averageCheck: number;
  costOfGoods?: number;
  grossProfit?: number;
  grossMargin?: number;
}

export interface DayOfWeekData {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dayName: string; // Name of the day
  revenue: number;
  checks: number;
  averageCheck: number;
}

export interface MonthPeriodMetrics {
  revenue: number;
  checks: number;
  averageCheck: number;
  costOfGoods?: number;
  grossProfit?: number;
  grossMargin?: number;
  dailyData: PeriodData[];
  paymentBreakdown: {
    cash: number;
    terminal: number;
    qr: number;
    sbp: number;
  };
}

export interface DayMetrics {
  date: string;
  revenue: number;
  checks: number;
  averageCheck: number;
  costOfGoods?: number;
  grossProfit?: number;
  grossMargin?: number;
  paymentBreakdown: {
    cash: number;
    terminal: number;
    qr: number;
    sbp: number;
  };
}

export interface DayComparisonData {
  currentDay: DayMetrics | null;
  previousMonthSameDay: DayMetrics | null;
  comparison: {
    revenueGrowth: number;
    checksGrowth: number;
    averageCheckGrowth: number;
    grossProfitGrowth?: number;
    grossMarginChange?: number;
  } | null;
}

export interface MonthlyComparisonData {
  currentMonth: {
    period: string;
    metrics: MonthPeriodMetrics;
  };
  previousMonth: {
    period: string;
    metrics: MonthPeriodMetrics;
  };
  comparison: {
    revenueGrowth: number;
    checksGrowth: number;
    averageCheckGrowth: number;
    grossProfitGrowth?: number;
    grossMarginChange?: number;
  };
  dayComparison?: DayComparisonData;
}

export type AnalyticsDateFilterPreset = 'last7' | 'last28' | 'last90' | 'mtd' | 'ytd' | 'custom';

export interface AnalyticsPeriod {
  from: string;
  to: string;
  preset?: AnalyticsDateFilterPreset;
}

export interface MLAnomaly {
  date: string;
  revenue: number;
  expectedRevenue: number;
  deviation: number; // Процент отклонения
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: 'minimum' | 'maximum' | 'spike' | 'drop' | 'pattern';
  explanation: string; // Объяснение от ML модели
  recommendations?: string[];
}

export interface MLModelMetrics {
  arima?: number;
  prophet?: number;
  lstm?: number;
  linear?: number;
  movingAverage?: number;
  overall?: number; // Общая метрика качества (0-1)
}

export interface MLAnalysis {
  anomalies: MLAnomaly[];
  modelQuality: MLModelMetrics;
  minRevenueAnomaly?: MLAnomaly; // Аномалия с минимальной выручкой
  maxRevenueAnomaly?: MLAnomaly; // Аномалия с максимальной выручкой
  confidence: number; // Уверенность модели в анализе (0-1)
  dataPoints: number; // Количество точек данных для анализа
}

export interface AnalyticsResponse {
  kpi: KPIMetrics;
  daily?: PeriodData[];
  monthly?: PeriodData[];
  yearly?: PeriodData[];
  byDayOfWeek?: DayOfWeekData[];
  monthlyComparison?: MonthlyComparisonData;
  forecast?: RevenueForecast;
  transactions: Transaction[];
  // Продвинутая аналитика
  advancedAnalytics?: {
    customerClusters: CustomerCluster[];
    productClusters: ProductCluster[];
    anomalies: Anomaly[];
    trendAnalysis: TrendAnalysis;
    marketSegments: MarketSegment[];
  };
  // ML анализ для резюме
  mlAnalysis?: MLAnalysis;
  hasCostData?: boolean;
  period?: AnalyticsPeriod;
}

export interface FileUploadResponse {
  success: boolean;
  uploadId: string;
  rowsProcessed: number;
  columnsDetected: {
    date: string;
    amount: string;
    category?: string;
    employee?: string;
  };
}

// Column mapping types for auto-detection
export const COLUMN_MAPPINGS = {
  date: ['date', 'дата', 'день', 'day', 'timestamp', 'время', 'дата/время'],
  year: ['year', 'год'],
  month: ['month', 'месяц'],
  amount: ['amount', 'сумма', 'total', 'итого', 'price', 'цена', 'revenue', 'выручка'],
  costOfGoods: [
    'cost',
    'costs',
    'cost of goods',
    'cogs',
    'себестоимость',
    'себестоимость продаж',
    'себестоимость товара',
    'с/с',
    'cost_of_goods',
  ],
  checksCount: [
    'чеков прихода',
    'checks count',
    'receipt count',
    'receipts',
    'количество чеков',
    'кол-во чеков',
  ],
  cashPayment: [
    'приход наличными',
    'cash payment',
    'оплата наличными',
    'наличные',
    'наличные, руб',
    'наличные руб',
    'наличные (руб)',
    'наличными',
    'наличный расчет',
    'наличный расчёт',
    'наличные платежи',
    'cash',
  ],
  terminalPayment: [
    'приход безналичными',
    'card payment',
    'по терминалу',
    'терминал',
    'терминал, руб',
    'терминал руб',
    'терминальные платежи',
    'безнал',
    'безналичные',
    'безналичный расчет',
    'безналичный расчёт',
    'оплата по карте',
    'оплата картой',
    'карта',
    'картой',
    'bank card',
    'card',
    'эквайринг',
    'pos-терминал',
    'pos терминал',
  ],
  qrPayment: [
    'qr',
    'qr-код',
    'qr код',
    'по qr',
    'по qr-коду',
    'оплата по qr',
    'оплата по qr-коду',
    'qr оплата',
    'qr-платежи',
    'qr/сбп',
    'qr-сбп',
  ],
  sbpPayment: [
    'sbp',
    'сбп',
    'система быстрых платежей',
    'оплата по сбп',
    'по сбп',
    'быстрые платежи',
    'fast payment',
    'fast payments',
    'sbp payment',
    'сбп/qr',
  ],
  refundChecksCount: [
    'чеков возврата прихода',
    'чеков возврата',
    'возврата прихода',
    'refund checks',
    'refund count',
  ],
  refundCashPayment: ['возврат наличными', 'возврат наличных', 'refund cash'],
  refundTerminalPayment: [
    'возврат безналичными',
    'возврат безналичных',
    'refund terminal',
    'refund card',
  ],
  refundQrPayment: ['возврат qr', 'refund qr'],
  refundSbpPayment: ['возврат сбп', 'refund sbp'],
  category: ['category', 'категория', 'тип', 'type', 'product', 'товар'],
  employee: ['employee', 'сотрудник', 'seller', 'продавец', 'cashier', 'кассир'],
} as const;

// Продвинутая аналитика
export interface CustomerCluster {
  id: string;
  name: string;
  size: number;
  avgCheck: number;
  frequency: number;
  seasonality: number[];
  characteristics: {
    isHighValue: boolean;
    isFrequent: boolean;
    isSeasonal: boolean;
    preferredDays: number[];
    preferredMonths: number[];
  };
  transactions: Transaction[];
}

export interface ProductCluster {
  id: string;
  name: string;
  size: number;
  avgPrice: number;
  demandPattern: number[];
  seasonality: number[];
  characteristics: {
    isPremium: boolean;
    isSeasonal: boolean;
    isStable: boolean;
    peakHours: number[];
    peakDays: number[];
  };
  transactions: Transaction[];
}

export interface Anomaly {
  id: string;
  type: 'revenue' | 'volume' | 'pattern' | 'seasonal' | 'external';
  severity: 'low' | 'medium' | 'high' | 'critical';
  date: string;
  value: number;
  expectedValue: number;
  deviation: number;
  description: string;
  impact: number;
  recommendations: string[];
}

export interface TrendAnalysis {
  period: string;
  direction: 'up' | 'down' | 'stable' | 'volatile';
  strength: number; // 0-1
  confidence: number; // 0-1
  factors: {
    seasonal: number;
    economic: number;
    weather: number;
    social: number;
    internal: number;
  };
  forecast: {
    nextWeek: number;
    nextMonth: number;
    nextQuarter: number;
  };
}

export interface MarketSegment {
  id: string;
  name: string;
  size: number;
  growth: number;
  profitability: number;
  characteristics: {
    avgCheck: number;
    frequency: number;
    loyalty: number;
    seasonality: number;
  };
  opportunities: string[];
  risks: string[];
}

// Password validation function
const passwordValidation = z
  .string()
  .min(8, 'Пароль должен содержать минимум 8 символов')
  .regex(/[a-z]/, 'Пароль должен содержать минимум одну строчную букву')
  .regex(/[A-Z]/, 'Пароль должен содержать минимум одну заглавную букву')
  .regex(/[0-9]/, 'Пароль должен содержать минимум одну цифру')
  .regex(
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
    'Пароль должен содержать минимум один специальный символ',
  );

// Authentication schemas
export const loginSchema = z.object({
  email: z.string().email('Некорректный email адрес'),
  password: z.string().min(1, 'Введите пароль'),
});

export const registerSchema = z
  .object({
    email: z.string().email('Некорректный email адрес'),
    password: passwordValidation,
    confirmPassword: z.string().min(8, 'Подтвердите пароль'),
    name: z.string().min(2, 'Имя должно содержать минимум 2 символа'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Введите текущий пароль'),
    newPassword: passwordValidation,
    confirmPassword: z.string().min(8, 'Подтвердите новый пароль'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Пароли не совпадают',
    path: ['confirmPassword'],
  });

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
export type ChangePasswordData = z.infer<typeof changePasswordSchema>;

// API Response types
export interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  message?: string;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  sessionToken: string;
  expiresAt: string;
}

// Z-Reports (sales_z_reports) — ежедневные Z-отчёты
export const salesZReports = pgTable('sales_z_reports', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  reportDatetime: timestamp('report_datetime').notNull(), // исходное Дата/время
  reportDate: text('report_date').notNull(), // нормализованная дата (без времени)
  reportNumber: text('report_number').notNull(), // Номер отчёта
  receiptsCount: integer('receipts_count').notNull(), // Чеков прихода
  revenueCash: real('revenue_cash').notNull(), // Приход наличными
  revenueCashless: real('revenue_cashless').notNull(), // Приход безналичными
  refundReceiptsCount: integer('refund_receipts_count').notNull(), // Чеков возврата прихода
  refundCash: real('refund_cash').notNull(), // Возврат наличными
  refundCashless: real('refund_cashless').notNull(), // Возврат безналичными
  corrReceiptsCount: integer('corr_receipts_count').notNull(), // Чеков коррекции прихода
  corrCash: real('corr_cash').notNull(), // Коррекции прихода наличными
  corrCashless: real('corr_cashless').notNull(), // Коррекции прихода безналичными
  importBatchId: varchar('import_batch_id').notNull(), // связывает с импортом
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SalesZReport = typeof salesZReports.$inferSelect;

// COGS Daily (cogs_daily)
export const cogsDaily = pgTable('cogs_daily', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  reportDate: text('report_date').notNull().unique(),
  cogsTotal: real('cogs_total').notNull(),
  importBatchId: varchar('import_batch_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type CogsDaily = typeof cogsDaily.$inferSelect;

// Import Batches (import_batches)
export const importBatches = pgTable('import_batches', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  filename: text('filename').notNull(),
  sourceType: varchar('source_type').notNull(), // z_report | cogs_daily
  rowsTotal: integer('rows_total').notNull(),
  rowsOk: integer('rows_ok').notNull(),
  rowsFailed: integer('rows_failed').notNull(),
  periodFrom: text('period_from').notNull(),
  periodTo: text('period_to').notNull(),
  errorsJson: text('errors_json'), // JSON с ошибками
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ImportBatch = typeof importBatches.$inferSelect;

// Forecast Predictions (forecast_predictions) — сохранение прогнозов для обратной связи
export const forecastPredictions = pgTable('forecast_predictions', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  uploadId: varchar('upload_id').notNull(),
  modelName: varchar('model_name').notNull(), // ARIMA, Prophet, LSTM, GRU, Linear, MovingAverage, Ensemble, LLM
  forecastDate: timestamp('forecast_date').notNull(), // Дата, на которую сделан прогноз
  actualDate: timestamp('actual_date').notNull(), // Дата фактических данных (обычно совпадает с forecastDate)
  predictedRevenue: real('predicted_revenue').notNull(),
  actualRevenue: real('actual_revenue'), // Заполняется при наличии реальных данных
  dayOfWeek: integer('day_of_week'), // 0-6 (0=воскресенье)
  horizon: integer('horizon').notNull(), // Горизонт прогноза в днях (1, 2, 3, ...)
  mape: real('mape'), // Mean Absolute Percentage Error (заполняется при наличии actualRevenue)
  mae: real('mae'), // Mean Absolute Error
  rmse: real('rmse'), // Root Mean Square Error
  factors: jsonb('factors').$type<ForecastData['factors'] | null>(), // Факторы влияния из прогноза
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const insertForecastPredictionSchema = createInsertSchema(forecastPredictions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertForecastPrediction = z.infer<typeof insertForecastPredictionSchema>;
export type ForecastPrediction = typeof forecastPredictions.$inferSelect;

// Model Accuracy Metrics (model_accuracy_metrics) — агрегированные метрики точности моделей
export const modelAccuracyMetrics = pgTable('model_accuracy_metrics', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  modelName: varchar('model_name').notNull(), // ARIMA, Prophet, LSTM, GRU, Linear, MovingAverage, Ensemble, LLM
  dayOfWeek: integer('day_of_week'), // null = все дни недели, 0-6 = конкретный день
  horizon: integer('horizon'), // null = все горизонты, 1+ = конкретный горизонт
  mape: real('mape').notNull(), // Средняя MAPE
  mae: real('mae').notNull(), // Средняя MAE
  rmse: real('rmse').notNull(), // Средняя RMSE
  sampleSize: integer('sample_size').notNull(), // Количество прогнозов в выборке
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
});

export const insertModelAccuracyMetricSchema = createInsertSchema(modelAccuracyMetrics).omit({
  id: true,
  lastUpdated: true,
});

export type InsertModelAccuracyMetric = z.infer<typeof insertModelAccuracyMetricSchema>;
export type ModelAccuracyMetric = typeof modelAccuracyMetrics.$inferSelect;

// ML Models (ml_models) — персистентное хранение обученных ML моделей
export const mlModels = pgTable('ml_models', {
  id: varchar('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  modelName: varchar('model_name').notNull(), // ARIMA, Prophet, LSTM, GRU, RandomForest, XGBoost, GradientBoosting, NHITS
  uploadId: varchar('upload_id').notNull(), // Связь с данными
  dataHash: varchar('data_hash').notNull(), // Хеш данных для проверки актуальности
  parameters: jsonb('parameters').notNull(), // Сериализованные параметры модели
  dataLength: integer('data_length').notNull(), // Количество точек данных
  lastDataDate: timestamp('last_data_date'), // Дата последней точки данных
  trainedAt: timestamp('trained_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  version: integer('version').default(1), // Версия модели для миграций
  supportsIncremental: boolean('supports_incremental').default(false), // Поддержка инкрементального обучения
});

export const insertMLModelSchema = createInsertSchema(mlModels).omit({
  id: true,
  trainedAt: true,
  lastUsedAt: true,
});

export type InsertMLModel = z.infer<typeof insertMLModelSchema>;
export type MLModel = typeof mlModels.$inferSelect;
