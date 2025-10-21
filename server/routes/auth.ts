import type { Express } from 'express';
import type {
  AuthResponse,
  ChangePasswordData,
  LoginData,
  RegisterData,
} from '@shared/schema';
import { loginSchema, registerSchema, changePasswordSchema } from '@shared/schema';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  generateJWT,
  createUserSession,
  requireAuthCookie,
  sanitizeUser,
} from '../utils/auth';
import {
  registerRateLimit,
  passwordChangeRateLimit,
  checkBlocked,
  recordFailedAttempt,
  clearFailedAttempts,
} from '../utils/security';
import { verifyTwoFactorToken } from '../utils/twoFactorAuth';
import {
  logLoginAttempt,
  logLogout,
  logPasswordChange,
  logAccountLocked,
} from '../utils/securityLogger';
import { storage } from '../storage';

export function registerAuthRoutes(app: Express): void {
  app.post('/api/auth/register', registerRateLimit, async (req, res) => {
    try {
      const validatedData = registerSchema.parse(req.body) as RegisterData;
      const { email, password, name, confirmPassword } = validatedData;

      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Пользователь с таким email уже существует',
        });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        role: 'user',
        isActive: true,
      });

      const token = generateJWT(user);
      const session = createUserSession(user.id);
      await storage.createSession(session);

      const response: AuthResponse = {
        success: true,
        user: sanitizeUser(user),
        message: 'Регистрация успешна',
      };

      res.cookie('session_token', session.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json(response);
    } catch (error) {
      console.error('Registration error:', error);

      if (error && typeof error === 'object' && 'issues' in error) {
        const zodError = error as any;
        const passwordErrors = zodError.issues
          .filter((issue: any) => issue.path.includes('password'))
          .map((issue: any) => issue.message);

        if (passwordErrors.length > 0) {
          return res.status(400).json({
            success: false,
            message: passwordErrors.join(', '),
          });
        }
      }

      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Ошибка регистрации',
      });
    }
  });

  app.post('/api/auth/login', checkBlocked, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    try {
      const validatedData = loginSchema.parse(req.body) as LoginData;
      const { email, password } = validatedData;

      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        recordFailedAttempt(ip, email);
        await logLoginAttempt(email, ip, userAgent, false);
        return res.status(401).json({
          success: false,
          message: 'Неверный email или пароль',
        });
      }

      if (user.lockedUntil && new Date() < user.lockedUntil) {
        await logLoginAttempt(email, ip, userAgent, false, user.id, {
          reason: 'account_locked',
        });
        return res.status(423).json({
          success: false,
          message: `Аккаунт заблокирован до ${user.lockedUntil.toLocaleString()}`,
        });
      }

      console.log(
        'Attempt login:',
        email,
        'failedAttempts:',
        user.failedLoginAttempts,
        'lockedUntil:',
        user.lockedUntil,
      );
      const isValidPassword = await validatePassword(password, user.password);
      console.log('Password valid:', isValidPassword);
      console.log(`[AUTH] Login attempt for ${email} - password valid: ${isValidPassword}`);
      if (!isValidPassword) {
        recordFailedAttempt(ip, email);
        const failedAttempts = (user.failedLoginAttempts || 0) + 1;
        const lockedUntil =
          failedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
        const remainingAttempts = Math.max(0, 5 - failedAttempts);

        await storage.updateUserFailedAttempts(user.id, failedAttempts, lockedUntil);
        await logLoginAttempt(email, ip, userAgent, false, user.id, { failedAttempts });

        if (lockedUntil) {
          await logAccountLocked(user.id, ip, userAgent, 'too_many_failed_attempts');
        }

        return res
          .status(401)
          .json({
            success: false,
            message: `Неверный пароль. Осталось попыток: ${remainingAttempts}`,
          });
      }

      if (user.twoFactorEnabled) {
        const twoFactorTokenHeader = req.headers['x-two-factor-token'];
        if (typeof twoFactorTokenHeader !== 'string' || twoFactorTokenHeader.trim().length === 0) {
          recordFailedAttempt(ip, email);
          await logLoginAttempt(email, ip, userAgent, false, user.id, {
            reason: 'missing_two_factor_token',
          });
          return res.status(401).json({
            success: false,
            message: 'Требуется код двухфакторной аутентификации',
          });
        }

        const twoFactorToken = twoFactorTokenHeader.trim();
        const secret = user.twoFactorSecret as string | undefined;
        const isTwoFactorValid = secret ? verifyTwoFactorToken(secret, twoFactorToken) : false;

        console.log(`[AUTH] Two-factor verification for ${email} - valid: ${isTwoFactorValid}`);

        if (!isTwoFactorValid) {
          recordFailedAttempt(ip, email);
          await logLoginAttempt(email, ip, userAgent, false, user.id, {
            reason: 'invalid_two_factor_token',
          });
          return res.status(401).json({
            success: false,
            message: 'Неверный код двухфакторной аутентификации',
          });
        }
      }

      await storage.resetUserFailedAttempts(user.id);
      clearFailedAttempts(ip, email);

      await storage.updateUser(user.id, {
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      });

      const token = generateJWT(user);
      const session = createUserSession(user.id);
      await storage.createSession(session);

      await logLoginAttempt(email, ip, userAgent, true, user.id);

      const response: AuthResponse = {
        success: true,
        user: sanitizeUser(user),
        message: 'Вход выполнен успешно',
      };

      res.cookie('session_token', session.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      res.json(response);
    } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Ошибка входа',
      });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    try {
      const sessionToken = req.cookies?.session_token;

      if (sessionToken) {
        await storage.deleteSession(sessionToken);

        if (req.user?.userId) {
          await logLogout(req.user.userId, ip, userAgent);
        }
      }

      res.clearCookie('session_token');
      res.json({
        success: true,
        message: 'Выход выполнен успешно',
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка выхода',
      });
    }
  });

  app.get('/api/auth/me', requireAuthCookie, async (req, res) => {
    try {
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Пользователь не найден',
        });
      }

      res.json({
        success: true,
        user: sanitizeUser(user),
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка получения данных пользователя',
      });
    }
  });

  app.post(
    '/api/auth/change-password',
    passwordChangeRateLimit,
    requireAuthCookie,
    async (req, res) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      try {
        const validatedData = changePasswordSchema.parse(req.body) as ChangePasswordData;
        const { currentPassword, newPassword } = validatedData;

        const user = await storage.getUserById(req.user.userId);
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'Пользователь не найден',
          });
        }

        const isValidPassword = await verifyPassword(currentPassword, user.password);
        if (!isValidPassword) {
          await logPasswordChange(user.id, ip, userAgent, false, {
            reason: 'invalid_current_password',
          });
          return res.status(400).json({
            success: false,
            message: 'Неверный текущий пароль',
          });
        }

        const hashedPassword = await hashPassword(newPassword);
        await storage.updateUser(user.id, {
          password: hashedPassword,
          passwordChangedAt: new Date(),
        });

        await logPasswordChange(user.id, ip, userAgent, true);

        res.json({
          success: true,
          message: 'Пароль изменен успешно',
        });
      } catch (error) {
        console.error('Change password error:', error);

        if (error && typeof error === 'object' && 'issues' in error) {
          const zodError = error as any;
          const passwordErrors = zodError.issues
            .filter((issue: any) => issue.path.includes('newPassword'))
            .map((issue: any) => issue.message);

          if (passwordErrors.length > 0) {
            return res.status(400).json({
              success: false,
              message: passwordErrors.join(', '),
            });
          }
        }

        res.status(400).json({
          success: false,
          message: error instanceof Error ? error.message : 'Ошибка изменения пароля',
        });
      }
    },
  );
}
