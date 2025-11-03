import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import { Request, Response, NextFunction, type Express } from 'express';
import { randomBytes } from 'crypto';

const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Логируем режим rate limiting при запуске
if (isDevelopment) {
  console.log('🔓 Rate limiting отключен в режиме разработки');
}

// Rate limiting для регистрации (отключен в режиме разработки)
export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 3, // максимум 3 регистрации в час с одного IP
  message: {
    success: false,
    message: 'Слишком много попыток регистрации. Попробуйте через час.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // В режиме разработки полностью отключаем rate limiting
  skip: () => isDevelopment,
});

// Rate limiting для смены пароля (отключен в режиме разработки)
export const passwordChangeRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 час
  max: 3, // максимум 3 попытки смены пароля в час
  message: {
    success: false,
    message: 'Слишком много попыток смены пароля. Попробуйте через час.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // В режиме разработки полностью отключаем rate limiting
  skip: () => isDevelopment,
});

// Общий rate limiting для API (отключен в режиме разработки)
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: process.env.NODE_ENV === 'production' ? 100 : Infinity, // В разработке без лимитов
  message: {
    success: false,
    message: 'Слишком много запросов. Попробуйте позже.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // В режиме разработки полностью отключаем rate limiting
  skip: () => isDevelopment,
});

// Slow down для подозрительной активности (отключен в режиме разработки)
export const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 минут
  delayAfter: process.env.NODE_ENV === 'production' ? 50 : Infinity, // В разработке без ограничений
  delayMs: () => (process.env.NODE_ENV === 'production' ? 500 : 0), // Без задержки в разработке
  maxDelayMs: process.env.NODE_ENV === 'production' ? 20000 : 0, // Без задержки в разработке
  // В режиме разработки полностью отключаем slow down
  skip: () => isDevelopment,
});

// Настройки Helmet для безопасности заголовков
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// Интерфейс для отслеживания попыток входа
interface LoginAttempt {
  ip: string;
  email: string;
  attempts: number;
  lastAttempt: Date;
  blockedUntil?: Date;
}

// Хранилище попыток входа (в продакшене использовать Redis)
const loginAttempts = new Map<string, LoginAttempt>();

// Очистка старых записей каждые 5 минут
setInterval(
  () => {
    const now = new Date();
    loginAttempts.forEach((attempt, key) => {
      if (now.getTime() - attempt.lastAttempt.getTime() > 30 * 60 * 1000) {
        // 30 минут
        loginAttempts.delete(key);
      }
    });
  },
  5 * 60 * 1000,
);

/**
 * Проверяет, заблокирован ли IP или email
 */
export function isBlocked(ip: string, email: string): boolean {
  const key = `${ip}:${email}`;
  const attempt = loginAttempts.get(key);

  if (!attempt) return false;

  if (attempt.blockedUntil && new Date() < attempt.blockedUntil) {
    return true;
  }

  return false;
}

/**
 * Записывает неудачную попытку входа
 */
export function recordFailedAttempt(ip: string, email: string): void {
  const key = `${ip}:${email}`;
  const now = new Date();

  let attempt = loginAttempts.get(key);
  if (!attempt) {
    attempt = {
      ip,
      email,
      attempts: 0,
      lastAttempt: now,
    };
  }

  attempt.attempts += 1;
  attempt.lastAttempt = now;

  // Блокируем на 30 минут после 5 неудачных попыток
  if (attempt.attempts >= 5) {
    attempt.blockedUntil = new Date(now.getTime() + 30 * 60 * 1000);
  }

  loginAttempts.set(key, attempt);
}

/**
 * Очищает попытки входа для успешного входа
 */
export function clearFailedAttempts(ip: string, email: string): void {
  const key = `${ip}:${email}`;
  loginAttempts.delete(key);
}

/**
 * Middleware для проверки блокировки
 */
export function checkBlocked(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const email = req.body?.email;

  if (email && isBlocked(ip, email)) {
    return res.status(429).json({
      success: false,
      message: 'Слишком много попыток, попробуйте позже.',
    });
  }

  next();
}

/**
 * Генерирует CSRF токен
 */
export function generateCSRFToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Middleware для проверки CSRF токена
 */
export async function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Пропускаем GET запросы и запросы без тела
  if (req.method === 'GET' || !req.body) {
    return next();
  }

  const token = req.headers['x-csrf-token'] as string;
  const sessionToken = req.cookies?.session_token;

  if (!token || !sessionToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF токен не предоставлен',
    });
  }

  try {
    const { storage } = await import('../storage');
    const session = await storage.getSessionByToken(sessionToken);

    if (!session) {
      return res.status(403).json({
        success: false,
        message: 'Сессия не найдена',
      });
    }

    const expectedToken = (session as { csrfToken?: string }).csrfToken;

    if (typeof expectedToken !== 'string' || expectedToken !== token) {
      return res.status(403).json({
        success: false,
        message: 'Недействительный CSRF токен',
      });
    }

    return next();
  } catch (error) {
    console.error('CSRF validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Ошибка проверки CSRF токена',
    });
  }
}

/**
 * Middleware для логирования безопасности
 */
export function securityLogger(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || 'unknown';
  const timestamp = new Date().toISOString();

  // Логируем подозрительную активность
  if (req.path.includes('/auth/')) {
    console.log(
      `[SECURITY] ${timestamp} - ${req.method} ${req.path} - IP: ${ip} - UA: ${userAgent}`,
    );
  }

  next();
}

/**
 * Проверяет подозрительную активность
 */
export function detectSuspiciousActivity(req: Request): boolean {
  const userAgent = req.get('User-Agent') || '';
  const ip = req.ip || req.connection.remoteAddress || '';

  // Проверяем на ботов и подозрительные User-Agent
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /curl/i,
    /wget/i,
    /python/i,
    /java/i,
    /php/i,
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(userAgent));
}

/**
 * Middleware для обнаружения подозрительной активности
 */
export function suspiciousActivityDetection(req: Request, res: Response, next: NextFunction) {
  if (detectSuspiciousActivity(req)) {
    console.log(`[SECURITY WARNING] Suspicious activity detected from IP: ${req.ip}`);
    // Можно добавить дополнительную логику, например, временную блокировку
  }

  next();
}

/**
 * Очищает кэш rate limiting (только для разработки)
 */
export function clearRateLimitCache() {
  if (process.env.NODE_ENV !== 'production') {
    // Очищаем кэш попыток входа
    loginAttempts.clear();
    console.log('[DEV] Rate limit cache cleared');
  }
}

/**
 * Middleware для очистки rate limit в режиме разработки
 */
export function devRateLimitReset(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== 'production' && req.path === '/api/dev/reset-rate-limit') {
    clearRateLimitCache();
    return res.json({
      success: true,
      message: 'Rate limit cache cleared',
    });
  }
  next();
}

/**
 * Регистрирует dev-маршруты для управления попытками входа
 */
export function registerSecurityDevRoutes(app: Express) {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  app.get('/api/dev/reset-logins', (_req, res) => {
    loginAttempts.clear();
    res.json({ success: true });
  });
}
