import express, { type Express } from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer, createLogger } from 'vite';
import { type Server } from 'http';
import viteConfig from '../vite.config';
import { nanoid } from 'nanoid';

const viteLogger = createLogger();

export function log(message: string, source = 'express') {
  const formattedTime = new Date().toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  const port = parseInt(process.env.PORT || '5001', 10);
  
  const serverOptions = {
    middlewareMode: true,
    hmr: { 
      server,
      // Настройки HMR для локальной разработки
      protocol: isDev ? 'ws' : 'wss',
      host: isDev ? 'localhost' : undefined,
      port: isDev ? port : undefined,
    },
    allowedHosts: true as const,
    // Включаем watch для отслеживания изменений
    watch: {
      usePolling: false,
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Не завершаем процесс при ошибках в dev режиме для более стабильной работы
        if (!isDev) {
          process.exit(1);
        }
      },
    },
    server: serverOptions,
    appType: 'custom',
  });

  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;

    // Skip API routes
    if (url.startsWith('/api/')) {
      return next();
    }

    try {
      const clientTemplate = path.resolve(import.meta.dirname, '..', 'client', 'index.html');

      // В dev режиме всегда перечитываем template для поддержки HMR
      let template = await fs.promises.readFile(clientTemplate, 'utf-8');
      // В dev режиме не добавляем cache busting, чтобы не ломать HMR
      if (isDev) {
        template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx"`);
      } else {
        template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
      }
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, 'public');

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use('*', (req, res) => {
    // Skip API routes
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }

    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
