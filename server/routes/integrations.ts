import type { Express } from 'express';
import { requireAuth } from '../utils/auth';

export function registerIntegrationRoutes(app: Express): void {
  app.post('/api/test-fetch-shifts', requireAuth, async (_req, res) => {
    try {
      const fetchShifts = app.locals.fetchShifts?.run as (() => Promise<void>) | undefined;

      if (!fetchShifts) {
        res.status(503).json({
          success: false,
          message: 'Fetch shifts plugin is not registered',
        });
        return;
      }

      await fetchShifts();
      res.json({
        success: true,
        message: 'Shift report fetched successfully',
      });
    } catch (error) {
      console.error('Test fetch shifts error:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch shifts report',
      });
    }
  });
}
