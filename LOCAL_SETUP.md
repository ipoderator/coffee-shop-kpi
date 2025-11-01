# Локальная установка и запуск проекта

Это руководство поможет вам развернуть проект на локальном сервере.

## Предварительные требования

Убедитесь, что у вас установлено:

- **Node.js** версии 18 или выше ([скачать](https://nodejs.org/))
- **PostgreSQL** версии 14 или выше ([скачать](https://www.postgresql.org/download/))
- **npm** или **yarn** (устанавливается вместе с Node.js)

Проверьте установку:

```bash
node --version    # должно быть v18.0.0 или выше
npm --version     # должно быть 9.0.0 или выше
psql --version    # должно быть 14.0 или выше
```

## Шаг 1: Установка PostgreSQL

### Windows

1. Скачайте PostgreSQL с [официального сайта](https://www.postgresql.org/download/windows/)
2. Запустите установщик
3. Запомните пароль для пользователя `postgres`
4. По умолчанию PostgreSQL запустится на порту `5432`

### macOS

```bash
# Установка через Homebrew
brew install postgresql@14
brew services start postgresql@14
```

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

## Шаг 2: Создание базы данных

Откройте терминал и выполните:

```bash
# Войдите в PostgreSQL (пароль по умолчанию: postgres)
psql -U postgres

# Создайте базу данных
CREATE DATABASE coffee_kpi;

# Выйдите из psql
\q
```

## Шаг 3: Скачивание и распаковка проекта

1. Скачайте архив проекта
2. Распакуйте в удобную папку, например:
   - Windows: `C:\Projects\coffee-kpi`
   - macOS/Linux: `~/projects/coffee-kpi`

## Шаг 4: Установка зависимостей

Откройте терминал в папке проекта и выполните:

```bash
cd путь/к/проекту/coffee-kpi
npm install
```

Установка может занять 2-5 минут. Дождитесь сообщения об успешной установке.

## Шаг 5: Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS/Linux
cp .env.example .env
```

Откройте `.env` в текстовом редакторе и измените строку:

```env
DATABASE_URL=postgresql://postgres:ВАШ_ПАРОЛЬ@localhost:5432/coffee_kpi
```

Замените `ВАШ_ПАРОЛЬ` на пароль, который вы установили для PostgreSQL.

**Пример:**

```env
DATABASE_URL=postgresql://postgres:mypassword123@localhost:5432/coffee_kpi
```

## Шаг 6: Применение миграций базы данных

Создайте структуру таблиц в базе данных:

```bash
npm run db:push
```

Вы должны увидеть сообщение: `Changes applied`

## Шаг 7: Запуск проекта

Запустите приложение в режиме разработки:

```bash
npm run dev
```

Вы увидите сообщение:

```
serving on port 5000
```

## Шаг 8: Открытие приложения

Откройте браузер и перейдите по адресу:

```
http://localhost:5000
```

Приложение готово к использованию! 🎉

## Возможные проблемы и решения

### Ошибка: "PORT 5000 уже используется"

**Решение:**

1. Найдите процесс, использующий порт 5000:

   ```bash
   # Windows
   netstat -ano | findstr :5000

   # macOS/Linux
   lsof -i :5000
   ```

2. Остановите процесс или измените порт в `.env`:
   ```env
   PORT=3000
   ```

### Ошибка: "Cannot connect to database"

**Решение:**

1. Проверьте, что PostgreSQL запущен:

   ```bash
   # Windows
   services.msc  # найдите postgresql-x64-14

   # macOS
   brew services list

   # Linux
   sudo systemctl status postgresql
   ```

2. Проверьте правильность `DATABASE_URL` в `.env`
3. Проверьте, что база данных создана: `psql -U postgres -l`

### Ошибка: "Module not found"

**Решение:**

1. Удалите папки `node_modules` и файл `package-lock.json`
2. Переустановите зависимости:
   ```bash
   npm install
   ```

### Ошибка: "tsx: not found" или "Command not found"

**Решение:**

1. Убедитесь, что установка npm завершилась успешно
2. Попробуйте переустановить зависимости:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

## Тестирование приложения

1. Откройте приложение в браузере: `http://localhost:5000`
2. Нажмите на кнопку загрузки файла
3. Загрузите тестовый Excel файл из папки `attached_assets/`
4. Проверьте, что данные отображаются корректно
5. Переключайтесь между вкладками: Прогноз, Аналитика, Инсайты

## Остановка приложения

Для остановки сервера нажмите `Ctrl+C` в терминале.

## Запуск в production режиме

Для production сборки выполните:

```bash
# Создание production сборки
npm run build

# Запуск production версии
npm start
```

## Работа в Cursor IDE

1. Откройте папку проекта в Cursor
2. Cursor автоматически распознает `.cursorrules` файл
3. Используйте Cmd+K (Mac) или Ctrl+K (Win) для AI помощи
4. AI будет следовать правилам проекта при генерации кода

## Полезные команды

```bash
# Проверка TypeScript ошибок
npm run check

# Просмотр структуры БД
psql -U postgres -d coffee_kpi -c "\dt"

# Просмотр данных в таблице
psql -U postgres -d coffee_kpi -c "SELECT * FROM transactions LIMIT 5;"

# Очистка данных
psql -U postgres -d coffee_kpi -c "TRUNCATE TABLE transactions CASCADE;"
```

## Дополнительные настройки (опционально)

### Внешние API для расширенного прогнозирования

Для повышения точности ML-прогнозов можно настроить внешние API:

1. **OpenWeatherMap** (бесплатно 1000 запросов/день):
   - Зарегистрируйтесь на https://openweathermap.org/api
   - Получите API ключ
   - Добавьте в `.env`: `OPENWEATHER_API_KEY=ваш_ключ`

2. **ExchangeRate-API** (бесплатно 1500 запросов/месяц):
   - Зарегистрируйтесь на https://www.exchangerate-api.com/
   - Получите API ключ
   - Добавьте в `.env`: `EXCHANGERATE_API_KEY=ваш_ключ`

**Важно:** Приложение работает и без этих ключей, но прогнозы будут менее точными.

## Структура проекта

```
coffee-kpi/
├── client/              # Frontend React приложение
│   ├── src/
│   │   ├── components/  # UI компоненты
│   │   ├── pages/       # Страницы
│   │   └── lib/         # Утилиты
│   └── index.html
├── server/              # Backend Express сервер
│   ├── routes.ts        # API endpoints
│   ├── storage.ts       # Работа с БД
│   └── utils/           # Утилиты
├── shared/              # Общие типы TypeScript
│   └── schema.ts        # Схемы БД и типы
├── attached_assets/     # Тестовые файлы
├── .env                 # Переменные окружения (создать)
├── .env.example         # Пример переменных
├── package.json         # Зависимости проекта
└── README.md            # Документация
```

## Поддержка

Если у вас возникли проблемы:

1. Проверьте, что все команды выполнились без ошибок
2. Проверьте логи в терминале
3. Проверьте консоль браузера (F12)
4. Убедитесь, что PostgreSQL запущен
5. Проверьте правильность `.env` файла

Удачи! 🚀
