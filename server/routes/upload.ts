import type { Express } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import type { FileUploadResponse, InsertTransaction } from '@shared/schema';
import { storage } from '../storage';
import { analyticsCache } from '../utils/analyticsCache';
import {
  parseExcelFile,
  parseCSVFile,
  parsePDFFile,
  parseSalesPositionsExcelFile,
} from '../utils/fileParser';
import { log } from '../vite';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

export function registerUploadRoutes(app: Express): void {
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    const startTime = performance.now();
    const fileName = req.file?.originalname || 'unknown';
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }
      
      const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
      const fileSizeKB = (req.file.size / 1024).toFixed(2);
      log(`📤 Начало загрузки файла: ${fileName} (${fileSizeKB} KB, ${fileExtension})`, 'upload');
      
      const type = req.query.type || req.body?.type;
      let parseResult;
      
      if (type === 'positions') {
        if (!['xlsx', 'xls'].includes(fileExtension)) {
          return res.status(400).json({ error: 'Поддерживаются только .xlsx и .xls' });
        }
        const parseStartTime = performance.now();
        parseResult = await parseSalesPositionsExcelFile(req.file.buffer);
        const parseTime = (performance.now() - parseStartTime).toFixed(2);
        log(`⏱️  Парсинг файла позиций завершен за ${parseTime}ms (строк: ${parseResult.rows.length})`, 'upload');
        return res.json(parseResult);
      }
      
      if (!fileExtension || !['xlsx', 'xls', 'csv', 'pdf'].includes(fileExtension)) {
        return res.status(400).json({
          error: 'Неподдерживаемый формат файла. Используйте .xlsx, .xls, .csv или .pdf',
        });
      }
      
      // Парсинг файла
      const parseStartTime = performance.now();
      parseResult = await parseExcelFile(req.file.buffer);
      const parseTime = (performance.now() - parseStartTime).toFixed(2);
      log(`⏱️  Парсинг файла завершен за ${parseTime}ms (строк: ${parseResult.rows.length})`, 'upload');
      
      if (parseResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Файл не содержит корректных данных',
        });
      }

      const uploadId = randomUUID();

      // Преобразование данных
      // Оптимизация: предвычисляем uploadId и используем более эффективное создание объектов
      const transformStartTime = performance.now();
      const rowsLength = parseResult.rows.length;
      
      // Оптимизация: ранний выход если нет данных
      if (rowsLength === 0) {
        return res.status(400).json({
          error: 'Файл не содержит корректных данных',
        });
      }
      
      const insertTransactions: InsertTransaction[] = [];
      insertTransactions.length = rowsLength; // Предвыделяем размер массива
      
      // Оптимизация: предвычисляем длину массива и создаем объекты напрямую
      // Минимизируем операции nullish coalescing где возможно
      for (let i = 0; i < rowsLength; i++) {
        const row = parseResult.rows[i];
        // Оптимизация: создаем объект напрямую, минимизируя проверки
        insertTransactions[i] = {
          date: row.date,
          year: row.year ?? null,
          month: row.month ?? null,
          amount: row.amount,
          checksCount: row.checksCount ?? 1,
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
        };
      }
      const transformTime = (performance.now() - transformStartTime).toFixed(2);
      log(`⏱️  Преобразование данных завершено за ${transformTime}ms (${rowsLength} записей)`, 'upload');

      // Сохранение в БД
      const saveStartTime = performance.now();
      await storage.createTransactions(insertTransactions);
      const saveTime = (performance.now() - saveStartTime).toFixed(2);
      log(`⏱️  Сохранение транзакций завершено за ${saveTime}ms (записей: ${insertTransactions.length})`, 'upload');

      // Инвалидируем кеш аналитики для этого uploadId
      analyticsCache.invalidate(uploadId);

      const totalTime = (performance.now() - startTime).toFixed(2);
      log(`✅ Загрузка файла завершена за ${totalTime}ms (парсинг: ${parseTime}ms, сохранение: ${saveTime}ms)`, 'upload');

      const response: FileUploadResponse = {
        success: true,
        uploadId,
        rowsProcessed: parseResult.rows.length,
        columnsDetected: parseResult.columnsDetected,
      };

      res.json(response);

      // Автоматическое переобучение моделей на новых данных в фоне
      setImmediate(async () => {
        try {
          // Получаем все транзакции для этого uploadId
          const allTransactions = await storage.getTransactionsByUploadId(uploadId);
          
          if (allTransactions.length >= 14) {
            const { EnhancedMLForecastingEngine } = await import('../utils/enhancedMLForecasting');
            const { getExternalDataService } = await import('../utils/externalDataSources');
            
            const externalDataService = getExternalDataService();
            const mlEngine = new EnhancedMLForecastingEngine(
              allTransactions,
              externalDataService,
              undefined, // profitabilityRecords
              false, // useLLM - отключаем для фонового переобучения
              storage,
              uploadId,
            );
            
            const retrainResult = await mlEngine.retrainEnsembleModelsOnActuals(allTransactions);
            if (retrainResult.success) {
              log(
                `✅ Модели переобучены после загрузки: ${retrainResult.modelsRetrained} моделей, точность: ${retrainResult.averageAccuracy.toFixed(3)}`,
                'ml-training',
              );
            } else {
              log(
                `⚠️ Переобучение моделей после загрузки не удалось: ${retrainResult.errors.join(', ')}`,
                'ml-training',
              );
            }
          }
        } catch (error) {
          console.error('[Upload] Ошибка при переобучении моделей:', error);
        }
      });
    } catch (error) {
      const totalTime = (performance.now() - startTime).toFixed(2);
      console.error(`❌ Ошибка загрузки файла ${fileName} (время: ${totalTime}ms):`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Ошибка обработки файла',
      });
    }
  });

  app.post('/api/upload/positions', upload.single('file'), async (req, res) => {
    const startTime = performance.now();
    const fileName = req.file?.originalname || 'unknown';
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }
      const extension = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
      const fileSizeKB = (req.file.size / 1024).toFixed(2);
      log(`📤 Начало загрузки файла позиций: ${fileName} (${fileSizeKB} KB)`, 'upload');
      
      if (!['xlsx', 'xls'].includes(extension)) {
        return res.status(400).json({ error: 'Поддерживаются только .xlsx и .xls' });
      }
      
      const parseStartTime = performance.now();
      const result = await parseSalesPositionsExcelFile(req.file.buffer);
      const parseTime = (performance.now() - parseStartTime).toFixed(2);
      const totalTime = (performance.now() - startTime).toFixed(2);
      log(`✅ Загрузка файла позиций завершена за ${totalTime}ms (парсинг: ${parseTime}ms, строк: ${result.rows.length})`, 'upload');
      
      res.json(result);
    } catch (error) {
      const totalTime = (performance.now() - startTime).toFixed(2);
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(`❌ Ошибка загрузки файла позиций ${fileName} (время: ${totalTime}ms):`, error);
      res.status(400).json(stack ? { error: message, stack } : { error: message });
    }
  });
}
