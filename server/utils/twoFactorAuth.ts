import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import type { User } from '@shared/schema';

/**
 * Генерирует секрет для 2FA
 */
export function generateTwoFactorSecret(user: User): string {
  return speakeasy.generateSecret({
    name: `Coffee KPI Dashboard (${user.email})`,
    issuer: 'Coffee KPI Dashboard',
    length: 32,
  }).base32;
}

/**
 * Генерирует QR код для настройки 2FA
 */
export async function generateTwoFactorQRCode(secret: string, user: User): Promise<string> {
  const otpauthUrl = speakeasy.otpauthURL({
    secret,
    label: user.email,
    issuer: 'Coffee KPI Dashboard',
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });

  try {
    return await QRCode.toDataURL(otpauthUrl);
  } catch (error) {
    throw new Error('Ошибка генерации QR кода');
  }
}

/**
 * Проверяет код 2FA
 */
export function verifyTwoFactorToken(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2, // допускаем отклонение в 2 периода (60 секунд)
  });
}

/**
 * Генерирует резервные коды для 2FA
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    codes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
  }
  return codes;
}

/**
 * Проверяет резервный код
 */
export function verifyBackupCode(usedCodes: string[], code: string): boolean {
  const upperCode = code.toUpperCase();
  return usedCodes.includes(upperCode);
}

/**
 * Middleware для проверки 2FA
 */
export function requireTwoFactor(req: any, res: any, next: any) {
  const user = req.user;
  
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Пользователь не авторизован'
    });
  }
  
  // Если 2FA не включена, пропускаем
  if (!user.twoFactorEnabled) {
    return next();
  }
  
  const twoFactorToken = req.headers['x-two-factor-token'] as string;
  
  if (!twoFactorToken) {
    return res.status(400).json({
      success: false,
      message: 'Требуется код двухфакторной аутентификации',
      requiresTwoFactor: true
    });
  }
  
  const secret = user.twoFactorSecret as string | undefined;

  const isValid = secret ? verifyTwoFactorToken(secret, twoFactorToken) : false;

  if (!isValid) {
    return res.status(400).json({
      success: false,
      message: 'Неверный код двухфакторной аутентификации',
      requiresTwoFactor: true
    });
  }

  next();
}
