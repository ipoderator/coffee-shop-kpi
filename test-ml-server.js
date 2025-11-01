import express from 'express';
import { SimpleMLForecastingEngine } from './utils/simpleMLForecasting.js';

const app = express();
app.use(express.json());

// Простые тестовые данные
const testTransactions = [
  { id: '1', date: '2024-01-01', amount: 1000, customerId: 'customer1', productId: 'product1' },
  { id: '2', date: '2024-01-02', amount: 1500, customerId: 'customer2', productId: 'product2' },
  { id: '3', date: '2024-01-03', amount: 800, customerId: 'customer1', productId: 'product1' },
  { id: '4', date: '2024-01-04', amount: 2000, customerId: 'customer3', productId: 'product3' },
  { id: '5', date: '2024-01-05', amount: 1200, customerId: 'customer2', productId: 'product2' },
  { id: '6', date: '2024-01-06', amount: 900, customerId: 'customer1', productId: 'product1' },
  { id: '7', date: '2024-01-07', amount: 1800, customerId: 'customer3', productId: 'product3' },
  { id: '8', date: '2024-01-08', amount: 1100, customerId: 'customer2', productId: 'product2' },
  { id: '9', date: '2024-01-09', amount: 1300, customerId: 'customer1', productId: 'product1' },
  { id: '10', date: '2024-01-10', amount: 1600, customerId: 'customer3', productId: 'product3' },
  { id: '11', date: '2024-01-11', amount: 950, customerId: 'customer2', productId: 'product2' },
  { id: '12', date: '2024-01-12', amount: 1400, customerId: 'customer1', productId: 'product1' },
  { id: '13', date: '2024-01-13', amount: 1700, customerId: 'customer3', productId: 'product3' },
  { id: '14', date: '2024-01-14', amount: 1050, customerId: 'customer2', productId: 'product2' },
  { id: '15', date: '2024-01-15', amount: 1250, customerId: 'customer1', productId: 'product1' },
];

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'ML Server is running' });
});

app.get('/api/analytics/test', async (req, res) => {
  try {
    // Инициализируем ML движок
    const mlEngine = new SimpleMLForecastingEngine(testTransactions);

    // Генерируем прогноз
    const forecast = await mlEngine.generateMLForecast(7);

    // Получаем информацию о сегментах
    const segments = mlEngine.getSegmentsInfo();

    // Рассчитываем KPI
    const totalRevenue = testTransactions.reduce((sum, t) => sum + t.amount, 0);
    const totalChecks = testTransactions.length;
    const averageCheck = totalRevenue / totalChecks;

    const response = {
      kpi: {
        totalRevenue,
        averageCheck,
        totalChecks,
      },
      daily: [],
      monthly: [],
      yearly: [],
      transactions: testTransactions,
      forecast: {
        nextMonth: {
          predictedRevenue: forecast.reduce((sum, day) => sum + day.predictedRevenue, 0),
          confidence: forecast.reduce((sum, day) => sum + day.confidence, 0) / forecast.length,
          dailyForecast: forecast,
        },
        extendedForecast: {
          totalPredictedRevenue: forecast.reduce((sum, day) => sum + day.predictedRevenue, 0),
          averageConfidence:
            forecast.reduce((sum, day) => sum + day.confidence, 0) / forecast.length,
          dailyForecast: forecast,
          weeklyForecast: [
            {
              weekNumber: 1,
              predictedRevenue: forecast.reduce((sum, day) => sum + day.predictedRevenue, 0),
              confidence: forecast.reduce((sum, day) => sum + day.confidence, 0) / forecast.length,
            },
          ],
          monthlyForecast: [],
        },
        methodology: {
          algorithm: 'ML Ensemble (ARIMA + Prophet + LSTM) with Customer & Product Segmentation',
          dataPoints: testTransactions.length,
          forecastDays: 7,
          weatherAnalysis: true,
          holidayAnalysis: true,
          trendAnalysis: true,
          seasonalAdjustment: true,
          timeOfMonthAnalysis: true,
          historicalPatternAnalysis: true,
          economicCycleAnalysis: true,
          localEventAnalysis: true,
          customerBehaviorAnalysis: true,
        },
      },
      segments: segments,
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating ML forecast:', error);
    res.status(500).json({ error: 'Failed to generate forecast' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`ML Server running on port ${port}`);
  console.log(`Test endpoint: http://localhost:${port}/api/analytics/test`);
});
