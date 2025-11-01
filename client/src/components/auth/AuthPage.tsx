import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Coffee, TrendingUp, BarChart3 } from 'lucide-react';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { AnimatedBackground } from '../AnimatedBackground';

type AuthMode = 'login' | 'register';

export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('login');

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4 relative overflow-hidden">
      <AnimatedBackground />

      <div className="max-w-6xl w-full grid lg:grid-cols-2 gap-8 items-center relative z-10">
        {/* Left side - Branding */}
        <motion.div
          className="text-center lg:text-left space-y-8"
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.6, type: 'spring' }}
            className="inline-flex items-center gap-3 px-6 py-3 rounded-full bg-gradient-to-r from-primary/20 via-chart-3/20 to-chart-4/20 border border-primary/30 backdrop-blur-sm"
          >
            <span className="text-sm font-semibold bg-gradient-to-r from-primary via-chart-3 to-chart-4 bg-clip-text text-transparent">
              Профессиональная аналитика кофейни
            </span>
          </motion.div>

          <motion.h1
            className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <span className="bg-gradient-to-r from-primary via-chart-3 to-chart-4 bg-clip-text text-transparent">
              Coffee KPI
            </span>
            <br />
            <span className="text-foreground">Dashboard</span>
          </motion.h1>

          <motion.h2
            className="text-xl md:text-2xl lg:text-3xl font-semibold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            Анализ показателей кофейни
          </motion.h2>

          <motion.p
            className="text-lg text-muted-foreground max-w-2xl leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
          >
            Получите доступ к детальной аналитике с KPI метриками, графиками и сравнением периодов.
            Загружайте данные о продажах и получайте ценные инсайты для развития вашего бизнеса.
          </motion.p>

          <motion.div
            className="flex items-center gap-8 pt-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
          >
            {[
              { icon: TrendingUp, label: 'Динамика продаж', color: 'text-chart-2' },
              { icon: BarChart3, label: 'KPI метрики', color: 'text-primary' },
              { icon: Coffee, label: 'Анализ товаров', color: 'text-chart-4' },
            ].map((feature, index) => (
              <motion.div
                key={feature.label}
                className="flex flex-col items-center gap-2"
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.7 + index * 0.1, type: 'spring' }}
                whileHover={{ scale: 1.1 }}
              >
                <div
                  className={`p-3 rounded-full bg-gradient-to-br from-card to-card/50 border border-border/50 ${feature.color}`}
                >
                  <feature.icon className="w-5 h-5" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">{feature.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Right side - Auth Forms */}
        <motion.div
          className="flex items-center justify-center"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
        >
          <AnimatePresence mode="wait">
            {mode === 'login' ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <LoginForm onSwitchToRegister={switchMode} />
              </motion.div>
            ) : (
              <motion.div
                key="register"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
              >
                <RegisterForm onSwitchToLogin={switchMode} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
