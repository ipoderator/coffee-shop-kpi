import type { InsertSecurityLog } from '@shared/schema';
import { storage } from '../storage';

export type SecurityAction = 
  | 'login_attempt'
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'password_change'
  | 'password_reset_request'
  | 'password_reset_success'
  | 'account_locked'
  | 'account_unlocked'
  | 'two_factor_enabled'
  | 'two_factor_disabled'
  | 'suspicious_activity'
  | 'rate_limit_exceeded';

interface SecurityLogData {
  userId?: string;
  action: SecurityAction;
  ip: string;
  userAgent?: string;
  success: boolean;
  details?: Record<string, any>;
}

/**
 * Логирует событие безопасности
 */
export async function logSecurityEvent(data: SecurityLogData): Promise<void> {
  try {
    const logEntry: InsertSecurityLog = {
      userId: data.userId,
      action: data.action,
      ip: data.ip,
      userAgent: data.userAgent,
      success: data.success,
      details: data.details ? JSON.stringify(data.details) : null,
    };

    await storage.createSecurityLog(logEntry);
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Логирует попытку входа
 */
export async function logLoginAttempt(
  email: string,
  ip: string,
  userAgent: string,
  success: boolean,
  userId?: string,
  details?: Record<string, any>
): Promise<void> {
  await logSecurityEvent({
    userId,
    action: success ? 'login_success' : 'login_failed',
    ip,
    userAgent,
    success,
    details: {
      email,
      ...details,
    },
  });
}

/**
 * Логирует выход из системы
 */
export async function logLogout(
  userId: string,
  ip: string,
  userAgent: string
): Promise<void> {
  await logSecurityEvent({
    userId,
    action: 'logout',
    ip,
    userAgent,
    success: true,
  });
}

/**
 * Логирует смену пароля
 */
export async function logPasswordChange(
  userId: string,
  ip: string,
  userAgent: string,
  success: boolean,
  details?: Record<string, any>
): Promise<void> {
  await logSecurityEvent({
    userId,
    action: 'password_change',
    ip,
    userAgent,
    success,
    details,
  });
}

/**
 * Логирует блокировку аккаунта
 */
export async function logAccountLocked(
  userId: string,
  ip: string,
  userAgent: string,
  reason: string
): Promise<void> {
  await logSecurityEvent({
    userId,
    action: 'account_locked',
    ip,
    userAgent,
    success: false,
    details: { reason },
  });
}

/**
 * Логирует подозрительную активность
 */
export async function logSuspiciousActivity(
  ip: string,
  userAgent: string,
  details: Record<string, any>
): Promise<void> {
  await logSecurityEvent({
    action: 'suspicious_activity',
    ip,
    userAgent,
    success: false,
    details,
  });
}

/**
 * Логирует превышение лимита запросов
 */
export async function logRateLimitExceeded(
  ip: string,
  userAgent: string,
  endpoint: string,
  limit: number
): Promise<void> {
  await logSecurityEvent({
    action: 'rate_limit_exceeded',
    ip,
    userAgent,
    success: false,
    details: {
      endpoint,
      limit,
    },
  });
}

/**
 * Получает логи безопасности для пользователя
 */
export async function getSecurityLogs(
  userId: string,
  limit: number = 50,
  offset: number = 0
): Promise<any[]> {
  try {
    return await storage.getSecurityLogsByUserId(userId, limit, offset);
  } catch (error) {
    console.error('Failed to get security logs:', error);
    return [];
  }
}

/**
 * Получает статистику безопасности
 */
export async function getSecurityStats(userId: string): Promise<{
  totalLogins: number;
  failedLogins: number;
  lastLogin: Date | null;
  suspiciousActivity: number;
}> {
  try {
    const logs = await storage.getSecurityLogsByUserId(userId, 1000, 0);
    
    const totalLogins = logs.filter(log => log.action === 'login_success').length;
    const failedLogins = logs.filter(log => log.action === 'login_failed').length;
    const lastLoginLog = logs.find(log => log.action === 'login_success');
    const suspiciousActivity = logs.filter(log => log.action === 'suspicious_activity').length;
    
    return {
      totalLogins,
      failedLogins,
      lastLogin: lastLoginLog?.createdAt || null,
      suspiciousActivity,
    };
  } catch (error) {
    console.error('Failed to get security stats:', error);
    return {
      totalLogins: 0,
      failedLogins: 0,
      lastLogin: null,
      suspiciousActivity: 0,
    };
  }
}
