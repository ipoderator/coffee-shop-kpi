import type { Express } from 'express';
import { createServer, type Server } from 'http';
import {
  apiRateLimit,
  devRateLimitReset,
  helmetConfig,
  registerSecurityDevRoutes,
  securityLogger,
  suspiciousActivityDetection,
} from '../utils/security';
import { registerAuthRoutes } from './auth';
import { registerUploadRoutes } from './upload';
import { registerAnalyticsRoutes } from './analytics';
import { registerProfitabilityRoutes } from './profitability';
import { registerIntegrationRoutes } from './integrations';

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(helmetConfig);
  app.use(securityLogger);
  app.use(suspiciousActivityDetection);
  app.use(devRateLimitReset);
  app.use(apiRateLimit);
  registerSecurityDevRoutes(app);

  registerAuthRoutes(app);
  registerUploadRoutes(app);
  registerAnalyticsRoutes(app);
  registerProfitabilityRoutes(app);
  registerIntegrationRoutes(app);

  const httpServer = createServer(app);

  return httpServer;
}
