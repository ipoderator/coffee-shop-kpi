import type { Express } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import type { FileUploadResponse, InsertTransaction } from '@shared/schema';
import { storage } from '../storage';
import {
  parseExcelFile,
  parseCSVFile,
  parsePDFFile,
  parseSalesPositionsExcelFile,
} from '../utils/fileParser';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

export function registerUploadRoutes(app: Express): void {
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }
      const fileExtension = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
      const type = req.query.type || req.body?.type;
      let parseResult;
      if (type === 'positions') {
        if (!['xlsx', 'xls'].includes(fileExtension)) {
          return res.status(400).json({ error: 'Поддерживаются только .xlsx и .xls' });
        }
        parseResult = await parseSalesPositionsExcelFile(req.file.buffer);
        return res.json(parseResult);
      }
      if (!fileExtension || !['xlsx', 'xls', 'csv', 'pdf'].includes(fileExtension)) {
        return res.status(400).json({
          error: 'Неподдерживаемый формат файла. Используйте .xlsx, .xls, .csv или .pdf',
        });
      }
      parseResult = await parseExcelFile(req.file.buffer);
      if (parseResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Файл не содержит корректных данных',
        });
      }

      const uploadId = randomUUID();

      const insertTransactions: InsertTransaction[] = parseResult.rows.map((row) => ({
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
        error: error instanceof Error ? error.message : 'Ошибка обработки файла',
      });
    }
  });

  app.post('/api/upload/positions', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Файл не был загружен' });
      }
      const extension = req.file.originalname.split('.').pop()?.toLowerCase() ?? '';
      if (!['xlsx', 'xls'].includes(extension)) {
        return res.status(400).json({ error: 'Поддерживаются только .xlsx и .xls' });
      }
      const result = await parseSalesPositionsExcelFile(req.file.buffer);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      res.status(400).json(stack ? { error: message, stack } : { error: message });
    }
  });
}
