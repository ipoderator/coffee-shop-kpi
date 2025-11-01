declare module 'node-cron' {
  export interface ScheduleOptions {
    scheduled?: boolean;
    timezone?: string;
    recoverMissedExecutions?: boolean;
  }

  export interface ScheduledTask {
    start: () => void;
    stop: () => void;
    destroy: () => void;
  }

  export function schedule(
    cronExpression: string,
    task: () => void,
    options?: ScheduleOptions,
  ): ScheduledTask;

  export function validate(cronExpression: string): boolean;

  const nodeCron: {
    schedule: typeof schedule;
    validate: typeof validate;
  };

  export default nodeCron;
}

declare module 'speakeasy' {
  interface GenerateSecretOptions {
    length?: number;
    name?: string;
    issuer?: string;
  }

  interface GenerateSecretResult {
    ascii: string;
    hex: string;
    base32: string;
    otpauth_url: string;
  }

  interface TotpVerifyOptions {
    secret: string;
    token: string;
    encoding?: string;
    window?: number;
  }

  export function generateSecret(options?: GenerateSecretOptions): GenerateSecretResult;

  export function otpauthURL(options: {
    secret: string;
    label: string;
    issuer?: string;
    algorithm?: string;
    digits?: number;
    period?: number;
  }): string;

  export const totp: {
    verify(options: TotpVerifyOptions): boolean;
  };

  const speakeasy: {
    generateSecret: typeof generateSecret;
    otpauthURL: typeof otpauthURL;
    totp: typeof totp;
  };

  export default speakeasy;
}

declare module 'qrcode' {
  export function toDataURL(text: string, options?: Record<string, unknown>): Promise<string>;

  const qrCode: {
    toDataURL: typeof toDataURL;
  };

  export default qrCode;
}

declare namespace Express {
  interface UserPayload {
    userId: string;
    email: string;
    role: string;
    twoFactorEnabled?: boolean | null;
    twoFactorSecret?: string | null;
  }

  interface Request {
    user?: UserPayload;
  }
}
