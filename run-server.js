#!/usr/bin/env node

// Простой скрипт для запуска сервера
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('🚀 Запускаем Coffee KPI сервер...');

// Устанавливаем переменные окружения
process.env.PORT = '5000';
process.env.NODE_ENV = 'development';

// Запускаем сервер
const server = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, PORT: '5000', NODE_ENV: 'development' },
});

server.on('error', (err) => {
  console.error('❌ Ошибка запуска сервера:', err);
});

server.on('exit', (code) => {
  console.log(`📊 Сервер завершился с кодом: ${code}`);
});

// Обработка сигналов завершения
process.on('SIGINT', () => {
  console.log('\n🛑 Останавливаем сервер...');
  server.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Останавливаем сервер...');
  server.kill('SIGTERM');
});
