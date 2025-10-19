import { type Transaction, type InsertTransaction, type User, type InsertUser, type UserSession, type InsertUserSession, type SecurityLog, type InsertSecurityLog } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Transactions
  getTransactionsByUploadId(uploadId: string): Promise<Transaction[]>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  createTransactions(transactions: InsertTransaction[]): Promise<Transaction[]>;
  deleteTransactionsByUploadId(uploadId: string): Promise<void>;
  
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

export class MemStorage implements IStorage {
  private transactions: Map<string, Transaction>;
  private users: Map<string, User>;
  private userSessions: Map<string, UserSession>;
  private securityLogs: Map<string, SecurityLog>;

  constructor() {
    this.transactions = new Map();
    this.users = new Map();
    this.userSessions = new Map();
    this.securityLogs = new Map();
  }

  async getTransactionsByUploadId(uploadId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (t) => t.uploadId === uploadId,
    );
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

  // User methods
  async getUserByEmail(email: string): Promise<User | null> {
    const user = Array.from(this.users.values()).find(u => u.email === email);
    return user || null;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    const user: User = {
      ...insertUser,
      id,
      role: insertUser.role || 'user',
      isActive: insertUser.isActive ?? true,
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
    const session = Array.from(this.userSessions.values())
      .find(s => s.sessionToken === sessionToken);
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
    const session = Array.from(this.userSessions.values())
      .find(s => s.sessionToken === sessionToken);
    
    if (session) {
      const updatedSession: UserSession = {
        ...session,
        lastUsedAt: new Date(),
      };
      this.userSessions.set(session.id, updatedSession);
    }
  }

  async deleteSession(sessionToken: string): Promise<void> {
    const session = Array.from(this.userSessions.values())
      .find(s => s.sessionToken === sessionToken);
    
    if (session) {
      this.userSessions.delete(session.id);
    }
  }

  async deleteExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions = Array.from(this.userSessions.values())
      .filter(s => s.expiresAt < now);
    
    expiredSessions.forEach(session => {
      this.userSessions.delete(session.id);
    });
  }

  // Security methods
  async createSecurityLog(log: InsertSecurityLog): Promise<SecurityLog> {
    const id = randomUUID();
    const securityLog: SecurityLog = {
      ...log,
      id,
      createdAt: new Date(),
    };
    
    this.securityLogs.set(id, securityLog);
    return securityLog;
  }

  async getSecurityLogsByUserId(userId: string, limit: number, offset: number): Promise<SecurityLog[]> {
    return Array.from(this.securityLogs.values())
      .filter(log => log.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  async updateUserFailedAttempts(userId: string, attempts: number, lockedUntil?: Date): Promise<void> {
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
