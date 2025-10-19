#!/bin/bash

# Убиваем все существующие процессы
echo "🔄 Останавливаем существующие процессы..."
pkill -f "tsx server/index.ts" || true
pkill -f "npm run dev" || true

# Убиваем процессы на портах 5000 и 54112
echo "🔄 Освобождаем порты..."
lsof -ti:5000 | xargs kill -9 || true
lsof -ti:54112 | xargs kill -9 || true

# Устанавливаем порт
export PORT=5000

echo "🚀 Запускаем Coffee KPI сервер на порту $PORT..."

# Запускаем сервер
npm run dev
