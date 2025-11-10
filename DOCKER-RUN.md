# Запуск Coffee KPI Dashboard через Docker

Это руководство поможет вам запустить приложение Coffee KPI Dashboard в Docker контейнере.

## Требования

- Docker версии 20.10 или выше
- Docker Compose версии 2.0 или выше
- Минимум 2GB свободной оперативной памяти
- Минимум 5GB свободного места на диске

## Быстрый старт

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd coffee-shop-kpi
```

### 2. Настройка переменных окружения

Создайте файл `.env` на основе `env.example`:

```bash
cp env.example .env
```

Отредактируйте `.env` и укажите необходимые переменные:

```env
# Обязательные переменные
DATABASE_URL=postgresql://coffee_user:coffee_password@db:5432/coffee_kpi

# Опциональные переменные для расширенного прогнозирования
OPENWEATHER_API_KEY=your_key_here
EXCHANGERATE_API_KEY=your_key_here
CALENDARIFIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
```

**Примечание:** Если вы используете `docker-compose.yml`, переменные БД уже настроены по умолчанию. Для внешних API ключей вы можете либо:
- Добавить их в `.env` файл и использовать `${VARIABLE_NAME}` в `docker-compose.yml`
- Или напрямую указать в секции `environment` в `docker-compose.yml`

### 3. Запуск приложения

#### Вариант A: Использование Docker Compose (рекомендуется)

```bash
# Сборка и запуск всех сервисов (приложение + база данных)
docker-compose up -d

# Просмотр логов
docker-compose logs -f app

# Остановка
docker-compose down

# Остановка с удалением volumes (удалит данные БД!)
docker-compose down -v
```

#### Вариант B: Использование только Dockerfile

Если у вас уже есть база данных PostgreSQL:

```bash
# Сборка образа
docker build -t coffee-kpi:latest .

# Запуск контейнера
docker run -d \
  --name coffee-kpi-app \
  -p 5001:5001 \
  -e DATABASE_URL=postgresql://user:password@host:5432/database \
  -e NODE_ENV=production \
  -e PORT=5001 \
  -v $(pwd)/logs:/app/logs \
  coffee-kpi:latest
```

### 4. Проверка работы

После запуска приложение будет доступно по адресу:
- **HTTP:** http://localhost:5001

Откройте браузер и перейдите по этому адресу. Вы должны увидеть интерфейс Coffee KPI Dashboard.

## Режим разработки с Hot Reload

Для разработки с автоматическим применением изменений без пересборки контейнера:

```bash
# Запуск в режиме разработки
./docker-dev.sh

# Или вручную:
docker-compose -f docker-compose.dev.yml up -d --build
```

В режиме разработки:
- ✅ **Hot Reload включен** - изменения в коде применяются автоматически
- ✅ **Порт:** 5001
- ✅ **Не требуется пересборка** при изменении кода
- ✅ **Отдельная БД** для разработки (не конфликтует с production)

Изменения в файлах `client/`, `server/`, `shared/` применяются автоматически благодаря volumes.

## Структура Docker Compose

Docker Compose файл включает следующие сервисы:

1. **app** - основное приложение (Node.js + Express)
2. **db** - база данных PostgreSQL 15
3. **nginx** (опционально) - reverse proxy для production (профиль `production`)
4. **redis** (опционально) - кеширование для production (профиль `production`)

### Запуск с дополнительными сервисами

Для запуска с Nginx и Redis:

```bash
docker-compose --profile production up -d
```

## Управление контейнерами

### Просмотр статуса

```bash
docker-compose ps
```

### Просмотр логов

```bash
# Все сервисы
docker-compose logs -f

# Только приложение
docker-compose logs -f app

# Только база данных
docker-compose logs -f db
```

### Перезапуск

```bash
# Перезапуск всех сервисов
docker-compose restart

# Перезапуск только приложения
docker-compose restart app
```

### Остановка

```bash
# Остановка без удаления контейнеров
docker-compose stop

# Остановка с удалением контейнеров
docker-compose down

# Остановка с удалением контейнеров и volumes (удалит данные БД!)
docker-compose down -v
```

## Миграции базы данных

Миграции базы данных применяются автоматически при старте контейнера через `docker-entrypoint.sh`.

Если нужно применить миграции вручную:

```bash
# Войти в контейнер
docker-compose exec app sh

# Применить миграции
npm run db:push
```

## Обновление приложения

### Обновление кода

```bash
# Остановить контейнеры
docker-compose down

# Получить последние изменения
git pull

# Пересобрать и запустить
docker-compose up -d --build
```

### Обновление зависимостей

```bash
# Остановить контейнеры
docker-compose down

# Пересобрать образ (заново установит зависимости)
docker-compose build --no-cache

# Запустить
docker-compose up -d
```

## Резервное копирование базы данных

### Создание бэкапа

```bash
# Создать бэкап
docker-compose exec db pg_dump -U coffee_user coffee_kpi > backup_$(date +%Y%m%d_%H%M%S).sql

# Или через docker exec
docker exec coffee-kpi-db pg_dump -U coffee_user coffee_kpi > backup.sql
```

### Восстановление из бэкапа

```bash
# Остановить приложение
docker-compose stop app

# Восстановить данные
docker-compose exec -T db psql -U coffee_user coffee_kpi < backup.sql

# Запустить приложение
docker-compose start app
```

## Решение проблем

### Контейнер не запускается

1. Проверьте логи:
   ```bash
   docker-compose logs app
   ```

2. Проверьте, что порт 5001 не занят:
   ```bash
   # Linux/Mac
   lsof -i :5001
   
   # Windows
   netstat -ano | findstr :5001
   ```

3. Проверьте переменные окружения:
   ```bash
   docker-compose config
   ```

### База данных не подключается

1. Проверьте, что контейнер БД запущен:
   ```bash
   docker-compose ps db
   ```

2. Проверьте логи БД:
   ```bash
   docker-compose logs db
   ```

3. Проверьте переменную `DATABASE_URL` в `docker-compose.yml`

### Миграции не применяются

1. Проверьте логи при старте:
   ```bash
   docker-compose logs app | grep -i migration
   ```

2. Примените миграции вручную:
   ```bash
   docker-compose exec app npm run db:push
   ```

### Проблемы с правами доступа

Если возникают проблемы с правами доступа к файлам:

```bash
# Изменить владельца директории logs
sudo chown -R $USER:$USER logs/

# Или дать права на запись
chmod -R 755 logs/
```

## Production настройки

### Безопасность

1. **Измените пароли БД** в `docker-compose.yml`:
   ```yaml
   environment:
     POSTGRES_PASSWORD=your_strong_password_here
   ```

2. **Используйте секреты** для API ключей:
   ```yaml
   environment:
     - OPENAI_API_KEY_FILE=/run/secrets/openai_api_key
   secrets:
     - openai_api_key
   ```

3. **Настройте SSL** через Nginx (профиль `production`)

### Производительность

1. **Ограничьте ресурсы** контейнеров:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

2. **Используйте Redis** для кеширования (профиль `production`)

3. **Настройте логирование** для production

## Дополнительная информация

- [Основная документация](README.md)
- [Документация по развертыванию](DEPLOYMENT.md)
- [Настройка внешних API](EXTERNAL_DATA_INTEGRATION.md)

## Поддержка

При возникновении проблем:
1. Проверьте логи: `docker-compose logs`
2. Проверьте статус контейнеров: `docker-compose ps`
3. Убедитесь, что все переменные окружения установлены правильно

