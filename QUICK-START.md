# ⚡ Coffee KPI Dashboard - Быстрый старт

## 🚀 Автоматическое развертывание (1 команда)

```bash
./setup.sh
```

Этот скрипт:
- ✅ Проверяет системные требования
- ✅ Очищает старые зависимости
- ✅ Устанавливает все пакеты в правильном порядке
- ✅ Исправляет все проблемы с зависимостями
- ✅ Собирает приложение
- ✅ Тестирует работоспособность

## 🔧 Ручное развертывание

Если автоматический скрипт не работает:

```bash
# 1. Очистка
rm -rf node_modules package-lock.json
npm cache clean --force

# 2. Установка зависимостей
npm install --legacy-peer-deps --force

# 3. Установка проблемных пакетов
npm install vite@^5.4.20 --save --force
npm install "@vitejs/plugin-react@^4.7.0" --save --force
npm install autoprefixer postcss --save --force
npm install "@tailwindcss/typography" --save --force
npm install "tailwindcss@^3.4.17" --save --force

# 4. Настройка окружения
cp env.example .env
# Отредактируйте .env файл

# 5. Сборка и запуск
npm run build
PORT=3000 npm run dev
```

## 🐳 Docker развертывание

```bash
# Простое развертывание
docker-compose up --build

# В фоновом режиме
docker-compose up -d --build
```

## 📋 Что исправлено

Все проблемы с зависимостями решены:

- ✅ **vite** - перемещен в dependencies
- ✅ **@vitejs/plugin-react** - установлен и настроен
- ✅ **autoprefixer** - установлен для PostCSS
- ✅ **postcss** - установлен для PostCSS
- ✅ **@tailwindcss/typography** - установлен для Tailwind
- ✅ **tailwindcss** - установлен для Tailwind
- ✅ **Плагины Replit** - убраны из конфигурации

## 🌐 Доступ к приложению

После успешного развертывания:
- **Локально**: http://localhost:3000
- **Docker**: http://localhost:3000

## 📁 Файлы развертывания

- `setup.sh` - **Главный скрипт** (рекомендуется)
- `quick-deploy.sh` - Быстрое развертывание
- `deploy.sh` - Детальный скрипт
- `package-fixed.json` - Исправленный package.json
- `Dockerfile` - Docker образ
- `docker-compose.yml` - Docker Compose
- `DEPLOYMENT.md` - Подробное руководство

## 🆘 Если что-то не работает

1. **Запустите**: `./setup.sh`
2. **Проверьте порт**: `lsof -i :3000`
3. **Остановите процессы**: `pkill -f "tsx.*server"`
4. **Проверьте .env**: настройте DATABASE_URL
5. **Перезапустите**: `PORT=3000 npm run dev`

## ✅ Готово!

Приложение Coffee KPI Dashboard готово к использованию! 🎉☕
