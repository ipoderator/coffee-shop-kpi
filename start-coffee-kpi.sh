#!/bin/bash

echo "🔄 Останавливаем все процессы на портах 5000 и 54112..."
lsof -ti:5000 | xargs kill -9 2>/dev/null || true
lsof -ti:54112 | xargs kill -9 2>/dev/null || true
pkill -f "tsx server/index.ts" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

echo "⏳ Ждем 2 секунды..."
sleep 2

echo "🚀 Запускаем Coffee KPI сервер на порту 5000..."
NODE_ENV=development PORT=5000 npx tsx server/index.ts
