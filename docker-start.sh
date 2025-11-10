#!/bin/bash

# Coffee KPI Dashboard - Быстрый запуск через Docker

set -e

echo "🚀 Coffee KPI Dashboard - Docker Quick Start"
echo ""

# Проверка наличия Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Пожалуйста, установите Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Проверка наличия Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose не установлен. Пожалуйста, установите Docker Compose."
    exit 1
fi

# Проверка наличия .env файла
if [ ! -f .env ]; then
    echo "⚠️  Файл .env не найден. Создаю из env.example..."
    if [ -f env.example ]; then
        cp env.example .env
        echo "✅ Файл .env создан. Пожалуйста, отредактируйте его и укажите необходимые переменные."
        echo "   Особенно важно указать DATABASE_URL и другие API ключи."
        read -p "Нажмите Enter после редактирования .env файла..."
    else
        echo "❌ Файл env.example не найден!"
        exit 1
    fi
fi

# Создание директории для логов, если её нет
mkdir -p logs

echo "📦 Сборка и запуск контейнеров..."
echo ""

# Используем docker compose (новый синтаксис) или docker-compose (старый)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Сборка и запуск
$DOCKER_COMPOSE up -d --build

echo ""
echo "⏳ Ожидание готовности приложения..."
sleep 5

# Проверка статуса
if $DOCKER_COMPOSE ps | grep -q "Up"; then
    echo ""
    echo "✅ Приложение запущено!"
    echo ""
    echo "📊 Приложение доступно по адресу:"
    echo "   http://localhost:5001"
    echo ""
    echo "📝 Полезные команды:"
    echo "   Просмотр логов:    $DOCKER_COMPOSE logs -f app"
    echo "   Остановка:          $DOCKER_COMPOSE down"
    echo "   Перезапуск:         $DOCKER_COMPOSE restart"
    echo "   Статус:             $DOCKER_COMPOSE ps"
    echo ""
else
    echo ""
    echo "⚠️  Контейнеры запущены, но могут быть проблемы."
    echo "   Проверьте логи: $DOCKER_COMPOSE logs app"
    exit 1
fi

