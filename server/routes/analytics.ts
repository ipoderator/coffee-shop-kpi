import type { Express } from 'express';
import { storage } from '../storage';
import { calculateAnalytics } from '../utils/analytics';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerAnalyticsRoutes(app: Express): void {
  app.get('/api/analytics/:uploadId', async (req, res) => {
    try {
      const { uploadId } = req.params;

      if (!uuidRe.test(uploadId)) {
        return res.status(400).json({
          error: 'Неверный формат ID. Ожидается UUID.',
        });
      }

      const transactions = await storage.getTransactionsByUploadId(uploadId);

      if (transactions.length === 0) {
        return res.status(404).json({
          error: 'Данные не найдены. Пожалуйста, загрузите файл.',
        });
      }

      const analytics = await calculateAnalytics(transactions);

      res.json(analytics);
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ошибка расчета аналитики',
      });
    }
  });
}
