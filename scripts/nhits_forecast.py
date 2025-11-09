#!/usr/bin/env python3
"""
N-HITS модель прогнозирования временных рядов
Использует библиотеку neuralforecast для прогнозирования выручки
"""
import sys
import json
import numpy as np
from datetime import datetime
from typing import List, Dict

try:
    from neuralforecast import NeuralForecast
    from neuralforecast.models import NHITS
    import pandas as pd
except ImportError as e:
    error_msg = f"Import error: {str(e)}"
    error_result = {"success": False, "error": error_msg, "predictions": []}
    print(json.dumps(error_result), file=sys.stderr)
    print(json.dumps(error_result))
    sys.exit(1)


def prepare_data(data: List[Dict]) -> pd.DataFrame:
    """Подготовка данных для N-HITS"""
    df = pd.DataFrame(data)

    # Преобразуем дату
    df['ds'] = pd.to_datetime(df['date'])
    
    # Создаем уникальный ID для временного ряда (все данные относятся к одному ряду)
    df['unique_id'] = 'revenue'
    
    # Переименовываем revenue в y (стандартное имя для neuralforecast)
    df['y'] = df['revenue'].astype(float)
    
    # Сортируем по дате
    df = df.sort_values('ds')
    
    # Выбираем только нужные колонки
    return df[['unique_id', 'ds', 'y']]

def forecast(data: List[Dict], horizon: int = 7) -> List[float]:
    """
    Прогнозирование с помощью N-HITS
    
    Args:
        data: Список словарей с ключами 'date' и 'revenue'
        horizon: Количество дней для прогноза
    
    Returns:
        Список прогнозируемых значений
    """
    try:
        # Подготовка данных
        df = prepare_data(data)
        
        if len(df) < 14:
            # Если данных недостаточно, используем простое среднее
            avg = df['y'].mean()
            return [float(avg)] * horizon
        
        # Создаем модель N-HITS
        # Параметры оптимизированы для краткосрочных прогнозов выручки
        model = NHITS(
            h=horizon,  # Горизонт прогноза
            input_size=min(28, len(df) - 1),  # Размер входного окна
            max_steps=100,  # Максимум шагов обучения
            learning_rate=1e-3,
            num_layers=2,  # Количество слоев
            num_blocks=[1, 1],  # Блоки для каждого уровня
            mlp_units=[[512, 512], [512, 512]],  # Размеры MLP слоев
            pooling_kernel_size=2,  # Размер пулинга
            n_freq_downsample=[2, 1],  # Частота даунсэмплинга
            n_pool_kernel_size=2,  # Размер пула
            dropout_prob_theta=0.1,  # Dropout для предотвращения переобучения
            activation='ReLU',
            futr_exog_list=None,  # Можно добавить внешние факторы
            hist_exog_list=None,
            stat_exog_list=None,
            scaler_type='robust',  # Робастное масштабирование
            loss='MAE',  # Средняя абсолютная ошибка
            valid_loss='MAE',
            num_lr_decays=3,
            random_seed=42,
        )
        
        # Создаем NeuralForecast объект
        nf = NeuralForecast(models=[model], freq='D')  # D = daily
        
        # Обучаем модель
        nf.fit(df=df)
        
        # Генерируем прогноз
        forecast_df = nf.predict()
        
        # Извлекаем прогнозы
        predictions = forecast_df['NHITS'].values.tolist()
        
        # Убеждаемся, что прогнозы валидны
        predictions = [float(p) if np.isfinite(p) and p > 0 else float(df['y'].mean()) 
                      for p in predictions[:horizon]]
        
        return predictions
        
    except Exception as e:
        # В случае ошибки возвращаем среднее значение
        try:
            df = prepare_data(data)
            avg = float(df['y'].mean())
            return [avg] * horizon
        except:
            # Последний fallback
            if data:
                avg = sum(d.get('revenue', 0) for d in data) / len(data)
                return [float(avg)] * horizon
            return [0.0] * horizon

if __name__ == '__main__':
    try:
        # Читаем входные данные из stdin
        input_text = sys.stdin.read()
        if not input_text:
            raise ValueError("No input data provided")
        
        input_data = json.loads(input_text)
        
        historical_data = input_data.get('historical_data', [])
        horizon = input_data.get('horizon', 7)
        
        if not historical_data or len(historical_data) == 0:
            raise ValueError("Empty historical data")
        
        # Генерируем прогноз
        predictions = forecast(historical_data, horizon)
        
        if not predictions or len(predictions) == 0:
            raise ValueError("No predictions generated")
        
        # Выводим результат в JSON формате
        result = {
            'success': True,
            'predictions': predictions,
            'model': 'NHITS'
        }
        
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        import traceback
        error_msg = f'{type(e).__name__}: {str(e)}'
        traceback_str = traceback.format_exc()
        
        error_result = {
            'success': False,
            'error': error_msg,
            'predictions': []
        }
        # Выводим детальную ошибку в stderr для отладки
        print(f'[N-HITS Error] {error_msg}', file=sys.stderr)
        print(traceback_str, file=sys.stderr)
        # Выводим JSON в stdout
        print(json.dumps(error_result))
        sys.stdout.flush()
        sys.exit(1)

