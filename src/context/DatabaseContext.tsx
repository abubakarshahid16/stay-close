/**
 * DatabaseContext — provides a single shared SQLiteDatabase instance
 * to all screens. The database is opened once on app start.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db/database';

interface DatabaseContextValue {
  db: SQLiteDatabase | null;
  isReady: boolean;
  error: Error | null;
  retry: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  db: null,
  isReady: false,
  error: null,
  retry: () => {},
});

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<SQLiteDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsReady(false);
    setError(null);
    getDatabase()
      .then((database) => {
        if (cancelled) return;
        setDb(database);
        setIsReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('[DatabaseContext] getDatabase failed:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => setAttempt((n) => n + 1);

  return (
    <DatabaseContext.Provider value={{ db, isReady, error, retry }}>
      {children}
    </DatabaseContext.Provider>
  );
}

export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext);
}
