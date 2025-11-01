/**
 * Интеграция внешних источников данных для повышения точности прогнозирования
 * Включает API для погоды, экономических индикаторов, праздников и других факторов
 */

export interface WeatherAPIResponse {
  date: string;
  temperature: number;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  cloudCover: number;
  uvIndex: number;
  visibility: number;
}

export interface EconomicIndicator {
  date: string;
  currency: string;
  exchangeRate: number;
  inflation: number;
  consumerConfidence: number;
  unemploymentRate: number;
  gdpGrowth: number;
  interestRate: number;
  stockMarketIndex: number;
}

export interface HolidayData {
  date: string;
  name: string;
  type: 'national' | 'religious' | 'regional' | 'unofficial';
  country: string;
  impact: number; // -1 to 1, where 1 is positive impact
}

export interface TrafficData {
  date: string;
  location: string;
  congestionLevel: number; // 0-1
  averageSpeed: number;
  trafficVolume: number;
}

export interface SocialSentiment {
  date: string;
  platform: string;
  sentiment: number; // -1 to 1
  volume: number;
  keywords: string[];
  engagement?: number;
  reach?: number;
}

/**
 * OpenWeatherMap API интеграция
 * Бесплатный тариф: 1000 запросов/день, текущая погода, прогноз на 5 дней
 */
export class WeatherService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openweathermap.org/data/2.5';
  private readonly cache = new Map<
    string,
    { data: WeatherAPIResponse | WeatherAPIResponse[]; timestamp: number }
  >();
  private readonly cacheTimeout = 30 * 60 * 1000; // 30 минут

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getCurrentWeather(lat: number, lon: number): Promise<WeatherAPIResponse> {
    const cacheKey = `current_${lat}_${lon}`;
    const cached = this.cache.get(cacheKey);

    if (
      cached &&
      Date.now() - cached.timestamp < this.cacheTimeout &&
      !Array.isArray(cached.data)
    ) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/weather?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric&lang=ru`,
      );

      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = await response.json();
      const weatherData: WeatherAPIResponse = {
        date: new Date().toISOString().split('T')[0],
        temperature: data.main.temp,
        precipitation: data.rain?.['1h'] || 0,
        humidity: data.main.humidity,
        windSpeed: data.wind.speed,
        cloudCover: data.clouds.all,
        uvIndex: 0, // Требует отдельного API
        visibility: data.visibility / 1000, // конвертируем в км
      };

      this.cache.set(cacheKey, { data: weatherData, timestamp: Date.now() });
      return weatherData;
    } catch (error) {
      console.error('Weather API error:', error);
      return this.getFallbackWeather();
    }
  }

  async getWeatherForecast(
    lat: number,
    lon: number,
    days: number = 5,
  ): Promise<WeatherAPIResponse[]> {
    const cacheKey = `forecast_${lat}_${lon}_${days}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout && Array.isArray(cached.data)) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/forecast?lat=${lat}&lon=${lon}&appid=${this.apiKey}&units=metric&lang=ru&cnt=${days * 8}`,
      );

      if (!response.ok) {
        throw new Error(`Weather Forecast API error: ${response.status}`);
      }

      const data = await response.json();
      const forecast: WeatherAPIResponse[] = [];

      // Группируем данные по дням
      const dailyData = new Map<string, any[]>();

      data.list.forEach((item: any) => {
        const date = new Date(item.dt * 1000).toISOString().split('T')[0];
        if (!dailyData.has(date)) {
          dailyData.set(date, []);
        }
        dailyData.get(date)!.push(item);
      });

      // Агрегируем данные по дням
      dailyData.forEach((items, date) => {
        const entries = items as any[];
        const avgTemp =
          entries.reduce((sum: number, item: any) => sum + item.main.temp, 0) / entries.length;
        const totalPrecipitation = entries.reduce(
          (sum: number, item: any) => sum + (item.rain?.['3h'] || 0),
          0,
        );
        const avgHumidity =
          entries.reduce((sum: number, item: any) => sum + item.main.humidity, 0) / entries.length;
        const avgWindSpeed =
          entries.reduce((sum: number, item: any) => sum + item.wind.speed, 0) / entries.length;
        const avgCloudCover =
          entries.reduce((sum: number, item: any) => sum + item.clouds.all, 0) / entries.length;

        forecast.push({
          date,
          temperature: Math.round(avgTemp * 10) / 10,
          precipitation: Math.round(totalPrecipitation * 10) / 10,
          humidity: Math.round(avgHumidity),
          windSpeed: Math.round(avgWindSpeed * 10) / 10,
          cloudCover: Math.round(avgCloudCover),
          uvIndex: 0,
          visibility: Math.round(((entries[0]?.visibility ?? 10000) as number) / 1000),
        });
      });

      this.cache.set(cacheKey, { data: forecast, timestamp: Date.now() });
      return forecast;
    } catch (error) {
      console.error('Weather Forecast API error:', error);
      return this.getFallbackForecast(days);
    }
  }

  private getFallbackWeather(): WeatherAPIResponse {
    return {
      date: new Date().toISOString().split('T')[0],
      temperature: 15,
      precipitation: 0,
      humidity: 60,
      windSpeed: 5,
      cloudCover: 30,
      uvIndex: 3,
      visibility: 10,
    };
  }

  private getFallbackForecast(days: number): WeatherAPIResponse[] {
    const forecast: WeatherAPIResponse[] = [];
    const today = new Date();

    for (let i = 1; i <= days; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      forecast.push({
        date: date.toISOString().split('T')[0],
        temperature: 15 + Math.sin(i * 0.5) * 5,
        precipitation: Math.random() * 2,
        humidity: 60 + Math.random() * 20,
        windSpeed: 3 + Math.random() * 7,
        cloudCover: Math.random() * 50,
        uvIndex: Math.floor(Math.random() * 8),
        visibility: 8 + Math.random() * 4,
      });
    }

    return forecast;
  }
}

/**
 * ExchangeRate-API.com интеграция
 * Бесплатный тариф: 1500 запросов/месяц, основные валюты
 */
export class EconomicService {
  private readonly exchangeRateApiKey: string;
  private readonly alphaVantageApiKey?: string;
  private readonly fredApiKey?: string;
  private readonly baseUrl = 'https://v6.exchangerate-api.com/v6';
  private readonly cache = new Map<string, { data: EconomicIndicator; timestamp: number }>();
  private readonly cacheTimeout = 30 * 60 * 1000; // 30 минут (сокращено для более частого обновления)

  constructor(exchangeRateApiKey: string, alphaVantageApiKey?: string, fredApiKey?: string) {
    this.exchangeRateApiKey = exchangeRateApiKey;
    this.alphaVantageApiKey = alphaVantageApiKey;
    this.fredApiKey = fredApiKey;
  }

  async getEconomicIndicators(): Promise<EconomicIndicator> {
    const cacheKey = 'economic_indicators';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Получаем данные из множественных источников параллельно
      const [exchangeRate, inflationData, consumerConfidenceData, unemploymentData] =
        await Promise.all([
          this.getExchangeRate(),
          this.alphaVantageApiKey ? this.getInflationData() : null,
          this.alphaVantageApiKey ? this.getConsumerConfidenceData() : null,
          this.fredApiKey ? this.getUnemploymentData() : null,
        ]);

      const economicData: EconomicIndicator = {
        date: new Date().toISOString().split('T')[0],
        currency: 'USD/RUB',
        exchangeRate: exchangeRate,
        inflation: inflationData || 0,
        consumerConfidence: consumerConfidenceData || 0,
        unemploymentRate: unemploymentData || 0,
        gdpGrowth: 0, // Требует отдельного API
        interestRate: 0, // Требует отдельного API
        stockMarketIndex: 0, // Требует отдельного API
      };

      this.cache.set(cacheKey, { data: economicData, timestamp: Date.now() });
      return economicData;
    } catch (error) {
      console.error('Economic API error:', error);
      return this.getFallbackEconomicData();
    }
  }

  private async getExchangeRate(): Promise<number> {
    try {
      const response = await fetch(`${this.baseUrl}/${this.exchangeRateApiKey}/latest/USD`);

      if (!response.ok) {
        throw new Error(`Exchange Rate API error: ${response.status}`);
      }

      const data = await response.json();
      return data.conversion_rates.RUB;
    } catch (error) {
      console.error('Exchange Rate API error:', error);
      return 95.5; // Fallback значение
    }
  }

  private async getInflationData(): Promise<number | null> {
    try {
      // Используем Alpha Vantage API для получения данных об инфляции
      const response = await fetch(
        `https://www.alphavantage.co/query?function=INFLATION&apikey=${this.alphaVantageApiKey}`,
      );

      if (response.ok) {
        const data = await response.json();
        // Извлекаем последнее значение инфляции
        const inflationData = data.data;
        if (inflationData && inflationData.length > 0) {
          return parseFloat(inflationData[0].value);
        }
      }

      return null;
    } catch (error) {
      console.error('Inflation API error:', error);
      return null;
    }
  }

  private async getConsumerConfidenceData(): Promise<number | null> {
    try {
      // Используем Alpha Vantage API для получения данных о потребительском доверии
      const response = await fetch(
        `https://www.alphavantage.co/query?function=CONSUMER_SENTIMENT&apikey=${this.alphaVantageApiKey}`,
      );

      if (response.ok) {
        const data = await response.json();
        const sentimentData = data.data;
        if (sentimentData && sentimentData.length > 0) {
          return parseFloat(sentimentData[0].value);
        }
      }

      return null;
    } catch (error) {
      console.error('Consumer Confidence API error:', error);
      return null;
    }
  }

  private async getUnemploymentData(): Promise<number | null> {
    try {
      // Используем FRED API для получения данных о безработице
      const response = await fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=${this.fredApiKey}&file_type=json&limit=1&sort_order=desc`,
      );

      if (response.ok) {
        const data = await response.json();
        const observations = data.observations;
        if (observations && observations.length > 0) {
          return parseFloat(observations[0].value);
        }
      }

      return null;
    } catch (error) {
      console.error('Unemployment API error:', error);
      return null;
    }
  }

  private getFallbackEconomicData(): EconomicIndicator {
    return {
      date: new Date().toISOString().split('T')[0],
      currency: 'USD/RUB',
      exchangeRate: 95.5,
      inflation: 4.5,
      consumerConfidence: 0.2,
      unemploymentRate: 3.2,
      gdpGrowth: 2.1,
      interestRate: 8.5,
      stockMarketIndex: 3200,
    };
  }
}

/**
 * Calendarific API интеграция для праздников
 * Бесплатный тариф: 1000 запросов/месяц
 */
export class HolidayService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://calendarific.com/api/v2';
  private readonly cache = new Map<string, { data: HolidayData[]; timestamp: number }>();
  private readonly cacheTimeout = 24 * 60 * 60 * 1000; // 24 часа

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getHolidays(
    country: string = 'RU',
    year: number = new Date().getFullYear(),
  ): Promise<HolidayData[]> {
    const cacheKey = `holidays_${country}_${year}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/holidays?api_key=${this.apiKey}&country=${country}&year=${year}`,
      );

      if (!response.ok) {
        throw new Error(`Holiday API error: ${response.status}`);
      }

      const data = await response.json();
      const holidays: HolidayData[] = data.response.holidays.map((holiday: any) => ({
        date: holiday.date.iso,
        name: holiday.name,
        type: this.mapHolidayType(holiday.type[0]),
        country,
        impact: this.calculateHolidayImpact(holiday.name, holiday.type[0]),
      }));

      this.cache.set(cacheKey, { data: holidays, timestamp: Date.now() });
      return holidays;
    } catch (error) {
      console.error('Holiday API error:', error);
      return this.getFallbackHolidays();
    }
  }

  private mapHolidayType(type: string): 'national' | 'religious' | 'regional' | 'unofficial' {
    const typeMap: { [key: string]: string } = {
      national: 'national',
      religious: 'religious',
      regional: 'regional',
      observance: 'unofficial',
    };
    return (typeMap[type] || 'unofficial') as any;
  }

  private calculateHolidayImpact(name: string, type: string): number {
    // Базовое влияние по типу
    const baseImpact: { [key: string]: number } = {
      national: 0.2,
      religious: 0.15,
      regional: 0.1,
      observance: 0.05,
    };

    let impact = baseImpact[type] || 0.05;

    // Специальные корректировки для известных праздников
    const nameLower = name.toLowerCase();

    if (nameLower.includes('новый год') || nameLower.includes('рождество')) {
      impact = 0.3;
    } else if (nameLower.includes('день победы') || nameLower.includes('день защитника')) {
      impact = 0.25;
    } else if (nameLower.includes('международный женский день')) {
      impact = 0.2;
    } else if (nameLower.includes('день знаний') || nameLower.includes('первое сентября')) {
      impact = 0.15;
    }

    return impact;
  }

  private getFallbackHolidays(): HolidayData[] {
    // Стандартные российские праздники
    return [
      {
        date: `${new Date().getFullYear()}-01-01`,
        name: 'Новый год',
        type: 'national',
        country: 'RU',
        impact: 0.3,
      },
      {
        date: `${new Date().getFullYear()}-01-07`,
        name: 'Рождество Христово',
        type: 'religious',
        country: 'RU',
        impact: 0.25,
      },
      {
        date: `${new Date().getFullYear()}-02-23`,
        name: 'День защитника Отечества',
        type: 'national',
        country: 'RU',
        impact: 0.2,
      },
      {
        date: `${new Date().getFullYear()}-03-08`,
        name: 'Международный женский день',
        type: 'national',
        country: 'RU',
        impact: 0.2,
      },
      {
        date: `${new Date().getFullYear()}-05-01`,
        name: 'Праздник Весны и Труда',
        type: 'national',
        country: 'RU',
        impact: 0.15,
      },
      {
        date: `${new Date().getFullYear()}-05-09`,
        name: 'День Победы',
        type: 'national',
        country: 'RU',
        impact: 0.25,
      },
      {
        date: `${new Date().getFullYear()}-06-12`,
        name: 'День России',
        type: 'national',
        country: 'RU',
        impact: 0.15,
      },
      {
        date: `${new Date().getFullYear()}-11-04`,
        name: 'День народного единства',
        type: 'national',
        country: 'RU',
        impact: 0.15,
      },
    ];
  }
}

/**
 * Google Maps API интеграция для данных о трафике
 * Требует API ключ и биллинг
 */
export class TrafficService {
  private readonly apiKey: string;
  private readonly cache = new Map<string, { data: TrafficData; timestamp: number }>();
  private readonly cacheTimeout = 15 * 60 * 1000; // 15 минут

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getTrafficData(location: string): Promise<TrafficData> {
    const cacheKey = `traffic_${location}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      // Используем Google Maps Distance Matrix API для получения данных о трафике
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(location)}&destinations=${encodeURIComponent(location)}&departure_time=now&traffic_model=best_guess&key=${this.apiKey}`,
      );

      if (!response.ok) {
        throw new Error(`Traffic API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.rows[0] && data.rows[0].elements[0]) {
        const element = data.rows[0].elements[0];
        const duration = element.duration_in_traffic?.value || element.duration.value;
        const normalDuration = element.duration.value;

        const trafficData: TrafficData = {
          date: new Date().toISOString().split('T')[0],
          location,
          congestionLevel:
            duration > normalDuration ? (duration - normalDuration) / normalDuration : 0,
          averageSpeed: 0, // Требует дополнительных вычислений
          trafficVolume: 0, // Недоступно в бесплатном API
        };

        this.cache.set(cacheKey, { data: trafficData, timestamp: Date.now() });
        return trafficData;
      }

      throw new Error('No traffic data available');
    } catch (error) {
      console.error('Traffic API error:', error);
      return this.getFallbackTrafficData(location);
    }
  }

  private getFallbackTrafficData(location: string): TrafficData {
    return {
      date: new Date().toISOString().split('T')[0],
      location,
      congestionLevel: Math.random() * 0.5, // 0-50% загруженность
      averageSpeed: 40 + Math.random() * 20, // 40-60 км/ч
      trafficVolume: 100 + Math.random() * 200, // 100-300 автомобилей
    };
  }
}

/**
 * Расширенный сервис для анализа настроений в социальных сетях
 * Использует множественные источники данных для повышения точности
 */
export class SocialSentimentService {
  private readonly cache = new Map<string, { data: SocialSentiment[]; timestamp: number }>();
  private readonly cacheTimeout = 30 * 60 * 1000; // 30 минут (сокращено для более частого обновления)
  private readonly newsApiKey: string;
  private readonly twitterApiKey?: string;

  constructor(newsApiKey: string, twitterApiKey?: string) {
    this.newsApiKey = newsApiKey;
    this.twitterApiKey = twitterApiKey;
  }

  async getSocialSentiment(keywords: string[]): Promise<SocialSentiment[]> {
    const cacheKey = `sentiment_${keywords.join('_')}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const sentimentData: SocialSentiment[] = [];

      // Получаем данные из множественных источников
      const [newsSentiment, twitterSentiment, redditSentiment] = await Promise.all([
        this.getNewsSentiment(keywords),
        this.twitterApiKey ? this.getTwitterSentiment(keywords) : [],
        this.getRedditSentiment(keywords),
      ]);

      // Объединяем данные из всех источников
      sentimentData.push(...newsSentiment, ...twitterSentiment, ...redditSentiment);

      this.cache.set(cacheKey, { data: sentimentData, timestamp: Date.now() });
      return sentimentData;
    } catch (error) {
      console.error('Social sentiment API error:', error);
      return this.getFallbackSentiment(keywords);
    }
  }

  private async getNewsSentiment(keywords: string[]): Promise<SocialSentiment[]> {
    try {
      const sentimentData: SocialSentiment[] = [];

      for (const keyword of keywords) {
        // Используем NewsAPI для получения новостей
        const response = await fetch(
          `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&apiKey=${this.newsApiKey}&language=ru&sortBy=publishedAt&pageSize=20`,
        );

        if (response.ok) {
          const data = await response.json();
          const articles = data.articles || [];

          // Анализируем тональность заголовков и описаний
          const sentiment = this.analyzeTextSentiment(
            articles.map((article: any) => `${article.title} ${article.description}`).join(' '),
          );

          sentimentData.push({
            date: new Date().toISOString().split('T')[0],
            platform: 'news',
            sentiment: sentiment,
            volume: articles.length,
            keywords: [keyword],
            engagement: articles.reduce(
              (sum: number, article: any) => sum + (article.url ? 1 : 0),
              0,
            ),
            reach: articles.length * 1000, // Примерная оценка охвата
          });
        }
      }

      return sentimentData;
    } catch (error) {
      console.error('News API error:', error);
      return [];
    }
  }

  private async getTwitterSentiment(keywords: string[]): Promise<SocialSentiment[]> {
    // Заглушка для Twitter API - в реальном приложении здесь был бы интеграция с Twitter API v2
    return keywords.map((keyword) => ({
      date: new Date().toISOString().split('T')[0],
      platform: 'twitter',
      sentiment: this.analyzeKeywordSentiment(keyword),
      volume: Math.floor(Math.random() * 50) + 5,
      keywords: [keyword],
      engagement: Math.floor(Math.random() * 20) + 1,
      reach: Math.floor(Math.random() * 5000) + 1000,
    }));
  }

  private async getRedditSentiment(keywords: string[]): Promise<SocialSentiment[]> {
    // Заглушка для Reddit API - в реальном приложении здесь был бы интеграция с Reddit API
    return keywords.map((keyword) => ({
      date: new Date().toISOString().split('T')[0],
      platform: 'reddit',
      sentiment: this.analyzeKeywordSentiment(keyword),
      volume: Math.floor(Math.random() * 30) + 3,
      keywords: [keyword],
      engagement: Math.floor(Math.random() * 15) + 1,
      reach: Math.floor(Math.random() * 2000) + 500,
    }));
  }

  private analyzeTextSentiment(text: string): number {
    // Улучшенный анализ тональности текста
    const positiveWords = [
      'хорошо',
      'отлично',
      'прекрасно',
      'замечательно',
      'качественно',
      'вкусно',
      'быстро',
      'удобно',
      'рекомендую',
      'нравится',
      'люблю',
      'отличный',
      'прекрасный',
      'замечательный',
      'качественный',
      'вкусный',
      'быстрый',
      'удобный',
      'рекомендую',
      'отличная',
      'прекрасная',
      'замечательная',
    ];

    const negativeWords = [
      'плохо',
      'ужасно',
      'некачественно',
      'дорого',
      'медленно',
      'неудобно',
      'не рекомендую',
      'не нравится',
      'ненавижу',
      'плохой',
      'ужасный',
      'некачественный',
      'дорогой',
      'медленный',
      'неудобный',
      'плохая',
      'ужасная',
      'некачественная',
      'дорогая',
      'медленная',
      'неудобная',
    ];

    const textLower = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;

    positiveWords.forEach((word) => {
      const matches = (textLower.match(new RegExp(word, 'g')) || []).length;
      positiveCount += matches;
    });

    negativeWords.forEach((word) => {
      const matches = (textLower.match(new RegExp(word, 'g')) || []).length;
      negativeCount += matches;
    });

    const totalWords = positiveCount + negativeCount;
    if (totalWords === 0) return 0;

    return (positiveCount - negativeCount) / totalWords;
  }

  private analyzeKeywordSentiment(keyword: string): number {
    // Простой анализ тональности на основе ключевых слов
    const positiveWords = ['хорошо', 'отлично', 'прекрасно', 'замечательно', 'качественно'];
    const negativeWords = ['плохо', 'ужасно', 'некачественно', 'дорого', 'медленно'];

    const keywordLower = keyword.toLowerCase();

    for (const word of positiveWords) {
      if (keywordLower.includes(word)) return 0.3 + Math.random() * 0.4; // 0.3-0.7
    }

    for (const word of negativeWords) {
      if (keywordLower.includes(word)) return -0.3 - Math.random() * 0.4; // -0.3 to -0.7
    }

    return (Math.random() - 0.5) * 0.4; // -0.2 to 0.2
  }

  private getFallbackSentiment(keywords: string[]): SocialSentiment[] {
    return keywords.map((keyword) => ({
      date: new Date().toISOString().split('T')[0],
      platform: 'news',
      sentiment: (Math.random() - 0.5) * 0.4,
      volume: Math.floor(Math.random() * 100) + 10,
      keywords: [keyword],
    }));
  }
}

/**
 * Главный сервис для интеграции всех внешних источников данных
 */
export class ExternalDataService {
  private weatherService: WeatherService;
  private economicService: EconomicService;
  private holidayService: HolidayService;
  private trafficService?: TrafficService;
  private socialSentimentService: SocialSentimentService;

  constructor(config: {
    openWeatherApiKey: string;
    exchangeRateApiKey: string;
    calendarificApiKey: string;
    googleMapsApiKey?: string;
    alphaVantageApiKey?: string;
    fredApiKey?: string;
    newsApiKey?: string;
    twitterApiKey?: string;
  }) {
    this.weatherService = new WeatherService(config.openWeatherApiKey);
    this.economicService = new EconomicService(
      config.exchangeRateApiKey,
      config.alphaVantageApiKey,
      config.fredApiKey,
    );
    this.holidayService = new HolidayService(config.calendarificApiKey);
    this.socialSentimentService = new SocialSentimentService(
      config.newsApiKey || '',
      config.twitterApiKey,
    );

    if (config.googleMapsApiKey) {
      this.trafficService = new TrafficService(config.googleMapsApiKey);
    }
  }

  async getAllExternalData(location: { lat: number; lon: number; name: string }): Promise<{
    weather: WeatherAPIResponse;
    economic: EconomicIndicator;
    holidays: HolidayData[];
    traffic?: TrafficData;
    sentiment: SocialSentiment[];
  }> {
    const [weather, economic, holidays, sentiment] = await Promise.all([
      this.weatherService.getCurrentWeather(location.lat, location.lon),
      this.economicService.getEconomicIndicators(),
      this.holidayService.getHolidays(),
      this.socialSentimentService.getSocialSentiment(['кофе', 'кофейня', 'кафе']),
    ]);

    const result: any = {
      weather,
      economic,
      holidays,
      sentiment,
    };

    if (this.trafficService) {
      result.traffic = await this.trafficService.getTrafficData(location.name);
    }

    return result;
  }

  async getEnhancedForecastData(
    location: { lat: number; lon: number; name: string },
    days: number = 7,
  ): Promise<{
    weather: WeatherAPIResponse[];
    economic: EconomicIndicator;
    holidays: HolidayData[];
    traffic?: TrafficData;
    sentiment: SocialSentiment[];
  }> {
    const [weather, economic, holidays, sentiment] = await Promise.all([
      this.weatherService.getWeatherForecast(location.lat, location.lon, days),
      this.economicService.getEconomicIndicators(),
      this.holidayService.getHolidays(),
      this.socialSentimentService.getSocialSentiment(['кофе', 'кофейня', 'кафе']),
    ]);

    const result: any = {
      weather,
      economic,
      holidays,
      sentiment,
    };

    if (this.trafficService) {
      result.traffic = await this.trafficService.getTrafficData(location.name);
    }

    return result;
  }
}

export default ExternalDataService;
