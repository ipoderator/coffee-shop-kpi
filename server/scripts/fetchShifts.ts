import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { Page } from 'puppeteer';
import cron from 'node-cron';

const LOGIN_URL = 'https://back.ytimes.ru/finance/shift/list';
const REPORTS_URL = 'https://back.ytimes.ru/finance/shift/zreports';
const DATE_RANGE_INPUT_SELECTOR = 'input[name="dateRange"]';
const DATE_RANGE_OPTION_THIS_YEAR = 'li[data-range-key="Этот год"]';
const EXPORT_ICON_SELECTOR = '.btn.btn-success i.fa.fa-download';
const CRON_SCHEDULE = '0 22 * * *';
const TIMEZONE = 'America/Chicago';

const credentials = {
  login: process.env.YTIMES_LOGIN ?? 'GLEB',
  account: process.env.YTIMES_ACCOUNT ?? 'reserva_lip',
  password: process.env.YTIMES_PASSWORD ?? 'wumxuq-rurWem-5zejtu'
};

const uploadEndpoint =
  process.env.COFFEE_KPI_UPLOAD_URL ?? `${process.env.COFFEE_KPI_BASE_URL ?? 'http://localhost:3000'}/api/upload`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fillInput(page: Page, selector: string, value: string, label: string) {
  const element = await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  if (!element) {
    throw new Error(`Unable to locate ${label} field (${selector})`);
  }
  await page.evaluate((sel) => {
    const input = document.querySelector<HTMLInputElement>(sel);
    if (!input) {
      throw new Error(`Input ${sel} is missing from the page`);
    }
    input.value = '';
  }, selector);
  await page.type(selector, value, { delay: 50 });
}

async function waitForDownload(downloadDir: string, trigger: () => Promise<void>, timeoutMs = 120_000) {
  const start = Date.now();
  await fs.mkdir(downloadDir, { recursive: true });
  await trigger();

  const ignoredExtensions = ['.crdownload', '.tmp', '.part'];

  while (Date.now() - start < timeoutMs) {
    const entries = await fs.readdir(downloadDir);

    for (const entry of entries) {
      const shouldSkip = ignoredExtensions.some((ext) => entry.endsWith(ext));
      if (shouldSkip) {
        continue;
      }

      const filePath = path.join(downloadDir, entry);
      const stats = await fs.stat(filePath);
      if (stats.isFile() && stats.size > 0 && stats.mtimeMs >= start) {
        return filePath;
      }
    }

    await delay(500);
  }

  throw new Error('Timed out waiting for the report download to finish');
}

async function fetchShiftsReport(): Promise<void> {
  const downloadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ytimes-shifts-'));
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(60_000);

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDir
    });

    await page.goto(LOGIN_URL, { waitUntil: 'networkidle0' });

    await fillInput(page, 'input[name="login"]', credentials.login, 'login');
    await fillInput(page, 'input[name="accountName"]', credentials.account, 'account');
    await fillInput(page, 'input[name="password"]', credentials.password, 'password');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"], button.btn.btn-primary[type="submit"]')
    ]);

    if (!page.url().startsWith(REPORTS_URL)) {
      await page.goto(REPORTS_URL, { waitUntil: 'networkidle0' });
    }

    await page.waitForSelector(DATE_RANGE_INPUT_SELECTOR, { visible: true });
    await page.click(DATE_RANGE_INPUT_SELECTOR);
    await page.waitForSelector(DATE_RANGE_OPTION_THIS_YEAR, { visible: true });
    await page.click(DATE_RANGE_OPTION_THIS_YEAR);

    const applyButton = await page.$('.drp-buttons .applyBtn');
    if (applyButton) {
      await applyButton.click();
    }

    await delay(1_000);

    const downloadedReport = await waitForDownload(downloadDir, async () => {
      const exportIcon = await page.waitForSelector(EXPORT_ICON_SELECTOR, { visible: true, timeout: 20_000 });
      if (!exportIcon) {
        throw new Error('Export button was not found on the reports page');
      }

      await exportIcon.evaluate((node) => {
        const button = node.closest('button');
        if (button) {
          (button as HTMLButtonElement).click();
        } else {
          (node as HTMLElement).click();
        }
      });
    });

    const fileBuffer = await fs.readFile(downloadedReport);
    const fileName = path.basename(downloadedReport);
    const fileBlob = new Blob([fileBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const formData = new FormData();
    formData.append('file', fileBlob, fileName);

    const response = await fetch(uploadEndpoint, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '<unavailable>');
      throw new Error(`Upload failed with status ${response.status}: ${errorBody}`);
    }

    console.info(`[fetchShifts] Uploaded ${fileName} (${fileBuffer.length} bytes) to ${uploadEndpoint}`);
  } catch (error) {
    console.error('[fetchShifts] Job failed:', error);
    throw error;
  } finally {
    await browser.close().catch(() => undefined);
    await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function scheduleJob() {
  cron.schedule(
    CRON_SCHEDULE,
    () => {
      console.info(`[fetchShifts] Running scheduled job at ${new Date().toISOString()}`);
      fetchShiftsReport().catch((error) => {
        console.error('[fetchShifts] Scheduled execution failed:', error);
      });
    },
    { timezone: TIMEZONE }
  );

  console.info(`[fetchShifts] Scheduler initialised for ${CRON_SCHEDULE} (${TIMEZONE})`);
}

if (process.argv.includes('--run-once')) {
  fetchShiftsReport()
    .then(() => console.info('[fetchShifts] Manual run completed'))
    .catch((error) => {
      console.error('[fetchShifts] Manual run failed:', error);
      process.exitCode = 1;
    });
} else {
  scheduleJob();
}
