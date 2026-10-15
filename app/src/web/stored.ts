import { useState } from 'react';

export function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : (JSON.parse(saved) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function usePreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState(() => load(key, fallback));
  const update = (next: T) => {
    setValue(next);
    save(key, next);
  };
  return [value, update] as const;
}
