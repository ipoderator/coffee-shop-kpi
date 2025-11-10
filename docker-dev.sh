#!/bin/bash

# Coffee KPI Dashboard - Запуск в режиме разработки с hot reload

set -e

echo "🚀 Coffee KPI Dashboard - Development Mode"
echo "   Hot Reload: ✅ Enabled"
echo "   Port: 5001"
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

# Используем docker compose (новый синтаксис) или docker-compose (старый)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
else
    DOCKER_COMPOSE="docker-compose"
fi

# Проверка наличия .env файла
if [ ! -f .env ]; then
    echo "⚠️  Файл .env не найден. Создаю из env.example..."
    if [ -f env.example ]; then
        cp env.example .env
        echo "✅ Файл .env создан. Пожалуйста, отредактируйте его и укажите необходимые переменные."
        echo "   Особенно важно указать DATABASE_URL и JWT_SECRET."
        echo "   Для разработки можно использовать значения по умолчанию из docker-compose.dev.yml"
        read -p "Нажмите Enter после редактирования .env файла (или просто Enter для продолжения с дефолтными значениями)..."
    else
        echo "❌ Файл env.example не найден!"
        exit 1
    fi
else
    # Проверяем наличие JWT_SECRET в .env
    if ! grep -q "^JWT_SECRET=" .env 2>/dev/null; then
        echo "⚠️  JWT_SECRET не найден в .env файле."
        echo "   Используется значение по умолчанию из docker-compose.dev.yml"
        echo "   Для production обязательно установите безопасный JWT_SECRET в .env файле!"
    fi
fi

# Создание директории для логов, если её нет
mkdir -p logs

echo "📦 Сборка и запуск контейнеров в режиме разработки..."
echo "   Изменения в коде будут применяться автоматически!"
echo ""

# Сборка и запуск с dev конфигурацией
$DOCKER_COMPOSE -f docker-compose.dev.yml up -d --build

echo ""
echo "⏳ Ожидание готовности приложения..."
sleep 5

# Проверка статуса
if $DOCKER_COMPOSE -f docker-compose.dev.yml ps | grep -q "Up"; then
    echo ""
    echo "✅ Приложение запущено в режиме разработки!"
    echo ""
    echo "📊 Приложение доступно по адресу:"
    echo "   http://localhost:5001"
    echo ""
    echo "🔄 Hot Reload включен!"
    echo "   Изменения в файлах client/, server/, shared/ применяются автоматически"
    echo "   Перезапуск контейнера не требуется!"
    echo ""
    echo "📝 Полезные команды:"
    echo "   Просмотр логов:    $DOCKER_COMPOSE -f docker-compose.dev.yml logs -f app"
    echo "   Остановка:          $DOCKER_COMPOSE -f docker-compose.dev.yml down"
    echo "   Перезапуск:         $DOCKER_COMPOSE -f docker-compose.dev.yml restart app"
    echo "   Статус:             $DOCKER_COMPOSE -f docker-compose.dev.yml ps"
    echo ""
    echo "💡 Совет: Откройте терминал и выполните 'docker-compose -f docker-compose.dev.yml logs -f app'"
    echo "   чтобы видеть логи в реальном времени"
    echo ""
else
    echo ""
    echo "⚠️  Контейнеры запущены, но могут быть проблемы."
    echo "   Проверьте логи: $DOCKER_COMPOSE -f docker-compose.dev.yml logs app"
    exit 1
fi

