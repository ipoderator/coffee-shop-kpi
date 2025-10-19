# 🐳 Coffee KPI Dashboard - Docker Deployment

Полное руководство по развертыванию Coffee KPI Dashboard с использованием Docker.

## 🚀 Быстрое развертывание

### Автоматическое развертывание
```bash
# Клонируйте репозиторий
git clone <repository-url>
cd coffee-shop-kpi-main

# Запустите автоматический скрипт развертывания
./deploy.sh
```

### Ручное развертывание
```bash
# Сборка и запуск
docker-compose up -d --build

# Проверка статуса
docker-compose ps

# Просмотр логов
docker-compose logs -f app
```

## 📋 Требования

- Docker 20.10+
- Docker Compose 2.0+
- 2GB RAM
- 5GB свободного места

## 🔧 Конфигурация

### Переменные окружения

Создайте файл `.env` на основе `env.example`:

```env
# Основные настройки
NODE_ENV=production
PORT=5000

# База данных
DATABASE_URL=postgresql://coffee_user:coffee_password@db:5432/coffee_kpi

# Внешние API (опционально)
OPENWEATHER_API_KEY=your_api_key
EXCHANGERATE_API_KEY=your_api_key
CALENDARIFIC_API_KEY=your_api_key
```

### Порты

- **5000** - Основное приложение (Frontend + API)
- **5432** - PostgreSQL база данных

## 🏗️ Архитектура

```
┌─────────────────┐    ┌─────────────────┐
│   Coffee KPI    │    │   PostgreSQL    │
│   Application   │◄──►│   Database      │
│   (Port 5000)   │    │   (Port 5432)   │
└─────────────────┘    └─────────────────┘
```

## 📊 Доступ к приложению

После успешного развертывания:

- **Frontend**: http://localhost:5000
- **API**: http://localhost:5000/api
- **Health Check**: http://localhost:5000/health

## 🛠️ Полезные команды

### Управление контейнерами
```bash
# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Перезапуск
docker-compose restart

# Пересборка
docker-compose up -d --build
```

### Логи и мониторинг
```bash
# Просмотр логов приложения
docker-compose logs -f app

# Просмотр логов базы данных
docker-compose logs -f db

# Статус контейнеров
docker-compose ps

# Использование ресурсов
docker stats
```

### Подключение к контейнерам
```bash
# Подключение к приложению
docker-compose exec app sh

# Подключение к базе данных
docker-compose exec db psql -U coffee_user -d coffee_kpi
```

### Резервное копирование
```bash
# Создание бэкапа базы данных
docker-compose exec db pg_dump -U coffee_user coffee_kpi > backup.sql

# Восстановление из бэкапа
docker-compose exec -T db psql -U coffee_user coffee_kpi < backup.sql
```

## 🔒 Безопасность

### Production настройки
1. Измените пароли в `.env`
2. Используйте сильные JWT секреты
3. Настройте SSL/TLS
4. Ограничьте доступ к портам
5. Регулярно обновляйте образы

### Firewall
```bash
# Разрешить только необходимые порты
sudo ufw allow 5000/tcp
sudo ufw allow 22/tcp  # SSH
sudo ufw enable
```

## 📈 Мониторинг

### Health Checks
```bash
# Проверка здоровья приложения
curl -f http://localhost:5000/ || echo "App is down"

# Проверка базы данных
docker-compose exec db pg_isready -U coffee_user
```

### Логи
```bash
# Настройка ротации логов
echo '{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}' > /etc/docker/daemon.json
```

## 🚨 Troubleshooting

### Проблемы с портами
```bash
# Проверка занятых портов
lsof -i :5000
lsof -i :5432

# Освобождение портов
sudo fuser -k 5000/tcp
sudo fuser -k 5432/tcp
```

### Проблемы с памятью
```bash
# Очистка Docker
docker system prune -a

# Очистка volumes
docker volume prune
```

### Проблемы с базой данных
```bash
# Сброс базы данных
docker-compose down -v
docker-compose up -d

# Проверка подключения
docker-compose exec app npm run db:push
```

## 📝 Обновление

```bash
# Обновление приложения
git pull origin main
./deploy.sh

# Обновление только кода
docker-compose up -d --build app
```

## 🔄 Автоматическое развертывание

### GitHub Actions
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to server
        run: ./deploy.sh
```

## 📞 Поддержка

При возникновении проблем:

1. Проверьте логи: `docker-compose logs -f`
2. Проверьте статус: `docker-compose ps`
3. Проверьте ресурсы: `docker stats`
4. Создайте issue в репозитории

---

**Coffee KPI Dashboard** - Аналитика и прогнозирование для кофейни ☕📊
