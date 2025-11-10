# Coffee KPI Dashboard - Dockerfile
# Многоэтапная сборка для оптимизации размера образа

# Этап 1: Сборка приложения
FROM node:20-alpine AS builder

# Установка системных зависимостей
RUN apk add --no-cache python3 make g++

# Создание рабочей директории
WORKDIR /app

# Копирование файлов зависимостей
COPY package*.json ./
COPY env.example ./

# Установка всех зависимостей (включая dev для сборки)
RUN npm ci --legacy-peer-deps && \
    npm cache clean --force

# Копирование исходного кода
COPY . .

# Сборка приложения
RUN npm run build

# Этап 2: Production образ
FROM node:20-alpine AS production

# Установка системных зависимостей
RUN apk add --no-cache \
    postgresql-client \
    curl \
    bash \
    && rm -rf /var/cache/apk/*

# Создание пользователя для безопасности
RUN addgroup -g 1001 -S nodejs && \
    adduser -S coffee -u 1001

# Создание рабочей директории
WORKDIR /app

# Копирование package.json и установка зависимостей (включая drizzle-kit для миграций)
COPY package*.json ./
RUN npm ci --legacy-peer-deps && \
    npm cache clean --force

# Копирование собранного приложения из builder этапа
COPY --from=builder --chown=coffee:nodejs /app/dist ./dist
COPY --from=builder --chown=coffee:nodejs /app/shared ./shared
COPY --from=builder --chown=coffee:nodejs /app/server ./server

# Копирование конфигурационных файлов
COPY --from=builder --chown=coffee:nodejs /app/vite.config.ts ./
COPY --from=builder --chown=coffee:nodejs /app/tailwind.config.ts ./
COPY --from=builder --chown=coffee:nodejs /app/tsconfig.json ./
COPY --from=builder --chown=coffee:nodejs /app/postcss.config.js ./
COPY --from=builder --chown=coffee:nodejs /app/drizzle.config.ts ./

# Копирование скрипта запуска
COPY --from=builder --chown=coffee:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Создание директории для логов
RUN mkdir -p /app/logs && chown coffee:nodejs /app/logs

# Переключение на непривилегированного пользователя
USER coffee

# Открытие порта
EXPOSE 5001

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=5001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5001/ || exit 1

# Использование entrypoint скрипта
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
