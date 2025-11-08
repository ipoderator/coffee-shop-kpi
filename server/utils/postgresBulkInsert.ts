/**
 * Утилиты для bulk insert в PostgreSQL через Drizzle ORM
 * Используется для оптимизации массовой вставки транзакций
 * 
 * Примечание: Этот модуль подготовлен для будущей миграции с in-memory storage на PostgreSQL
 */

import { transactions } from '@shared/schema';
import type { InsertTransaction } from '@shared/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Выполняет bulk insert транзакций в PostgreSQL
 * Оптимизировано для вставки больших объемов данных
 * 
 * @param db - Экземпляр Drizzle database connection
 * @param insertTransactions - Массив транзакций для вставки
 * @param batchSize - Размер батча (по умолчанию 500)
 * @returns Массив созданных транзакций
 */
export async function bulkInsertTransactions(
  db: NodePgDatabase<any>,
  insertTransactions: InsertTransaction[],
  batchSize: number = 500,
): Promise<typeof transactions.$inferSelect[]> {
  if (insertTransactions.length === 0) {
    return [];
  }

  const results: typeof transactions.$inferSelect[] = [];

  // Обрабатываем транзакции батчами для оптимизации производительности
  for (let i = 0; i < insertTransactions.length; i += batchSize) {
    const batch = insertTransactions.slice(i, i + batchSize);
    
    // Используем Drizzle's insert().values() для bulk insert
    const inserted = await db
      .insert(transactions)
      .values(batch)
      .returning();

    results.push(...inserted);
  }

  return results;
}

/**
 * Выполняет bulk insert с использованием транзакции для обеспечения атомарности
 * Полезно когда нужно гарантировать, что все транзакции будут вставлены или ни одна
 * 
 * @param db - Экземпляр Drizzle database connection
 * @param insertTransactions - Массив транзакций для вставки
 * @param batchSize - Размер батча (по умолчанию 500)
 * @returns Массив созданных транзакций
 */
export async function bulkInsertTransactionsWithTransaction(
  db: NodePgDatabase<any>,
  insertTransactions: InsertTransaction[],
  batchSize: number = 500,
): Promise<typeof transactions.$inferSelect[]> {
  if (insertTransactions.length === 0) {
    return [];
  }

  // Используем транзакцию для атомарности
  return await db.transaction(async (tx) => {
    const results: typeof transactions.$inferSelect[] = [];

    for (let i = 0; i < insertTransactions.length; i += batchSize) {
      const batch = insertTransactions.slice(i, i + batchSize);
      
      const inserted = await tx
        .insert(transactions)
        .values(batch)
        .returning();

      results.push(...inserted);
    }

    return results;
  });
}

/**
 * Проверяет, доступна ли PostgreSQL база данных
 * Используется для определения, какой storage использовать
 * 
 * @param db - Экземпляр Drizzle database connection (может быть undefined)
 * @returns true если PostgreSQL доступен
 */
export function isPostgresAvailable(db: any): db is NodePgDatabase<any> {
  return db !== undefined && db !== null && typeof db.insert === 'function';
}

