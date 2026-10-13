import { useCallback, useEffect, useState } from 'react';
import { get } from './api';

export function usePoll<T>(path: string, every = 5000) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();

  const load = useCallback(
    () =>
      get<T>(path).then(
        (value) => {
          setData(value);
          setError(undefined);
        },
        (reason: Error) => setError(reason),
      ),
    [path],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), every);
    return () => clearInterval(timer);
  }, [load, every]);

  return { data, error, reload: load };
}
