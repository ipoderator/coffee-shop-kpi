import { Transaction, ForecastData } from '@shared/schema';
import { addDays, format, getDay, startOfDay, endOfDay } from 'date-fns';

const isEnsembleDebugEnabled = process.env.DEBUG_ENSEMBLE === 'true';

function calculateHistoricalClamp(
  values: number[],
  fallback: number,
): { mean: number; std: number; clampLimit: number } {
  const sanitized = values.filter((value) => Number.isFinite(value) && value > 0);
  const fallbackMean = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
  const mean =
    sanitized.length > 0
      ? sanitized.reduce((sum, value) => sum + value, 0) / sanitized.length
      : fallbackMean;
  const effectiveMean = mean > 0 ? mean : fallbackMean;

  let variance = 0;
  if (sanitized.length > 1) {
    variance =
      sanitized.reduce((sum, value) => sum + Math.pow(value - effectiveMean, 2), 0) /
      sanitized.length;
  } else {
    variance = Math.pow(effectiveMean * 0.15, 2);
  }

  const std = Math.sqrt(Math.max(variance, 0));
  const limitBase = Math.max(effectiveMean * 3, effectiveMean + 3 * std);
  const clampLimit = Number.isFinite(limitBase) && limitBase > 0 ? limitBase : effectiveMean * 3;

  return {
    mean: effectiveMean,
    std,
    clampLimit,
  };
}

function formatDebugNumber(value: number, fractionDigits = 2): string {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : 'NaN';
}

// Интерфейсы для ML моделей
interface TimeSeriesData {
  date: string;
  revenue: number;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  isWeekend: boolean;
  weatherTemp?: number;
  weatherPrecip?: number;
  isHoliday?: boolean;
  holidayType?: string;
}

interface CustomerSegment {
  id: string;
  name: string;
  avgCheck: number;
  frequency: number;
  seasonality: number[];
}

interface ProductSegment {
  id: string;
  name: string;
  avgPrice: number;
  demandPattern: number[];
  seasonality: number[];
}

// Упрощенный ML движок без внешних зависимостей
export class SimpleMLForecastingEngine {
  private transactions: Transaction[];
  private customerSegments: CustomerSegment[] = [];
  private productSegments: ProductSegment[] = [];

  constructor(transactions: Transaction[]) {
    this.transactions = transactions;
    this.initializeSegments();
  }

  // Инициализация сегментов
  private initializeSegments(): void {
    this.customerSegments = this.analyzeCustomerSegments();
    this.productSegments = this.analyzeProductSegments();
  }

  // Анализ сегментов клиентов (упрощенная версия на основе доступных данных)
  private analyzeCustomerSegments(): CustomerSegment[] {
    const customerData = new Map<string, { amounts: number[]; dates: string[] }>();

    this.transactions.forEach((tx) => {
      // Используем employee как идентификатор сегмента (если доступен)
      const customerId = tx.employee || 'general';
      if (!customerData.has(customerId)) {
        customerData.set(customerId, { amounts: [], dates: [] });
      }
      const data = customerData.get(customerId)!;
      data.amounts.push(tx.amount);
      data.dates.push(tx.date.toString());
    });

    const segments: CustomerSegment[] = [];
    const amounts = Array.from(customerData.values()).map(
      (data) => data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length,
    );

    if (amounts.length >= 2) {
      // Простая сегментация по среднему чеку
      const sortedAmounts = [...amounts].sort((a, b) => a - b);
      const q1 = sortedAmounts[Math.floor(sortedAmounts.length * 0.25)];
      const q3 = sortedAmounts[Math.floor(sortedAmounts.length * 0.75)];

      customerData.forEach((data, customerId) => {
        const avgCheck =
          data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length;
        const frequency = data.dates.length;

        let segmentName = 'Новые клиенты';
        if (avgCheck > q3 && frequency > 5) segmentName = 'VIP клиенты';
        else if (avgCheck > q1 && frequency > 3) segmentName = 'Постоянные клиенты';
        else if (avgCheck > 200) segmentName = 'Средние клиенты';

        const seasonality = this.calculateCustomerSeasonality([customerId, data]);

        segments.push({
          id: customerId,
          name: segmentName,
          avgCheck,
          frequency,
          seasonality,
        });
      });
    }

    return segments;
  }

  // Анализ сегментов товаров (упрощенная версия на основе категорий)
  private analyzeProductSegments(): ProductSegment[] {
    const productData = new Map<string, { amounts: number[]; dates: string[] }>();

    this.transactions.forEach((tx) => {
      // Используем category как идентификатор сегмента товаров
      const productId = tx.category || 'general';
      if (!productData.has(productId)) {
        productData.set(productId, { amounts: [], dates: [] });
      }
      const data = productData.get(productId)!;
      data.amounts.push(tx.amount);
      data.dates.push(tx.date.toString());
    });

    const segments: ProductSegment[] = [];
    const amounts = Array.from(productData.values()).map(
      (data) => data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length,
    );

    if (amounts.length >= 1) {
      const sortedAmounts = [...amounts].sort((a, b) => a - b);
      const q1 = sortedAmounts[Math.floor(sortedAmounts.length * 0.33)];
      const q2 = sortedAmounts[Math.floor(sortedAmounts.length * 0.67)];

      productData.forEach((data, productId) => {
        const avgPrice =
          data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length;

        let segmentName = 'Базовые товары';
        if (avgPrice > q2) segmentName = 'Премиум товары';
        else if (avgPrice > q1) segmentName = 'Средние товары';

        const demandPattern = this.calculateDemandPattern([productId, data]);
        const seasonality = this.calculateProductSeasonality([productId, data]);

        segments.push({
          id: productId,
          name: segmentName,
          avgPrice,
          demandPattern,
          seasonality,
        });
      });
    }

    return segments;
  }

  // Расчет сезонности клиентов
  private calculateCustomerSeasonality(customer: [string, any]): number[] {
    const dayOfWeekRevenue = new Array(7).fill(0);
    const dayOfWeekCount = new Array(7).fill(0);

    customer[1].dates.forEach((date: string, index: number) => {
      const dayOfWeek = getDay(new Date(date));
      dayOfWeekRevenue[dayOfWeek] += customer[1].amounts[index];
      dayOfWeekCount[dayOfWeek]++;
    });

    return dayOfWeekRevenue.map((revenue, index) =>
      dayOfWeekCount[index] > 0 ? revenue / dayOfWeekCount[index] : 0,
    );
  }

  // Расчет паттерна спроса
  private calculateDemandPattern(product: [string, any]): number[] {
    const hourlyDemand = new Array(24).fill(0);
    const hourlyCount = new Array(24).fill(0);

    product[1].dates.forEach((date: string, index: number) => {
      const hour = new Date(date).getHours();
      hourlyDemand[hour] += product[1].amounts[index];
      hourlyCount[hour]++;
    });

    return hourlyDemand.map((demand, index) =>
      hourlyCount[index] > 0 ? demand / hourlyCount[index] : 0,
    );
  }

  // Расчет сезонности товаров
  private calculateProductSeasonality(product: [string, any]): number[] {
    const monthlyRevenue = new Array(12).fill(0);
    const monthlyCount = new Array(12).fill(0);

    product[1].dates.forEach((date: string, index: number) => {
      const month = new Date(date).getMonth();
      monthlyRevenue[month] += product[1].amounts[index];
      monthlyCount[month]++;
    });

    return monthlyRevenue.map((revenue, index) =>
      monthlyCount[index] > 0 ? revenue / monthlyCount[index] : 0,
    );
  }

  // Подготовка данных для временных рядов
  private prepareTimeSeriesData(): TimeSeriesData[] {
    const dailyData = new Map<string, { revenue: number; count: number }>();

    this.transactions.forEach((tx) => {
      const date = format(new Date(tx.date), 'yyyy-MM-dd');
      if (!dailyData.has(date)) {
        dailyData.set(date, { revenue: 0, count: 0 });
      }
      const data = dailyData.get(date)!;
      data.revenue += tx.amount;
      data.count++;
    });

    return Array.from(dailyData.entries())
      .map(([date, data]) => {
        const dateObj = new Date(date);
        return {
          date,
          revenue: data.revenue,
          dayOfWeek: getDay(dateObj),
          dayOfMonth: dateObj.getDate(),
          month: dateObj.getMonth(),
          isWeekend: getDay(dateObj) === 0 || getDay(dateObj) === 6,
          weatherTemp: 20,
          weatherPrecip: 0,
          isHoliday: false,
          holidayType: 'none',
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // Простая ARIMA модель
  private fitARIMAModel(data: TimeSeriesData[]): { slope: number; intercept: number } {
    if (data.length < 7) return { slope: 0, intercept: 0 };

    const revenues = data.map((d) => d.revenue);
    const n = revenues.length;
    const x = Array.from({ length: n }, (_, i) => i);

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = revenues.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * revenues[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  // Prophet-подобная модель
  private fitProphetModel(data: TimeSeriesData[]): { weekly: number[]; monthly: number[] } {
    const weeklyPattern = new Array(7).fill(0);
    const weeklyCount = new Array(7).fill(0);
    const monthlyPattern = new Array(12).fill(0);
    const monthlyCount = new Array(12).fill(0);

    data.forEach((d) => {
      weeklyPattern[d.dayOfWeek] += d.revenue;
      weeklyCount[d.dayOfWeek]++;
      monthlyPattern[d.month] += d.revenue;
      monthlyCount[d.month]++;
    });

    const weeklySeasonality = weeklyPattern.map((revenue, day) =>
      weeklyCount[day] > 0 ? revenue / weeklyCount[day] : 0,
    );

    const monthlySeasonality = monthlyPattern.map((revenue, month) =>
      monthlyCount[month] > 0 ? revenue / monthlyCount[month] : 0,
    );

    return { weekly: weeklySeasonality, monthly: monthlySeasonality };
  }

  // Простая нейронная сеть
  private fitLSTMModel(data: TimeSeriesData[]): number[] {
    if (data.length < 10) return [0.1, 0.1, 0.1];

    const revenues = data.map((d) => d.revenue);
    const avgRevenue = revenues.reduce((sum, rev) => sum + rev, 0) / revenues.length;

    // Простые веса для нейросети
    const weights = [
      revenues.slice(-3).reduce((sum, rev) => sum + rev, 0) / 3 / avgRevenue, // Последние 3 дня
      revenues.slice(-7).reduce((sum, rev) => sum + rev, 0) / 7 / avgRevenue, // Последние 7 дней
      revenues.slice(-14).reduce((sum, rev) => sum + rev, 0) /
        Math.min(14, revenues.length) /
        avgRevenue, // Последние 14 дней
    ];

    return weights.map((w) => Math.max(0.1, Math.min(2, w)));
  }

  // Основной метод прогнозирования
  public async generateMLForecast(days: number = 7): Promise<ForecastData[]> {
    const timeSeriesData = this.prepareTimeSeriesData();

    if (timeSeriesData.length < 7) {
      return this.generateFallbackForecast(days);
    }

    // Обучение моделей
    const arimaModel = this.fitARIMAModel(timeSeriesData);
    const prophetModel = this.fitProphetModel(timeSeriesData);
    const lstmWeights = this.fitLSTMModel(timeSeriesData);

    // Генерация прогнозов
    const forecasts: ForecastData[] = [];
    const lastDate = new Date(timeSeriesData[timeSeriesData.length - 1].date);
    const avgRevenue =
      timeSeriesData.reduce((sum, d) => sum + d.revenue, 0) / timeSeriesData.length;
    const historicalRevenues = timeSeriesData.map((d) => d.revenue);
    const { clampLimit } = calculateHistoricalClamp(historicalRevenues, avgRevenue);
    const ensembleWeights = {
      arima: 0.3,
      prophet: 0.4,
      lstm: 0.3,
    };

    for (let i = 1; i <= days; i++) {
      const forecastDate = addDays(lastDate, i);
      const dayOfWeek = getDay(forecastDate);
      const dayOfMonth = forecastDate.getDate();
      const month = forecastDate.getMonth();

      // Прогнозы от всех моделей
      const arimaPrediction = arimaModel.slope * (timeSeriesData.length + i) + arimaModel.intercept;
      const prophetPrediction = prophetModel.weekly[dayOfWeek] + prophetModel.monthly[month];
      const lstmPrediction = avgRevenue * lstmWeights[0];

      // Ансамбль прогнозов
      const componentPredictions = {
        arima: arimaPrediction,
        prophet: prophetPrediction,
        lstm: lstmPrediction,
      };
      const rawEnsemblePrediction =
        componentPredictions.arima * ensembleWeights.arima +
        componentPredictions.prophet * ensembleWeights.prophet +
        componentPredictions.lstm * ensembleWeights.lstm;
      const clampedEnsemblePrediction = Math.min(rawEnsemblePrediction, clampLimit);
      const safePrediction = Math.max(0, clampedEnsemblePrediction);

      if (isEnsembleDebugEnabled) {
        const dateLabel = format(forecastDate, 'yyyy-MM-dd');
        console.debug(
          `[simple ensemble][${dateLabel}] base=${formatDebugNumber(avgRevenue)} ` +
            `raw=${formatDebugNumber(rawEnsemblePrediction)} ` +
            `clamp=${formatDebugNumber(clampLimit)} ` +
            `clamped=${formatDebugNumber(clampedEnsemblePrediction)} ` +
            `final=${formatDebugNumber(safePrediction)}`,
        );
        (Object.keys(componentPredictions) as Array<keyof typeof componentPredictions>).forEach(
          (component) => {
            const weight = ensembleWeights[component];
            const prediction = componentPredictions[component];
            const contribution = prediction * weight;
            console.debug(
              `[simple ensemble][${dateLabel}] ${component}: ` +
                `weight=${formatDebugNumber(weight, 2)} ` +
                `prediction=${formatDebugNumber(prediction)} ` +
                `contribution=${formatDebugNumber(contribution)}`,
            );
          },
        );
      }

      // Расчет факторов влияния
      const factors = this.calculateInfluenceFactors(forecastDate, timeSeriesData);

      // Расчет уверенности
      const confidence = this.calculateMLConfidence(
        timeSeriesData.length,
        Math.abs(arimaModel.slope),
      );

      // Определение тренда
      const trend = arimaModel.slope > 0.05 ? 'up' : arimaModel.slope < -0.05 ? 'down' : 'stable';

      forecasts.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(safePrediction),
        confidence: Math.round(confidence * 100) / 100,
        trend,
        weatherImpact: factors.weather,
        holidayImpact: factors.holiday,
        factors: {
          weather: { temperature: 20, precipitation: 0, impact: factors.weather },
          economic: {
            exchangeRate: 0,
            impact: factors.economic,
          },
          traffic: {
            congestionLevel: 0,
            averageSpeed: 0,
            trafficVolume: 0,
            impact: factors.traffic,
          },
          social: {
            sentiment: 0,
            volume: 0,
            platforms: [],
            impact: factors.social,
          },
          demographic: {
            population: 0,
            ageGroups: {},
            incomeLevels: {},
            employmentRate: 0,
            impact: factors.demographic,
          },
          holiday: { isHoliday: false, holidayType: 'none', impact: factors.holiday },
          seasonality: factors.seasonal,
          trend: factors.trend,
          timeOfMonth: factors.timeOfMonth,
          historicalPattern: factors.historicalPattern,
          economicCycle: factors.economicCycle,
          localEvent: factors.localEvent,
          customerBehavior: factors.customerSegment,
        },
      });
    }

    return forecasts;
  }

  // Расчет факторов влияния
  private calculateInfluenceFactors(date: Date, data: TimeSeriesData[]): any {
    const dayOfWeek = getDay(date);
    const dayOfMonth = date.getDate();
    const month = date.getMonth();

    const seasonalFactor = this.calculateSeasonalFactor(dayOfWeek, month, data);
    const trendFactor = this.calculateTrendFactor(data);
    const weatherFactor = this.calculateWeatherFactor(date);
    const holidayFactor = this.calculateHolidayFactor(date);
    const timeOfMonthFactor = this.calculateTimeOfMonthFactor(dayOfMonth);
    const historicalPatternFactor = this.calculateHistoricalPatternFactor(dayOfWeek, data);
    const economicCycleFactor = this.calculateEconomicCycleFactor(month);
    const localEventFactor = this.calculateLocalEventFactor(date);
    const customerSegmentFactor = this.calculateCustomerSegmentFactor(dayOfWeek);

    return {
      seasonal: seasonalFactor,
      trend: trendFactor,
      weather: weatherFactor,
      holiday: holidayFactor,
      economic: 0,
      traffic: 0,
      social: 0,
      demographic: 0,
      timeOfMonth: timeOfMonthFactor,
      historicalPattern: historicalPatternFactor,
      economicCycle: economicCycleFactor,
      localEvent: localEventFactor,
      customerSegment: customerSegmentFactor,
    };
  }

  // Расчет сезонного фактора
  private calculateSeasonalFactor(
    dayOfWeek: number,
    month: number,
    data: TimeSeriesData[],
  ): number {
    const dayOfWeekData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    const monthData = data.filter((d) => d.month === month);

    if (dayOfWeekData.length === 0 || monthData.length === 0) return 1;

    const avgDayRevenue =
      dayOfWeekData.reduce((sum, d) => sum + d.revenue, 0) / dayOfWeekData.length;
    const avgMonthRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0) / monthData.length;
    const overallAvg = data.reduce((sum, d) => sum + d.revenue, 0) / data.length;

    return (avgDayRevenue + avgMonthRevenue) / (2 * overallAvg);
  }

  // Расчет тренда
  private calculateTrendFactor(data: TimeSeriesData[]): number {
    if (data.length < 7) return 0;

    const recent = data.slice(-7).map((d) => d.revenue);
    const older = data.slice(-14, -7).map((d) => d.revenue);

    const recentAvg = recent.reduce((sum, rev) => sum + rev, 0) / recent.length;
    const olderAvg = older.reduce((sum, rev) => sum + rev, 0) / older.length;

    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  // Расчет погодного фактора
  private calculateWeatherFactor(date: Date): number {
    const month = date.getMonth();
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;

    if (isWinter) return -0.1;
    if (isSummer) return 0.05;
    return 0;
  }

  // Расчет праздничного фактора
  private calculateHolidayFactor(date: Date): number {
    const month = date.getMonth();
    const day = date.getDate();

    if (month === 0 && day === 1) return 0.3; // Новый год
    if (month === 1 && day === 23) return 0.2; // День защитника отечества
    if (month === 2 && day === 8) return 0.2; // Международный женский день
    if (month === 4 && day === 9) return 0.3; // День Победы

    return 0;
  }

  // Расчет фактора времени месяца
  private calculateTimeOfMonthFactor(dayOfMonth: number): number {
    if (dayOfMonth <= 5) return -0.05;
    if (dayOfMonth >= 25) return 0.1;
    return 0;
  }

  // Расчет исторического паттерна
  private calculateHistoricalPatternFactor(dayOfWeek: number, data: TimeSeriesData[]): number {
    const sameDayData = data.filter((d) => d.dayOfWeek === dayOfWeek);
    if (sameDayData.length < 2) return 0;

    const revenues = sameDayData.map((d) => d.revenue);
    const recent = revenues.slice(-3);
    const older = revenues.slice(-6, -3);

    const recentAvg = recent.reduce((sum, rev) => sum + rev, 0) / recent.length;
    const olderAvg = older.reduce((sum, rev) => sum + rev, 0) / older.length;

    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  // Расчет экономического цикла
  private calculateEconomicCycleFactor(month: number): number {
    const cycle = Math.sin((month / 12) * 2 * Math.PI);
    return cycle * 0.05;
  }

  // Расчет локальных событий
  private calculateLocalEventFactor(date: Date): number {
    return 0;
  }

  // Расчет фактора сегментации клиентов
  private calculateCustomerSegmentFactor(dayOfWeek: number): number {
    const segment = this.customerSegments.find((s) => s.seasonality[dayOfWeek] > 0);

    return segment ? segment.seasonality[dayOfWeek] / 1000 : 0;
  }

  // Расчет уверенности ML моделей
  private calculateMLConfidence(dataLength: number, trendStability: number): number {
    const dataQuality = Math.min(1, dataLength / 100);
    const stability = Math.max(0, 1 - trendStability);

    return Math.min(0.95, stability * 0.7 + dataQuality * 0.3);
  }

  // Fallback прогноз при недостатке данных
  private generateFallbackForecast(days: number): ForecastData[] {
    const forecasts: ForecastData[] = [];
    const lastDate = new Date(this.transactions[this.transactions.length - 1].date);
    const avgRevenue =
      this.transactions.reduce((sum, t) => sum + t.amount, 0) / this.transactions.length;

    for (let i = 1; i <= days; i++) {
      const forecastDate = addDays(lastDate, i);
      forecasts.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(avgRevenue),
        confidence: 0.3,
        trend: 'stable',
        weatherImpact: 0,
        holidayImpact: 0,
        factors: {
          weather: { temperature: 20, precipitation: 0, impact: 0 },
          economic: {
            exchangeRate: 0,
            impact: 0,
          },
          traffic: {
            congestionLevel: 0,
            averageSpeed: 0,
            trafficVolume: 0,
            impact: 0,
          },
          social: {
            sentiment: 0,
            volume: 0,
            platforms: [],
            impact: 0,
          },
          demographic: {
            population: 0,
            ageGroups: {},
            incomeLevels: {},
            employmentRate: 0,
            impact: 0,
          },
          holiday: { isHoliday: false, holidayType: 'none', impact: 0 },
          seasonality: 1,
          trend: 0,
          timeOfMonth: 0,
          historicalPattern: 0,
          economicCycle: 0,
          localEvent: 0,
          customerBehavior: 0,
        },
      });
    }

    return forecasts;
  }

  // Получение информации о сегментах
  public getSegmentsInfo(): { customers: CustomerSegment[]; products: ProductSegment[] } {
    return {
      customers: this.customerSegments,
      products: this.productSegments,
    };
  }
}
