#!/bin/bash
set -e

echo "🚀 Coffee KPI Dashboard - Starting container..."

# Определяем режим работы
if [ "$NODE_ENV" = "development" ]; then
  echo "🔧 Development mode - Hot reload enabled"
  echo "   Changes in code will be applied automatically!"
else
  echo "📦 Production mode"
fi

# Ожидание готовности базы данных
if [ -n "$DATABASE_URL" ]; then
  echo "⏳ Waiting for database to be ready..."
  
  # Извлекаем параметры подключения из DATABASE_URL
  # Формат: postgresql://user:password@host:port/database
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
  DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p' || echo "5432")
  DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
  
  # Ждем доступности базы данных (максимум 60 секунд)
  MAX_RETRIES=30
  RETRY_COUNT=0
  
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" 2>/dev/null || [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
    echo "⏳ Database is unavailable - sleeping... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
  done
  
  if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
    echo "❌ Database connection timeout after $MAX_RETRIES attempts"
    exit 1
  fi
  
  echo "✅ Database is ready!"
  
  # Применение миграций БД
  echo "📦 Applying database migrations..."
  if npm run db:push; then
    echo "✅ Database migrations completed successfully"
  else
    echo "⚠️  Warning: Database migrations failed, but continuing..."
    echo "   This might be normal if migrations were already applied."
  fi
else
  echo "⚠️  Warning: DATABASE_URL not set, skipping database setup"
fi

# Запуск приложения
echo "🎯 Starting application..."
exec "$@"

