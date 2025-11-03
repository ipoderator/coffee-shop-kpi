import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      jsxImportSource: 'react',
      // Fast Refresh включен по умолчанию в @vitejs/plugin-react
      babel: {
        plugins: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
      '@shared': path.resolve(import.meta.dirname, 'shared'),
      '@assets': path.resolve(import.meta.dirname, 'attached_assets'),
    },
  },
  root: path.resolve(import.meta.dirname, 'client'),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5001', 10),
    strictPort: true,
    // Настройки HMR для локальной разработки
    hmr: (() => {
      const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
      const port = parseInt(process.env.PORT || '5001', 10);
      if (isDev) {
        // Используем стандартный WebSocket для локальной разработки
        return {
          protocol: 'ws',
          host: 'localhost',
          port: port,
        };
      } else {
        // Для Replit/продакшена используем wss
        return {
          clientPort: 443,
          protocol: 'wss',
        };
      }
    })(),
    watch: {
      // Отслеживаем изменения в shared файлах
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
    fs: {
      strict: true,
      deny: ['**/.*'],
      // Разрешаем доступ к shared файлам для HMR
      allow: ['..'],
    },
  },
  optimizeDeps: {
    // Не предварительно собираем эти зависимости для более быстрой перезагрузки
    exclude: [],
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});
