import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { parseExcelFile, parseCSVFile, parsePDFFile } from "./utils/fileParser";
import { calculateAnalytics } from "./utils/analytics";
import { hashPassword, verifyPassword, generateJWT, createUserSession, requireAuth, requireAuthCookie, sanitizeUser, isSessionExpired } from "./utils/auth";
import type { FileUploadResponse, InsertTransaction, LoginData, RegisterData, AuthResponse, SessionResponse, ChangePasswordData } from "@shared/schema";
import { loginSchema, registerSchema, changePasswordSchema } from "@shared/schema";
import { 
  authRateLimit, 
  registerRateLimit, 
  passwordChangeRateLimit, 
  apiRateLimit, 
  helmetConfig, 
  checkBlocked, 
  securityLogger, 
  suspiciousActivityDetection,
  devRateLimitReset 
} from './utils/security';
import { 
  logLoginAttempt, 
  logLogout, 
  logPasswordChange, 
  logAccountLocked,
  logSuspiciousActivity 
} from './utils/securityLogger';

// UUID validation regex
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply security middleware globally
  app.use(helmetConfig);
  app.use(securityLogger);
  app.use(suspiciousActivityDetection);
  app.use(devRateLimitReset); // Development rate limit reset
  app.use(apiRateLimit);

  // Auth endpoints
  app.post('/api/auth/register', registerRateLimit, async (req, res) => {
    try {
      const validatedData = registerSchema.parse(req.body);
      const { email, password, name, confirmPassword } = validatedData;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'Пользователь с таким email уже существует'
        });
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        role: 'user',
        isActive: true,
      });

      // Generate JWT and session
      const token = generateJWT(user);
      const session = createUserSession(user.id);
      await storage.createSession(session);

      const response: AuthResponse = {
        success: true,
        user: sanitizeUser(user),
        message: 'Регистрация успешна'
      };

      // Set session cookie
      res.cookie('session_token', session.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json(response);
    } catch (error) {
      console.error('Registration error:', error);
      
      // Handle Zod validation errors
      if (error && typeof error === 'object' && 'issues' in error) {
        const zodError = error as any;
        const passwordErrors = zodError.issues
          .filter((issue: any) => issue.path.includes('password'))
          .map((issue: any) => issue.message);
        
        if (passwordErrors.length > 0) {
          return res.status(400).json({
            success: false,
            message: passwordErrors.join(', ')
          });
        }
      }
      
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Ошибка регистрации'
      });
    }
  });

  app.post('/api/auth/login', authRateLimit, checkBlocked, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    try {
      const validatedData = loginSchema.parse(req.body);
      const { email, password } = validatedData;

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user || !user.isActive) {
        await logLoginAttempt(email, ip, userAgent, false);
        return res.status(401).json({
          success: false,
          message: 'Неверный email или пароль'
        });
      }

      // Check if account is locked
      if (user.lockedUntil && new Date() < user.lockedUntil) {
        await logLoginAttempt(email, ip, userAgent, false, user.id, { reason: 'account_locked' });
        return res.status(423).json({
          success: false,
          message: 'Аккаунт временно заблокирован. Попробуйте позже.'
        });
      }

      // Verify password
      const isValidPassword = await verifyPassword(password, user.password);
      if (!isValidPassword) {
        const failedAttempts = (user.failedLoginAttempts || 0) + 1;
        const lockedUntil = failedAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
        
        await storage.updateUserFailedAttempts(user.id, failedAttempts, lockedUntil);
        await logLoginAttempt(email, ip, userAgent, false, user.id, { failedAttempts });
        
        if (lockedUntil) {
          await logAccountLocked(user.id, ip, userAgent, 'too_many_failed_attempts');
        }
        
        return res.status(401).json({
          success: false,
          message: 'Неверный email или пароль'
        });
      }

      // Reset failed attempts on successful login
      await storage.resetUserFailedAttempts(user.id);
      
      // Update last login info
      await storage.updateUser(user.id, {
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      });

      // Generate JWT and session
      const token = generateJWT(user);
      const session = createUserSession(user.id);
      await storage.createSession(session);

      // Log successful login
      await logLoginAttempt(email, ip, userAgent, true, user.id);

      const response: AuthResponse = {
        success: true,
        user: sanitizeUser(user),
        message: 'Вход выполнен успешно'
      };

      // Set session cookie
      res.cookie('session_token', session.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.json(response);
    } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Ошибка входа'
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
        
        // Log logout if user was authenticated
        if (req.user?.userId) {
          await logLogout(req.user.userId, ip, userAgent);
        }
      }

      res.clearCookie('session_token');
      res.json({
        success: true,
        message: 'Выход выполнен успешно'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка выхода'
      });
    }
  });

  app.get('/api/auth/me', requireAuthCookie, async (req, res) => {
    try {
      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Пользователь не найден'
        });
      }

      res.json({
        success: true,
        user: sanitizeUser(user)
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({
        success: false,
        message: 'Ошибка получения данных пользователя'
      });
    }
  });

  app.post('/api/auth/change-password', passwordChangeRateLimit, requireAuthCookie, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    try {
      const validatedData = changePasswordSchema.parse(req.body);
      const { currentPassword, newPassword } = validatedData;

      const user = await storage.getUserById(req.user.userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Пользователь не найден'
        });
      }

      // Verify current password
      const isValidPassword = await verifyPassword(currentPassword, user.password);
      if (!isValidPassword) {
        await logPasswordChange(user.id, ip, userAgent, false, { reason: 'invalid_current_password' });
        return res.status(400).json({
          success: false,
          message: 'Неверный текущий пароль'
        });
      }

      // Hash new password and update
      const hashedPassword = await hashPassword(newPassword);
      await storage.updateUser(user.id, { 
        password: hashedPassword,
        passwordChangedAt: new Date()
      });

      // Log successful password change
      await logPasswordChange(user.id, ip, userAgent, true);

      res.json({
        success: true,
        message: 'Пароль изменен успешно'
      });
    } catch (error) {
      console.error('Change password error:', error);
      
      // Handle Zod validation errors
      if (error && typeof error === 'object' && 'issues' in error) {
        const zodError = error as any;
        const passwordErrors = zodError.issues
          .filter((issue: any) => issue.path.includes('newPassword'))
          .map((issue: any) => issue.message);
        
        if (passwordErrors.length > 0) {
          return res.status(400).json({
            success: false,
            message: passwordErrors.join(', ')
          });
        }
      }
      
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : 'Ошибка изменения пароля'
      });
    }
  });

  // File upload endpoint
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }

      const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase();
      
      let parseResult;
      
      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        parseResult = await parseExcelFile(req.file.buffer);
      } else if (fileExtension === 'csv') {
        parseResult = await parseCSVFile(req.file.buffer);
      } else if (fileExtension === 'pdf') {
        parseResult = await parsePDFFile(req.file.buffer);
      } else {
        return res.status(400).json({ 
          error: 'Неподдерживаемый формат файла. Используйте .xlsx, .xls, .csv или .pdf' 
        });
      }

      if (parseResult.rows.length === 0) {
        return res.status(400).json({ 
          error: 'Файл не содержит корректных данных' 
        });
      }

      // Generate upload ID
      const uploadId = randomUUID();

      // Store transactions
      const insertTransactions: InsertTransaction[] = parseResult.rows.map(row => ({
        date: row.date,
        year: row.year ?? null,
        month: row.month ?? null,
        amount: row.amount,
        checksCount: row.checksCount ?? 1, // По умолчанию 1 чек если не указано
        cashPayment: row.cashPayment ?? null,
        terminalPayment: row.terminalPayment ?? null,
        qrPayment: row.qrPayment ?? null,
        sbpPayment: row.sbpPayment ?? null,
        refundChecksCount: row.refundChecksCount ?? null,
        refundCashPayment: row.refundCashPayment ?? null,
        refundTerminalPayment: row.refundTerminalPayment ?? null,
        refundQrPayment: row.refundQrPayment ?? null,
        refundSbpPayment: row.refundSbpPayment ?? null,
        category: row.category ?? null,
        employee: row.employee ?? null,
        uploadId,
      }));

      await storage.createTransactions(insertTransactions);

      const response: FileUploadResponse = {
        success: true,
        uploadId,
        rowsProcessed: parseResult.rows.length,
        columnsDetected: parseResult.columnsDetected,
      };

      res.json(response);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Ошибка обработки файла' 
      });
    }
  });

  // Analytics endpoint
  app.get('/api/analytics/:uploadId', async (req, res) => {
    try {
      const { uploadId } = req.params;
      
      // Validate UUID format
      if (!uuidRe.test(uploadId)) {
        return res.status(400).json({ 
          error: 'Неверный формат ID. Ожидается UUID.' 
        });
      }
      
      const transactions = await storage.getTransactionsByUploadId(uploadId);
      
      if (transactions.length === 0) {
        return res.status(404).json({ 
          error: 'Данные не найдены. Пожалуйста, загрузите файл.' 
        });
      }

      const analytics = await calculateAnalytics(transactions);
      
      res.json(analytics);
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Ошибка расчета аналитики' 
      });
    }
  });


  const httpServer = createServer(app);

  return httpServer;
}
