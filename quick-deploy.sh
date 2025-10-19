#!/bin/bash

# Coffee KPI Dashboard - Быстрое развертывание
# Решает все проблемы с зависимостями автоматически

set -e

echo "🚀 Быстрое развертывание Coffee KPI Dashboard..."

# Функция для установки пакетов
install_package() {
    local package=$1
    local version=$2
    
    echo "📦 Устанавливаем $package..."
    if npm install "$package@$version" --save --force --legacy-peer-deps; then
        echo "✅ $package установлен"
    else
        echo "❌ Ошибка установки $package"
        exit 1
    fi
}

# Очистка
echo "🧹 Очищаем старые зависимости..."
rm -rf node_modules package-lock.json
npm cache clean --force

# Установка основных зависимостей
echo "📦 Устанавливаем основные зависимости..."
npm install --legacy-peer-deps --force

# Установка проблемных пакетов в правильном порядке
install_package "vite" "^5.4.20"
install_package "@vitejs/plugin-react" "^4.7.0"
install_package "autoprefixer" "^10.4.21"
install_package "postcss" "^8.5.6"
install_package "@tailwindcss/typography" "^0.5.19"

# Создание .env файла
if [ ! -f .env ]; then
    echo "⚙️ Создаем .env файл..."
    cp env.example .env
    echo "⚠️  Не забудьте настроить DATABASE_URL в .env файле!"
fi

# Сборка приложения
echo "🔨 Собираем приложение..."
if npm run build; then
    echo "✅ Приложение собрано успешно"
else
    echo "❌ Ошибка сборки приложения"
    exit 1
fi

# Тестирование
echo "🧪 Тестируем приложение..."
PORT=3000 npm run dev &
APP_PID=$!
sleep 15

if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Приложение работает на http://localhost:3000"
else
    echo "❌ Приложение недоступно"
fi

kill $APP_PID 2>/dev/null || true

echo ""
echo "🎉 Развертывание завершено!"
echo "🌐 Запустите: PORT=3000 npm run dev"
echo "🔧 Или: npm start (для production)"
