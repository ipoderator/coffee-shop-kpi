import { Transaction, ForecastData } from '@shared/schema';
import { addDays, format, getDay, startOfDay, endOfDay } from 'date-fns';
import { Matrix } from 'ml-matrix';
import { MLR } from 'ml-regression-multivariate-linear';
import { kmeans } from 'ml-kmeans';
import * as ss from 'simple-statistics';

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

interface MLForecastResult {
  predictedRevenue: number;
  confidence: number;
  trend: 'up' | 'down' | 'stable';
  factors: {
    seasonal: number;
    trend: number;
    weather: number;
    holiday: number;
    customerSegment: number;
    productSegment: number;
  };
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

// Основной класс для ML прогнозирования
export class MLForecastingEngine {
  private transactions: Transaction[];
  private customerSegments: CustomerSegment[] = [];
  private productSegments: ProductSegment[] = [];
  private arimaModel: any = null;
  private prophetModel: any = null;
  private lstmModel: any = null;

  constructor(transactions: Transaction[]) {
    this.transactions = transactions;
    this.initializeSegments();
  }

  // Инициализация сегментов клиентов и товаров
  private initializeSegments(): void {
    this.customerSegments = this.analyzeCustomerSegments();
    this.productSegments = this.analyzeProductSegments();
  }

  // Анализ сегментов клиентов на основе поведения
  private analyzeCustomerSegments(): CustomerSegment[] {
    const customerData = new Map<string, { amounts: number[], dates: string[] }>();
    
    this.transactions.forEach(tx => {
      const customerId = tx.customerId || 'anonymous';
      if (!customerData.has(customerId)) {
        customerData.set(customerId, { amounts: [], dates: [] });
      }
      const data = customerData.get(customerId)!;
      data.amounts.push(tx.amount);
      data.dates.push(tx.date);
    });

    const segments: CustomerSegment[] = [];
    const amounts = Array.from(customerData.values()).map(data => 
      data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length
    );

    // K-means кластеризация для сегментации клиентов
    if (amounts.length >= 3) {
      const k = Math.min(3, Math.floor(amounts.length / 2));
      const clusters = kmeans(amounts, k);
      
      clusters.forEach((cluster, index) => {
        const clusterCustomers = Array.from(customerData.entries()).filter((_, i) => 
          clusters[i] === cluster
        );
        
        const avgCheck = clusterCustomers.reduce((sum, [_, data]) => 
          sum + data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length, 0
        ) / clusterCustomers.length;

        const frequency = clusterCustomers.reduce((sum, [_, data]) => 
          sum + data.dates.length, 0
        ) / clusterCustomers.length;

        // Анализ сезонности по дням недели
        const seasonality = this.calculateCustomerSeasonality(clusterCustomers);

        segments.push({
          id: `segment_${index}`,
          name: this.getSegmentName(avgCheck, frequency),
          avgCheck,
          frequency,
          seasonality
        });
      });
    }

    return segments;
  }

  // Анализ сегментов товаров
  private analyzeProductSegments(): ProductSegment[] {
    const productData = new Map<string, { amounts: number[], dates: string[] }>();
    
    this.transactions.forEach(tx => {
      const productId = tx.productId || 'general';
      if (!productData.has(productId)) {
        productData.set(productId, { amounts: [], dates: [] });
      }
      const data = productData.get(productId)!;
      data.amounts.push(tx.amount);
      data.dates.push(tx.date);
    });

    const segments: ProductSegment[] = [];
    const amounts = Array.from(productData.values()).map(data => 
      data.amounts.reduce((sum, amount) => sum + amount, 0) / data.amounts.length
    );

    if (amounts.length >= 2) {
      const k = Math.min(3, Math.floor(amounts.length / 2));
      const clusters = kmeans(amounts, k);
      
      clusters.forEach((cluster, index) => {
        const clusterProducts = Array.from(productData.entries()).filter((_, i) => 
          clusters[i] === cluster
        );
        
        const avgPrice = clusterProducts.reduce((sum, [_, data]) => 
          sum + data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length, 0
        ) / clusterProducts.length;

        const demandPattern = this.calculateDemandPattern(clusterProducts);
        const seasonality = this.calculateProductSeasonality(clusterProducts);

        segments.push({
          id: `product_${index}`,
          name: this.getProductSegmentName(avgPrice),
          avgPrice,
          demandPattern,
          seasonality
        });
      });
    }

    return segments;
  }

  // Расчет сезонности клиентов
  private calculateCustomerSeasonality(customers: [string, any][]): number[] {
    const dayOfWeekRevenue = new Array(7).fill(0);
    const dayOfWeekCount = new Array(7).fill(0);

    customers.forEach(([_, data]) => {
      data.dates.forEach((date: string, index: number) => {
        const dayOfWeek = getDay(new Date(date));
        dayOfWeekRevenue[dayOfWeek] += data.amounts[index];
        dayOfWeekCount[dayOfWeek]++;
      });
    });

    return dayOfWeekRevenue.map((revenue, index) => 
      dayOfWeekCount[index] > 0 ? revenue / dayOfWeekCount[index] : 0
    );
  }

  // Расчет паттерна спроса
  private calculateDemandPattern(products: [string, any][]): number[] {
    const hourlyDemand = new Array(24).fill(0);
    const hourlyCount = new Array(24).fill(0);

    products.forEach(([_, data]) => {
      data.dates.forEach((date: string, index: number) => {
        const hour = new Date(date).getHours();
        hourlyDemand[hour] += data.amounts[index];
        hourlyCount[hour]++;
      });
    });

    return hourlyDemand.map((demand, index) => 
      hourlyCount[index] > 0 ? demand / hourlyCount[index] : 0
    );
  }

  // Расчет сезонности товаров
  private calculateProductSeasonality(products: [string, any][]): number[] {
    const monthlyRevenue = new Array(12).fill(0);
    const monthlyCount = new Array(12).fill(0);

    products.forEach(([_, data]) => {
      data.dates.forEach((date: string, index: number) => {
        const month = new Date(date).getMonth();
        monthlyRevenue[month] += data.amounts[index];
        monthlyCount[month]++;
      });
    });

    return monthlyRevenue.map((revenue, index) => 
      monthlyCount[index] > 0 ? revenue / monthlyCount[index] : 0
    );
  }

  // Получение названия сегмента клиентов
  private getSegmentName(avgCheck: number, frequency: number): string {
    if (avgCheck > 1000 && frequency > 10) return 'VIP клиенты';
    if (avgCheck > 500 && frequency > 5) return 'Постоянные клиенты';
    if (avgCheck > 200) return 'Средние клиенты';
    return 'Новые клиенты';
  }

  // Получение названия сегмента товаров
  private getProductSegmentName(avgPrice: number): string {
    if (avgPrice > 500) return 'Премиум товары';
    if (avgPrice > 200) return 'Средние товары';
    return 'Базовые товары';
  }

  // Подготовка данных для временных рядов
  private prepareTimeSeriesData(): TimeSeriesData[] {
    const dailyData = new Map<string, { revenue: number, count: number }>();
    
    this.transactions.forEach(tx => {
      const date = format(new Date(tx.date), 'yyyy-MM-dd');
      if (!dailyData.has(date)) {
        dailyData.set(date, { revenue: 0, count: 0 });
      }
      const data = dailyData.get(date)!;
      data.revenue += tx.amount;
      data.count++;
    });

    return Array.from(dailyData.entries()).map(([date, data]) => {
      const dateObj = new Date(date);
      return {
        date,
        revenue: data.revenue,
        dayOfWeek: getDay(dateObj),
        dayOfMonth: dateObj.getDate(),
        month: dateObj.getMonth(),
        isWeekend: getDay(dateObj) === 0 || getDay(dateObj) === 6,
        weatherTemp: 20, // Заглушка, в реальности получать из API
        weatherPrecip: 0,
        isHoliday: false,
        holidayType: 'none'
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // ARIMA модель для прогнозирования
  private fitARIMAModel(data: TimeSeriesData[]): void {
    if (data.length < 30) return;

    const revenues = data.map(d => d.revenue);
    
    // Простая реализация ARIMA(1,1,1)
    const diffRevenues = this.difference(revenues, 1);
    const arimaParams = this.estimateARIMAParameters(diffRevenues);
    
    this.arimaModel = {
      params: arimaParams,
      originalData: revenues,
      lastValues: revenues.slice(-10)
    };
  }

  // Разность временного ряда
  private difference(data: number[], order: number): number[] {
    if (order === 0) return data;
    const diff = [];
    for (let i = 1; i < data.length; i++) {
      diff.push(data[i] - data[i - 1]);
    }
    return this.difference(diff, order - 1);
  }

  // Оценка параметров ARIMA
  private estimateARIMAParameters(data: number[]): { ar: number, ma: number } {
    // Упрощенная оценка параметров ARIMA
    const mean = ss.mean(data);
    const variance = ss.variance(data);
    
    // Автокорреляция для AR параметра
    const ar = this.calculateAutocorrelation(data, 1);
    
    // Скользящее среднее для MA параметра
    const ma = this.calculateMovingAverage(data, 3);
    
    return { ar: Math.max(-0.9, Math.min(0.9, ar)), ma: Math.max(-0.9, Math.min(0.9, ma)) };
  }

  // Расчет автокорреляции
  private calculateAutocorrelation(data: number[], lag: number): number {
    if (data.length <= lag) return 0;
    
    const mean = ss.mean(data);
    let numerator = 0;
    let denominator = 0;
    
    for (let i = lag; i < data.length; i++) {
      numerator += (data[i] - mean) * (data[i - lag] - mean);
    }
    
    for (let i = 0; i < data.length; i++) {
      denominator += Math.pow(data[i] - mean, 2);
    }
    
    return denominator > 0 ? numerator / denominator : 0;
  }

  // Расчет скользящего среднего
  private calculateMovingAverage(data: number[], window: number): number {
    if (data.length < window) return 0;
    
    const recent = data.slice(-window);
    return ss.mean(recent);
  }

  // Prophet-подобная модель для сезонного прогнозирования
  private fitProphetModel(data: TimeSeriesData[]): void {
    if (data.length < 14) return;

    const revenues = data.map(d => d.revenue);
    const trend = this.calculateTrend(revenues);
    const seasonality = this.calculateSeasonality(data);
    
    this.prophetModel = {
      trend,
      seasonality,
      originalData: revenues,
      lastDate: data[data.length - 1].date
    };
  }

  // Расчет тренда
  private calculateTrend(data: number[]): { slope: number, intercept: number } {
    const n = data.length;
    const x = Array.from({ length: n }, (_, i) => i);
    
    const sumX = ss.sum(x);
    const sumY = ss.sum(data);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * data[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  // Расчет сезонности
  private calculateSeasonality(data: TimeSeriesData[]): { weekly: number[], monthly: number[] } {
    const weeklyPattern = new Array(7).fill(0);
    const weeklyCount = new Array(7).fill(0);
    const monthlyPattern = new Array(12).fill(0);
    const monthlyCount = new Array(12).fill(0);

    data.forEach(d => {
      weeklyPattern[d.dayOfWeek] += d.revenue;
      weeklyCount[d.dayOfWeek]++;
      monthlyPattern[d.month] += d.revenue;
      monthlyCount[d.month]++;
    });

    const weeklySeasonality = weeklyPattern.map((revenue, day) => 
      weeklyCount[day] > 0 ? revenue / weeklyCount[day] : 0
    );
    
    const monthlySeasonality = monthlyPattern.map((revenue, month) => 
      monthlyCount[month] > 0 ? revenue / monthlyCount[month] : 0
    );

    return { weekly: weeklySeasonality, monthly: monthlySeasonality };
  }

  // LSTM-подобная модель (упрощенная реализация)
  private fitLSTMModel(data: TimeSeriesData[]): void {
    if (data.length < 20) return;

    const revenues = data.map(d => d.revenue);
    const features = data.map(d => [
      d.revenue,
      d.dayOfWeek / 7,
      d.dayOfMonth / 31,
      d.month / 12,
      d.isWeekend ? 1 : 0,
      d.weatherTemp ? d.weatherTemp / 50 : 0.4,
      d.weatherPrecip ? d.weatherPrecip / 20 : 0,
      d.isHoliday ? 1 : 0
    ]);

    // Простая нейронная сеть с одним скрытым слоем
    const weights = this.trainSimpleNeuralNetwork(features, revenues);
    
    this.lstmModel = {
      weights,
      features: features.slice(-10), // Последние 10 наблюдений для предсказания
      revenues: revenues.slice(-10)
    };
  }

  // Обучение простой нейронной сети
  private trainSimpleNeuralNetwork(features: number[][], targets: number[]): number[][] {
    const inputSize = features[0].length;
    const hiddenSize = Math.min(16, Math.floor(inputSize * 2));
    const outputSize = 1;

    // Инициализация весов
    const weights1 = Array.from({ length: inputSize }, () => 
      Array.from({ length: hiddenSize }, () => Math.random() * 0.1 - 0.05)
    );
    const weights2 = Array.from({ length: hiddenSize }, () => 
      Array.from({ length: outputSize }, () => Math.random() * 0.1 - 0.05)
    );

    // Простое обучение (градиентный спуск)
    const learningRate = 0.01;
    const epochs = 100;

    for (let epoch = 0; epoch < epochs; epoch++) {
      for (let i = 0; i < Math.min(features.length, 50); i++) {
        const input = features[i];
        const target = targets[i];

        // Forward pass
        const hidden = this.sigmoid(this.multiplyVectorMatrix(input, weights1));
        const output = this.multiplyVectorMatrix(hidden, weights2)[0];

        // Backward pass (упрощенный)
        const error = target - output;
        
        // Обновление весов (упрощенный градиентный спуск)
        for (let j = 0; j < weights2.length; j++) {
          weights2[j][0] += learningRate * error * hidden[j];
        }
      }
    }

    return [weights1, weights2];
  }

  // Сигмоидная функция активации
  private sigmoid(x: number[]): number[] {
    return x.map(val => 1 / (1 + Math.exp(-val)));
  }

  // Умножение вектора на матрицу
  private multiplyVectorMatrix(vector: number[], matrix: number[][]): number[] {
    return matrix[0].map((_, colIndex) => 
      vector.reduce((sum, val, rowIndex) => sum + val * matrix[rowIndex][colIndex], 0)
    );
  }

  // Основной метод прогнозирования
  public async generateMLForecast(days: number = 7): Promise<ForecastData[]> {
    const timeSeriesData = this.prepareTimeSeriesData();
    
    if (timeSeriesData.length < 14) {
      return this.generateFallbackForecast(days);
    }

    // Обучение моделей
    this.fitARIMAModel(timeSeriesData);
    this.fitProphetModel(timeSeriesData);
    this.fitLSTMModel(timeSeriesData);

    // Генерация прогнозов
    const forecasts: ForecastData[] = [];
    const lastDate = new Date(timeSeriesData[timeSeriesData.length - 1].date);

    for (let i = 1; i <= days; i++) {
      const forecastDate = addDays(lastDate, i);
      const dayOfWeek = getDay(forecastDate);
      const dayOfMonth = forecastDate.getDate();
      const month = forecastDate.getMonth();

      // Получение прогнозов от всех моделей
      const arimaPrediction = this.predictARIMA(i);
      const prophetPrediction = this.predictProphet(forecastDate, timeSeriesData);
      const lstmPrediction = this.predictLSTM(forecastDate, timeSeriesData);

      // Ансамбль прогнозов
      const ensemblePrediction = this.createEnsemblePrediction([
        arimaPrediction,
        prophetPrediction,
        lstmPrediction
      ]);

      // Расчет факторов влияния
      const factors = this.calculateInfluenceFactors(forecastDate, timeSeriesData);

      // Расчет уверенности
      const confidence = this.calculateMLConfidence([
        arimaPrediction,
        prophetPrediction,
        lstmPrediction
      ]);

      // Определение тренда
      const trend = this.determineTrend(ensemblePrediction, timeSeriesData);

      forecasts.push({
        date: format(forecastDate, 'yyyy-MM-dd'),
        predictedRevenue: Math.round(ensemblePrediction),
        confidence: Math.round(confidence * 100) / 100,
        trend,
        weatherImpact: factors.weather,
        holidayImpact: factors.holiday,
        factors: {
          weather: { temperature: 20, precipitation: 0, impact: factors.weather },
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

  // Прогноз ARIMA
  private predictARIMA(steps: number): number {
    if (!this.arimaModel) return 0;

    const { params, lastValues } = this.arimaModel;
    const lastValue = lastValues[lastValues.length - 1];
    
    // Простой ARIMA прогноз
    return lastValue * (1 + params.ar) + params.ma * 0.1;
  }

  // Прогноз Prophet
  private predictProphet(date: Date, data: TimeSeriesData[]): number {
    if (!this.prophetModel) return 0;

    const { trend, seasonality } = this.prophetModel;
    const dayOfWeek = getDay(date);
    const month = date.getMonth();
    
    const trendValue = trend.slope * data.length + trend.intercept;
    const weeklySeasonal = seasonality.weekly[dayOfWeek] || 0;
    const monthlySeasonal = seasonality.monthly[month] || 0;
    
    return trendValue + weeklySeasonal + monthlySeasonal;
  }

  // Прогноз LSTM
  private predictLSTM(date: Date, data: TimeSeriesData[]): number {
    if (!this.lstmModel) return 0;

    const { weights, features } = this.lstmModel;
    const dayOfWeek = getDay(date);
    const dayOfMonth = date.getDate();
    const month = date.getMonth();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const input = [
      features[features.length - 1][0], // Последняя выручка
      dayOfWeek / 7,
      dayOfMonth / 31,
      month / 12,
      isWeekend ? 1 : 0,
      0.4, // Температура
      0,   // Осадки
      0    // Праздник
    ];

    const hidden = this.sigmoid(this.multiplyVectorMatrix(input, weights[0]));
    const output = this.multiplyVectorMatrix(hidden, weights[1])[0];

    return Math.max(0, output);
  }

  // Создание ансамбля прогнозов
  private createEnsemblePrediction(predictions: number[]): number {
    const validPredictions = predictions.filter(p => p > 0);
    if (validPredictions.length === 0) return 0;

    // Взвешенное среднее с учетом качества моделей
    const weights = [0.3, 0.4, 0.3]; // ARIMA, Prophet, LSTM
    let weightedSum = 0;
    let totalWeight = 0;

    validPredictions.forEach((prediction, index) => {
      if (index < weights.length) {
        weightedSum += prediction * weights[index];
        totalWeight += weights[index];
      }
    });

    return totalWeight > 0 ? weightedSum / totalWeight : ss.mean(validPredictions);
  }

  // Расчет факторов влияния
  private calculateInfluenceFactors(date: Date, data: TimeSeriesData[]): any {
    const dayOfWeek = getDay(date);
    const dayOfMonth = date.getDate();
    const month = date.getMonth();

    // Сезонный фактор
    const seasonalFactor = this.calculateSeasonalFactor(dayOfWeek, month, data);

    // Тренд
    const trendFactor = this.calculateTrendFactor(data);

    // Погодный фактор
    const weatherFactor = this.calculateWeatherFactor(date);

    // Праздничный фактор
    const holidayFactor = this.calculateHolidayFactor(date);

    // Фактор времени месяца
    const timeOfMonthFactor = this.calculateTimeOfMonthFactor(dayOfMonth);

    // Исторический паттерн
    const historicalPatternFactor = this.calculateHistoricalPatternFactor(dayOfWeek, data);

    // Экономический цикл
    const economicCycleFactor = this.calculateEconomicCycleFactor(month);

    // Локальные события
    const localEventFactor = this.calculateLocalEventFactor(date);

    // Сегментация клиентов
    const customerSegmentFactor = this.calculateCustomerSegmentFactor(dayOfWeek);

    return {
      seasonal: seasonalFactor,
      trend: trendFactor,
      weather: weatherFactor,
      holiday: holidayFactor,
      timeOfMonth: timeOfMonthFactor,
      historicalPattern: historicalPatternFactor,
      economicCycle: economicCycleFactor,
      localEvent: localEventFactor,
      customerSegment: customerSegmentFactor
    };
  }

  // Расчет сезонного фактора
  private calculateSeasonalFactor(dayOfWeek: number, month: number, data: TimeSeriesData[]): number {
    const dayOfWeekData = data.filter(d => d.dayOfWeek === dayOfWeek);
    const monthData = data.filter(d => d.month === month);
    
    if (dayOfWeekData.length === 0 || monthData.length === 0) return 1;

    const avgDayRevenue = ss.mean(dayOfWeekData.map(d => d.revenue));
    const avgMonthRevenue = ss.mean(monthData.map(d => d.revenue));
    const overallAvg = ss.mean(data.map(d => d.revenue));

    return (avgDayRevenue + avgMonthRevenue) / (2 * overallAvg);
  }

  // Расчет тренда
  private calculateTrendFactor(data: TimeSeriesData[]): number {
    if (data.length < 7) return 0;

    const recent = data.slice(-7).map(d => d.revenue);
    const older = data.slice(-14, -7).map(d => d.revenue);

    const recentAvg = ss.mean(recent);
    const olderAvg = ss.mean(older);

    return olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
  }

  // Расчет погодного фактора
  private calculateWeatherFactor(date: Date): number {
    // Заглушка для погодного фактора
    const month = date.getMonth();
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;
    
    if (isWinter) return -0.1; // Зимой меньше продаж
    if (isSummer) return 0.05; // Летом больше продаж
    return 0;
  }

  // Расчет праздничного фактора
  private calculateHolidayFactor(date: Date): number {
    const month = date.getMonth();
    const day = date.getDate();
    
    // Простые праздники
    if (month === 0 && day === 1) return 0.3; // Новый год
    if (month === 1 && day === 23) return 0.2; // День защитника отечества
    if (month === 2 && day === 8) return 0.2; // Международный женский день
    if (month === 4 && day === 9) return 0.3; // День Победы
    
    return 0;
  }

  // Расчет фактора времени месяца
  private calculateTimeOfMonthFactor(dayOfMonth: number): number {
    if (dayOfMonth <= 5) return -0.05; // Начало месяца
    if (dayOfMonth >= 25) return 0.1;  // Конец месяца
    return 0;
  }

  // Расчет исторического паттерна
  private calculateHistoricalPatternFactor(dayOfWeek: number, data: TimeSeriesData[]): number {
    const sameDayData = data.filter(d => d.dayOfWeek === dayOfWeek);
    if (sameDayData.length < 2) return 0;

    const revenues = sameDayData.map(d => d.revenue);
    const trend = this.calculateTrend({ map: () => revenues } as any);
    
    return trend;
  }

  // Расчет экономического цикла
  private calculateEconomicCycleFactor(month: number): number {
    // Простая модель экономического цикла
    const cycle = Math.sin((month / 12) * 2 * Math.PI);
    return cycle * 0.05;
  }

  // Расчет локальных событий
  private calculateLocalEventFactor(date: Date): number {
    // Заглушка для локальных событий
    return 0;
  }

  // Расчет фактора сегментации клиентов
  private calculateCustomerSegmentFactor(dayOfWeek: number): number {
    const segment = this.customerSegments.find(s => 
      s.seasonality[dayOfWeek] > 0
    );
    
    return segment ? segment.seasonality[dayOfWeek] / 1000 : 0;
  }

  // Расчет уверенности ML моделей
  private calculateMLConfidence(predictions: number[]): number {
    const validPredictions = predictions.filter(p => p > 0);
    if (validPredictions.length === 0) return 0.3;

    // Уверенность основана на согласованности прогнозов
    const mean = ss.mean(validPredictions);
    const variance = ss.variance(validPredictions);
    const coefficientOfVariation = Math.sqrt(variance) / mean;

    // Чем меньше вариация, тем выше уверенность
    const consistency = Math.max(0, 1 - coefficientOfVariation);
    const dataQuality = Math.min(1, this.transactions.length / 100);
    
    return Math.min(0.95, consistency * 0.7 + dataQuality * 0.3);
  }

  // Определение тренда
  private determineTrend(prediction: number, data: TimeSeriesData[]): 'up' | 'down' | 'stable' {
    if (data.length < 7) return 'stable';

    const recentAvg = ss.mean(data.slice(-7).map(d => d.revenue));
    const change = (prediction - recentAvg) / recentAvg;

    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'stable';
  }

  // Fallback прогноз при недостатке данных
  private generateFallbackForecast(days: number): ForecastData[] {
    const forecasts: ForecastData[] = [];
    const lastDate = new Date(this.transactions[this.transactions.length - 1].date);
    const avgRevenue = ss.mean(this.transactions.map(t => t.amount));

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
  public getSegmentsInfo(): { customers: CustomerSegment[], products: ProductSegment[] } {
    return {
      customers: this.customerSegments,
      products: this.productSegments
    };
  }
}
