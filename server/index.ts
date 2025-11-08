import 'dotenv/config';
import express, { type Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { registerRoutes } from './routes';
import { registerPlugins } from './plugins';
import { setupVite, serveStatic, log } from './vite';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (path.startsWith('/api')) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + '…';
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log('🚀 Starting Coffee KPI server...');


    await registerPlugins(app);
    console.log('✅ Plugins registered successfully');

    const server = await registerRoutes(app);
    console.log('✅ Routes registered successfully');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || 'Internal Server Error';

      console.error('❌ Server error:', err);
      res.status(status).json({ message });
    });

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    const isDevelopment = process.env.NODE_ENV === 'development' || app.get('env') === 'development';
    
    if (isDevelopment) {
      console.log('🔧 Setting up Vite for development with HMR...');
      await setupVite(app, server);
      console.log('✅ Vite setup complete - Hot Module Replacement enabled');
    } else {
      console.log('📦 Setting up static file serving...');
      serveStatic(app);
      console.log('✅ Static file serving setup complete');
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Default to 5001 if not specified.
    // this serves both the API and the client.
    const port = parseInt(process.env.PORT || '5001', 10);

    // Функция для освобождения порта, если он занят
    async function killProcessOnPort(port: number): Promise<boolean> {
      try {
        // Определяем команду в зависимости от ОС
        const isWindows = process.platform === 'win32';
        let command: string;
        let pidExtractor: (output: string) => string[];

        if (isWindows) {
          // Windows: используем netstat для поиска PID
          command = `netstat -ano | findstr :${port}`;
          pidExtractor = (output: string) => {
            const lines = output.trim().split('\n');
            const pids = new Set<string>();
            lines.forEach((line) => {
              const parts = line.trim().split(/\s+/);
              if (parts.length > 0) {
                const pid = parts[parts.length - 1];
                if (pid && /^\d+$/.test(pid)) {
                  pids.add(pid);
                }
              }
            });
            return Array.from(pids);
          };
        } else {
          // macOS/Linux: используем lsof
          command = `lsof -ti :${port}`;
          pidExtractor = (output: string) => {
            return output
              .trim()
              .split('\n')
              .filter((pid) => pid && /^\d+$/.test(pid));
          };
        }

        const { stdout } = await execAsync(command);
        const pids = pidExtractor(stdout);

        if (pids.length === 0) {
          return false; // Порт свободен
        }

        console.log(`⚠️  Порт ${port} занят процессами: ${pids.join(', ')}`);
        console.log(`🔪 Завершаю процессы...`);

        // Убиваем процессы
        for (const pid of pids) {
          try {
            if (isWindows) {
              await execAsync(`taskkill /PID ${pid} /F`);
            } else {
              await execAsync(`kill -9 ${pid}`);
            }
            console.log(`✅ Процесс ${pid} завершен`);
          } catch (error: any) {
            // Игнорируем ошибки, если процесс уже завершен
            if (!error.message?.includes('not found') && !error.message?.includes('No such process')) {
              console.warn(`⚠️  Не удалось завершить процесс ${pid}:`, error.message);
            }
          }
        }

        // Даем системе время на освобождение порта
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      } catch (error: any) {
        // Если команда не нашла процессы (порт свободен), это нормально
        if (error.code === 1 || error.message?.includes('not found')) {
          return false;
        }
        console.warn(`⚠️  Ошибка при проверке порта ${port}:`, error.message);
        return false;
      }
    }

    // Освобождаем порт перед запуском сервера
    const portFreed = await killProcessOnPort(port);
    if (portFreed) {
      console.log(`✅ Порт ${port} освобожден, запускаю сервер...`);
    }

    server.listen(port, () => {
      console.log(`🎉 Coffee KPI server is running!`);
      console.log(`📊 Frontend: http://localhost:${port}`);
      console.log(`🔌 API: http://localhost:${port}/api`);
      console.log(`🌍 Environment: ${app.get('env')}`);
      log(`serving on port ${port}`);
    });

    server.on('error', async (err: any) => {
      console.error('❌ Server startup error:', err);
      if (err.code === 'EADDRINUSE') {
        console.log(`🔄 Пытаюсь автоматически освободить порт ${port}...`);
        const freed = await killProcessOnPort(port);
        if (freed) {
          console.log(`✅ Порт ${port} освобожден, перезапускаю сервер...`);
          // Перезапускаем сервер после освобождения порта
          setTimeout(() => {
            server.listen(port, () => {
              console.log(`🎉 Coffee KPI server is running!`);
              console.log(`📊 Frontend: http://localhost:${port}`);
              console.log(`🔌 API: http://localhost:${port}/api`);
              log(`serving on port ${port}`);
            });
          }, 1000);
        } else {
          console.error(
            `🚫 Не удалось автоматически освободить порт ${port}. Пожалуйста, завершите процесс вручную.`,
          );
        }
      }
    });

    // Обработка необработанных ошибок для предотвращения перезапусков
    process.on('uncaughtException', (error: Error) => {
      console.error('❌ Uncaught Exception:', error);
      console.error('Stack:', error.stack);
      // Не завершаем процесс, чтобы сервер продолжал работать
      // В production можно добавить отправку в систему мониторинга
    });

    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      console.error('❌ Unhandled Rejection at:', promise);
      console.error('Reason:', reason);
      // Не завершаем процесс, чтобы сервер продолжал работать
    });

    // Мониторинг использования памяти
    if (process.env.NODE_ENV === 'development') {
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const memMB = {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          external: Math.round(memUsage.external / 1024 / 1024),
        };
        
        // Предупреждение при высоком использовании памяти
        if (memMB.heapUsed > 500) {
          console.warn(`⚠️  Высокое использование памяти: ${memMB.heapUsed}MB (heap)`);
        }
        
        // Логируем каждые 5 минут в development
        if (Date.now() % 300000 < 10000) {
          log(`💾 Память: RSS=${memMB.rss}MB, Heap=${memMB.heapUsed}/${memMB.heapTotal}MB`, 'memory');
        }
      }, 60000); // Проверяем каждую минуту
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();
