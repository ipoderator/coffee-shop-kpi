import type { EnhancedTimeSeriesData } from './enhancedMLForecasting';
import { format, addDays, getDay } from 'date-fns';

interface LLMCacheEntry {
  prediction: number;
  timestamp: number;
}

interface LLMConfig {
  apiKey: string; // Для OpenAI
  model: string;
  enabled: boolean;
  cacheTtl: number;
  maxRetries: number;
  temperature: number;
  timeoutMs?: number; // Таймаут для запросов в миллисекундах
  maxConcurrentRequests?: number; // Максимальное количество параллельных запросов
}

interface LLMMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cacheHits: number;
  averageResponseTime: number;
  totalCost: number;
}

/**
 * LLM движок для прогнозирования выручки кофейни
 * Использует OpenAI API
 */
export class LLMForecastingEngine {
  private config: LLMConfig;
  private cache: Map<string, LLMCacheEntry> = new Map();
  private metrics: LLMMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    averageResponseTime: 0,
    totalCost: 0,
  };
  private responseTimes: number[] = [];

  constructor(config?: Partial<LLMConfig>) {
    const apiKey = process.env.OPENAI_API_KEY || '';
    
    // LLM всегда включен по умолчанию, если есть API ключ OpenAI
    const enabled = !!apiKey;
    
    this.config = {
      apiKey,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      enabled,
      cacheTtl: parseInt(process.env.LLM_CACHE_TTL || '7200', 10), // 2 часа
      maxRetries: 3,
      temperature: 0.3, // Низкая температура для более детерминированных прогнозов
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '15000', 10), // 15 секунд для OpenAI
      maxConcurrentRequests: parseInt(process.env.LLM_MAX_CONCURRENT || '3', 10), // Максимум 3 параллельных запроса
      ...config,
    };

    // Детальное логирование статуса конфигурации
    if (apiKey) {
      const maskedKey = apiKey.length > 8 
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : '***';
      console.log(`[LLM Forecast] ✅ LLM включен по умолчанию - Model: ${this.config.model}, API Key: ${maskedKey}`);
    } else {
      console.warn(`[LLM Forecast] ⚠️  LLM не может быть включен: отсутствует OPENAI_API_KEY. LLM будет отключен.`);
    }
  }

  /**
   * Проверяет, доступен ли LLM
   */
  public isAvailable(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    
    if (!this.config.apiKey || this.config.apiKey.trim() === '') {
      console.warn('[LLM Forecast] ⚠️  API ключ OpenAI отсутствует или пустой');
      return false;
    }
    
    // Базовая валидация формата API ключа (должен начинаться с sk-)
    if (!this.config.apiKey.startsWith('sk-')) {
      return false;
    }
    
    return true;
  }

  /**
   * Основной метод прогнозирования, совместимый с другими моделями
   * Теперь использует параллельную обработку с ограничением количества одновременных запросов
   */
  public async predict(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): Promise<number[]> {
    // Валидация доступности LLM
    if (!this.isAvailable()) {
      console.warn('[LLM Forecast] ⚠️  LLM недоступен, используется fallback прогнозирование');
      return this.generateFallbackPredictions(data, futureData);
    }
    
    // Валидация количества данных
    if (data.length < 7) {
      console.warn(`[LLM Forecast] ⚠️  Недостаточно данных для LLM прогноза (${data.length} дней, требуется минимум 7), используется fallback`);
      return this.generateFallbackPredictions(data, futureData);
    }
    
    // Валидация API ключа перед запросами
    if (!this.config.apiKey || !this.config.apiKey.startsWith('sk-')) {
      console.error('[LLM Forecast] ❌ Неверный формат API ключа OpenAI');
      return this.generateFallbackPredictions(data, futureData);
    }

    // Сначала проверяем кеш для всех дней
    const predictions: (number | null)[] = [];
    const uncachedIndices: number[] = [];

    for (let i = 0; i < futureData.length; i++) {
      const futurePoint = futureData[i];
      const cacheKey = this.generateCacheKey(data, futurePoint);

      // Проверяем кеш
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtl * 1000) {
        predictions[i] = cached.prediction;
        this.metrics.cacheHits++;
      } else {
        predictions[i] = null;
        uncachedIndices.push(i);
      }
    }

    // Если все данные в кеше, возвращаем сразу
    if (uncachedIndices.length === 0) {
      return predictions as number[];
    }

    // Обрабатываем незакешированные дни параллельно с ограничением
    const maxConcurrent = this.config.maxConcurrentRequests || 3;
    const results: { index: number; prediction: number }[] = [];

    // Создаем батчи для параллельной обработки
    for (let batchStart = 0; batchStart < uncachedIndices.length; batchStart += maxConcurrent) {
      const batchEnd = Math.min(batchStart + maxConcurrent, uncachedIndices.length);
      const batch = uncachedIndices.slice(batchStart, batchEnd);

      const batchPromises = batch.map(async (originalIndex) => {
        const futurePoint = futureData[originalIndex];
        const cacheKey = this.generateCacheKey(data, futurePoint);
        const forecastDate = futurePoint.date ? new Date(futurePoint.date).toISOString().split('T')[0] : `day ${originalIndex}`;

        try {
          const startTime = Date.now();
          console.log(`[LLM Forecast] 📤 Запрос прогноза для ${forecastDate}...`);
          const prediction = await this.predictWithLLMWithTimeout(data, futurePoint);
          const responseTime = Date.now() - startTime;

          // Обновляем метрики
          this.metrics.totalRequests++;
          this.metrics.successfulRequests++;
          this.responseTimes.push(responseTime);
          this.updateAverageResponseTime();

          console.log(`[LLM Forecast] ✅ Успешный прогноз для ${forecastDate}: ${prediction.toFixed(0)} руб. (время: ${responseTime}ms)`);

          // Сохраняем в кеш
          this.cache.set(cacheKey, {
            prediction,
            timestamp: Date.now(),
          });

          return { index: originalIndex, prediction };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorDetails = error instanceof Error && 'status' in error 
            ? ` (статус: ${(error as any).status})` 
            : '';
          
          console.error(`[LLM Forecast] ❌ Ошибка прогноза для ${forecastDate}: ${errorMessage}${errorDetails}`);
          
          // Детальное логирование типов ошибок
          if (errorMessage.includes('API key')) {
            console.error(`[LLM Forecast] 🔑 Проблема с API ключом OpenAI. Проверьте OPENAI_API_KEY в .env`);
          } else if (errorMessage.includes('timeout')) {
            console.error(`[LLM Forecast] ⏱️  Таймаут запроса (${this.config.timeoutMs}ms). Возможно, API перегружен.`);
          } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
            console.error(`[LLM Forecast] 🚦 Превышен лимит запросов (rate limit). Увеличьте задержку между запросами.`);
          } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
            console.error(`[LLM Forecast] 🔐 Неавторизованный запрос. Проверьте валидность OPENAI_API_KEY.`);
          }
          
          this.metrics.totalRequests++;
          this.metrics.failedRequests++;

          // Fallback на простое прогнозирование
          const fallback = this.generateFallbackPrediction(data, futurePoint);
          console.log(`[LLM Forecast] 🔄 Используется fallback прогноз для ${forecastDate}: ${fallback.toFixed(0)} руб.`);
          return { index: originalIndex, prediction: fallback };
        }
      });

      // Ждем завершения текущего батча перед началом следующего
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Логируем метрики после каждого батча
      const batchSuccessCount = batchResults.length;
      const batchFailedCount = batch.length - batchSuccessCount;
      console.log(`[LLM Forecast] 📊 Батч завершен: ${batch.length} запросов. Всего: ${this.metrics.successfulRequests}/${this.metrics.totalRequests} успешно, ${this.metrics.failedRequests} ошибок`);
    }

    // Заполняем прогнозы
    for (const result of results) {
      predictions[result.index] = result.prediction;
    }

    return predictions as number[];
  }

  /**
   * Выполняет прогноз с таймаутом
   */
  private async predictWithLLMWithTimeout(
    historicalData: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): Promise<number> {
    // Используем таймаут из конфига (без fallback)
    const timeoutMs = this.config.timeoutMs;

    // Создаем промис с таймаутом
    const timeoutPromise = new Promise<number>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`LLM request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Соревнование между прогнозом и таймаутом
    return Promise.race([
      this.predictWithLLM(historicalData, futurePoint),
      timeoutPromise,
    ]);
  }

  /**
   * Генерирует прогноз с помощью LLM
   */
  private async predictWithLLM(
    historicalData: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): Promise<number> {
    // Используем специальный промпт для малых данных (<14 дней)
    const isSmallData = historicalData.length < 14;
    const prompt = isSmallData
      ? this.buildSmallDataPrompt(historicalData, futurePoint)
      : await this.buildPrompt(historicalData, futurePoint);
    const systemPrompt = isSmallData
      ? this.buildSmallDataSystemPrompt()
      : await this.buildSystemPrompt();

    let lastError: Error | null = null;

    // Улучшенная retry логика с экспоненциальным backoff
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await this.callOpenAI(systemPrompt, prompt);
        const prediction = this.parseLLMResponse(response);

        if (prediction !== null && Number.isFinite(prediction) && prediction >= 0) {
          return prediction;
        }
        
        // Если парсинг не удался, это тоже ошибка
        throw new Error('Failed to parse valid prediction from LLM response');
      } catch (error) {
        lastError = error as Error;
        
        // Прерываем на критичные ошибки
        const isCriticalError = 
          error instanceof Error && (
            error.message.includes('not found') ||
            error.message.includes('not available') ||
            error.message.includes('Cannot connect') ||
            error.message.includes('API key')
          );
        
        if (isCriticalError) {
          throw error; // Пробрасываем критическую ошибку сразу
        }
        
        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.pow(2, attempt) * 1000;
          
          const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
          console.warn(`[LLM Forecast] ⚠️  Попытка ${attempt + 1}/${this.config.maxRetries} не удалась: ${errorMsg}. Повтор через ${backoffMs}ms...`);
          
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          // Последняя попытка не удалась
          const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
          console.error(`[LLM Forecast] ❌ Все ${this.config.maxRetries} попыток не удались. Последняя ошибка: ${errorMsg}`);
        }
      }
    }

    throw lastError || new Error('Failed to get valid prediction from LLM after all retries');
  }

  /**
   * Вызывает OpenAI API
   */
  private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
    // Динамический импорт для уменьшения размера бандла, если API не используется
    const { default: OpenAI } = await import('openai');

    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const openai = new OpenAI({
      apiKey: this.config.apiKey,
    });

    const requestStartTime = Date.now();
    
    try {
      console.log(`[LLM Forecast] 📡 Отправка запроса к OpenAI API (модель: ${this.config.model})...`);
      
      const response = await openai.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.config.temperature,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });

      const requestTime = Date.now() - requestStartTime;
      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        console.error(`[LLM Forecast] ❌ Пустой ответ от OpenAI API (время запроса: ${requestTime}ms)`);
        throw new Error('Empty response from OpenAI');
      }

      console.log(`[LLM Forecast] ✅ Получен ответ от OpenAI API (время: ${requestTime}ms, токены: ${response.usage?.total_tokens || 'N/A'})`);
      return content;
    } catch (error: any) {
      const requestTime = Date.now() - requestStartTime;
      const statusCode = error?.status || error?.response?.status || 'N/A';
      const errorMessage = error?.message || String(error);
      const errorType = error?.type || 'unknown';
      
      console.error(`[LLM Forecast] ❌ Ошибка OpenAI API (время запроса: ${requestTime}ms, статус: ${statusCode}, тип: ${errorType}): ${errorMessage}`);
      
      if (statusCode === 401) {
        console.error(`[LLM Forecast] 🔐 Ошибка авторизации (401). Проверьте правильность OPENAI_API_KEY в .env`);
        throw new Error('Invalid OpenAI API key (401 Unauthorized)');
      } else if (statusCode === 429) {
        // Rate limit - ждем и пробуем еще раз
        const retryAfter = error?.response?.headers?.['retry-after'] || 5;
        console.warn(`[LLM Forecast] 🚦 Rate limit (429). Ожидание ${retryAfter} секунд перед повтором...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        throw new Error(`Rate limit exceeded (429). Retry after ${retryAfter}s`);
      } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
        console.error(`[LLM Forecast] 🔧 Ошибка сервера OpenAI (${statusCode}). Сервер временно недоступен.`);
        throw new Error(`OpenAI server error (${statusCode})`);
      } else if (errorMessage.includes('timeout') || (this.config.timeoutMs && requestTime >= this.config.timeoutMs)) {
        console.error(`[LLM Forecast] ⏱️  Таймаут запроса (${requestTime}ms >= ${this.config.timeoutMs || 'N/A'}ms)`);
        throw new Error(`Request timeout after ${requestTime}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Строит системный промпт для LLM
   */
  private async buildSystemPrompt(): Promise<string> {
    // Получаем историческую точность для улучшения промпта
    let historicalAccuracyInfo = '';
    try {
      const { getModelMetrics } = await import('./forecastFeedback');
      const metrics = await getModelMetrics('LLM');
      if (metrics.length > 0) {
        const overallMetric = metrics.find((m) => m.dayOfWeek === null && m.horizon === null);
        if (overallMetric) {
          const accuracy = Math.max(0, Math.min(1, 1 - overallMetric.mape));
          historicalAccuracyInfo = `\n\nИСТОРИЧЕСКАЯ ТОЧНОСТЬ ТВОИХ ПРОГНОЗОВ:
- Средняя точность (1 - MAPE): ${(accuracy * 100).toFixed(1)}%
- MAPE (Mean Absolute Percentage Error): ${(overallMetric.mape * 100).toFixed(1)}%
- MAE (Mean Absolute Error): ${overallMetric.mae.toFixed(0)} руб.
- RMSE (Root Mean Squared Error): ${overallMetric.rmse.toFixed(0)} руб.
- Размер выборки: ${overallMetric.sampleSize} прогнозов

ИСПОЛЬЗУЙ ЭТУ ИНФОРМАЦИЮ ДЛЯ КАЛИБРОВКИ УВЕРЕННОСТИ:
- Если твоя историческая точность ${(accuracy * 100).toFixed(0)}%, то твоя уверенность должна быть близка к этому значению
- Не переоценивай уверенность, если историческая точность ниже
- Учитывай типичные ошибки при оценке уверенности`;
        }
      }
    } catch (error) {
      // Игнорируем ошибки получения метрик
    }

    return `Ты эксперт по прогнозированию выручки для кофейни. Твоя задача - анализировать исторические данные о продажах и внешние факторы (погода, праздники, экономика) для прогнозирования выручки на будущие дни.

Ты должен:
1. Анализировать паттерны в исторических данных (тренды, сезонность, дни недели)
2. Учитывать внешние факторы (погода, праздники, экономические показатели)
3. Выявлять аномалии и корректировать прогнозы соответственно
4. Давать реалистичные прогнозы, основанные на данных
5. Калибровать уверенность на основе реальной исторической точности${historicalAccuracyInfo}

ТИПИЧНЫЕ ОШИБКИ, КОТОРЫХ СЛЕДУЕТ ИЗБЕГАТЬ:
- Переоценка влияния внешних факторов (погода обычно влияет слабо, ~5-10%)
- Недооценка сезонности и дней недели (это самые важные факторы)
- Слишком высокая уверенность при малом количестве данных
- Игнорирование трендов и паттернов в исторических данных

Твои ответы должны быть в формате JSON:
{
  "predictedRevenue": <число>,
  "confidence": <0-1>, // Калибруй на основе исторической точности!
  "reasoning": "<краткое обоснование>",
  "factors": {
    "trend": "<up/down/stable>",
    "seasonality": "<описание сезонности>",
    "externalFactors": "<влияние внешних факторов>"
  }
}`;
  }

  /**
   * Строит пользовательский промпт с данными
   */
  private buildPrompt(
    historicalData: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): string {
    // Берем последние 60 дней для анализа (или меньше, если данных меньше)
    const recentData = historicalData.slice(-60);
    const forecastDate = futurePoint.date ? new Date(futurePoint.date) : addDays(new Date(historicalData[historicalData.length - 1]?.date || new Date()), 1);

    // Статистика по историческим данным
    const revenues = recentData.map((d) => d.revenue);
    const avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
    const medianRevenue = this.getMedian(revenues);
    const minRevenue = Math.min(...revenues);
    const maxRevenue = Math.max(...revenues);

    // Анализ по дням недели
    const dayOfWeek = futurePoint.dayOfWeek ?? getDay(forecastDate);
    const sameDayData = recentData.filter((d) => d.dayOfWeek === dayOfWeek);
    const sameDayAvg = sameDayData.length > 0
      ? sameDayData.reduce((sum, d) => sum + d.revenue, 0) / sameDayData.length
      : avgRevenue;

    // Тренд (последние 7 дней vs предыдущие 7 дней)
    const last7Days = revenues.slice(-7);
    const prev7Days = revenues.slice(-14, -7);
    const last7Avg = last7Days.reduce((sum, r) => sum + r, 0) / last7Days.length;
    const prev7Avg = prev7Days.length > 0 ? prev7Days.reduce((sum, r) => sum + r, 0) / prev7Days.length : last7Avg;
    const trend = prev7Avg > 0 ? ((last7Avg - prev7Avg) / prev7Avg) * 100 : 0;

    // Волатильность
    const variance = revenues.reduce((sum, r) => sum + Math.pow(r - avgRevenue, 2), 0) / revenues.length;
    const volatility = Math.sqrt(variance) / avgRevenue;

    // Последние 14 дней для контекста
    const last14Days = recentData.slice(-14).map((d) => ({
      date: d.date,
      revenue: d.revenue,
      dayOfWeek: d.dayOfWeek,
      isWeekend: d.isWeekend,
      temperature: d.temperature,
      precipitation: d.precipitation,
      isHoliday: d.isHoliday,
      holidayType: d.holidayType,
    }));

    // Внешние факторы для прогнозируемого дня
    const externalFactors = {
      dayOfWeek,
      dayOfMonth: forecastDate.getDate(),
      month: forecastDate.getMonth() + 1,
      isWeekend: futurePoint.isWeekend ?? (dayOfWeek === 0 || dayOfWeek === 6),
      isHoliday: futurePoint.isHoliday ?? false,
      holidayType: futurePoint.holidayType || 'none',
      temperature: futurePoint.temperature ?? 15,
      precipitation: futurePoint.precipitation ?? 0,
      exchangeRate: futurePoint.exchangeRate ?? 95,
      isMonthStart: (forecastDate.getDate() <= 3),
      isMonthEnd: (forecastDate.getDate() >= 28),
    };

    return `Анализируй исторические данные о выручке кофейни и спрогнозируй выручку на ${format(forecastDate, 'dd.MM.yyyy')} (${this.getDayName(dayOfWeek)}).

ИСТОРИЧЕСКИЕ ДАННЫЕ:
- Период анализа: ${recentData.length} дней
- Средняя выручка: ${Math.round(avgRevenue)} руб
- Медианная выручка: ${Math.round(medianRevenue)} руб
- Минимум: ${Math.round(minRevenue)} руб
- Максимум: ${Math.round(maxRevenue)} руб
- Тренд (последние 7 дней vs предыдущие 7): ${trend.toFixed(1)}%
- Волатильность: ${(volatility * 100).toFixed(1)}%

ДАННЫЕ ПО ДНЮ НЕДЕЛИ (${this.getDayName(dayOfWeek)}):
- Средняя выручка в этот день недели: ${Math.round(sameDayAvg)} руб
- Количество наблюдений: ${sameDayData.length}

ПОСЛЕДНИЕ 14 ДНЕЙ:
${JSON.stringify(last14Days, null, 2)}

ВНЕШНИЕ ФАКТОРЫ ДЛЯ ПРОГНОЗИРУЕМОГО ДНЯ:
${JSON.stringify(externalFactors, null, 2)}

ЗАДАЧА:
Спрогнозируй выручку на ${format(forecastDate, 'dd.MM.yyyy')}, учитывая:
1. Исторические паттерны (средняя выручка, тренд, сезонность)
2. Особенности дня недели
3. Внешние факторы (погода, праздники, экономика)
4. Недавние изменения в данных

Ответь в формате JSON с полями: predictedRevenue (число в рублях), confidence (0-1), reasoning (обоснование), factors (объект с анализом факторов).`;
  }

  /**
   * Парсит ответ LLM в числовое значение с улучшенной обработкой различных форматов
   */
  private parseLLMResponse(response: string): number | null {
    if (!response || typeof response !== 'string') {
      console.warn('[LLM Forecast] Empty or invalid response');
      return null;
    }

    // Убираем лишние пробелы и переносы строк
    const cleaned = response.trim();

    try {
      // Пытаемся распарсить как JSON
      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Если не JSON, пробуем найти JSON блок в тексте
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      }

      // Пробуем разные поля для получения выручки
      const revenue = 
        parsed.predictedRevenue ?? 
        parsed.revenue ?? 
        parsed.prediction ?? 
        parsed.value ?? 
        parsed.amount;

      if (typeof revenue === 'number' && Number.isFinite(revenue) && revenue >= 0) {
        return Math.round(revenue);
      }

      // Если revenue - строка, пытаемся распарсить
      if (typeof revenue === 'string') {
        const num = parseFloat(revenue.replace(/[^\d.-]/g, ''));
        if (Number.isFinite(num) && num >= 0) {
          return Math.round(num);
        }
      }
    } catch (error) {
      // Если JSON парсинг не удался, пробуем найти число в тексте
      console.warn('[LLM Forecast] JSON parsing failed, trying to extract number from text:', error);
    }

    // Ищем числа в тексте (приоритет большим числам, которые похожи на выручку)
    // Ищем числа от 1000 и выше (разумная выручка кофейни)
    const numberPatterns = [
      /(\d{4,})/, // 4+ цифры подряд
      /(\d{1,3}(?:\s?\d{3})*(?:[.,]\d+)?)/, // Форматированные числа с пробелами/запятыми
      /(\d+\.\d+)/, // Десятичные числа
      /(\d+)/, // Любые числа
    ];

    for (const pattern of numberPatterns) {
      const matches = cleaned.match(pattern);
      if (matches && matches[1]) {
        const numStr = matches[1].replace(/[\s,]/g, '').replace(',', '.');
        const num = parseFloat(numStr);
        if (Number.isFinite(num) && num >= 0) {
          // Предпочитаем числа в разумном диапазоне для выручки кофейни (1000-1000000)
          if (num >= 1000 && num <= 1000000) {
            return Math.round(num);
          }
        }
      }
    }

    // Если ничего не нашли, пробуем последнее найденное число
    const allNumbers = cleaned.match(/\d+/g);
    if (allNumbers && allNumbers.length > 0) {
      // Берем самое большое число (скорее всего это выручка)
      const numbers = allNumbers.map(n => parseFloat(n)).filter(n => Number.isFinite(n) && n >= 0);
      if (numbers.length > 0) {
        const maxNum = Math.max(...numbers);
        if (maxNum >= 100) { // Минимум 100 рублей
          return Math.round(maxNum);
        }
      }
    }

    console.warn('[LLM Forecast] Failed to parse LLM response, no valid number found:', cleaned.substring(0, 200));
    return null;
  }

  /**
   * Генерирует ключ для кеша (улучшенная версия с большим контекстом)
   */
  private generateCacheKey(
    data: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): string {
    // Используем последние 14 дней для более точного кеширования
    const recentDays = data.slice(-14);
    const recentDataHash = recentDays.map((d) => 
      `${d.date}:${Math.round(d.revenue)}:${d.dayOfWeek}`
    ).join(',');
    
    // Более детальный ключ для будущего дня
    const futureKey = [
      futurePoint.date || '',
      futurePoint.dayOfWeek ?? '',
      futurePoint.isHoliday ? '1' : '0',
      futurePoint.holidayType || '',
      Math.round(futurePoint.temperature || 0),
      Math.round((futurePoint.precipitation || 0) * 10) / 10,
      futurePoint.isWeekend ? '1' : '0',
    ].join(':');
    
    // Добавляем хеш среднего значения для быстрого сравнения
    const avgRevenue = recentDays.length > 0
      ? recentDays.reduce((sum, d) => sum + d.revenue, 0) / recentDays.length
      : 0;
    const avgHash = Math.round(avgRevenue / 1000); // Округляем до тысяч
    
    return `${recentDataHash}|${futureKey}|avg:${avgHash}`;
  }

  /**
   * Генерирует fallback прогноз (простое среднее)
   */
  private generateFallbackPredictions(
    data: EnhancedTimeSeriesData[],
    futureData: Partial<EnhancedTimeSeriesData>[],
  ): number[] {
    return futureData.map((futurePoint) => this.generateFallbackPrediction(data, futurePoint));
  }

  /**
   * Генерирует fallback прогноз для одного дня
   */
  private generateFallbackPrediction(
    data: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): number {
    if (data.length === 0) {
      return 0;
    }

    const revenues = data.map((d) => d.revenue);
    const avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;

    // Учитываем день недели, если есть данные
    const dayOfWeek = futurePoint.dayOfWeek;
    if (dayOfWeek !== undefined) {
      const sameDayData = data.filter((d) => d.dayOfWeek === dayOfWeek);
      if (sameDayData.length > 0) {
        const sameDayAvg = sameDayData.reduce((sum, d) => sum + d.revenue, 0) / sameDayData.length;
        return Math.round(sameDayAvg * 0.7 + avgRevenue * 0.3);
      }
    }

    return Math.round(avgRevenue);
  }

  /**
   * Получает медиану массива
   */
  private getMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Обновляет среднее время ответа
   */
  private updateAverageResponseTime(): void {
    if (this.responseTimes.length > 0) {
      const sum = this.responseTimes.reduce((a, b) => a + b, 0);
      this.metrics.averageResponseTime = sum / this.responseTimes.length;
      
      // Храним только последние 100 значений
      if (this.responseTimes.length > 100) {
        this.responseTimes = this.responseTimes.slice(-100);
      }
    }
  }

  /**
   * Строит системный промпт для малых данных (<14 дней)
   */
  private buildSmallDataSystemPrompt(): string {
    return `Ты эксперт по прогнозированию выручки для кофейни. У тебя есть ограниченное количество исторических данных (менее 14 дней), поэтому тебе нужно использовать экспертные знания о типичных паттернах кофеен.

Ты должен:
1. Использовать экспертные знания о типичных паттернах кофеен:
   - Понедельник-Четверг: обычно выручка на 10% ниже среднего
   - Пятница-Воскресенье: обычно выручка на 10-15% выше среднего
   - Праздники: повышение выручки на 20-30%
   - Лето: повышение на 5-10%, Зима: снижение на 5-10%
   - Начало месяца (1-5 число): снижение на 5%, Конец месяца (25-31): повышение на 10%
2. Анализировать доступные данные (даже если их мало)
3. Учитывать внешние факторы (погода, праздники)
4. Давать консервативные прогнозы, основанные на экспертных знаниях и доступных данных

Твои ответы должны быть в формате JSON:
{
  "predictedRevenue": <число>,
  "confidence": <0-1>,
  "reasoning": "<краткое обоснование с упоминанием экспертных знаний>",
  "factors": {
    "trend": "<up/down/stable>",
    "seasonality": "<описание сезонности>",
    "externalFactors": "<влияние внешних факторов>",
    "expertKnowledge": "<какие экспертные знания использованы>"
  }
}`;
  }

  /**
   * Строит промпт для малых данных (<14 дней)
   */
  private buildSmallDataPrompt(
    historicalData: EnhancedTimeSeriesData[],
    futurePoint: Partial<EnhancedTimeSeriesData>,
  ): string {
    const forecastDate = futurePoint.date ? new Date(futurePoint.date) : addDays(new Date(historicalData[historicalData.length - 1]?.date || new Date()), 1);
    const dayOfWeek = futurePoint.dayOfWeek ?? getDay(forecastDate);
    const month = forecastDate.getMonth() + 1;
    const dayOfMonth = forecastDate.getDate();

    // Статистика по доступным данным
    const revenues = historicalData.map((d) => d.revenue);
    const avgRevenue = revenues.reduce((sum, r) => sum + r, 0) / revenues.length;
    const medianRevenue = this.getMedian(revenues);

    // Анализ по дням недели (если есть данные)
    const sameDayData = historicalData.filter((d) => d.dayOfWeek === dayOfWeek);
    const sameDayAvg = sameDayData.length > 0
      ? sameDayData.reduce((sum, d) => sum + d.revenue, 0) / sameDayData.length
      : null;

    // Все доступные данные
    const allDays = historicalData.map((d) => ({
      date: d.date,
      revenue: d.revenue,
      dayOfWeek: d.dayOfWeek,
      dayName: this.getDayName(d.dayOfWeek),
      isWeekend: d.isWeekend,
      temperature: d.temperature,
      precipitation: d.precipitation,
      isHoliday: d.isHoliday,
    }));

    // Внешние факторы
    const externalFactors = {
      dayOfWeek,
      dayName: this.getDayName(dayOfWeek),
      dayOfMonth,
      month,
      isWeekend: futurePoint.isWeekend ?? (dayOfWeek === 0 || dayOfWeek === 6),
      isHoliday: futurePoint.isHoliday ?? false,
      holidayType: futurePoint.holidayType || 'none',
      temperature: futurePoint.temperature ?? 15,
      precipitation: futurePoint.precipitation ?? 0,
      isMonthStart: (dayOfMonth <= 5),
      isMonthEnd: (dayOfMonth >= 25),
      isSummer: month >= 6 && month <= 8,
      isWinter: month >= 12 || month <= 2,
    };

    // Экспертные коэффициенты
    const dayOfWeekMultiplier = dayOfWeek >= 1 && dayOfWeek <= 4 ? 0.9 : dayOfWeek >= 5 ? 1.1 : 1.0;
    const monthMultiplier = externalFactors.isSummer ? 1.05 : externalFactors.isWinter ? 0.95 : 1.0;
    const monthEndMultiplier = externalFactors.isMonthEnd ? 1.1 : externalFactors.isMonthStart ? 0.95 : 1.0;
    const holidayMultiplier = externalFactors.isHoliday ? 1.25 : 1.0;

    return `У тебя есть ограниченные исторические данные о выручке кофейни (${historicalData.length} дней). Используй экспертные знания о типичных паттернах кофеен для компенсации недостатка данных.

ДОСТУПНЫЕ ДАННЫЕ (${historicalData.length} дней):
- Средняя выручка: ${Math.round(avgRevenue)} руб
- Медианная выручка: ${Math.round(medianRevenue)} руб
${sameDayAvg !== null ? `- Средняя выручка в ${this.getDayName(dayOfWeek)}: ${Math.round(sameDayAvg)} руб (${sameDayData.length} наблюдений)` : ''}

ВСЕ ДОСТУПНЫЕ ДНИ:
${JSON.stringify(allDays, null, 2)}

ВНЕШНИЕ ФАКТОРЫ ДЛЯ ПРОГНОЗИРУЕМОГО ДНЯ (${format(forecastDate, 'dd.MM.yyyy')}):
${JSON.stringify(externalFactors, null, 2)}

ЭКСПЕРТНЫЕ ЗНАНИЯ О ПАТТЕРНАХ КОФЕЕН:
1. Дни недели:
   - Понедельник-Четверг: обычно -10% от среднего (коэффициент 0.9)
   - Пятница-Воскресенье: обычно +10-15% от среднего (коэффициент 1.1-1.15)
   - ${this.getDayName(dayOfWeek)}: ожидаемый коэффициент ${dayOfWeekMultiplier.toFixed(2)}

2. Сезонность:
   - Лето (июнь-август): +5-10% (коэффициент 1.05-1.1)
   - Зима (декабрь-февраль): -5-10% (коэффициент 0.9-0.95)
   - Текущий месяц (${month}): коэффициент ${monthMultiplier.toFixed(2)}

3. Время месяца:
   - Начало месяца (1-5 число): -5% (коэффициент 0.95)
   - Конец месяца (25-31 число): +10% (коэффициент 1.1)
   - Текущий день (${dayOfMonth}): коэффициент ${monthEndMultiplier.toFixed(2)}

4. Праздники:
   - Праздничные дни: +20-30% (коэффициент 1.2-1.3)
   - ${externalFactors.isHoliday ? `Это праздник (${futurePoint.holidayType || 'unknown'}), коэффициент ${holidayMultiplier.toFixed(2)}` : 'Это не праздник'}

ЗАДАЧА:
Спрогнозируй выручку на ${format(forecastDate, 'dd.MM.yyyy')}, комбинируя:
1. Доступные исторические данные (${historicalData.length} дней)
2. Экспертные знания о паттернах кофеен (используй коэффициенты выше)
3. Внешние факторы (погода, праздники)

Начни с базовой выручки (средняя или медианная из доступных данных), затем примени экспертные коэффициенты для дня недели, сезонности, времени месяца и праздников.

Ответь в формате JSON с полями: predictedRevenue (число в рублях), confidence (0-1, учитывай ограниченность данных), reasoning (обоснование с упоминанием экспертных знаний), factors (объект с анализом факторов).`;
  }

  /**
   * Получает название дня недели
   */
  private getDayName(dayOfWeek: number): string {
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    return days[dayOfWeek] || 'Неизвестно';
  }

  /**
   * Получает метрики использования LLM
   */
  public getMetrics(): LLMMetrics {
    return { ...this.metrics };
  }

  /**
   * Очищает кеш
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Очищает старые записи из кеша
   */
  public cleanupCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.config.cacheTtl * 1000) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * Очищает все ресурсы: кеш, временные данные
   * ВАЖНО: Метрики НЕ очищаются, так как они нужны для отображения статуса
   * Вызывается после завершения анализа для освобождения памяти
   */
  public cleanup(): void {
    // Очищаем кеш
    this.cache.clear();
    
    // НЕ очищаем метрики - они нужны для отображения статуса LLM
    // Метрики будут накапливаться между вызовами, что позволяет отслеживать общую статистику
    
    // Очищаем массив времен отклика (но сохраняем метрики)
    // Оставляем последние 100 значений для расчета среднего времени ответа
    if (this.responseTimes.length > 100) {
      this.responseTimes = this.responseTimes.slice(-100);
    }
    
    console.log('[LLM Forecast] Ресурсы очищены (метрики сохранены для отображения)');
  }
}
