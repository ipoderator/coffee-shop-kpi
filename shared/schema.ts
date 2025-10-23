import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Transaction/Sale record from uploaded file
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp("date").notNull(),
  year: integer("year"),
  month: integer("month"),
  amount: real("amount").notNull(),
  checksCount: integer("checks_count").default(1), // Количество чеков (по умолчанию 1)
  cashPayment: real("cash_payment"),
  terminalPayment: real("terminal_payment"),
  qrPayment: real("qr_payment"),
  sbpPayment: real("sbp_payment"),
  refundChecksCount: integer("refund_checks_count"), // Количество возвратов
  refundCashPayment: real("refund_cash_payment"), // Возврат наличными
  refundTerminalPayment: real("refund_terminal_payment"), // Возврат безналичными
  refundQrPayment: real("refund_qr_payment"), // Возврат QR
  refundSbpPayment: real("refund_sbp_payment"), // Возврат СБП
  category: text("category"),
  employee: text("employee"),
  uploadId: varchar("upload_id").notNull(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Users table for authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").notNull().unique(),
  password: varchar("password").notNull(),
  name: varchar("name").notNull(),
  role: varchar("role").default("user"), // user, admin
  isActive: boolean("is_active").default(true),
  // Security fields
  twoFactorSecret: varchar("two_factor_secret"), // для 2FA
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: varchar("last_login_ip"),
  failedLoginAttempts: integer("failed_login_attempts").default(0),
  lockedUntil: timestamp("locked_until"),
  passwordChangedAt: timestamp("password_changed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Security logs table
export const securityLogs = pgTable("security_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  action: varchar("action").notNull(), // login, logout, password_change, etc.
  ip: varchar("ip").notNull(),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  details: text("details"), // JSON string with additional details
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SecurityLog = typeof securityLogs.$inferSelect;
export type InsertSecurityLog = typeof securityLogs.$inferInsert;

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User sessions table
export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionToken: varchar("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
});

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({
  id: true,
  createdAt: true,
});

export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

export type AuthUser = Pick<User, "id" | "email" | "name" | "role"> & {
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
  };
  dayComparison?: DayComparisonData;
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
  checksCount: ['чеков прихода', 'checks count', 'receipt count', 'receipts', 'количество чеков', 'кол-во чеков'],
  cashPayment: ['приход наличными', 'cash payment'],
  terminalPayment: ['приход безналичными', 'card payment', 'по терминалу'],
  qrPayment: ['qr', 'qr-код', 'qr код', 'по qr', 'по qr-коду'],
  sbpPayment: ['sbp', 'сбп', 'система быстрых платежей'],
  refundChecksCount: ['чеков возврата прихода', 'чеков возврата', 'возврата прихода', 'refund checks', 'refund count'],
  refundCashPayment: ['возврат наличными', 'возврат наличных', 'refund cash'],
  refundTerminalPayment: ['возврат безналичными', 'возврат безналичных', 'refund terminal', 'refund card'],
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
const passwordValidation = z.string()
  .min(8, "Пароль должен содержать минимум 8 символов")
  .regex(/[a-z]/, "Пароль должен содержать минимум одну строчную букву")
  .regex(/[A-Z]/, "Пароль должен содержать минимум одну заглавную букву")
  .regex(/[0-9]/, "Пароль должен содержать минимум одну цифру")
  .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/, "Пароль должен содержать минимум один специальный символ");

// Authentication schemas
export const loginSchema = z.object({
  email: z.string().email("Некорректный email адрес"),
  password: z.string().min(1, "Введите пароль"),
});

export const registerSchema = z.object({
  email: z.string().email("Некорректный email адрес"),
  password: passwordValidation,
  confirmPassword: z.string().min(8, "Подтвердите пароль"),
  name: z.string().min(2, "Имя должно содержать минимум 2 символа"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: passwordValidation,
  confirmPassword: z.string().min(8, "Подтвердите новый пароль"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Пароли не совпадают",
  path: ["confirmPassword"],
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
