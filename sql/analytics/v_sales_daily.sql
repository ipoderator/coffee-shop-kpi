CREATE OR REPLACE VIEW v_sales_daily AS
SELECT
  z.id AS z_report_id,
  z.report_date::date,
  z.report_number,
  z.receipts_count,
  z.revenue_cash,
  z.revenue_cashless,
  z.refund_receipts_count,
  z.refund_cash,
  z.refund_cashless,
  z.corr_receipts_count,
  z.corr_cash,
  z.corr_cashless,
  z.import_batch_id,
  z.created_at,
  z.updated_at,

  -- Агрегаты
  (z.revenue_cash + z.revenue_cashless) AS revenue_gross,
  (z.refund_cash + z.refund_cashless) AS refund_total,
  (z.corr_cash + z.corr_cashless) AS corrections_total,
  ((z.revenue_cash + z.revenue_cashless) - (z.refund_cash + z.refund_cashless) + (z.corr_cash + z.corr_cashless)) AS revenue_net,
  CASE WHEN z.receipts_count > 0 THEN (z.revenue_cash + z.revenue_cashless) / z.receipts_count END AS avg_check,
  c.cogs_total,
  ((z.revenue_cash + z.revenue_cashless) - (z.refund_cash + z.refund_cashless) + (z.corr_cash + z.corr_cashless)) - c.cogs_total AS gross_profit,
  CASE WHEN ((z.revenue_cash + z.revenue_cashless) - (z.refund_cash + z.refund_cashless) + (z.corr_cash + z.corr_cashless)) <> 0
    THEN (((z.revenue_cash + z.revenue_cashless) - (z.refund_cash + z.refund_cashless) + (z.corr_cash + z.corr_cashless)) - c.cogs_total) / 
         NULLIF(((z.revenue_cash + z.revenue_cashless) - (z.refund_cash + z.refund_cashless) + (z.corr_cash + z.corr_cashless)), 0)
    END AS gross_margin_pct
FROM
  sales_z_reports z
LEFT JOIN cogs_daily c ON c.report_date = z.report_date::text;
