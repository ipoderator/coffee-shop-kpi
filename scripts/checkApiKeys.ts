/**
 * Скрипт для проверки всех API ключей в проекте
 * Проверяет наличие, формат и работоспособность ключей
 */

import * as dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Получаем __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config({ path: join(__dirname, '..', '.env') });

interface ApiKeyCheck {
  name: string;
  envVar: string;
  value: string | undefined;
  isValid: boolean;
  error?: string;
  testResult?: 'success' | 'failed' | 'skipped';
  testMessage?: string;
}

const checks: ApiKeyCheck[] = [];

/**
 * Проверка формата API ключа OpenAI
 */
function validateOpenAIKey(key: string | undefined): boolean {
  if (!key) return false;
  return key.startsWith('sk-') && key.length > 20;
}

/**
 * Проверка формата API ключа OpenWeatherMap
 */
function validateOpenWeatherKey(key: string | undefined): boolean {
  if (!key) return false;
  // OpenWeather API ключи обычно 32 символа
  return key.length >= 20;
}

/**
 * Проверка формата API ключа ExchangeRate-API
 */
function validateExchangeRateKey(key: string | undefined): boolean {
  if (!key) return false;
  // ExchangeRate API ключи обычно 32 символа
  return key.length >= 20;
}

/**
 * Проверка формата API ключа Calendarific
 */
function validateCalendarificKey(key: string | undefined): boolean {
  if (!key) return false;
  // Calendarific API ключи обычно 32+ символов
  return key.length >= 20;
}

/**
 * Тест работоспособности OpenWeather API
 */
async function testOpenWeatherAPI(key: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=55.7558&lon=37.6176&appid=${key}&units=metric`,
    );
    
    if (response.status === 401) {
      return { success: false, message: 'Неверный API ключ (401 Unauthorized)' };
    }
    
    if (response.status === 429) {
      return { success: false, message: 'Превышен лимит запросов (429 Too Many Requests)' };
    }
    
    if (!response.ok) {
      return { success: false, message: `Ошибка API: ${response.status} ${response.statusText}` };
    }
    
    const data = await response.json();
    if (data.main && data.weather) {
      return { success: true, message: `✅ Работает! Температура: ${data.main.temp}°C` };
    }
    
    return { success: false, message: 'Неожиданный формат ответа' };
  } catch (error) {
    return { success: false, message: `Ошибка сети: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Тест работоспособности ExchangeRate API
 */
async function testExchangeRateAPI(key: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`https://v6.exchangerate-api.com/v6/${key}/latest/USD`);
    
    if (response.status === 401) {
      return { success: false, message: 'Неверный API ключ (401 Unauthorized)' };
    }
    
    if (response.status === 429) {
      return { success: false, message: 'Превышен лимит запросов (429 Too Many Requests)' };
    }
    
    if (!response.ok) {
      return { success: false, message: `Ошибка API: ${response.status} ${response.statusText}` };
    }
    
    const data = await response.json();
    if (data.conversion_rates && data.conversion_rates.RUB) {
      return { success: true, message: `✅ Работает! USD/RUB: ${data.conversion_rates.RUB}` };
    }
    
    return { success: false, message: 'Неожиданный формат ответа' };
  } catch (error) {
    return { success: false, message: `Ошибка сети: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Тест работоспособности Calendarific API
 */
async function testCalendarificAPI(key: string): Promise<{ success: boolean; message: string }> {
  try {
    const currentYear = new Date().getFullYear();
    const response = await fetch(
      `https://calendarific.com/api/v2/holidays?api_key=${key}&country=RU&year=${currentYear}`,
    );
    
    if (response.status === 401) {
      return { success: false, message: 'Неверный API ключ (401 Unauthorized)' };
    }
    
    if (response.status === 429) {
      return { success: false, message: 'Превышен лимит запросов (429 Too Many Requests)' };
    }
    
    if (!response.ok) {
      return { success: false, message: `Ошибка API: ${response.status} ${response.statusText}` };
    }
    
    const data = await response.json();
    if (data.response && data.response.holidays) {
      return { success: true, message: `✅ Работает! Найдено праздников: ${data.response.holidays.length}` };
    }
    
    return { success: false, message: 'Неожиданный формат ответа' };
  } catch (error) {
    return { success: false, message: `Ошибка сети: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Тест работоспособности OpenAI API
 */
async function testOpenAIAPI(key: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.status === 401) {
      return { success: false, message: 'Неверный API ключ (401 Unauthorized)' };
    }
    
    if (response.status === 429) {
      return { success: false, message: 'Превышен лимит запросов (429 Too Many Requests)' };
    }
    
    if (!response.ok) {
      return { success: false, message: `Ошибка API: ${response.status} ${response.statusText}` };
    }
    
    const data = await response.json();
    if (data.data && Array.isArray(data.data)) {
      return { success: true, message: `✅ Работает! Доступно моделей: ${data.data.length}` };
    }
    
    return { success: false, message: 'Неожиданный формат ответа' };
  } catch (error) {
    return { success: false, message: `Ошибка сети: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Основная функция проверки
 */
async function checkApiKeys() {
  console.log('🔍 Проверка API ключей...\n');
  
  // Проверяем обязательные ключи
  const openWeatherKey = process.env.OPENWEATHER_API_KEY;
  checks.push({
    name: 'OpenWeatherMap',
    envVar: 'OPENWEATHER_API_KEY',
    value: openWeatherKey,
    isValid: validateOpenWeatherKey(openWeatherKey),
  });
  
  const exchangeRateKey = process.env.EXCHANGERATE_API_KEY;
  checks.push({
    name: 'ExchangeRate-API',
    envVar: 'EXCHANGERATE_API_KEY',
    value: exchangeRateKey,
    isValid: validateExchangeRateKey(exchangeRateKey),
  });
  
  const calendarificKey = process.env.CALENDARIFIC_API_KEY;
  checks.push({
    name: 'Calendarific',
    envVar: 'CALENDARIFIC_API_KEY',
    value: calendarificKey,
    isValid: validateCalendarificKey(calendarificKey),
  });
  
  // Проверяем опциональные ключи
  const openAIKey = process.env.OPENAI_API_KEY;
  checks.push({
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    value: openAIKey,
    isValid: validateOpenAIKey(openAIKey),
  });
  
  const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  checks.push({
    name: 'Google Maps',
    envVar: 'GOOGLE_MAPS_API_KEY',
    value: googleMapsKey,
    isValid: !!googleMapsKey && googleMapsKey.length > 20,
  });
  
  const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
  checks.push({
    name: 'Alpha Vantage',
    envVar: 'ALPHA_VANTAGE_API_KEY',
    value: alphaVantageKey,
    isValid: !!alphaVantageKey && alphaVantageKey.length > 20,
  });
  
  const fredKey = process.env.FRED_API_KEY;
  checks.push({
    name: 'FRED',
    envVar: 'FRED_API_KEY',
    value: fredKey,
    isValid: !!fredKey && fredKey.length > 20,
  });
  
  const newsKey = process.env.NEWS_API_KEY;
  checks.push({
    name: 'NewsAPI',
    envVar: 'NEWS_API_KEY',
    value: newsKey,
    isValid: !!newsKey && newsKey.length > 20,
  });
  
  const twitterKey = process.env.TWITTER_API_KEY;
  checks.push({
    name: 'Twitter',
    envVar: 'TWITTER_API_KEY',
    value: twitterKey,
    isValid: !!twitterKey && twitterKey.length > 20,
  });
  
  // Выводим результаты проверки формата
  console.log('📋 Результаты проверки формата:\n');
  checks.forEach((check) => {
    const status = check.isValid ? '✅' : check.value ? '⚠️' : '❌';
    const maskedValue = check.value
      ? check.value.length > 8
        ? `${check.value.substring(0, 4)}...${check.value.substring(check.value.length - 4)}`
        : '***'
      : 'не установлен';
    
    console.log(`${status} ${check.name.padEnd(20)} ${check.envVar.padEnd(30)} ${maskedValue}`);
    
    if (!check.isValid && check.value) {
      console.log(`   ⚠️  Предупреждение: формат ключа может быть неверным`);
    } else if (!check.value) {
      console.log(`   ℹ️  Информация: ключ не установлен (опциональный)`);
    }
  });
  
  // Тестируем работоспособность основных API
  console.log('\n🧪 Тестирование работоспособности API...\n');
  
  for (const check of checks) {
    if (!check.value || !check.isValid) {
      check.testResult = 'skipped';
      check.testMessage = 'Пропущено (ключ не установлен или неверный формат)';
      continue;
    }
    
    console.log(`Тестирование ${check.name}...`);
    
    try {
      let result: { success: boolean; message: string };
      
      switch (check.name) {
        case 'OpenWeatherMap':
          result = await testOpenWeatherAPI(check.value);
          break;
        case 'ExchangeRate-API':
          result = await testExchangeRateAPI(check.value);
          break;
        case 'Calendarific':
          result = await testCalendarificAPI(check.value);
          break;
        case 'OpenAI':
          result = await testOpenAIAPI(check.value);
          break;
        default:
          check.testResult = 'skipped';
          check.testMessage = 'Автоматическое тестирование не поддерживается';
          continue;
      }
      
      check.testResult = result.success ? 'success' : 'failed';
      check.testMessage = result.message;
      
      const icon = result.success ? '✅' : '❌';
      console.log(`   ${icon} ${result.message}\n`);
    } catch (error) {
      check.testResult = 'failed';
      check.testMessage = `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
      console.log(`   ❌ Ошибка: ${check.testMessage}\n`);
    }
  }
  
  // Итоговая сводка
  console.log('\n📊 Итоговая сводка:\n');
  
  const validKeys = checks.filter((c) => c.isValid).length;
  const testedKeys = checks.filter((c) => c.testResult === 'success').length;
  const failedTests = checks.filter((c) => c.testResult === 'failed').length;
  
  console.log(`Всего проверено ключей: ${checks.length}`);
  console.log(`✅ Валидных ключей: ${validKeys}`);
  console.log(`✅ Успешно протестировано: ${testedKeys}`);
  console.log(`❌ Ошибок при тестировании: ${failedTests}`);
  console.log(`⏭️  Пропущено: ${checks.length - validKeys}`);
  
  // Рекомендации
  console.log('\n💡 Рекомендации:\n');
  
  const requiredKeys = ['OPENWEATHER_API_KEY', 'EXCHANGERATE_API_KEY', 'CALENDARIFIC_API_KEY'];
  const missingRequired = requiredKeys.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === '',
  );
  
  if (missingRequired.length > 0) {
    console.log('⚠️  Отсутствуют обязательные ключи:');
    missingRequired.forEach((key) => console.log(`   - ${key}`));
    console.log('   Эти ключи необходимы для работы расширенного прогнозирования.\n');
  }
  
  const failedChecks = checks.filter((c) => c.testResult === 'failed');
  if (failedChecks.length > 0) {
    console.log('❌ Ключи с ошибками при тестировании:');
    failedChecks.forEach((check) => {
      console.log(`   - ${check.name}: ${check.testMessage}`);
    });
    console.log('   Проверьте правильность ключей в файле .env\n');
  }
  
  if (validKeys === checks.length && testedKeys === validKeys) {
    console.log('🎉 Все ключи настроены правильно и работают!');
  }
}

// Запускаем проверку
checkApiKeys().catch((error) => {
  console.error('❌ Ошибка при проверке API ключей:', error);
  process.exit(1);
});

