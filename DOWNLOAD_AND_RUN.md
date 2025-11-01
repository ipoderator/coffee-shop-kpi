# Быстрый старт: Скачать и запустить

## Для Windows

1. **Скачайте и установите зависимости:**
   - Node.js 18+: https://nodejs.org/ (выберите LTS версию)
   - PostgreSQL 14+: https://www.postgresql.org/download/windows/
2. **Установите PostgreSQL:**
   - Запустите установщик
   - Запомните пароль для пользователя `postgres`
   - Оставьте порт по умолчанию: 5432
3. **Создайте базу данных:**
   - Откройте командную строку (Win+R, введите `cmd`)
   - Выполните:
     ```cmd
     psql -U postgres
     ```
   - Введите пароль postgres
   - Создайте БД:
     ```sql
     CREATE DATABASE coffee_kpi;
     \q
     ```

4. **Скачайте и распакуйте проект:**
   - Распакуйте архив в папку, например: `C:\coffee-kpi`

5. **Настройте проект:**
   - Откройте командную строку в папке проекта
   - Скопируйте файл с переменными:
     ```cmd
     copy .env.example .env
     ```
   - Откройте `.env` в Блокноте и измените строку:
     ```
     DATABASE_URL=postgresql://postgres:ВАШ_ПАРОЛЬ@localhost:5432/coffee_kpi
     ```

6. **Установите зависимости:**

   ```cmd
   npm install
   ```

7. **Примените миграции:**

   ```cmd
   npm run db:push
   ```

8. **Запустите приложение:**

   ```cmd
   npm run dev
   ```

9. **Откройте браузер:**
   ```
   http://localhost:5000
   ```

## Для macOS

1. **Установите Homebrew (если еще не установлен):**

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Установите зависимости:**

   ```bash
   brew install node@18 postgresql@14
   ```

3. **Запустите PostgreSQL:**

   ```bash
   brew services start postgresql@14
   ```

4. **Создайте базу данных:**

   ```bash
   createdb coffee_kpi
   ```

5. **Распакуйте проект:**
   - Распакуйте архив в папку, например: `~/coffee-kpi`

6. **Настройте проект:**

   ```bash
   cd ~/coffee-kpi
   cp .env.example .env
   ```

   - Откройте `.env` и измените:
     ```
     DATABASE_URL=postgresql://localhost:5432/coffee_kpi
     ```

7. **Установите зависимости:**

   ```bash
   npm install
   ```

8. **Примените миграции:**

   ```bash
   npm run db:push
   ```

9. **Запустите приложение:**

   ```bash
   npm run dev
   ```

10. **Откройте браузер:**
    ```
    http://localhost:5000
    ```

## Для Linux (Ubuntu/Debian)

1. **Установите зависимости:**

   ```bash
   # Node.js 18
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # PostgreSQL
   sudo apt update
   sudo apt install postgresql postgresql-contrib
   ```

2. **Создайте пользователя и базу данных:**

   ```bash
   sudo -u postgres psql
   ```

   ```sql
   CREATE USER myuser WITH PASSWORD 'mypassword';
   CREATE DATABASE coffee_kpi OWNER myuser;
   \q
   ```

3. **Распакуйте проект:**

   ```bash
   cd ~
   unzip coffee-kpi.zip
   cd coffee-kpi
   ```

4. **Настройте проект:**

   ```bash
   cp .env.example .env
   nano .env
   ```

   - Измените строку:
     ```
     DATABASE_URL=postgresql://myuser:mypassword@localhost:5432/coffee_kpi
     ```

5. **Установите зависимости:**

   ```bash
   npm install
   ```

6. **Примените миграции:**

   ```bash
   npm run db:push
   ```

7. **Запустите приложение:**

   ```bash
   npm run dev
   ```

8. **Откройте браузер:**
   ```
   http://localhost:5000
   ```

## Проверка установки

После запуска вы должны увидеть:

```
serving on port 5000
```

Если возникли проблемы, смотрите файл `LOCAL_SETUP.md` для подробных инструкций.

## Первое использование

1. Откройте http://localhost:5000 в браузере
2. Нажмите кнопку "Загрузить файл"
3. Выберите Excel файл с данными о продажах из папки `attached_assets/`
4. Изучите дашборд с аналитикой и прогнозами

## Остановка приложения

Нажмите `Ctrl+C` в терминале где запущен `npm run dev`

## Полезные команды

```bash
# Запуск приложения
npm run dev

# Остановка: Ctrl+C

# Перезапуск: остановите и запустите снова
npm run dev

# Проверка типов
npm run check

# Production сборка
npm run build
npm start
```

Готово! Приложение работает на вашем компьютере. 🎉
