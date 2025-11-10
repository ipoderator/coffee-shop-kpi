<!-- f898dfea-f509-4ef8-ab3a-edb433677b09 1855b62a-d732-4475-8574-fa54b59bafb0 -->
# План: Кеширование и персистентное хранение ML моделей

## Текущее состояние

- ARIMA модель уже имеет in-memory кеширование через `modelCache`
- Другие модели (Prophet, LSTM, GRU, RandomForest, XGBoost, GradientBoosting, NHITS) не используют кеширование
- Кеш хранится только в памяти и теряется при перезапуске сервера
- Нет персистентного хранения моделей в БД

## Задачи

### 1. Расширение кеширования для всех моделей

**Файлы:** `server/utils/enhancedMLForecasting.ts`

- Добавить использование `getCachedModel()` и `saveModelToCache()` для всех моделей:
  - `prophetPredict()` - кешировать параметры сезонности, тренда, changepoints
  - `lstmPredict()` - кешировать веса LSTM (`lstmWeights`)
  - `gruPredict()` - кешировать веса GRU (`gruWeights`)
  - `randomForestPredict()` - кешировать деревья (`trees`)
  - `xgboostPredict()` - кешировать параметры XGBoost (`model`)
  - `gradientBoostingPredict()` - кешировать параметры GradientBoosting
  - `nhitsPredict()` - кешировать параметры NHITS (если используется)

**Изменения:**

- В каждом методе `*Predict()` добавить проверку кеша перед обучением
- Сохранять параметры модели в кеш после обучения
- Использовать `computeDataHash()` для генерации ключа кеша

### 2. Создание таблицы для персистентного хранения моделей

**Файлы:** `shared/schema.ts`

Создать новую таблицу `ml_models`:

```typescript
export const mlModels = pgTable('ml_models', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  modelName: varchar('model_name').notNull(), // ARIMA, Prophet, LSTM, GRU, etc.
  uploadId: varchar('upload_id').notNull(), // Связь с данными
  dataHash: varchar('data_hash').notNull(), // Хеш данных для проверки актуальности
  parameters: jsonb('parameters').notNull(), // Сериализованные параметры модели
  dataLength: integer('data_length').notNull(), // Количество точек данных
  lastDataDate: timestamp('last_data_date'), // Дата последней точки данных
  trainedAt: timestamp('trained_at').defaultNow().notNull(),
  lastUsedAt: timestamp('last_used_at').defaultNow().notNull(),
  version: integer('version').default(1), // Версия модели для миграций
  supportsIncremental: boolean('supports_incremental').default(false), // Поддержка инкрементального обучения
});
```

### 3. Реализация методов работы с БД для моделей

**Файлы:** `server/storage.ts`

Добавить методы в интерфейс `IStorage`:

- `saveMLModel(model: InsertMLModel): Promise<MLModel>` - сохранение модели
- `getMLModel(modelName: string, uploadId: string, dataHash: string): Promise<MLModel | null>` - получение модели
- `updateMLModelLastUsed(id: string): Promise<void>` - обновление времени использования
- `deleteOldMLModels(olderThanDays: number): Promise<void>` - удаление старых моделей
- `getMLModelsByUploadId(uploadId: string): Promise<MLModel[]>` - получение всех моделей для uploadId

Реализовать эти методы в `PostgresStorage`.

### 4. Интеграция персистентного кеша в EnhancedMLForecastingEngine

**Файлы:** `server/utils/enhancedMLForecasting.ts`

- Добавить загрузку моделей из БД при инициализации (если `uploadId` предоставлен)
- Модифицировать `getCachedModel()` для проверки БД, если модель не найдена в памяти
- Модифицировать `saveModelToCache()` для сохранения в БД
- Добавить метод `loadModelsFromDB()` для загрузки моделей при старте
- Добавить метод `saveModelToDB()` для сохранения модели в БД

### 5. Реализация инкрементального обучения

**Файлы:** `server/utils/enhancedMLForecasting.ts`

Для моделей, поддерживающих инкрементальное обучение:

- **LSTM/GRU**: Добавить метод `incrementalTrainLSTM()` / `incrementalTrainGRU()` для дообучения на новых данных
- **RandomForest/XGBoost**: Добавить метод `incrementalTrainRandomForest()` / `incrementalTrainXGBoost()` для добавления новых деревьев/итераций
- **ARIMA**: Уже частично поддерживает через кеширование параметров

Логика:

- При наличии кешированной модели и новых данных проверять, можно ли использовать инкрементальное обучение
- Если данных немного (например, < 10% от исходного объема), использовать инкрементальное обучение
- Если данных много или модель устарела, переобучать полностью

### 6. Обновление методов обучения моделей

**Файлы:** `server/utils/enhancedMLForecasting.ts`

Для каждой модели:

- Извлекать параметры из кеша/БД перед обучением
- Сохранять параметры после обучения
- Добавлять флаг `supportsIncremental` в метаданные модели

## Порядок реализации

1. Создать схему БД (`ml_models` таблица)
2. Добавить методы в `IStorage` и `PostgresStorage`
3. Расширить кеширование для всех моделей (in-memory)
4. Интегрировать персистентное хранение в БД
5. Реализовать инкрементальное обучение для поддерживающих моделей
6. Добавить миграцию БД

## Технические детали

- **Формат хранения параметров**: JSONB для гибкости
- **Хеширование данных**: Использовать существующий `computeDataHash()`
- **Очистка старых моделей**: Автоматическая очистка моделей старше 30 дней
- **Версионирование**: Версия модели для будущих миграций формата параметров
- **Инкрементальное обучение**: Только для моделей с флагом `supportsIncremental: true`

### To-dos

- [ ] Создать таблицу ml_models в shared/schema.ts с полями для хранения моделей (modelName, uploadId, dataHash, parameters, trainedAt, supportsIncremental и т.д.)
- [ ] Добавить методы работы с моделями в IStorage интерфейс и реализовать их в PostgresStorage (saveMLModel, getMLModel, updateMLModelLastUsed, deleteOldMLModels)
- [ ] Добавить кеширование для Prophet модели: проверка кеша перед обучением, сохранение параметров (сезонность, тренд, changepoints) после обучения
- [ ] Добавить кеширование для LSTM и GRU моделей: проверка кеша перед обучением, сохранение весов (lstmWeights, gruWeights) после обучения
- [ ] Добавить кеширование для RandomForest, XGBoost, GradientBoosting: проверка кеша перед обучением, сохранение деревьев/параметров после обучения
- [ ] Интегрировать персистентное хранение в EnhancedMLForecastingEngine: загрузка моделей из БД при инициализации, сохранение в БД при обучении, проверка БД в getCachedModel()
- [ ] Реализовать инкрементальное обучение для LSTM и GRU: метод incrementalTrainLSTM/GRU для дообучения на новых данных без полного переобучения
- [ ] Реализовать инкрементальное обучение для RandomForest и XGBoost: методы для добавления новых деревьев/итераций без полного переобучения
- [ ] Добавить версионирование моделей и логику миграции формата параметров при изменении версии
- [ ] Добавить автоматическую очистку старых моделей (старше 30 дней) при сохранении новых моделей