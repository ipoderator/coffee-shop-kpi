# 🚀 Руководство по развертыванию Coffee KPI Dashboard

## 📋 Быстрый старт

### 1. Системные требования

- **Node.js**: версия 18+ (рекомендуется 20+)
- **npm**: версия 8+
- **PostgreSQL**: версия 12+ (для production)
- **Память**: минимум 2GB RAM
- **Диск**: минимум 1GB свободного места

### 2. Установка зависимостей

```bash
# Очистка и установка зависимостей
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --legacy-peer-deps --force
```

### 3. Настройка окружения

```bash
# Создание файла окружения
cp env.example .env

# Редактирование .env файла
nano .env
```

**Обязательные настройки в .env:**

```env
# База данных (ОБЯЗАТЕЛЬНО)
DATABASE_URL=postgresql://username:password@localhost:5432/coffee_kpi

# Опционально для расширенного прогнозирования
OPENWEATHER_API_KEY=your_key_here
EXCHANGERATE_API_KEY=your_key_here
CALENDARIFIC_API_KEY=your_key_here
```

### 4. Настройка базы данных

```bash
# Создание базы данных PostgreSQL
createdb coffee_kpi

# Применение миграций
npm run db:push
```

### 5. Запуск приложения

```bash
# Development режим
PORT=3000 npm run dev

# Production режим
npm run build
npm start
```

## 🔧 Решение проблем

### Проблема: "Cannot find package 'vite'"

**Решение:**

```bash
npm install vite@^5.4.20 --save --force
```

### Проблема: "Cannot find package '@vitejs/plugin-react'"

**Решение:**

```bash
npm install "@vitejs/plugin-react@^4.7.0" --save --force
```

### Проблема: "Cannot find module 'autoprefixer'"

**Решение:**

```bash
npm install autoprefixer postcss --save --force
```

### Проблема: "Cannot find module '@tailwindcss/typography'"

**Решение:**

```bash
npm install "@tailwindcss/typography" --save --force
```

### Проблема: Порт 5000 занят

**Решение:**

```bash
# Используйте другой порт
PORT=3000 npm run dev
# или
PORT=8080 npm run dev
```

## 🐳 Docker развертывание

### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Копирование package.json и установка зависимостей
COPY package*.json ./
RUN npm ci --legacy-peer-deps --only=production

# Копирование исходного кода
COPY . .

# Сборка приложения
RUN npm run build

# Открытие порта
EXPOSE 3000

# Запуск приложения
CMD ["npm", "start"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/coffee_kpi
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=coffee_kpi
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - '5432:5432'

volumes:
  postgres_data:
```

### Запуск с Docker

```bash
# Сборка и запуск
docker-compose up --build

# Запуск в фоне
docker-compose up -d --build
```

## 🌐 Production развертывание

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установка PostgreSQL
sudo apt install postgresql postgresql-contrib -y

# Установка PM2 для управления процессами
sudo npm install -g pm2
```

### 2. Настройка базы данных

```bash
# Создание пользователя и базы данных
sudo -u postgres psql
CREATE USER coffee_user WITH PASSWORD 'secure_password';
CREATE DATABASE coffee_kpi OWNER coffee_user;
GRANT ALL PRIVILEGES ON DATABASE coffee_kpi TO coffee_user;
\q
```

### 3. Развертывание приложения

```bash
# Клонирование репозитория
git clone <your-repo-url>
cd coffee-shop-kpi

# Установка зависимостей
npm install --legacy-peer-deps --force

# Настройка окружения
cp env.example .env
nano .env

# Применение миграций
npm run db:push

# Сборка приложения
npm run build

# Запуск с PM2
pm2 start npm --name "coffee-kpi" -- start
pm2 save
pm2 startup
```

### 4. Настройка Nginx (опционально)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🔍 Мониторинг и логи

### PM2 команды

```bash
# Просмотр статуса
pm2 status

# Просмотр логов
pm2 logs coffee-kpi

# Перезапуск
pm2 restart coffee-kpi

# Остановка
pm2 stop coffee-kpi
```

### Логи приложения

```bash
# Логи сервера
tail -f logs/server.log

# Логи ошибок
tail -f logs/error.log
```

## 🛠️ Скрипты для автоматизации

### deploy.sh

```bash
#!/bin/bash
set -e

echo "🚀 Начинаем развертывание Coffee KPI Dashboard..."

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен"
    exit 1
fi

# Проверка npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm не установлен"
    exit 1
fi

# Очистка и установка зависимостей
echo "📦 Устанавливаем зависимости..."
rm -rf node_modules package-lock.json
npm cache clean --force
npm install --legacy-peer-deps --force

# Проверка .env файла
if [ ! -f .env ]; then
    echo "⚙️ Создаем .env файл..."
    cp env.example .env
    echo "⚠️  Не забудьте настроить DATABASE_URL в .env файле!"
fi

# Сборка приложения
echo "🔨 Собираем приложение..."
npm run build

echo "✅ Развертывание завершено!"
echo "🌐 Запустите приложение: npm start"
echo "🔧 Или в dev режиме: PORT=3000 npm run dev"
```

### health-check.sh

```bash
#!/bin/bash

# Проверка доступности приложения
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo "✅ Приложение работает"
    exit 0
else
    echo "❌ Приложение недоступно"
    exit 1
fi
```

## 📝 Чек-лист развертывания

- [ ] Node.js 18+ установлен
- [ ] npm установлен
- [ ] PostgreSQL установлен и запущен
- [ ] База данных `coffee_kpi` создана
- [ ] Файл `.env` настроен
- [ ] Зависимости установлены (`npm install --legacy-peer-deps --force`)
- [ ] Миграции применены (`npm run db:push`)
- [ ] Приложение собрано (`npm run build`)
- [ ] Приложение запущено (`npm start`)
- [ ] Приложение доступно по http://localhost:3000

## 🆘 Поддержка

При возникновении проблем:

1. Проверьте логи: `pm2 logs coffee-kpi`
2. Проверьте статус: `pm2 status`
3. Перезапустите: `pm2 restart coffee-kpi`
4. Проверьте порты: `netstat -tulpn | grep :3000`
5. Проверьте базу данных: `psql -U coffee_user -d coffee_kpi`

## 📞 Контакты

- GitHub Issues: [Создать issue]
- Email: support@example.com
- Документация: [Ссылка на документацию]
