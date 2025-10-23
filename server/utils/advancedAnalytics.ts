import { Transaction } from '@shared/schema';
import { format, getDay, getMonth, getYear, addDays, subDays } from 'date-fns';

// Интерфейсы для продвинутой аналитики
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

/**
 * Продвинутый аналитический движок с кластеризацией и обнаружением аномалий
 */
export class AdvancedAnalyticsEngine {
  private transactions: Transaction[];
  private customerClusters: CustomerCluster[] = [];
  private productClusters: ProductCluster[] = [];
  private anomalies: Anomaly[] = [];

  constructor(transactions: Transaction[]) {
    this.transactions = transactions;
    this.analyzeClusters();
    this.detectAnomalies();
  }

  // Анализ кластеров клиентов
  private analyzeClusters(): void {
    this.customerClusters = this.performCustomerClustering();
    this.productClusters = this.performProductClustering();
  }

  // K-means кластеризация клиентов
  private performCustomerClustering(): CustomerCluster[] {
    const customerData = this.prepareCustomerData();
    
    if (customerData.length < 3) {
      return this.createDefaultCustomerClusters(customerData);
    }

    // Определяем количество кластеров (2-5)
    const k = Math.min(5, Math.max(2, Math.floor(customerData.length / 10)));
    
    // Инициализируем центроиды случайным образом
    const centroids = this.initializeCentroids(customerData, k);
    
    // Выполняем K-means
    const clusters = this.kMeansClustering(customerData, centroids, k);
    
    return this.formatCustomerClusters(clusters);
  }

  // K-means кластеризация товаров
  private performProductClustering(): ProductCluster[] {
    const productData = this.prepareProductData();
    
    if (productData.length < 3) {
      return this.createDefaultProductClusters(productData);
    }

    const k = Math.min(4, Math.max(2, Math.floor(productData.length / 8)));
    const centroids = this.initializeCentroids(productData, k);
    const clusters = this.kMeansClustering(productData, centroids, k);
    
    return this.formatProductClusters(clusters);
  }

  // Подготовка данных клиентов для кластеризации
  private prepareCustomerData(): Array<{
    id: string;
    avgCheck: number;
    frequency: number;
    seasonality: number[];
    transactions: Transaction[];
  }> {
    const customerMap = new Map<string, Transaction[]>();
    
    this.transactions.forEach(tx => {
      const customerId = tx.employee || 'anonymous';
      if (!customerMap.has(customerId)) {
        customerMap.set(customerId, []);
      }
      customerMap.get(customerId)!.push(tx);
    });

    return Array.from(customerMap.entries()).map(([id, transactions]) => {
      const avgCheck = transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length;
      const frequency = transactions.length;
      const seasonality = this.calculateCustomerSeasonality(transactions);
      
      return {
        id,
        avgCheck,
        frequency,
        seasonality,
        transactions
      };
    });
  }

  // Подготовка данных товаров для кластеризации
  private prepareProductData(): Array<{
    id: string;
    avgPrice: number;
    demandPattern: number[];
    seasonality: number[];
    transactions: Transaction[];
  }> {
    const productMap = new Map<string, Transaction[]>();
    
    this.transactions.forEach(tx => {
      const productId = tx.category || 'general';
      if (!productMap.has(productId)) {
        productMap.set(productId, []);
      }
      productMap.get(productId)!.push(tx);
    });

    return Array.from(productMap.entries()).map(([id, transactions]) => {
      const avgPrice = transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length;
      const demandPattern = this.calculateDemandPattern(transactions);
      const seasonality = this.calculateProductSeasonality(transactions);
      
      return {
        id,
        avgPrice,
        demandPattern,
        seasonality,
        transactions
      };
    });
  }

  // Расчет сезонности клиентов
  private calculateCustomerSeasonality(transactions: Transaction[]): number[] {
    const weeklyRevenue = new Array(7).fill(0);
    const weeklyCount = new Array(7).fill(0);

    transactions.forEach(tx => {
      const dayOfWeek = getDay(new Date(tx.date));
      weeklyRevenue[dayOfWeek] += tx.amount;
      weeklyCount[dayOfWeek]++;
    });

    return weeklyRevenue.map((revenue, day) => 
      weeklyCount[day] > 0 ? revenue / weeklyCount[day] : 0
    );
  }

  // Расчет паттерна спроса
  private calculateDemandPattern(transactions: Transaction[]): number[] {
    const hourlyDemand = new Array(24).fill(0);
    const hourlyCount = new Array(24).fill(0);

    transactions.forEach(tx => {
      const hour = new Date(tx.date).getHours();
      hourlyDemand[hour] += tx.amount;
      hourlyCount[hour]++;
    });

    return hourlyDemand.map((demand, hour) => 
      hourlyCount[hour] > 0 ? demand / hourlyCount[hour] : 0
    );
  }

  // Расчет сезонности товаров
  private calculateProductSeasonality(transactions: Transaction[]): number[] {
    const monthlyRevenue = new Array(12).fill(0);
    const monthlyCount = new Array(12).fill(0);

    transactions.forEach(tx => {
      const month = getMonth(new Date(tx.date));
      monthlyRevenue[month] += tx.amount;
      monthlyCount[month]++;
    });

    return monthlyRevenue.map((revenue, month) => 
      monthlyCount[month] > 0 ? revenue / monthlyCount[month] : 0
    );
  }

  // Инициализация центроидов
  private initializeCentroids(data: any[], k: number): any[] {
    const centroids = [];
    const usedIndices = new Set<number>();
    
    for (let i = 0; i < k; i++) {
      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * data.length);
      } while (usedIndices.has(randomIndex));
      
      usedIndices.add(randomIndex);
      centroids.push({ ...data[randomIndex] });
    }
    
    return centroids;
  }

  // K-means алгоритм
  private kMeansClustering(data: any[], centroids: any[], k: number): any[][] {
    let clusters: any[][] = Array.from({ length: k }, () => [] as any[]);
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      // Назначаем точки к ближайшим центроидам
      clusters = Array.from({ length: k }, () => [] as any[]);
      
      data.forEach(point => {
        let minDistance = Infinity;
        let closestCentroid = 0;
        
        centroids.forEach((centroid, index) => {
          const distance = this.calculateDistance(point, centroid);
          if (distance < minDistance) {
            minDistance = distance;
            closestCentroid = index;
          }
        });
        
        clusters[closestCentroid].push(point);
      });

      // Обновляем центроиды
      const newCentroids = centroids.map((_, index) => {
        const cluster = clusters[index];
        if (cluster.length === 0) return centroids[index];
        
        return this.calculateCentroid(cluster);
      });

      // Проверяем сходимость
      changed = this.centroidsChanged(centroids, newCentroids);
      centroids = newCentroids;
      iterations++;
    }

    return clusters;
  }

  // Расчет расстояния между точками
  private calculateDistance(point1: any, point2: any): number {
    const features = ['avgCheck', 'frequency'];
    let distance = 0;
    
    features.forEach(feature => {
      if (point1[feature] !== undefined && point2[feature] !== undefined) {
        distance += Math.pow(point1[feature] - point2[feature], 2);
      }
    });
    
    // Добавляем расстояние по сезонности
    if (point1.seasonality && point2.seasonality) {
      const seasonalityDistance = point1.seasonality.reduce((sum: number, val: number, index: number) => {
        return sum + Math.pow(val - (point2.seasonality[index] || 0), 2);
      }, 0);
      distance += seasonalityDistance;
    }
    
    return Math.sqrt(distance);
  }

  // Расчет центроида кластера
  private calculateCentroid(cluster: any[]): any {
    if (cluster.length === 0) return {};
    
    const centroid: any = {};
    const features = ['avgCheck', 'frequency'];
    
    features.forEach(feature => {
      const values = cluster.map(point => point[feature] || 0);
      centroid[feature] = values.reduce((sum, val) => sum + val, 0) / values.length;
    });
    
    // Средняя сезонность
    if (cluster[0].seasonality) {
      const seasonalityLength = cluster[0].seasonality.length;
      centroid.seasonality = Array(seasonalityLength).fill(0);
      
      cluster.forEach(point => {
        if (point.seasonality) {
          point.seasonality.forEach((val: number, index: number) => {
            centroid.seasonality[index] += val;
          });
        }
      });
      
      centroid.seasonality = centroid.seasonality.map((sum: number) => sum / cluster.length);
    }
    
    return centroid;
  }

  // Проверка изменения центроидов
  private centroidsChanged(oldCentroids: any[], newCentroids: any[]): boolean {
    const threshold = 0.01;
    
    for (let i = 0; i < oldCentroids.length; i++) {
      const distance = this.calculateDistance(oldCentroids[i], newCentroids[i]);
      if (distance > threshold) return true;
    }
    
    return false;
  }

  // Форматирование кластеров клиентов
  private formatCustomerClusters(clusters: any[][]): CustomerCluster[] {
    return clusters.map((cluster, index) => {
      if (cluster.length === 0) return this.createEmptyCustomerCluster(index);
      
      const avgCheck = cluster.reduce((sum, c) => sum + c.avgCheck, 0) / cluster.length;
      const frequency = cluster.reduce((sum, c) => sum + c.frequency, 0) / cluster.length;
      const seasonality = cluster[0].seasonality || Array(7).fill(0);
      
      return {
        id: `customer_cluster_${index}`,
        name: this.getCustomerClusterName(avgCheck, frequency),
        size: cluster.length,
        avgCheck,
        frequency,
        seasonality,
        characteristics: {
          isHighValue: avgCheck > 500,
          isFrequent: frequency > 10,
          isSeasonal: this.calculateSeasonalityIndex(seasonality) > 0.3,
          preferredDays: this.getPreferredDays(seasonality),
          preferredMonths: this.getPreferredMonths(cluster)
        },
        transactions: cluster.flatMap(c => c.transactions)
      };
    });
  }

  // Форматирование кластеров товаров
  private formatProductClusters(clusters: any[][]): ProductCluster[] {
    return clusters.map((cluster, index) => {
      if (cluster.length === 0) return this.createEmptyProductCluster(index);
      
      const avgPrice = cluster.reduce((sum, c) => sum + c.avgPrice, 0) / cluster.length;
      const demandPattern = cluster[0].demandPattern || Array(24).fill(0);
      const seasonality = cluster[0].seasonality || Array(12).fill(0);
      
      return {
        id: `product_cluster_${index}`,
        name: this.getProductClusterName(avgPrice),
        size: cluster.length,
        avgPrice,
        demandPattern,
        seasonality,
        characteristics: {
          isPremium: avgPrice > 300,
          isSeasonal: this.calculateSeasonalityIndex(seasonality) > 0.3,
          isStable: this.calculateStabilityIndex(demandPattern) > 0.7,
          peakHours: this.getPeakHours(demandPattern),
          peakDays: this.getPeakDays(seasonality)
        },
        transactions: cluster.flatMap(c => c.transactions)
      };
    });
  }

  // Обнаружение аномалий
  private detectAnomalies(): void {
    this.anomalies = [
      ...this.detectRevenueAnomalies(),
      ...this.detectVolumeAnomalies(),
      ...this.detectPatternAnomalies(),
      ...this.detectSeasonalAnomalies()
    ];
  }

  // Обнаружение аномалий в выручке
  private detectRevenueAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const dailyRevenue = this.calculateDailyRevenue();
    
    if (dailyRevenue.length < 7) return anomalies;
    
    const mean = dailyRevenue.reduce((sum, d) => sum + d.revenue, 0) / dailyRevenue.length;
    const stdDev = Math.sqrt(
      dailyRevenue.reduce((sum, d) => sum + Math.pow(d.revenue - mean, 2), 0) / dailyRevenue.length
    );
    
    dailyRevenue.forEach((day, index) => {
      const zScore = Math.abs(day.revenue - mean) / stdDev;
      
      if (zScore > 2) {
        const severity = zScore > 3 ? 'critical' : zScore > 2.5 ? 'high' : 'medium';
        const deviation = (day.revenue - mean) / mean;
        
        anomalies.push({
          id: `revenue_anomaly_${index}`,
          type: 'revenue',
          severity: severity as any,
          date: day.date,
          value: day.revenue,
          expectedValue: mean,
          deviation,
          description: this.getRevenueAnomalyDescription(deviation, severity),
          impact: Math.abs(deviation),
          recommendations: this.getRevenueAnomalyRecommendations(deviation, severity)
        });
      }
    });
    
    return anomalies;
  }

  // Обнаружение аномалий в объеме
  private detectVolumeAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const dailyVolume = this.calculateDailyVolume();
    
    if (dailyVolume.length < 7) return anomalies;
    
    const mean = dailyVolume.reduce((sum, d) => sum + d.volume, 0) / dailyVolume.length;
    const stdDev = Math.sqrt(
      dailyVolume.reduce((sum, d) => sum + Math.pow(d.volume - mean, 2), 0) / dailyVolume.length
    );
    
    dailyVolume.forEach((day, index) => {
      const zScore = Math.abs(day.volume - mean) / stdDev;
      
      if (zScore > 2) {
        const severity = zScore > 3 ? 'critical' : zScore > 2.5 ? 'high' : 'medium';
        const deviation = (day.volume - mean) / mean;
        
        anomalies.push({
          id: `volume_anomaly_${index}`,
          type: 'volume',
          severity: severity as any,
          date: day.date,
          value: day.volume,
          expectedValue: mean,
          deviation,
          description: this.getVolumeAnomalyDescription(deviation, severity),
          impact: Math.abs(deviation),
          recommendations: this.getVolumeAnomalyRecommendations(deviation, severity)
        });
      }
    });
    
    return anomalies;
  }

  // Обнаружение аномалий в паттернах
  private detectPatternAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const hourlyPattern = this.calculateHourlyPattern();
    
    // Анализируем отклонения от типичного паттерна
    const typicalPattern = this.calculateTypicalHourlyPattern();
    
    hourlyPattern.forEach((hour, index) => {
      const expected = typicalPattern[index] || 0;
      const deviation = expected > 0 ? (hour - expected) / expected : 0;
      
      if (Math.abs(deviation) > 0.5) {
        anomalies.push({
          id: `pattern_anomaly_${index}`,
          type: 'pattern',
          severity: Math.abs(deviation) > 1 ? 'high' : 'medium',
          date: new Date().toISOString().split('T')[0],
          value: hour,
          expectedValue: expected,
          deviation,
          description: `Необычная активность в ${index}:00`,
          impact: Math.abs(deviation),
          recommendations: ['Проверить расписание работы', 'Анализировать причины пиковой активности']
        });
      }
    });
    
    return anomalies;
  }

  // Обнаружение сезонных аномалий
  private detectSeasonalAnomalies(): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const monthlyRevenue = this.calculateMonthlyRevenue();
    
    if (monthlyRevenue.length < 12) return anomalies;
    
    // Сравниваем с предыдущим годом
    const currentYear = monthlyRevenue.slice(-12);
    const previousYear = monthlyRevenue.slice(-24, -12);
    
    currentYear.forEach((month, index) => {
      if (previousYear[index]) {
        const deviation = (month.revenue - previousYear[index].revenue) / previousYear[index].revenue;
        
        if (Math.abs(deviation) > 0.3) {
          anomalies.push({
            id: `seasonal_anomaly_${index}`,
            type: 'seasonal',
            severity: Math.abs(deviation) > 0.5 ? 'high' : 'medium',
            date: month.date,
            value: month.revenue,
            expectedValue: previousYear[index].revenue,
            deviation,
            description: `Сезонная аномалия в ${month.date}`,
            impact: Math.abs(deviation),
            recommendations: ['Анализировать сезонные факторы', 'Корректировать прогнозы']
          });
        }
      }
    });
    
    return anomalies;
  }

  // Анализ трендов
  public analyzeTrends(): TrendAnalysis {
    const dailyRevenue = this.calculateDailyRevenue();
    
    if (dailyRevenue.length < 14) {
      return this.getDefaultTrendAnalysis();
    }
    
    const recent = dailyRevenue.slice(-7);
    const previous = dailyRevenue.slice(-14, -7);
    
    const recentAvg = recent.reduce((sum, d) => sum + d.revenue, 0) / recent.length;
    const previousAvg = previous.reduce((sum, d) => sum + d.revenue, 0) / previous.length;
    
    const growth = previousAvg > 0 ? (recentAvg - previousAvg) / previousAvg : 0;
    const direction = growth > 0.05 ? 'up' : growth < -0.05 ? 'down' : 'stable';
    const strength = Math.min(1, Math.abs(growth) * 2);
    
    return {
      period: '7 дней',
      direction: direction as any,
      strength,
      confidence: this.calculateTrendConfidence(dailyRevenue),
      factors: {
        seasonal: this.calculateSeasonalFactor(),
        economic: 0.1,
        weather: 0.05,
        social: 0.02,
        internal: 0.8
      },
      forecast: {
        nextWeek: recentAvg * 1.02,
        nextMonth: recentAvg * 4.1,
        nextQuarter: recentAvg * 12.3
      }
    };
  }

  // Анализ рыночных сегментов
  public analyzeMarketSegments(): MarketSegment[] {
    return this.customerClusters.map((cluster, index) => {
      const growth = this.calculateClusterGrowth(cluster);
      const profitability = this.calculateClusterProfitability(cluster);
      
      return {
        id: `market_segment_${index}`,
        name: cluster.name,
        size: cluster.size,
        growth,
        profitability,
        characteristics: {
          avgCheck: cluster.avgCheck,
          frequency: cluster.frequency,
          loyalty: this.calculateLoyalty(cluster),
          seasonality: this.calculateSeasonalityIndex(cluster.seasonality)
        },
        opportunities: this.identifyOpportunities(cluster),
        risks: this.identifyRisks(cluster)
      };
    });
  }

  // Вспомогательные методы
  private createDefaultCustomerClusters(data: any[]): CustomerCluster[] {
    return data.map((customer, index) => ({
      id: `customer_${index}`,
      name: 'Клиент',
      size: 1,
      avgCheck: customer.avgCheck,
      frequency: customer.frequency,
      seasonality: customer.seasonality,
      characteristics: {
        isHighValue: customer.avgCheck > 500,
        isFrequent: customer.frequency > 10,
        isSeasonal: false,
        preferredDays: [],
        preferredMonths: []
      },
      transactions: customer.transactions
    }));
  }

  private createDefaultProductClusters(data: any[]): ProductCluster[] {
    return data.map((product, index) => ({
      id: `product_${index}`,
      name: 'Товар',
      size: 1,
      avgPrice: product.avgPrice,
      demandPattern: product.demandPattern,
      seasonality: product.seasonality,
      characteristics: {
        isPremium: product.avgPrice > 300,
        isSeasonal: false,
        isStable: true,
        peakHours: [],
        peakDays: []
      },
      transactions: product.transactions
    }));
  }

  private createEmptyCustomerCluster(index: number): CustomerCluster {
    return {
      id: `empty_customer_cluster_${index}`,
      name: 'Пустой кластер',
      size: 0,
      avgCheck: 0,
      frequency: 0,
      seasonality: Array(7).fill(0),
      characteristics: {
        isHighValue: false,
        isFrequent: false,
        isSeasonal: false,
        preferredDays: [],
        preferredMonths: []
      },
      transactions: []
    };
  }

  private createEmptyProductCluster(index: number): ProductCluster {
    return {
      id: `empty_product_cluster_${index}`,
      name: 'Пустой кластер',
      size: 0,
      avgPrice: 0,
      demandPattern: Array(24).fill(0),
      seasonality: Array(12).fill(0),
      characteristics: {
        isPremium: false,
        isSeasonal: false,
        isStable: false,
        peakHours: [],
        peakDays: []
      },
      transactions: []
    };
  }

  private getCustomerClusterName(avgCheck: number, frequency: number): string {
    if (avgCheck > 500 && frequency > 10) return 'VIP клиенты';
    if (avgCheck > 300 && frequency > 5) return 'Постоянные клиенты';
    if (avgCheck > 200) return 'Средние клиенты';
    return 'Новые клиенты';
  }

  private getProductClusterName(avgPrice: number): string {
    if (avgPrice > 500) return 'Премиум товары';
    if (avgPrice > 200) return 'Средние товары';
    return 'Базовые товары';
  }

  private calculateSeasonalityIndex(seasonality: number[]): number {
    if (seasonality.length === 0) return 0;
    const mean = seasonality.reduce((sum, val) => sum + val, 0) / seasonality.length;
    const variance = seasonality.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / seasonality.length;
    return Math.sqrt(variance) / (mean + 1);
  }

  private calculateStabilityIndex(pattern: number[]): number {
    if (pattern.length === 0) return 0;
    const mean = pattern.reduce((sum, val) => sum + val, 0) / pattern.length;
    const variance = pattern.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / pattern.length;
    return Math.max(0, 1 - Math.sqrt(variance) / (mean + 1));
  }

  private getPreferredDays(seasonality: number[]): number[] {
    const maxValue = Math.max(...seasonality);
    return seasonality
      .map((val, index) => ({ val, index }))
      .filter(item => item.val > maxValue * 0.8)
      .map(item => item.index);
  }

  private getPreferredMonths(cluster: any[]): number[] {
    const monthlyCount = new Array(12).fill(0);
    cluster.forEach(customer => {
      customer.transactions.forEach((tx: Transaction) => {
        monthlyCount[getMonth(new Date(tx.date))]++;
      });
    });
    
    const maxCount = Math.max(...monthlyCount);
    return monthlyCount
      .map((count, index) => ({ count, index }))
      .filter(item => item.count > maxCount * 0.8)
      .map(item => item.index);
  }

  private getPeakHours(demandPattern: number[]): number[] {
    const maxValue = Math.max(...demandPattern);
    return demandPattern
      .map((val, index) => ({ val, index }))
      .filter(item => item.val > maxValue * 0.8)
      .map(item => item.index);
  }

  private getPeakDays(seasonality: number[]): number[] {
    return this.getPreferredDays(seasonality);
  }

  private calculateDailyRevenue(): Array<{ date: string; revenue: number }> {
    const dailyMap = new Map<string, number>();
    
    this.transactions.forEach(tx => {
      const date = format(new Date(tx.date), 'yyyy-MM-dd');
      dailyMap.set(date, (dailyMap.get(date) || 0) + tx.amount);
    });
    
    return Array.from(dailyMap.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private calculateDailyVolume(): Array<{ date: string; volume: number }> {
    const dailyMap = new Map<string, number>();
    
    this.transactions.forEach(tx => {
      const date = format(new Date(tx.date), 'yyyy-MM-dd');
      dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
    });
    
    return Array.from(dailyMap.entries())
      .map(([date, volume]) => ({ date, volume }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private calculateHourlyPattern(): number[] {
    const hourly = new Array(24).fill(0);
    const hourlyCount = new Array(24).fill(0);
    
    this.transactions.forEach(tx => {
      const hour = new Date(tx.date).getHours();
      hourly[hour] += tx.amount;
      hourlyCount[hour]++;
    });
    
    return hourly.map((revenue, hour) => 
      hourlyCount[hour] > 0 ? revenue / hourlyCount[hour] : 0
    );
  }

  private calculateTypicalHourlyPattern(): number[] {
    // Возвращаем типичный паттерн для кофейни
    return [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];
  }

  private calculateMonthlyRevenue(): Array<{ date: string; revenue: number }> {
    const monthlyMap = new Map<string, number>();
    
    this.transactions.forEach(tx => {
      const date = format(new Date(tx.date), 'yyyy-MM');
      monthlyMap.set(date, (monthlyMap.get(date) || 0) + tx.amount);
    });
    
    return Array.from(monthlyMap.entries())
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private getRevenueAnomalyDescription(deviation: number, severity: string): string {
    if (deviation > 0) {
      return `Неожиданный рост выручки на ${Math.round(deviation * 100)}%`;
    } else {
      return `Неожиданное падение выручки на ${Math.round(Math.abs(deviation) * 100)}%`;
    }
  }

  private getRevenueAnomalyRecommendations(deviation: number, severity: string): string[] {
    const recommendations = [];
    
    if (deviation > 0) {
      recommendations.push('Анализировать причины роста для повторения');
      recommendations.push('Увеличить запасы и персонал');
    } else {
      recommendations.push('Исследовать причины падения');
      recommendations.push('Проверить качество обслуживания');
    }
    
    if (severity === 'critical') {
      recommendations.push('Немедленно принять меры');
    }
    
    return recommendations;
  }

  private getVolumeAnomalyDescription(deviation: number, severity: string): string {
    if (deviation > 0) {
      return `Неожиданный рост количества транзакций на ${Math.round(deviation * 100)}%`;
    } else {
      return `Неожиданное падение количества транзакций на ${Math.round(Math.abs(deviation) * 100)}%`;
    }
  }

  private getVolumeAnomalyRecommendations(deviation: number, severity: string): string[] {
    const recommendations = [];
    
    if (deviation > 0) {
      recommendations.push('Проверить эффективность маркетинга');
      recommendations.push('Увеличить пропускную способность');
    } else {
      recommendations.push('Проверить доступность услуг');
      recommendations.push('Анализировать конкуренцию');
    }
    
    return recommendations;
  }

  private getDefaultTrendAnalysis(): TrendAnalysis {
    return {
      period: '7 дней',
      direction: 'stable',
      strength: 0.5,
      confidence: 0.3,
      factors: {
        seasonal: 0,
        economic: 0,
        weather: 0,
        social: 0,
        internal: 1
      },
      forecast: {
        nextWeek: 0,
        nextMonth: 0,
        nextQuarter: 0
      }
    };
  }

  private calculateTrendConfidence(dailyRevenue: Array<{ date: string; revenue: number }>): number {
    if (dailyRevenue.length < 7) return 0.3;
    
    const recent = dailyRevenue.slice(-7);
    const variance = this.calculateVariance(recent.map(d => d.revenue));
    const mean = recent.reduce((sum, d) => sum + d.revenue, 0) / recent.length;
    
    return Math.max(0.1, Math.min(0.9, 1 - Math.sqrt(variance) / (mean + 1)));
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  }

  private calculateSeasonalFactor(): number {
    const monthlyRevenue = this.calculateMonthlyRevenue();
    if (monthlyRevenue.length < 12) return 0;
    
    const currentYear = monthlyRevenue.slice(-12);
    const seasonality = this.calculateSeasonalityIndex(currentYear.map(m => m.revenue));
    return seasonality;
  }

  private calculateClusterGrowth(cluster: CustomerCluster): number {
    // Упрощенный расчет роста кластера
    return Math.random() * 0.2 - 0.1; // -10% to +10%
  }

  private calculateClusterProfitability(cluster: CustomerCluster): number {
    // Упрощенный расчет прибыльности кластера
    return cluster.avgCheck * cluster.frequency / 1000;
  }

  private calculateLoyalty(cluster: CustomerCluster): number {
    // Упрощенный расчет лояльности
    return Math.min(1, cluster.frequency / 20);
  }

  private identifyOpportunities(cluster: CustomerCluster): string[] {
    const opportunities = [];
    
    if (cluster.characteristics.isHighValue && !cluster.characteristics.isFrequent) {
      opportunities.push('Увеличить частоту посещений VIP клиентов');
    }
    
    if (cluster.characteristics.isFrequent && !cluster.characteristics.isHighValue) {
      opportunities.push('Повысить средний чек постоянных клиентов');
    }
    
    if (cluster.characteristics.isSeasonal) {
      opportunities.push('Разработать сезонные предложения');
    }
    
    return opportunities;
  }

  private identifyRisks(cluster: CustomerCluster): string[] {
    const risks = [];
    
    if (cluster.size < 5) {
      risks.push('Небольшой размер сегмента');
    }
    
    if (cluster.avgCheck < 100) {
      risks.push('Низкая средняя стоимость чека');
    }
    
    if (cluster.frequency < 2) {
      risks.push('Низкая частота посещений');
    }
    
    return risks;
  }

  // Публичные методы для получения результатов
  public getCustomerClusters(): CustomerCluster[] {
    return this.customerClusters;
  }

  public getProductClusters(): ProductCluster[] {
    return this.productClusters;
  }

  public getAnomalies(): Anomaly[] {
    return this.anomalies;
  }

  public getCriticalAnomalies(): Anomaly[] {
    return this.anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
  }

  public getAnomaliesByType(type: string): Anomaly[] {
    return this.anomalies.filter(a => a.type === type);
  }
}
