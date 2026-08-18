/**
 * useCircles — loads all circles from the database reactively.
 */
import { useState, useEffect, useCallback } from 'react';
import type { Circle } from '../types/circle';
import { CircleRepository } from '../db/repositories/CircleRepository';
import { useDatabase } from '../context/DatabaseContext';

interface UseCirclesResult {
  circles: Circle[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useCircles(): UseCirclesResult {
  const { db, isReady } = useDatabase();
  const [circles, setCircles] = useState<Circle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!db) {
      setIsLoading(false); // don't hang if DB failed to open
      return;
    }
    try {
      setIsLoading(true);
      const repo = new CircleRepository(db);
      const all = await repo.findAll();
      setCircles(all);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (isReady) {
      refresh();
    }
  }, [isReady, refresh]);

  return { circles, isLoading, error, refresh };
}
