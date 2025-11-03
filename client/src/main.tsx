import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);
root.render(<App />);

// Поддержка Hot Module Replacement (HMR) для разработки
if (import.meta.hot) {
  import.meta.hot.accept('./App', (newModule) => {
    // При изменении App.tsx перерисовываем компонент
    if (newModule) {
      root.render(<newModule.default />);
    }
  });

  // Обработка ошибок в dev режиме
  import.meta.hot.on('vite:error', (error) => {
    console.error('HMR Error:', error);
  });

  // Логирование при успешном обновлении модулей
  import.meta.hot.on('vite:beforeUpdate', (update) => {
    console.log('[HMR] Обновление модулей:', update.updates.map(u => u.path).join(', '));
  });

  import.meta.hot.on('vite:afterUpdate', () => {
    console.log('[HMR] Модули обновлены успешно');
  });
}
