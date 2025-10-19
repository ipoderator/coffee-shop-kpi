import React, { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface PasswordStrengthMeterProps {
  password: string;
  confirmPassword?: string;
  className?: string;
}

interface PasswordRequirement {
  label: string;
  met: boolean;
  icon: React.ReactNode;
}

export function PasswordStrengthMeter({ password, confirmPassword, className }: PasswordStrengthMeterProps) {
  const requirements = useMemo((): PasswordRequirement[] => {
    const hasMinLength = password.length >= 8;
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const passwordsMatch = confirmPassword ? password === confirmPassword : true;

    const baseRequirements = [
      {
        label: 'Минимум 8 символов',
        met: hasMinLength,
        icon: hasMinLength ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      },
      {
        label: 'Заглавные буквы',
        met: hasUppercase,
        icon: hasUppercase ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      },
      {
        label: 'Строчные буквы',
        met: hasLowercase,
        icon: hasLowercase ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      },
      {
        label: 'Цифры',
        met: hasNumber,
        icon: hasNumber ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      },
      {
        label: 'Специальные символы',
        met: hasSpecialChar,
        icon: hasSpecialChar ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      }
    ];

    // Добавляем проверку совпадения паролей, если есть confirmPassword
    if (confirmPassword !== undefined) {
      baseRequirements.push({
        label: 'Пароли совпадают',
        met: passwordsMatch,
        icon: passwordsMatch ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />
      });
    }

    return baseRequirements;
  }, [password, confirmPassword]);

  const strengthScore = useMemo(() => {
    const metRequirements = requirements.filter(req => req.met).length;
    return (metRequirements / requirements.length) * 100;
  }, [requirements]);

  const getStrengthLevel = (score: number) => {
    if (score < 20) return { level: 'Очень слабый', color: 'bg-red-500' };
    if (score < 40) return { level: 'Слабый', color: 'bg-orange-500' };
    if (score < 60) return { level: 'Средний', color: 'bg-yellow-500' };
    if (score < 80) return { level: 'Хороший', color: 'bg-blue-500' };
    return { level: 'Отличный', color: 'bg-green-500' };
  };

  const strengthLevel = getStrengthLevel(strengthScore);

  if (!password) {
    return null;
  }

  return (
    <div className={`space-y-3 ${className || ''}`}>
      {/* Strength Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Надежность пароля:</span>
          <span className={`font-medium ${strengthLevel.color.replace('bg-', 'text-')}`}>
            {strengthLevel.level}
          </span>
        </div>
        <Progress 
          value={strengthScore} 
          className="h-2"
          style={{
            '--progress-background': strengthLevel.color
          } as React.CSSProperties}
        />
      </div>

      {/* Requirements List */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Требования к паролю:</p>
        <div className="space-y-1">
          {requirements.map((requirement, index) => (
            <div key={index} className="flex items-center space-x-2 text-sm">
              {requirement.icon}
              <span className={requirement.met ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {requirement.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Additional Security Tips */}
      {password.length > 0 && strengthScore < 60 && (
        <div className="flex items-start space-x-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-medium mb-1">Советы для повышения безопасности:</p>
            <ul className="space-y-1 text-xs">
              <li>• Используйте уникальные символы и цифры</li>
              <li>• Избегайте простых последовательностей (123, abc)</li>
              <li>• Не используйте личную информацию</li>
              <li>• Рассмотрите использование менеджера паролей</li>
            </ul>
          </div>
        </div>
      )}

      {/* Success Message */}
      {strengthScore >= 80 && (
        <div className="flex items-start space-x-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-green-800 dark:text-green-200">
            <p className="font-medium">Отличный пароль!</p>
            <p className="text-xs">Ваш пароль соответствует высоким стандартам безопасности.</p>
          </div>
        </div>
      )}
    </div>
  );
}
