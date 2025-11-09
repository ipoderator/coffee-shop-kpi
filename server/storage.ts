// NOTE: In production replace this in-memory storage with persistent storage (e.g. PostgreSQL or Redis)
// and update callers that import `storage` in server/routes.ts, server/utils/auth.ts,
// server/utils/security.ts, and server/utils/securityLogger.ts to use the new implementation.
import {
  type Transaction,
  type InsertTransaction,
  type User,
  type InsertUser,
  type UserSession,
  type InsertUserSession,
  type SecurityLog,
  type InsertSecurityLog,
  type ProfitabilityRecord,
  type ProfitabilityDatasetInfo,
  type ProfitabilityImportLogEntry,
  type ProfitabilityImportStatus,
  type ProfitabilityImportError,
  type ProfitabilityCogsItem,
  type SalesZReport,
  type CogsDaily,
  type ImportBatch,
  type ForecastPrediction,
  type InsertForecastPrediction,
  type ModelAccuracyMetric,
  type InsertModelAccuracyMetric,
} from '@shared/schema';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { log } from './vite';

export interface IStorage {
  // Transactions
  getTransactionsByUploadId(uploadId: string): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createTransactions(transactions: InsertTransaction[]): Promise<Transaction[]>;
  deleteTransactionsByUploadId(uploadId: string): Promise<void>;

  // Profitability datasets
  createProfitabilityDataset(
    input: CreateProfitabilityDatasetInput,
  ): Promise<{ dataset: ProfitabilityDatasetInfo; records: ProfitabilityRecord[] }>;
  getProfitabilityDataset(
    datasetId: string,
  ): Promise<{ dataset: ProfitabilityDatasetInfo; records: ProfitabilityRecord[] } | null>;
  listProfitabilityDatasets(): Promise<ProfitabilityDatasetInfo[]>;
  listAllProfitabilityRecords(): Promise<ProfitabilityRecord[]>;
  createProfitabilityImportLog(
    input: CreateProfitabilityImportLogInput,
  ): Promise<ProfitabilityImportLogEntry>;
  listProfitabilityImportLogs(limit?: number): Promise<ProfitabilityImportLogEntry[]>;
  createImportBatch(input: CreateImportBatchInput): Promise<ImportBatch>;
  upsertCogsDaily(
    input: UpsertCogsDailyInput & { importBatchId: string },
  ): Promise<{ records: CogsDaily[] }>;
  listCogsDaily(): Promise<CogsDaily[]>;
  
  // Profitability file storage
  saveProfitabilityFile(datasetId: string, fileBuffer: Buffer): Promise<void>;
  getProfitabilityFile(datasetId: string): Promise<Buffer | null>;

  // Users
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User | null>;

  // Sessions
  getSessionByToken(sessionToken: string): Promise<UserSession | null>;
  createSession(session: InsertUserSession): Promise<UserSession>;
  updateSessionLastUsed(sessionToken: string): Promise<void>;
  deleteSession(sessionToken: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;

  // Security
  createSecurityLog(log: InsertSecurityLog): Promise<SecurityLog>;
  getSecurityLogsByUserId(userId: string, limit: number, offset: number): Promise<SecurityLog[]>;
  updateUserFailedAttempts(userId: string, attempts: number, lockedUntil?: Date): Promise<void>;
  resetUserFailedAttempts(userId: string): Promise<void>;

  // Forecast Predictions (Feedback Loop)
  createForecastPrediction(prediction: InsertForecastPrediction): Promise<ForecastPrediction>;
  getForecastPredictionById(id: string): Promise<ForecastPrediction | null>;
  updateForecastPredictionWithActual(
    id: string,
    actualRevenue: number,
    mape: number,
    mae: number,
    rmse: number,
  ): Promise<ForecastPrediction | null>;
  getForecastPredictionsByUploadId(uploadId: string): Promise<ForecastPrediction[]>;
  getForecastPredictionsWithoutActual(limit?: number): Promise<ForecastPrediction[]>;
  getForecastPredictionsByModel(
    modelName: string,
    dayOfWeek?: number,
    horizon?: number,
  ): Promise<ForecastPrediction[]>;
  getAllForecastPredictions(): Promise<ForecastPrediction[]>;

  // Model Accuracy Metrics
  getModelAccuracyMetric(
    modelName: string,
    dayOfWeek?: number | null,
    horizon?: number | null,
  ): Promise<ModelAccuracyMetric | null>;
  upsertModelAccuracyMetric(metric: InsertModelAccuracyMetric): Promise<ModelAccuracyMetric>;
  getAllModelAccuracyMetrics(): Promise<ModelAccuracyMetric[]>;
  getModelAccuracyMetricsByModel(modelName: string): Promise<ModelAccuracyMetric[]>;
  deleteModelAccuracyMetric(id: string): Promise<void>;
}

export interface CreateProfitabilityDatasetInput {
  name?: string;
  sourceFile?: string;
  periodStart: Date;
  periodEnd: Date;
  records: ProfitabilityRecordInput[];
  totalBonuses?: number;
  totalDiscounts?: number;
  totalBonusAccrued?: number;
  fileBuffer?: Buffer;
}

export interface ProfitabilityRecordInput {
  reportDate: Date;
  shiftNumber?: string | null;
  incomeChecks?: number;
  cashIncome?: number;
  cashlessIncome?: number;
  returnChecks?: number;
  cashReturn?: number;
  cashlessReturn?: number;
  correctionChecks?: number;
  correctionCash?: number;
  correctionCashless?: number;
  cogsTotal?: number | null;
  cogsDetails?: ProfitabilityCogsItem[] | null;
}

interface ProfitabilityDatasetInternal {
  id: string;
  name: string;
  sourceFile?: string;
  rows: number;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  totalBonuses?: number;
  totalDiscounts?: number;
  totalBonusAccrued?: number;
}

export interface CreateProfitabilityImportLogInput {
  status: ProfitabilityImportStatus;
  datasetId?: string;
  sourceFile?: string;
  rowsProcessed: number;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  author?: string | null;
  errors?: ProfitabilityImportError[];
  warnings?: string[];
}

export interface CreateImportBatchInput {
  filename: string;
  sourceType: 'z-report' | 'cogs-daily';
  rowsTotal: number;
  rowsOk: number;
  rowsFailed: number;
  periodFrom: string | null;
  periodTo: string | null;
  errors?: ProfitabilityImportError[];
}

export interface UpsertCogsDailyEntry {
  reportDate: string;
  cogsTotal: number;
}

export interface UpsertCogsDailyInput {
  filename: string;
  rows: UpsertCogsDailyEntry[];
}

const USERS_FILE_PATH = join(process.cwd(), '.data', 'users.json');

export class MemStorage implements IStorage {
  private transactions: Map<string, Transaction>;
  private users: Map<string, User>;
  private userSessions: Map<string, UserSession>;
  private securityLogs: Map<string, SecurityLog>;
  private profitabilityRecords: Map<string, ProfitabilityRecord>;
  private profitabilityDatasets: Map<string, ProfitabilityDatasetInternal>;
  private profitabilityImportLogs: Map<string, ProfitabilityImportLogEntry>;
  private importBatches: Map<string, ImportBatch>;
  private cogsDailyRecords: Map<string, CogsDaily>;
  private profitabilityFiles: Map<string, Buffer>;
  private forecastPredictions: Map<string, ForecastPrediction>;
  private modelAccuracyMetrics: Map<string, ModelAccuracyMetric>;

  constructor() {
    this.transactions = new Map();
    this.users = new Map();
    this.userSessions = new Map();
    this.securityLogs = new Map();
    this.profitabilityRecords = new Map();
    this.profitabilityDatasets = new Map();
    this.profitabilityImportLogs = new Map();
    this.importBatches = new Map();
    this.cogsDailyRecords = new Map();
    this.profitabilityFiles = new Map();
    this.forecastPredictions = new Map();
    this.modelAccuracyMetrics = new Map();
  }

  /**
   * Загружает пользователей из файла
   */
  private async loadUsers(): Promise<void> {
    try {
      const data = await fs.readFile(USERS_FILE_PATH, 'utf-8');
      const usersArray = JSON.parse(data) as any[];
      usersArray.forEach((user) => {
        // Преобразуем строковые даты обратно в Date объекты
        this.users.set(user.id, {
          ...user,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
          lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
          passwordChangedAt: new Date(user.passwordChangedAt),
          lockedUntil: user.lockedUntil ? new Date(user.lockedUntil) : null,
        } as User);
      });
    } catch (error: any) {
      // Файл не существует или пустой - это нормально при первом запуске
      if (error.code !== 'ENOENT') {
        console.warn('⚠️ Не удалось загрузить пользователей из файла:', error.message);
      }
    }
  }

  /**
   * Сохраняет пользователей в файл
   */
  private async saveUsers(): Promise<void> {
    try {
      const usersArray = Array.from(this.users.values());
      // Создаем директорию, если её нет
      await fs.mkdir(join(process.cwd(), '.data'), { recursive: true });
      await fs.writeFile(USERS_FILE_PATH, JSON.stringify(usersArray, null, 2), 'utf-8');
    } catch (error) {
      console.warn('⚠️ Не удалось сохранить пользователей в файл:', error);
    }
  }

  private toDatasetInfo(dataset: ProfitabilityDatasetInternal): ProfitabilityDatasetInfo {
    return {
      id: dataset.id,
      name: dataset.name,
      sourceFile: dataset.sourceFile,
      rows: dataset.rows,
      createdAt: dataset.createdAt.toISOString(),
      periodStart: dataset.periodStart.toISOString(),
      periodEnd: dataset.periodEnd.toISOString(),
      totalBonuses: dataset.totalBonuses,
      totalDiscounts: dataset.totalDiscounts,
      totalBonusAccrued: dataset.totalBonusAccrued,
    };
  }

  async getTransactionsByUploadId(uploadId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter((t) => t.uploadId === uploadId);
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const transaction: Transaction = {
      ...insertTransaction,
      id,
      year: insertTransaction.year ?? null,
      month: insertTransaction.month ?? null,
      checksCount: insertTransaction.checksCount ?? null,
      cashPayment: insertTransaction.cashPayment ?? null,
      terminalPayment: insertTransaction.terminalPayment ?? null,
      qrPayment: insertTransaction.qrPayment ?? null,
      sbpPayment: insertTransaction.sbpPayment ?? null,
      refundChecksCount: insertTransaction.refundChecksCount ?? null,
      refundCashPayment: insertTransaction.refundCashPayment ?? null,
      refundTerminalPayment: insertTransaction.refundTerminalPayment ?? null,
      refundQrPayment: insertTransaction.refundQrPayment ?? null,
      refundSbpPayment: insertTransaction.refundSbpPayment ?? null,
      category: insertTransaction.category ?? null,
      employee: insertTransaction.employee ?? null,
      costOfGoods: insertTransaction.costOfGoods ?? null,
    };
    this.transactions.set(id, transaction);
    return transaction;
  }

  async createTransactions(insertTransactions: InsertTransaction[]): Promise<Transaction[]> {
    if (insertTransactions.length === 0) {
      return [];
    }

    const startTime = performance.now();

    // Батчинг для оптимизации: увеличиваем размер батча до 1500 для лучшей производительности
    // При миграции на PostgreSQL используйте bulkInsertTransactions из server/utils/postgresBulkInsert.ts
    // Пример: return await bulkInsertTransactions(db, insertTransactions, BATCH_SIZE);
    const BATCH_SIZE = 1500; // Увеличено с 500 до 1500 для лучшей производительности
    const created: Transaction[] = [];
    created.length = insertTransactions.length; // Оптимизация: предвыделяем размер массива
    const totalBatches = Math.ceil(insertTransactions.length / BATCH_SIZE);
    const transactionsLength = insertTransactions.length;

    for (let i = 0; i < transactionsLength; i += BATCH_SIZE) {
      const batchEnd = Math.min(i + BATCH_SIZE, transactionsLength);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      
      // Оптимизация: обрабатываем батч без создания промежуточного массива slice
      const batchStartTime = performance.now();
      
      // Оптимизация: предгенерируем UUID для батча для ускорения (если батч большой)
      // Для in-memory storage это не критично, но может помочь при миграции на PostgreSQL
      for (let j = i; j < batchEnd; j++) {
        const insertTx = insertTransactions[j];
        // Оптимизация: randomUUID() уже достаточно быстрый, но можно оптимизировать создание объекта
        const id = randomUUID();
        // Оптимизация: создаем объект напрямую без spread оператора где возможно
        // Минимизируем количество операций nullish coalescing
        const transaction: Transaction = {
          id,
          date: insertTx.date,
          year: insertTx.year ?? null,
          month: insertTx.month ?? null,
          amount: insertTx.amount,
          checksCount: insertTx.checksCount ?? null,
          cashPayment: insertTx.cashPayment ?? null,
          terminalPayment: insertTx.terminalPayment ?? null,
          qrPayment: insertTx.qrPayment ?? null,
          sbpPayment: insertTx.sbpPayment ?? null,
          refundChecksCount: insertTx.refundChecksCount ?? null,
          refundCashPayment: insertTx.refundCashPayment ?? null,
          refundTerminalPayment: insertTx.refundTerminalPayment ?? null,
          refundQrPayment: insertTx.refundQrPayment ?? null,
          refundSbpPayment: insertTx.refundSbpPayment ?? null,
          category: insertTx.category ?? null,
          employee: insertTx.employee ?? null,
          costOfGoods: insertTx.costOfGoods ?? null,
          uploadId: insertTx.uploadId,
        };
        this.transactions.set(id, transaction);
        created[j] = transaction;
      }
      
      if (totalBatches > 1) {
        const batchTime = (performance.now() - batchStartTime).toFixed(2);
        const batchLength = batchEnd - i;
        log(`📦 Батч ${batchNumber}/${totalBatches} обработан за ${batchTime}ms (${batchLength} записей)`, 'storage');
      }
    }

    const totalTime = (performance.now() - startTime).toFixed(2);
    log(`💾 Сохранено ${created.length} транзакций за ${totalTime}ms (${totalBatches} батчей)`, 'storage');

    return created;
  }

  async deleteTransactionsByUploadId(uploadId: string): Promise<void> {
    const toDelete = Array.from(this.transactions.values())
      .filter((t) => t.uploadId === uploadId)
      .map((t) => t.id);

    toDelete.forEach((id) => this.transactions.delete(id));
  }

  async createProfitabilityDataset(
    input: CreateProfitabilityDatasetInput,
  ): Promise<{ dataset: ProfitabilityDatasetInfo; records: ProfitabilityRecord[] }> {
    const datasetId = randomUUID();
    const createdAt = new Date();
    const name =
      input.name?.trim() && input.name.trim().length > 0
        ? input.name.trim()
        : `Z-отчеты ${input.periodStart.toISOString().slice(0, 10)} — ${input.periodEnd
            .toISOString()
            .slice(0, 10)}`;

    const dataset: ProfitabilityDatasetInternal = {
      id: datasetId,
      name,
      sourceFile: input.sourceFile,
      rows: input.records.length,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdAt,
      totalBonuses: input.totalBonuses,
      totalDiscounts: input.totalDiscounts,
      totalBonusAccrued: input.totalBonusAccrued,
    };

    this.profitabilityDatasets.set(datasetId, dataset);

    // Сохраняем файл, если он был передан
    if (input.fileBuffer) {
      this.profitabilityFiles.set(datasetId, input.fileBuffer);
    }

    const records: ProfitabilityRecord[] = input.records.map((record) => {
      const id = randomUUID();
      const createdRecord: ProfitabilityRecord = {
        id,
        datasetId,
        reportDate: record.reportDate,
        shiftNumber: record.shiftNumber ?? null,
        incomeChecks: record.incomeChecks ?? 0,
        cashIncome: record.cashIncome ?? 0,
        cashlessIncome: record.cashlessIncome ?? 0,
        returnChecks: record.returnChecks ?? 0,
        cashReturn: record.cashReturn ?? 0,
        cashlessReturn: record.cashlessReturn ?? 0,
        correctionChecks: record.correctionChecks ?? 0,
        correctionCash: record.correctionCash ?? 0,
        correctionCashless: record.correctionCashless ?? 0,
        cogsTotal: record.cogsTotal ?? null,
        cogsDetails: record.cogsDetails ?? null,
        createdAt,
      };
      this.profitabilityRecords.set(id, createdRecord);
      return createdRecord;
    });

    return {
      dataset: this.toDatasetInfo({ ...dataset, rows: records.length }),
      records,
    };
  }

  async getProfitabilityDataset(
    datasetId: string,
  ): Promise<{ dataset: ProfitabilityDatasetInfo; records: ProfitabilityRecord[] } | null> {
    const dataset = this.profitabilityDatasets.get(datasetId);
    if (!dataset) {
      return null;
    }

    const records = Array.from(this.profitabilityRecords.values())
      .filter((record) => record.datasetId === datasetId)
      .sort((a, b) => a.reportDate.getTime() - b.reportDate.getTime());

    return {
      dataset: this.toDatasetInfo({ ...dataset, rows: records.length }),
      records,
    };
  }

  async listProfitabilityDatasets(): Promise<ProfitabilityDatasetInfo[]> {
    const datasets = Array.from(this.profitabilityDatasets.values());
    return datasets
      .map((dataset) => {
        const rows = Array.from(this.profitabilityRecords.values()).filter(
          (record) => record.datasetId === dataset.id,
        ).length;

        return this.toDatasetInfo({ ...dataset, rows });
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listAllProfitabilityRecords(): Promise<ProfitabilityRecord[]> {
    return Array.from(this.profitabilityRecords.values()).sort(
      (a, b) => a.reportDate.getTime() - b.reportDate.getTime(),
    );
  }

  async createProfitabilityImportLog(
    input: CreateProfitabilityImportLogInput,
  ): Promise<ProfitabilityImportLogEntry> {
    const id = randomUUID();
    const createdAt = new Date();
    const entry: ProfitabilityImportLogEntry = {
      id,
      status: input.status,
      datasetId: input.datasetId ?? undefined,
      sourceFile: input.sourceFile ?? undefined,
      rowsProcessed: input.rowsProcessed,
      periodStart: input.periodStart ? input.periodStart.toISOString() : undefined,
      periodEnd: input.periodEnd ? input.periodEnd.toISOString() : undefined,
      author: input.author ?? undefined,
      createdAt: createdAt.toISOString(),
      errors: input.errors && input.errors.length > 0 ? input.errors : undefined,
      warnings: input.warnings && input.warnings.length > 0 ? input.warnings : undefined,
    };

    this.profitabilityImportLogs.set(id, entry);
    return entry;
  }

  async listProfitabilityImportLogs(limit = 50): Promise<ProfitabilityImportLogEntry[]> {
    const entries = Array.from(this.profitabilityImportLogs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return entries.slice(0, limit);
  }

  async createImportBatch(input: CreateImportBatchInput): Promise<ImportBatch> {
    const id = randomUUID();
    const now = new Date();
    const entry: ImportBatch = {
      id,
      filename: input.filename,
      sourceType: input.sourceType,
      rowsTotal: input.rowsTotal,
      rowsOk: input.rowsOk,
      rowsFailed: input.rowsFailed,
      periodFrom: input.periodFrom ?? '',
      periodTo: input.periodTo ?? '',
      errorsJson: input.errors && input.errors.length > 0 ? JSON.stringify(input.errors) : null,
      createdAt: now,
      updatedAt: now,
    };

    this.importBatches.set(id, entry);
    return entry;
  }

  async upsertCogsDaily(
    input: UpsertCogsDailyInput & { importBatchId: string },
  ): Promise<{ records: CogsDaily[] }> {
    const now = new Date();
    const updated: CogsDaily[] = [];

    input.rows.forEach((row) => {
      const key = row.reportDate;
      const existing = this.cogsDailyRecords.get(key);

      if (existing) {
        const next: CogsDaily = {
          ...existing,
          cogsTotal: row.cogsTotal,
          importBatchId: input.importBatchId,
          updatedAt: now,
        };
        this.cogsDailyRecords.set(key, next);
        updated.push(next);
      } else {
        const created: CogsDaily = {
          id: randomUUID(),
          reportDate: row.reportDate,
          cogsTotal: row.cogsTotal,
          importBatchId: input.importBatchId,
          createdAt: now,
          updatedAt: now,
        };
        this.cogsDailyRecords.set(key, created);
        updated.push(created);
      }
    });

    return { records: updated };
  }

  async listCogsDaily(): Promise<CogsDaily[]> {
    return Array.from(this.cogsDailyRecords.values()).sort((a, b) =>
      a.reportDate.localeCompare(b.reportDate),
    );
  }

  async saveProfitabilityFile(datasetId: string, fileBuffer: Buffer): Promise<void> {
    this.profitabilityFiles.set(datasetId, fileBuffer);
  }

  async getProfitabilityFile(datasetId: string): Promise<Buffer | null> {
    return this.profitabilityFiles.get(datasetId) || null;
  }

  // User methods
  async getUserByEmail(email: string): Promise<User | null> {
    const user = Array.from(this.users.values()).find((u) => u.email === email);
    return user || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    const user: User = {
      id,
      email: insertUser.email,
      password: insertUser.password,
      name: insertUser.name,
      role: insertUser.role ?? 'user',
      isActive: insertUser.isActive ?? true,
      twoFactorSecret: insertUser.twoFactorSecret ?? null,
      twoFactorEnabled: insertUser.twoFactorEnabled ?? false,
      lastLoginAt: insertUser.lastLoginAt ?? null,
      lastLoginIp: insertUser.lastLoginIp ?? null,
      failedLoginAttempts: insertUser.failedLoginAttempts ?? 0,
      lockedUntil: insertUser.lockedUntil ?? null,
      passwordChangedAt: insertUser.passwordChangedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, user);
    await this.saveUsers();
    return user;
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;

    const updatedUser: User = {
      ...user,
      ...updates,
      updatedAt: new Date(),
    };
    this.users.set(id, updatedUser);
    await this.saveUsers();
    return updatedUser;
  }

  // Session methods
  async getSessionByToken(sessionToken: string): Promise<UserSession | null> {
    const session = Array.from(this.userSessions.values()).find(
      (s) => s.sessionToken === sessionToken,
    );
    return session || null;
  }

  async createSession(insertSession: InsertUserSession): Promise<UserSession> {
    const id = randomUUID();
    const now = new Date();
    const session: UserSession = {
      ...insertSession,
      id,
      createdAt: now,
      lastUsedAt: insertSession.lastUsedAt || now,
    };
    this.userSessions.set(id, session);
    return session;
  }

  async updateSessionLastUsed(sessionToken: string): Promise<void> {
    const session = Array.from(this.userSessions.values()).find(
      (s) => s.sessionToken === sessionToken,
    );

    if (session) {
      const updatedSession: UserSession = {
        ...session,
        lastUsedAt: new Date(),
      };
      this.userSessions.set(session.id, updatedSession);
    }
  }

  async deleteSession(sessionToken: string): Promise<void> {
    const session = Array.from(this.userSessions.values()).find(
      (s) => s.sessionToken === sessionToken,
    );

    if (session) {
      this.userSessions.delete(session.id);
    }
  }

  async deleteExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions = Array.from(this.userSessions.values()).filter((s) => s.expiresAt < now);

    expiredSessions.forEach((session) => {
      this.userSessions.delete(session.id);
    });
  }

  // Security methods
  async createSecurityLog(log: InsertSecurityLog): Promise<SecurityLog> {
    const id = randomUUID();
    const securityLog: SecurityLog = {
      ...log,
      id,
      userId: log.userId ?? null,
      userAgent: log.userAgent ?? null,
      details: log.details ?? null,
      createdAt: new Date(),
    };

    this.securityLogs.set(id, securityLog);
    return securityLog;
  }

  async getSecurityLogsByUserId(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<SecurityLog[]> {
    return Array.from(this.securityLogs.values())
      .filter((log) => log.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async updateUserFailedAttempts(
    userId: string,
    attempts: number,
    lockedUntil?: Date,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      const updatedUser = {
        ...user,
        failedLoginAttempts: attempts,
        lockedUntil: lockedUntil || null,
        updatedAt: new Date(),
      };
      this.users.set(userId, updatedUser);
      await this.saveUsers();
    }
  }

  async resetUserFailedAttempts(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      const updatedUser = {
        ...user,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      };
      this.users.set(userId, updatedUser);
      await this.saveUsers();
    }
  }

  // Forecast Predictions methods
  async createForecastPrediction(prediction: InsertForecastPrediction): Promise<ForecastPrediction> {
    const id = randomUUID();
    const now = new Date();
    const forecastPrediction: ForecastPrediction = {
      ...prediction,
      id,
      actualRevenue: prediction.actualRevenue ?? null,
      mape: prediction.mape ?? null,
      mae: prediction.mae ?? null,
      rmse: prediction.rmse ?? null,
      dayOfWeek: prediction.dayOfWeek ?? null,
      factors: (prediction.factors as ForecastPrediction['factors']) ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.forecastPredictions.set(id, forecastPrediction);
    return forecastPrediction;
  }

  async getForecastPredictionById(id: string): Promise<ForecastPrediction | null> {
    return this.forecastPredictions.get(id) ?? null;
  }

  async updateForecastPredictionWithActual(
    id: string,
    actualRevenue: number,
    mape: number,
    mae: number,
    rmse: number,
  ): Promise<ForecastPrediction | null> {
    const prediction = this.forecastPredictions.get(id);
    if (!prediction) {
      return null;
    }
    const updated: ForecastPrediction = {
      ...prediction,
      actualRevenue,
      mape,
      mae,
      rmse,
      updatedAt: new Date(),
    };
    this.forecastPredictions.set(id, updated);
    return updated;
  }

  async getForecastPredictionsByUploadId(uploadId: string): Promise<ForecastPrediction[]> {
    return Array.from(this.forecastPredictions.values()).filter((p) => p.uploadId === uploadId);
  }

  async getForecastPredictionsWithoutActual(limit?: number): Promise<ForecastPrediction[]> {
    const predictions = Array.from(this.forecastPredictions.values())
      .filter((p) => p.actualRevenue === null)
      .sort((a, b) => a.actualDate.getTime() - b.actualDate.getTime());
    return limit ? predictions.slice(0, limit) : predictions;
  }

  async getForecastPredictionsByModel(
    modelName: string,
    dayOfWeek?: number,
    horizon?: number,
  ): Promise<ForecastPrediction[]> {
    return Array.from(this.forecastPredictions.values()).filter((p) => {
      if (p.modelName !== modelName) return false;
      if (dayOfWeek !== undefined && p.dayOfWeek !== dayOfWeek) return false;
      if (horizon !== undefined && p.horizon !== horizon) return false;
      return true;
    });
  }

  async getAllForecastPredictions(): Promise<ForecastPrediction[]> {
    return Array.from(this.forecastPredictions.values());
  }

  // Model Accuracy Metrics methods
  async getModelAccuracyMetric(
    modelName: string,
    dayOfWeek?: number | null,
    horizon?: number | null,
  ): Promise<ModelAccuracyMetric | null> {
    // Ищем точное совпадение
    for (const metric of Array.from(this.modelAccuracyMetrics.values())) {
      if (
        metric.modelName === modelName &&
        (dayOfWeek === undefined || metric.dayOfWeek === dayOfWeek) &&
        (horizon === undefined || metric.horizon === horizon)
      ) {
        return metric;
      }
    }
    return null;
  }

  async upsertModelAccuracyMetric(metric: InsertModelAccuracyMetric): Promise<ModelAccuracyMetric> {
    // Ищем существующую метрику
    const existing = Array.from(this.modelAccuracyMetrics.values()).find(
      (m) =>
        m.modelName === metric.modelName &&
        m.dayOfWeek === (metric.dayOfWeek ?? null) &&
        m.horizon === (metric.horizon ?? null),
    );

    const now = new Date();
    if (existing) {
      // Обновляем существующую
      const updated: ModelAccuracyMetric = {
        ...existing,
        mape: metric.mape,
        mae: metric.mae,
        rmse: metric.rmse,
        sampleSize: metric.sampleSize,
        lastUpdated: now,
      };
      this.modelAccuracyMetrics.set(existing.id, updated);
      return updated;
    } else {
      // Создаем новую
      const id = randomUUID();
      const newMetric: ModelAccuracyMetric = {
        ...metric,
        id,
        dayOfWeek: metric.dayOfWeek ?? null,
        horizon: metric.horizon ?? null,
        lastUpdated: now,
      };
      this.modelAccuracyMetrics.set(id, newMetric);
      return newMetric;
    }
  }

  async getAllModelAccuracyMetrics(): Promise<ModelAccuracyMetric[]> {
    return Array.from(this.modelAccuracyMetrics.values());
  }

  async getModelAccuracyMetricsByModel(modelName: string): Promise<ModelAccuracyMetric[]> {
    return Array.from(this.modelAccuracyMetrics.values()).filter((m) => m.modelName === modelName);
  }

  async deleteModelAccuracyMetric(id: string): Promise<void> {
    this.modelAccuracyMetrics.delete(id);
  }

  /**
   * Инициализирует начальные данные (например, тестового пользователя)
   */
  async initialize(): Promise<void> {
    // Загружаем пользователей из файла
    await this.loadUsers();
    
    // Проверяем, есть ли уже пользователи
    if (this.users.size === 0) {
      // Создаем тестового пользователя, если пользователей нет
      const { hashPassword } = await import('./utils/auth');
      const defaultPassword = await hashPassword('admin123');
      
      await this.createUser({
        email: 'admin@example.com',
        password: defaultPassword,
        name: 'Администратор',
        role: 'admin',
        isActive: true,
      });

      console.log('✅ Создан тестовый пользователь: admin@example.com / admin123');
    } else {
      console.log(`✅ Загружено ${this.users.size} пользователей из файла`);
    }
  }
}

export const storage = new MemStorage();

// Инициализируем storage при импорте модуля
storage.initialize().catch((error) => {
  console.error('❌ Ошибка инициализации storage:', error);
});
