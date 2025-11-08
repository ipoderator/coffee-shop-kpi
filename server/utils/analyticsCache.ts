/**
 * Простое кеширование результатов аналитики для оптимизации производительности
 */

import type { AnalyticsResponse } from '@shared/schema';
import { createHash } from 'crypto';

type LLMStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface CacheEntry {
  data: AnalyticsResponse;
  timestamp: number;
  llmStatus?: LLMStatus;
  llmData?: AnalyticsResponse; // Данные с LLM анализом
  llmError?: string; // Ошибка при LLM анализе
}

// Простое in-memory кеширование
// В production можно заменить на Redis
class AnalyticsCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttl: number; // Время жизни кеша в миллисекундах
  // Храним маппинг uploadId -> ключи кеша для быстрой инвалидации
  private uploadIdToKeys: Map<string, Set<string>> = new Map();

  constructor(ttlSeconds: number = 300) {
    // По умолчанию 5 минут
    this.ttl = ttlSeconds * 1000;
  }

  /**
   * Генерирует ключ кеша на основе параметров запроса
   */
  private generateKey(uploadId: string, params: {
    preset?: string;
    from?: string;
    to?: string;
    includeLLM?: boolean;
  }): string {
    const keyData = JSON.stringify({ uploadId, ...params });
    return createHash('sha256').update(keyData).digest('hex');
  }

  /**
   * Получает данные из кеша
   */
  get(uploadId: string, params: {
    preset?: string;
    from?: string;
    to?: string;
    includeLLM?: boolean;
  }): AnalyticsResponse | null {
    const key = this.generateKey(uploadId, params);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Проверяем срок действия
    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Сохраняет данные в кеш
   */
  set(uploadId: string, params: {
    preset?: string;
    from?: string;
    to?: string;
    includeLLM?: boolean;
  }, data: AnalyticsResponse): void {
    const key = this.generateKey(uploadId, params);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
    
    // Сохраняем связь uploadId -> ключ для быстрой инвалидации
    if (!this.uploadIdToKeys.has(uploadId)) {
      this.uploadIdToKeys.set(uploadId, new Set());
    }
    this.uploadIdToKeys.get(uploadId)!.add(key);
  }

  /**
   * Очищает кеш для конкретного uploadId
   */
  invalidate(uploadId: string): void {
    const keys = this.uploadIdToKeys.get(uploadId);
    if (keys) {
      keys.forEach(key => this.cache.delete(key));
      this.uploadIdToKeys.delete(uploadId);
    }
  }

  /**
   * Очищает весь кеш
   */
  clear(): void {
    this.cache.clear();
    this.uploadIdToKeys.clear();
  }

  /**
   * Обновляет статус LLM анализа для записи
   */
  updateLLMStatus(
    uploadId: string,
    status: LLMStatus,
    llmData?: AnalyticsResponse,
    error?: Error | string,
    params?: {
      preset?: string;
      from?: string;
      to?: string;
      includeLLM?: boolean;
    }
  ): void {
    if (params) {
      // Обновляем конкретную запись по параметрам
      const key = this.generateKey(uploadId, params);
      const entry = this.cache.get(key);
      if (entry) {
        entry.llmStatus = status;
        if (llmData) {
          entry.llmData = llmData;
        }
        if (error) {
          entry.llmError = error instanceof Error ? error.message : error;
        }
      }
    } else {
      // Находим все ключи для этого uploadId (для обратной совместимости)
      const keys = this.uploadIdToKeys.get(uploadId);
      if (!keys) {
        return;
      }

      // Обновляем статус для всех записей этого uploadId
      keys.forEach(key => {
        const entry = this.cache.get(key);
        if (entry) {
          entry.llmStatus = status;
          if (llmData) {
            entry.llmData = llmData;
          }
          if (error) {
            entry.llmError = error instanceof Error ? error.message : error;
          }
        }
      });
    }
  }

  /**
   * Получает статус LLM анализа
   */
  getLLMStatus(uploadId: string, params: {
    preset?: string;
    from?: string;
    to?: string;
    includeLLM?: boolean;
  }): { status: LLMStatus; data?: AnalyticsResponse; error?: string } | null {
    const key = this.generateKey(uploadId, params);
    const entry = this.cache.get(key);
    
    if (!entry || !entry.llmStatus) {
      return null;
    }

    return {
      status: entry.llmStatus,
      data: entry.llmData,
      error: entry.llmError,
    };
  }

  /**
   * Очищает устаревшие записи
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.cache.delete(key);
      // Удаляем ключ из маппинга uploadId
      for (const [uploadId, keys] of this.uploadIdToKeys.entries()) {
        keys.delete(key);
        if (keys.size === 0) {
          this.uploadIdToKeys.delete(uploadId);
        }
      }
    });
  }

  /**
   * Получает статистику кеша
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: 1000, // Максимальный размер кеша
    };
  }
}

// Создаем глобальный экземпляр кеша
export const analyticsCache = new AnalyticsCache(
  parseInt(process.env.ANALYTICS_CACHE_TTL_SECONDS || '300', 10)
);

// Периодическая очистка устаревших записей (каждые 10 минут)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    analyticsCache.cleanup();
  }, 10 * 60 * 1000);
}

