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
} from '@shared/schema';
import { randomUUID } from 'crypto';

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
}

export interface CreateProfitabilityDatasetInput {
  name?: string;
  sourceFile?: string;
  periodStart: Date;
  periodEnd: Date;
  records: ProfitabilityRecordInput[];
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
    const created: Transaction[] = [];
    for (const insertTx of insertTransactions) {
      const id = randomUUID();
      const transaction: Transaction = {
        ...insertTx,
        id,
        year: insertTx.year ?? null,
        month: insertTx.month ?? null,
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
      };
      this.transactions.set(id, transaction);
      created.push(transaction);
    }
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
    };

    this.profitabilityDatasets.set(datasetId, dataset);

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
    }
  }
}

export const storage = new MemStorage();
