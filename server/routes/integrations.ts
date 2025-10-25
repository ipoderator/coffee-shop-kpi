import type { Express } from 'express';
import path from 'node:path';
import multer from 'multer';
import { requireAuthAny } from '../utils/auth';
import { getTrainingFileFieldName, trainSalesModelFromExcel, TrainingError } from '../utils/training';

const integrationTrainingUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

export function registerIntegrationRoutes(app: Express): void {
  app.post('/api/test-fetch-shifts', requireAuthAny, async (_req, res) => {
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

  app.post(
    '/api/integrations/train-sales-model',
    requireAuthAny,
    (req, res, next) => {
      integrationTrainingUpload.single(getTrainingFileFieldName())(req, res, err => {
        if (err) {
          console.error('Integration training upload error:', err);
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              success: false,
              message: 'Файл слишком большой. Максимальный размер — 15 МБ.',
            });
          }

          return res.status(400).json({
            success: false,
            message: 'Не удалось загрузить файл. Попробуйте ещё раз.',
          });
        }
        return next();
      });
    },
    async (req, res) => {
      try {
        const file = (req as typeof req & { file?: Express.Multer.File }).file;

        if (!file) {
          return res.status(400).json({
            success: false,
            message: 'Файл не был загружен.',
          });
        }

        const extension = path.extname(file.originalname).toLowerCase();
        if (!['.xlsx', '.xls'].includes(extension)) {
          return res.status(400).json({
            success: false,
            message: 'Неверный формат файла. Допустимы только .xlsx и .xls',
          });
        }

        const result = await trainSalesModelFromExcel(file.buffer, file.originalname);

        return res.json({
          success: true,
          message: result.message,
          modelUpdated: true,
        });
      } catch (error) {
        if (error instanceof TrainingError) {
          return res.status(error.status).json({
            success: false,
            message: error.message,
          });
        }

        console.error('Integration train-sales-model error:', error);
        return res.status(500).json({
          success: false,
          message: 'Неожиданная ошибка при обработке файла.',
        });
      }
    },
  );
}
