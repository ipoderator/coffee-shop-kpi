#!/bin/bash

# Coffee KPI Dashboard - Полная настройка и развертывание
# Решает ВСЕ проблемы с зависимостями

set -e

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# Заголовок
echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                Coffee KPI Dashboard                         ║"
echo "║              Полная настройка и развертывание               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Проверка Node.js
log "Проверяем Node.js..."
if ! command -v node &> /dev/null; then
    error "Node.js не установлен. Установите Node.js 18+ с https://nodejs.org/"
    exit 1
fi
success "Node.js $(node -v) установлен"

# Очистка
log "Очищаем старые зависимости..."
rm -rf node_modules package-lock.json
npm cache clean --force

# Использование исправленного package.json
log "Применяем исправленную конфигурацию package.json..."
cp package-fixed.json package.json

# Установка зависимостей
log "Устанавливаем зависимости..."
npm install --legacy-peer-deps --force

# Проверка установки критических пакетов
log "Проверяем установку критических пакетов..."

check_package() {
    local package=$1
    if [ -d "node_modules/$package" ]; then
        success "$package установлен"
    else
        error "$package НЕ установлен"
        return 1
    fi
}

check_package "vite"
check_package "@vitejs/plugin-react"
check_package "autoprefixer"
check_package "postcss"
check_package "@tailwindcss/typography"
check_package "tailwindcss"

# Дополнительная установка tailwindcss если нужно
if [ ! -d "node_modules/tailwindcss" ]; then
    log "Устанавливаем tailwindcss..."
    npm install "tailwindcss@^3.4.17" --save --force
fi

# Создание .env файла
log "Настраиваем окружение..."
if [ ! -f .env ]; then
    cp env.example .env
    warning "Создан файл .env. Настройте DATABASE_URL!"
else
    log "Файл .env уже существует"
fi

# Настройка базы данных
log "Настраиваем базу данных..."
if command -v psql &> /dev/null; then
    if npm run db:push 2>/dev/null; then
        success "Миграции базы данных применены"
    else
        warning "Не удалось применить миграции. Проверьте DATABASE_URL в .env"
    fi
else
    warning "PostgreSQL не найден. Пропускаем настройку БД"
fi

# Сборка приложения
log "Собираем приложение..."
if npm run build; then
    success "Приложение собрано успешно"
else
    error "Ошибка сборки приложения"
    exit 1
fi

# Тестирование
log "Тестируем приложение..."
PORT=3000 npm run dev &
APP_PID=$!
sleep 20

if curl -f http://localhost:3000 > /dev/null 2>&1; then
    success "Приложение работает на http://localhost:3000"
    TEST_PASSED=true
else
    error "Приложение недоступно"
    TEST_PASSED=false
fi

# Остановка тестового процесса
kill $APP_PID 2>/dev/null || true

# Результат
echo ""
if [ "$TEST_PASSED" = true ]; then
    success "🎉 Настройка завершена успешно!"
    echo ""
    echo -e "${YELLOW}Следующие шаги:${NC}"
    echo "1. Настройте DATABASE_URL в .env файле"
    echo "2. Запустите: ${GREEN}PORT=3000 npm run dev${NC}"
    echo "3. Откройте: ${GREEN}http://localhost:3000${NC}"
    echo ""
    echo -e "${YELLOW}Для production:${NC}"
    echo "1. Настройте переменные окружения"
    echo "2. Запустите: ${GREEN}npm start${NC}"
else
    error "Настройка завершена с ошибками"
    echo "Проверьте логи выше для диагностики"
fi

echo ""
echo -e "${BLUE}Дополнительные файлы:${NC}"
echo "• DEPLOYMENT.md - подробное руководство по развертыванию"
echo "• docker-compose.yml - для Docker развертывания"
echo "• deploy.sh - автоматический скрипт развертывания"
echo "• quick-deploy.sh - быстрое развертывание"
