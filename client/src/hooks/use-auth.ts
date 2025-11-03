import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from './use-toast';
import type {
  AuthResponse,
  LoginData,
  RegisterData,
  ChangePasswordData,
  AuthUser,
} from '@shared/schema';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login: (data: LoginData) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (data: ChangePasswordData) => Promise<void>;
}

// API functions
const authAPI = {
  async login(data: LoginData): Promise<AuthResponse> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Ошибка входа');
    }

    return response.json();
  },

  async register(data: RegisterData): Promise<AuthResponse> {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Ошибка регистрации');
    }

    return response.json();
  },

  async logout(): Promise<AuthResponse> {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Ошибка выхода');
    }

    return response.json();
  },

  async getMe(): Promise<{ success: boolean; user: AuthUser }> {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      const errorData = await response.json();
      throw new Error(errorData.message || 'Ошибка получения данных пользователя');
    }

    return response.json();
  },

  async changePassword(data: ChangePasswordData): Promise<AuthResponse> {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Ошибка изменения пароля');
    }

    return response.json();
  },
};

export function useAuth(): AuthContextType {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  // Query to get current user
  const {
    data: userData,
    isLoading: isUserLoading,
    error,
  } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: authAPI.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: authAPI.login,
    onSuccess: (data) => {
      setAuthState({
        user: data.user || null,
        isLoading: false,
        isAuthenticated: !!data.user,
      });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      
      // Сохраняем email последнего пользователя в localStorage
      if (data.user?.email) {
        localStorage.setItem('coffee-kpi-last-email', data.user.email);
      }
      
      toast({
        title: 'Успешный вход',
        description: data.message || 'Добро пожаловать!',
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Произошла ошибка входа';
      setAuthState((prev) => ({ ...prev, isLoading: false }));
      toast({
        title: 'Ошибка входа',
        description: message,
        variant: 'destructive',
      });
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: authAPI.register,
    onSuccess: (data) => {
      setAuthState({
        user: data.user || null,
        isLoading: false,
        isAuthenticated: !!data.user,
      });
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      
      // Сохраняем email последнего пользователя в localStorage
      if (data.user?.email) {
        localStorage.setItem('coffee-kpi-last-email', data.user.email);
      }
      
      toast({
        title: 'Успешная регистрация',
        description: data.message || 'Добро пожаловать!',
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Произошла ошибка регистрации';
      setAuthState((prev) => ({ ...prev, isLoading: false }));
      toast({
        title: 'Ошибка регистрации',
        description: message,
        variant: 'destructive',
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: authAPI.logout,
    onSuccess: () => {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
      queryClient.clear();
      // Не удаляем email из localStorage при выходе, чтобы пользователь мог легко войти снова
      toast({
        title: 'Выход выполнен',
        description: 'Вы успешно вышли из системы',
      });
    },
    onError: () => {
      // Even if logout fails on server, clear local state
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
      queryClient.clear();
      toast({
        title: 'Выход выполнен',
        description: 'Вы вышли из системы',
      });
    },
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: authAPI.changePassword,
    onSuccess: (data) => {
      toast({
        title: 'Пароль изменен',
        description: data.message || 'Пароль успешно изменен',
      });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Не удалось изменить пароль';
      toast({
        title: 'Ошибка изменения пароля',
        description: message,
        variant: 'destructive',
      });
    },
  });

  // Update auth state when user data changes
  useEffect(() => {
    if (userData) {
      setAuthState({
        user: userData.user,
        isLoading: false,
        isAuthenticated: true,
      });
      
      // Сохраняем email последнего пользователя в localStorage при автоматической загрузке
      if (userData.user?.email) {
        localStorage.setItem('coffee-kpi-last-email', userData.user.email);
      }
    } else if (error instanceof Error && error.message === 'Unauthorized') {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    } else if (!isUserLoading) {
      setAuthState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
      });
    }
  }, [userData, error, isUserLoading]);

  const login = useCallback(
    async (data: LoginData) => {
      await loginMutation.mutateAsync(data);
    },
    [loginMutation],
  );

  const register = useCallback(
    async (data: RegisterData) => {
      await registerMutation.mutateAsync(data);
    },
    [registerMutation],
  );

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const changePassword = useCallback(
    async (data: ChangePasswordData) => {
      await changePasswordMutation.mutateAsync(data);
    },
    [changePasswordMutation],
  );

  return {
    ...authState,
    login,
    register,
    logout,
    changePassword,
  };
}
