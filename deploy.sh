#!/bin/bash

# Coffee KPI Dashboard - Deployment Script
# Быстрое развертывание приложения с Docker

set -e

echo "🚀 Coffee KPI Dashboard - Deployment Script"
echo "=============================================="

# Проверяем наличие Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Установите Docker и попробуйте снова."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Установите Docker Compose и попробуйте снова."
    exit 1
fi

echo "✅ Docker и Docker Compose найдены"

# Останавливаем существующие контейнеры
echo "🔄 Останавливаем существующие контейнеры..."
docker-compose down --remove-orphans || true

# Удаляем старые образы
echo "🧹 Очищаем старые образы..."
docker image prune -f || true

# Собираем новый образ
echo "🔨 Собираем новый образ..."
docker-compose build --no-cache

# Запускаем приложение
echo "🚀 Запускаем приложение..."
docker-compose up -d

# Ждем запуска
echo "⏳ Ждем запуска приложения..."
sleep 10

# Проверяем статус
echo "📊 Проверяем статус контейнеров..."
docker-compose ps

# Проверяем здоровье приложения
echo "🏥 Проверяем здоровье приложения..."
for i in {1..30}; do
    if curl -f http://localhost:5000/ > /dev/null 2>&1; then
        echo "✅ Приложение успешно запущено!"
        echo "🌐 Доступно по адресу: http://localhost:5000"
        break
    fi
    echo "⏳ Ожидание запуска... ($i/30)"
    sleep 2
done

# Показываем логи
echo "📋 Последние логи приложения:"
docker-compose logs --tail=20 app

echo ""
echo "🎉 Развертывание завершено!"
echo "📊 Приложение: http://localhost:5000"
echo "🔌 API: http://localhost:5000/api"
echo "🗄️ База данных: localhost:5432"
echo ""
echo "📋 Полезные команды:"
echo "  docker-compose logs -f app     # Просмотр логов"
echo "  docker-compose down            # Остановка"
echo "  docker-compose restart app     # Перезапуск приложения"
echo "  docker-compose exec app sh     # Подключение к контейнеру"