import { useCallback, useEffect, useState } from 'react';
import { api, type AppConfig } from './api';

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export function useInterval(fn: () => void, ms: number | null) {
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [fn, ms]);
}

let configPromise: Promise<AppConfig> | null = null;

export function useConfig(): AppConfig | null {
  const [config, setConfig] = useState<AppConfig | null>(null);
  useEffect(() => {
    configPromise ??= api<AppConfig>('/public/config').catch((err) => {
      configPromise = null;
      throw err;
    });
    configPromise.then(setConfig).catch(() => {});
  }, []);
  return config;
}
