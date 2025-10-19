import React from 'react';

interface PasswordRequirementsProps {
  className?: string;
}

export function PasswordRequirements({ className }: PasswordRequirementsProps) {
  return (
    <div className={`text-xs text-muted-foreground space-y-1 ${className || ''}`}>
      <p>Требования к паролю:</p>
      <ul className="list-disc list-inside space-y-0.5">
        <li>Минимум 8 символов</li>
        <li>Заглавные и строчные буквы</li>
        <li>Минимум одна цифра</li>
      </ul>
    </div>
  );
}
