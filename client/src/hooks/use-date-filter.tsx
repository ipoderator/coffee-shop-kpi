import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AnalyticsDateFilterPreset } from '@shared/schema';

export type DateFilterPreset = AnalyticsDateFilterPreset;

export interface DateFilterState {
  preset: DateFilterPreset;
  from?: Date;
  to?: Date;
}

interface DateFilterContextValue {
  filter: DateFilterState;
  setPreset: (preset: Exclude<DateFilterPreset, 'custom'>) => void;
  setCustomRange: (range: { from?: Date; to?: Date }) => void;
  clearRange: () => void;
}

const STORAGE_KEY = 'coffee-kpi-date-filter';

const DateFilterContext = createContext<DateFilterContextValue | undefined>(undefined);

function parseStoredFilter(value: string | null): DateFilterState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as {
      preset?: DateFilterPreset;
      from?: string;
      to?: string;
    };

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const preset: DateFilterPreset = parsed.preset ?? 'last90';

    return {
      preset,
      from: parsed.from ? new Date(parsed.from) : undefined,
      to: parsed.to ? new Date(parsed.to) : undefined,
    };
  } catch {
    return null;
  }
}

function serializeFilter(filter: DateFilterState): string {
  return JSON.stringify({
    preset: filter.preset,
    from: filter.from ? filter.from.toISOString() : undefined,
    to: filter.to ? filter.to.toISOString() : undefined,
  });
}

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<DateFilterState>(() => {
    if (typeof window === 'undefined') {
      return { preset: 'last90' };
    }

    const stored = parseStoredFilter(window.localStorage.getItem(STORAGE_KEY));
    return stored ?? { preset: 'last90' };
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, serializeFilter(filter));
    } catch {
      // Ignore storage errors (e.g., private mode)
    }
  }, [filter]);

  const setPreset = useCallback((preset: Exclude<DateFilterPreset, 'custom'>) => {
    setFilter({ preset });
  }, []);

  const setCustomRange = useCallback((range: { from?: Date; to?: Date }) => {
    setFilter({
      preset: 'custom',
      from: range.from,
      to: range.to,
    });
  }, []);

  const clearRange = useCallback(() => {
    setFilter({ preset: 'last90' });
  }, []);

  const value = useMemo(
    () => ({
      filter,
      setPreset,
      setCustomRange,
      clearRange,
    }),
    [filter, setPreset, setCustomRange, clearRange],
  );

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>;
}

export function useDateFilter(): DateFilterContextValue {
  const context = useContext(DateFilterContext);
  if (!context) {
    throw new Error('useDateFilter must be used within a DateFilterProvider');
  }
  return context;
}
