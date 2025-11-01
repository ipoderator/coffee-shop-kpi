import type { Express, Request } from 'express';
import multer from 'multer';
import { parseISO, isValid, formatISO } from 'date-fns';
import PDFDocument from 'pdfkit';
import type {
  ProfitabilityAnalyticsResponse,
  ProfitabilityImportError,
  ProfitabilityUploadResponse,
  ProfitabilityImportResult,
  ProfitabilitySummaryResponse,
  ProfitabilitySeriesResponse,
  ProfitabilityTableResponse,
} from '@shared/schema';
import { storage } from '../storage';
import { parseProfitabilityExcelFile } from '../utils/profitabilityImport';
import { parseCogsExcelFile } from '../utils/cogsImport';
import { buildProfitabilityAnalytics } from '../utils/profitabilityAnalytics';
import {
  calculateProfitabilitySummary,
  calculateProfitabilitySeries,
  calculateProfitabilityTable,
} from '../utils/profitabilityKpi';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
  },
});

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatPercent = (value: number): string => `${(value * 100).toFixed(1).replace('.', ',')}%`;

function resolveAuthor(req: Request): string | undefined {
  const user = (req as any)?.user;
  if (!user) {
    return undefined;
  }
  return user.email ?? user.name ?? user.userId ?? undefined;
}

function parseDateParam(value?: string | string[]): Date | undefined {
  if (!value) {
    return undefined;
  }

  const str = Array.isArray(value) ? value[0] : value;
  const parsed = parseISO(str);
  return isValid(parsed) ? parsed : undefined;
}

async function resolveAnalyticsResponse(
  datasetId: string,
  req: { query: Record<string, any> },
): Promise<ProfitabilityAnalyticsResponse> {
  const dataset = await storage.getProfitabilityDataset(datasetId);

  if (!dataset) {
    throw Object.assign(new Error('Набор данных не найден'), { status: 404 });
  }

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);

  return buildProfitabilityAnalytics({
    dataset: dataset.dataset,
    records: dataset.records,
    filter: from || to ? { from, to } : undefined,
  });
}

export function registerProfitabilityRoutes(app: Express): void {
  app.post(
    '/api/profitability/import/z-report',
    upload.single('file'),
    async (req, res): Promise<void> => {
      const file = req.file;
      if (!file) {
        res
          .status(400)
          .json({ error: 'Файл с Z-отчетами не найден в запросе (ожидается поле "file")' });
        return;
      }

      const extension = file.originalname.split('.').pop()?.toLowerCase();
      if (!extension || !['xlsx', 'xls'].includes(extension)) {
        res.status(400).json({
          error: 'Поддерживаются только Excel файлы с расширением .xlsx или .xls',
        });
        return;
      }

      try {
        const parseResult = parseProfitabilityExcelFile(file.buffer);
        const warnings = [...parseResult.warnings];

        if (parseResult.skippedRows > 0) {
          warnings.push(
            `Пропущено строк: ${parseResult.skippedRows}. Проверьте журнал импорта для подробностей.`,
          );
        }

        const periodStart = parseResult.periodStart ?? parseResult.records[0]?.reportDate ?? null;
        const periodEnd =
          parseResult.periodEnd ??
          parseResult.records[parseResult.records.length - 1]?.reportDate ??
          null;

        if (!periodStart || !periodEnd || parseResult.records.length === 0) {
          res.status(400).json({
            error: 'Файл не содержит валидных строк для импорта',
            errors: parseResult.errors,
            warnings,
          });
          return;
        }

        const { dataset, records } = await storage.createProfitabilityDataset({
          name: parseResult.sheetName,
          sourceFile: file.originalname,
          periodStart,
          periodEnd,
          records: parseResult.records,
        });

        const rowsOk = records.length;
        const rowsFailed = Math.max(0, parseResult.rowsProcessed - rowsOk);

        const logEntry = await storage.createProfitabilityImportLog({
          status: rowsFailed > 0 || warnings.length > 0 ? 'partial' : 'success',
          datasetId: dataset.id,
          sourceFile: file.originalname,
          rowsProcessed: parseResult.rowsProcessed,
          periodStart,
          periodEnd,
          author: resolveAuthor(req),
          errors: parseResult.errors.length > 0 ? parseResult.errors : undefined,
          warnings: warnings.length > 0 ? warnings : undefined,
        });

        const periodFromStr = formatISO(periodStart, { representation: 'date' });
        const periodToStr = formatISO(periodEnd, { representation: 'date' });

        const batch = await storage.createImportBatch({
          filename: file.originalname,
          sourceType: 'z-report',
          rowsTotal: parseResult.rowsProcessed,
          rowsOk,
          rowsFailed,
          periodFrom: periodFromStr,
          periodTo: periodToStr,
          errors: parseResult.errors,
        });

        const response: ProfitabilityImportResult = {
          batchId: batch.id,
          rowsOk,
          rowsFailed,
          periodFrom: periodFromStr,
          periodTo: periodToStr,
          errors: parseResult.errors,
          warnings: warnings.length > 0 ? warnings : undefined,
          datasetId: dataset.id,
        };

        const statusCode = rowsFailed > 0 ? 207 : 201;
        res.status(statusCode).json(response);
      } catch (error) {
        console.error('[profitability] z-report import failed', error);
        const message =
          error instanceof Error ? error.message : 'Не удалось обработать файл Z-отчетов';
        res.status(500).json({ error: message });
      }
    },
  );

  app.post(
    '/api/profitability/import/cogs-daily',
    upload.single('file'),
    async (req, res): Promise<void> => {
      const file = req.file;
      if (!file) {
        res
          .status(400)
          .json({ error: 'Файл себестоимости не найден в запросе (ожидается поле "file")' });
        return;
      }

      const extension = file.originalname.split('.').pop()?.toLowerCase();
      if (!extension || !['xlsx', 'xls', 'csv'].includes(extension)) {
        res.status(400).json({
          error: 'Поддерживаются файлы себестоимости с расширением .xlsx, .xls или .csv',
        });
        return;
      }

      try {
        const result = parseCogsExcelFile(file.buffer);
        const entries = Object.entries(result.byDate).map(([date, value]) => ({
          reportDate: date,
          cogsTotal: value.total,
        }));

        if (entries.length === 0) {
          res.status(400).json({
            error: 'Файл себестоимости не содержит валидных записей',
            errors: result.errors,
            warnings: result.warnings,
          });
          return;
        }

        const periodDates = entries
          .map((entry) => parseISO(entry.reportDate))
          .filter((date) => !Number.isNaN(date.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());

        const periodFrom = periodDates[0];
        const periodTo = periodDates[periodDates.length - 1];

        const rowsOk = entries.length;
        const rowsFailed = result.errors.length;
        const periodFromStr = periodFrom ? formatISO(periodFrom, { representation: 'date' }) : null;
        const periodToStr = periodTo ? formatISO(periodTo, { representation: 'date' }) : null;

        const batch = await storage.createImportBatch({
          filename: file.originalname,
          sourceType: 'cogs-daily',
          rowsTotal: result.rowsProcessed,
          rowsOk,
          rowsFailed,
          periodFrom: periodFromStr,
          periodTo: periodToStr,
          errors: result.errors,
        });

        await storage.upsertCogsDaily({
          filename: file.originalname,
          rows: entries,
          importBatchId: batch.id,
        });

        const response: ProfitabilityImportResult = {
          batchId: batch.id,
          rowsOk,
          rowsFailed,
          periodFrom: periodFromStr,
          periodTo: periodToStr,
          errors: result.errors,
          warnings:
            result.warnings.length > 0 || result.skippedRows > 0
              ? [
                  ...result.warnings,
                  ...(result.skippedRows > 0 ? [`Пропущено строк: ${result.skippedRows}.`] : []),
                ]
              : undefined,
        };

        const statusCode = rowsFailed > 0 ? 207 : 201;
        res.status(statusCode).json(response);
      } catch (error) {
        console.error('[profitability] cogs import failed', error);
        const message =
          error instanceof Error ? error.message : 'Не удалось обработать файл себестоимости';
        res.status(500).json({ error: message });
      }
    },
  );

  app.get('/api/profitability/summary', async (req, res): Promise<void> => {
    try {
      const fromStr = Array.isArray(req.query.dateFrom)
        ? req.query.dateFrom[0]
        : req.query.dateFrom;
      const toStr = Array.isArray(req.query.dateTo) ? req.query.dateTo[0] : req.query.dateTo;
      const from = typeof fromStr === 'string' ? parseDateParam(fromStr) : undefined;
      const to = typeof toStr === 'string' ? parseDateParam(toStr) : undefined;

      if (from && to && from > to) {
        res.status(400).json({ error: 'Параметр dateFrom не может быть больше dateTo' });
        return;
      }

      const summary: ProfitabilitySummaryResponse = await calculateProfitabilitySummary({
        from,
        to,
      });

      res.json(summary);
    } catch (error) {
      console.error('[profitability] summary failed', error);
      const message = error instanceof Error ? error.message : 'Не удалось рассчитать KPI summary';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/profitability/series', async (req, res): Promise<void> => {
    try {
      const fromStr = Array.isArray(req.query.dateFrom)
        ? req.query.dateFrom[0]
        : req.query.dateFrom;
      const toStr = Array.isArray(req.query.dateTo) ? req.query.dateTo[0] : req.query.dateTo;
      const from = typeof fromStr === 'string' ? parseDateParam(fromStr) : undefined;
      const to = typeof toStr === 'string' ? parseDateParam(toStr) : undefined;

      if (from && to && from > to) {
        res.status(400).json({ error: 'Параметр dateFrom не может быть больше dateTo' });
        return;
      }

      const series: ProfitabilitySeriesResponse = await calculateProfitabilitySeries({
        from,
        to,
      });

      res.json(series);
    } catch (error) {
      console.error('[profitability] series failed', error);
      const message =
        error instanceof Error ? error.message : 'Не удалось сформировать временной ряд KPI';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/profitability/table/daily', async (req, res): Promise<void> => {
    try {
      const fromStr = Array.isArray(req.query.dateFrom)
        ? req.query.dateFrom[0]
        : req.query.dateFrom;
      const toStr = Array.isArray(req.query.dateTo) ? req.query.dateTo[0] : req.query.dateTo;
      const from = typeof fromStr === 'string' ? parseDateParam(fromStr) : undefined;
      const to = typeof toStr === 'string' ? parseDateParam(toStr) : undefined;

      if (from && to && from > to) {
        res.status(400).json({ error: 'Параметр dateFrom не может быть больше dateTo' });
        return;
      }

      const table: ProfitabilityTableResponse = await calculateProfitabilityTable({
        from,
        to,
      });

      res.json(table);
    } catch (error) {
      console.error('[profitability] daily table failed', error);
      const message =
        error instanceof Error ? error.message : 'Не удалось сформировать таблицу по дням';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/profitability/export.csv', async (req, res): Promise<void> => {
    try {
      const fromStr = Array.isArray(req.query.dateFrom)
        ? req.query.dateFrom[0]
        : req.query.dateFrom;
      const toStr = Array.isArray(req.query.dateTo) ? req.query.dateTo[0] : req.query.dateTo;
      const from = typeof fromStr === 'string' ? parseDateParam(fromStr) : undefined;
      const to = typeof toStr === 'string' ? parseDateParam(toStr) : undefined;

      if (from && to && from > to) {
        res.status(400).json({ error: 'Параметр dateFrom не может быть больше dateTo' });
        return;
      }

      const table = await calculateProfitabilityTable({ from, to });

      const header = [
        'Дата',
        'Валовая выручка',
        'Возвраты',
        'Коррекции',
        'Чистая выручка',
        'Количество чеков',
        'Возвраты, шт',
        'Коррекции, шт',
        'Средний чек',
        'Доля возвратов',
        'Себестоимость',
        'Валовая прибыль',
        'Валовая маржа',
      ].join(';');

      const rows = table.rows.map((row) =>
        [
          row.date,
          row.revenueGross.toFixed(2).replace('.', ','),
          row.returns.toFixed(2).replace('.', ','),
          row.corrections.toFixed(2).replace('.', ','),
          row.revenueNet.toFixed(2).replace('.', ','),
          row.receiptsCount,
          row.returnChecks,
          row.correctionsCount,
          row.averageCheck.toFixed(2).replace('.', ','),
          (row.refundRatio * 100).toFixed(1).replace('.', ','),
          row.cogsTotal !== null ? row.cogsTotal.toFixed(2).replace('.', ',') : '',
          row.grossProfit !== null ? row.grossProfit.toFixed(2).replace('.', ',') : '',
          row.grossMarginPct !== null
            ? (row.grossMarginPct * 100).toFixed(1).replace('.', ',')
            : '',
        ].join(';'),
      );

      const csv = [header, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="profitability-daily.csv"');
      res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error('[profitability] CSV export failed', error);
      const message = error instanceof Error ? error.message : 'Не удалось сформировать CSV';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/profitability/export.pdf', async (req, res): Promise<void> => {
    try {
      const { dateFrom, dateTo } = (req.body ?? {}) as {
        dateFrom?: string;
        dateTo?: string;
      };

      const from = parseDateParam(dateFrom);
      const to = parseDateParam(dateTo);

      if (from && to && from > to) {
        res.status(400).json({ error: 'Параметр dateFrom не может быть больше dateTo' });
        return;
      }

      const summary = await calculateProfitabilitySummary({ from, to });
      const table = await calculateProfitabilityTable({ from, to });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="profitability-report.pdf"');

      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      doc.pipe(res);

      doc.fontSize(18).text('Отчет по прибыльности', { align: 'center' });
      doc.moveDown();

      doc
        .fontSize(12)
        .text(
          `Период: ${new Date(summary.period.from).toLocaleDateString('ru-RU')} — ${new Date(
            summary.period.to,
          ).toLocaleDateString('ru-RU')}`,
        );

      doc.moveDown();
      doc.fontSize(14).text('Ключевые показатели', { underline: true });
      doc.moveDown(0.5);

      const current = summary.current;
      const safeGrossProfit = typeof current.grossProfit === 'number' ? current.grossProfit : 0;
      const safeGrossMarginPct =
        typeof current.grossMarginPct === 'number' ? current.grossMarginPct : 0;
      doc.list(
        [
          `Валовая выручка: ${formatCurrency(current.revenueGross)}`,
          `Чистая выручка: ${formatCurrency(current.revenueNet)}`,
          `Возвраты: ${formatCurrency(current.returns)} (${formatPercent(current.returnRate)})`,
          `Средний чек: ${formatCurrency(current.averageCheck)}`,
          `Количество чеков: ${current.receiptsCount.toLocaleString('ru-RU')}`,
          summary.hasCogs && typeof current.grossProfit === 'number'
            ? `Валовая прибыль: ${formatCurrency(safeGrossProfit)}`
            : 'Валовая прибыль: нет данных о себестоимости',
          summary.hasCogs && typeof current.grossMarginPct === 'number'
            ? `Валовая маржа: ${formatPercent(safeGrossMarginPct)}`
            : 'Валовая маржа: нет данных о себестоимости',
        ],
        { bulletIndent: 16 },
      );

      doc.moveDown();
      doc.fontSize(14).text('Динамика по дням', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);

      table.rows.forEach((row) => {
        doc
          .text(
            `${new Date(row.date).toLocaleDateString('ru-RU')}: чистая выручка ${formatCurrency(
              row.revenueNet,
            )}, возвраты ${formatCurrency(row.returns)}, коррекции ${formatCurrency(
              row.corrections,
            )}`,
          )
          .moveDown(0.25);
      });

      // TODO: Добавить визуализации (графики MA7/MA28, распределения) после интеграции с PDF-рендерингом графиков.

      doc.end();
    } catch (error) {
      console.error('[profitability] PDF export failed', error);
      const message = error instanceof Error ? error.message : 'Не удалось сформировать PDF';
      res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/profitability/upload',
    upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'costFile', maxCount: 1 },
    ]),
    async (req, res): Promise<void> => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const mainFile = files?.file?.[0];
      const costFile = files?.costFile?.[0];

      if (!mainFile) {
        res.status(400).json({ error: 'Файл не был загружен' });
        return;
      }

      const extension = mainFile.originalname.split('.').pop()?.toLowerCase();
      if (!extension || !['xlsx', 'xls'].includes(extension)) {
        res.status(400).json({
          error: 'Поддерживаются только Excel файлы (.xlsx или .xls)',
        });
        return;
      }

      try {
        const parseResult = parseProfitabilityExcelFile(mainFile.buffer);
        const combinedErrors = [...parseResult.errors];
        const combinedWarnings = [...parseResult.warnings];

        if (parseResult.skippedRows > 0) {
          combinedWarnings.push(
            `Пропущено строк: ${parseResult.skippedRows}. Подробности смотрите в журнале импорта.`,
          );
        }

        if (costFile) {
          const costExtension = costFile.originalname.split('.').pop()?.toLowerCase();
          if (!costExtension || !['xlsx', 'xls'].includes(costExtension)) {
            combinedWarnings.push(
              `Файл себестоимости "${costFile.originalname}" не был обработан: поддерживаются только Excel файлы (.xlsx или .xls).`,
            );
          } else {
            try {
              const cogsResult = parseCogsExcelFile(costFile.buffer);
              combinedErrors.push(...cogsResult.errors);
              combinedWarnings.push(...cogsResult.warnings);

              if (Object.keys(cogsResult.byDate).length === 0) {
                combinedWarnings.push(
                  `Файл себестоимости "${costFile.originalname}" не содержит данных.`,
                );
              } else {
                if (cogsResult.skippedRows > 0) {
                  combinedWarnings.push(
                    `В файле себестоимости пропущено строк: ${cogsResult.skippedRows}.`,
                  );
                }
                const recordsByDate = new Map<string, typeof parseResult.records>();
                parseResult.records.forEach((record) => {
                  const dateKey = record.reportDate.toISOString().slice(0, 10);
                  const group = recordsByDate.get(dateKey);
                  if (group) {
                    group.push(record);
                  } else {
                    recordsByDate.set(dateKey, [record]);
                  }
                });

                Object.entries(cogsResult.byDate).forEach(([dateKey, value]) => {
                  const group = recordsByDate.get(dateKey);
                  if (!group || group.length === 0) {
                    combinedWarnings.push(
                      `Себестоимость за ${dateKey} не сопоставлена с данными Z-отчетов.`,
                    );
                    return;
                  }

                  group.forEach((record, index) => {
                    record.cogsTotal = index === 0 ? value.total : 0;
                    record.cogsDetails = index === 0 ? (value.items ?? null) : null;
                  });
                });
              }
            } catch (cogsError) {
              combinedWarnings.push(
                `Не удалось обработать файл себестоимости "${costFile.originalname}": ${
                  cogsError instanceof Error ? cogsError.message : 'неизвестная ошибка'
                }`,
              );
            }
          }
        }

        const rowsProcessed = parseResult.rowsProcessed;
        const periodStart = parseResult.periodStart ?? parseResult.records[0]?.reportDate ?? null;
        const periodEnd =
          parseResult.periodEnd ??
          parseResult.records[parseResult.records.length - 1]?.reportDate ??
          null;

        if (rowsProcessed === 0 || !periodStart || !periodEnd) {
          const logEntry = await storage.createProfitabilityImportLog({
            status: 'failed',
            sourceFile: mainFile.originalname,
            rowsProcessed: 0,
            periodStart: null,
            periodEnd: null,
            author: resolveAuthor(req),
            errors: combinedErrors.length > 0 ? combinedErrors : undefined,
            warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
          });

          res.status(400).json({
            error: 'Файл не содержит валидных строк для импорта',
            log: logEntry,
            errors: combinedErrors.length > 0 ? combinedErrors : undefined,
            warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
          });
          return;
        }

        const creation = await storage.createProfitabilityDataset({
          name: parseResult.sheetName,
          sourceFile: mainFile.originalname,
          periodStart,
          periodEnd,
          records: parseResult.records,
        });

        const status =
          combinedErrors.length > 0 || combinedWarnings.length > 0 ? 'partial' : 'success';

        const logEntry = await storage.createProfitabilityImportLog({
          status,
          datasetId: creation.dataset.id,
          sourceFile: mainFile.originalname,
          rowsProcessed,
          periodStart,
          periodEnd,
          author: resolveAuthor(req),
          errors: combinedErrors.length > 0 ? combinedErrors : undefined,
          warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
        });

        const response: ProfitabilityUploadResponse = {
          success: true,
          dataset: creation.dataset,
          rowsProcessed,
          log: logEntry,
          errors: combinedErrors.length > 0 ? combinedErrors : undefined,
          warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
        };

        res.status(201).json(response);
      } catch (error) {
        console.error('[profitability] upload failed', error);
        const message = error instanceof Error ? error.message : 'Не удалось обработать файл';
        const status = (error as any)?.status ?? 500;
        const details = (error as any)?.details as
          | {
              errors?: ProfitabilityImportError[];
              warnings?: string[];
            }
          | undefined;

        try {
          await storage.createProfitabilityImportLog({
            status: 'failed',
            sourceFile: mainFile.originalname,
            rowsProcessed: 0,
            periodStart: null,
            periodEnd: null,
            author: resolveAuthor(req),
            errors: details?.errors,
            warnings: details?.warnings,
          });
        } catch (logError) {
          console.error('[profitability] failed to persist import log', logError);
        }

        const responseBody: Record<string, unknown> = { error: message };
        if (details?.errors && details.errors.length > 0) {
          responseBody.errors = details.errors;
        }
        if (details?.warnings && details.warnings.length > 0) {
          responseBody.warnings = details.warnings;
        }

        res.status(status).json(responseBody);
      }
    },
  );

  app.get('/api/profitability/datasets', async (_req, res) => {
    try {
      const datasets = await storage.listProfitabilityDatasets();
      res.json({ datasets });
    } catch (error) {
      console.error('[profitability] list datasets failed', error);
      res.status(500).json({ error: 'Не удалось получить список наборов данных' });
    }
  });

  app.get('/api/profitability/import-logs', async (_req, res) => {
    try {
      const logs = await storage.listProfitabilityImportLogs();
      res.json({ logs });
    } catch (error) {
      console.error('[profitability] list import logs failed', error);
      res.status(500).json({ error: 'Не удалось получить журнал импортов' });
    }
  });

  app.get('/api/profitability/:datasetId', async (req, res) => {
    try {
      const analytics = await resolveAnalyticsResponse(req.params.datasetId, req);
      res.json(analytics);
    } catch (error) {
      console.error('[profitability] analytics failed', error);
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Не удалось рассчитать показатели';
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/profitability/:datasetId/export.csv', async (req, res) => {
    try {
      const analytics = await resolveAnalyticsResponse(req.params.datasetId, req);

      const header = [
        'Дата',
        'Валовая выручка',
        'Возвраты',
        'Коррекции',
        'Чистая выручка',
        'Чеков прихода',
        'Чеков возврата',
        'Коррекций',
        'Доля наличных',
        'Доля безнала',
        'Себестоимость',
        'Валовая прибыль',
        'Маржа',
      ].join(';');

      const rows = analytics.table.map((row) =>
        [
          row.date,
          row.grossRevenue.toFixed(2).replace('.', ','),
          row.returns.toFixed(2).replace('.', ','),
          row.corrections.toFixed(2).replace('.', ','),
          row.netRevenue.toFixed(2).replace('.', ','),
          row.incomeChecks,
          row.returnChecks,
          row.correctionChecks,
          row.cashIncome + row.cashlessIncome > 0
            ? ((row.cashIncome / (row.cashIncome + row.cashlessIncome)) * 100)
                .toFixed(1)
                .replace('.', ',')
            : '0',
          row.cashIncome + row.cashlessIncome > 0
            ? ((row.cashlessIncome / (row.cashIncome + row.cashlessIncome)) * 100)
                .toFixed(1)
                .replace('.', ',')
            : '0',
          (row.cogsTotal ?? 0).toFixed(2).replace('.', ','),
          (row.grossProfit ?? row.netRevenue).toFixed(2).replace('.', ','),
          ((row.margin ?? 0) * 100).toFixed(1).replace('.', ','),
        ].join(';'),
      );

      const csvContent = [header, ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="profitability-${req.params.datasetId}.csv"`,
      );
      res.send(`\uFEFF${csvContent}`);
    } catch (error) {
      console.error('[profitability] CSV export failed', error);
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Не удалось сформировать CSV отчет';
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/profitability/:datasetId/export.pdf', async (req, res) => {
    try {
      const analytics = await resolveAnalyticsResponse(req.params.datasetId, req);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="profitability-${req.params.datasetId}.pdf"`,
      );

      const doc = new PDFDocument({ size: 'A4', margin: 42 });
      doc.pipe(res);

      doc.fontSize(18).text('Отчет по рентабельности', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Раздел: ${analytics.dataset.name}`);
      doc.text(
        `Период: ${new Date(analytics.period.from).toLocaleDateString('ru-RU')} — ${new Date(
          analytics.period.to,
        ).toLocaleDateString('ru-RU')}`,
      );
      doc.text(`Количество дней: ${analytics.table.length}`);
      doc.moveDown();

      doc.fontSize(14).text('Ключевые показатели', { underline: true });
      doc.moveDown(0.5);
      doc
        .fontSize(12)
        .list(
          [
            `Валовая выручка: ${formatCurrency(analytics.kpi.grossRevenue)}`,
            `Чистая выручка: ${formatCurrency(analytics.kpi.netRevenue)}`,
            `Возвраты: ${formatCurrency(analytics.kpi.returns)}`,
            `Коррекции: ${formatCurrency(analytics.kpi.corrections)}`,
            `Средний чек: ${formatCurrency(analytics.kpi.averageCheck)}`,
            `Количество чеков прихода: ${analytics.kpi.incomeChecks}`,
            `Доля возвратов: ${formatPercent(analytics.kpi.returnRate)}`,
            `Доля наличных: ${formatPercent(analytics.kpi.cashShare)}`,
            `Доля безналичных: ${formatPercent(analytics.kpi.cashlessShare)}`,
          ],
          { bulletIndent: 16 },
        );

      doc.moveDown();
      doc.fontSize(14).text('Динамика по дням', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(11);

      analytics.table.forEach((row) => {
        doc
          .text(
            `${new Date(row.date).toLocaleDateString('ru-RU')}: чистая выручка ${formatCurrency(
              row.netRevenue,
            )}, возвраты ${formatCurrency(row.returns)}, коррекции ${formatCurrency(
              row.corrections,
            )}`,
          )
          .moveDown(0.25);
      });

      doc.end();
    } catch (error) {
      console.error('[profitability] PDF export failed', error);
      const status = (error as any)?.status ?? 500;
      const message = error instanceof Error ? error.message : 'Не удалось сформировать PDF отчет';
      res.status(status).json({ error: message });
    }
  });
}
