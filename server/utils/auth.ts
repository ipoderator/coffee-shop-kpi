import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { User, InsertUser, InsertUserSession } from '@shared/schema';

const envJwtSecret = process.env.JWT_SECRET;

if (!envJwtSecret) {
  throw new Error('JWT_SECRET must be provided');
}

const JWT_SECRET = envJwtSecret;
const SESSION_EXPIRY_DAYS = 30;

/**
 * Хеширует пароль с использованием bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Проверяет пароль против хеша
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Валидирует введенный пароль и сравнивает его с хешем
 */
export async function validatePassword(password: unknown, hash: unknown): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0) {
    return false;
  }

  if (typeof hash !== 'string' || hash.length === 0) {
    return false;
  }

  return bcrypt.compare(password, hash);
}

/**
 * Генерирует JWT токен для пользователя
 */
export function generateJWT(user: User): string {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: `${SESSION_EXPIRY_DAYS}d`,
    issuer: 'coffee-kpi-dashboard',
  });
}

/**
 * Верифицирует JWT токен
 */
export function verifyJWT(token: string): { userId: string; email: string; role: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Генерирует случайный токен сессии
 */
export function generateSessionToken(): string {
  return randomUUID();
}

/**
 * Создает новую сессию пользователя
 */
export function createUserSession(userId: string): InsertUserSession {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

  return {
    userId,
    sessionToken,
    expiresAt,
  };
}

/**
 * Проверяет, истекла ли сессия
 */
export function isSessionExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Создает объект пользователя без пароля для отправки клиенту
 */
export function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Middleware для проверки авторизации через JWT токен
 */
export function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      message: 'Токен авторизации не предоставлен' 
    });
  }

  const token = authHeader.substring(7); // Убираем "Bearer "
  const decoded = verifyJWT(token);

  if (!decoded) {
    return res.status(401).json({ 
      success: false, 
      message: 'Недействительный токен авторизации' 
    });
  }

  req.user = decoded;
  next();
}

/**
 * Middleware для проверки авторизации через cookie сессию
 */
export async function requireAuthCookie(req: any, res: any, next: any) {
  const sessionToken = req.cookies?.session_token;
  
  if (!sessionToken) {
    return res.status(401).json({ 
      success: false, 
      message: 'Сессия не найдена' 
    });
  }

  try {
    // Импортируем storage здесь, чтобы избежать циклических зависимостей
    const { storage } = await import('../storage');
    const session = await storage.getSessionByToken(sessionToken);
    
    if (!session || isSessionExpired(session.expiresAt)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Сессия истекла' 
      });
    }

    const user = await storage.getUserById(session.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Пользователь не найден или заблокирован' 
      });
    }

    // Обновляем время последнего использования сессии
    await storage.updateSessionLastUsed(sessionToken);

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Ошибка проверки авторизации' 
    });
  }
}

/**
 * Middleware для проверки авторизации через JWT или cookie
 */
export async function requireAuthAny(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyJWT(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Недействительный токен авторизации',
      });
    }

    req.user = decoded;
    return next();
  }

  return await requireAuthCookie(req, res, next);
}

/**
 * Middleware для проверки роли администратора
 */
export function requireAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, (err: any) => {
    if (err) return next(err);
    
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Недостаточно прав доступа' 
      });
    }
    
    next();
  });
}
