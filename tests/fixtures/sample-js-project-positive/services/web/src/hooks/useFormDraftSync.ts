declare function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void];
declare function useRef<T>(initial: T): { current: T };
declare function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T;
declare function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
declare const window: {
  addEventListener(event: string, handler: () => void): void;
  removeEventListener(event: string, handler: () => void): void;
};
declare function setTimeout(handler: () => void, ms: number): number;
declare function clearTimeout(id: number): void;

export function useFormDraftSync<T>(persistFn: (draft: T) => Promise<void>, debounceMs = 1500) {
  const timerRef = useRef<number | null>(null);
  const lastDraftRef = useRef<T | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const [isDirty, setIsDirty] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const scheduleSync = useCallback(
    (draft: T) => {
      lastDraftRef.current = draft;

      // A pending timer or in-flight promise means the draft is unsaved
      setIsDirty(true);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        if (!lastDraftRef.current) {
          return;
        }

        const snapshot = lastDraftRef.current;
        lastDraftRef.current = null;
        timerRef.current = null;

        setIsSyncing(true);
        inFlightRef.current = persistFn(snapshot);

        try {
          await inFlightRef.current;
        } finally {
          inFlightRef.current = null;
          setIsSyncing(false);
          setIsDirty(false);
        }
      }, debounceMs);
    },
    [persistFn, debounceMs],
  );

  const flushDraft = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (inFlightRef.current) {
      // Already syncing → wait for the in-flight commit to settle
      await inFlightRef.current;
      return;
    }

    if (lastDraftRef.current) {
      const snapshot = lastDraftRef.current;
      lastDraftRef.current = null;

      setIsSyncing(true);
      setIsDirty(true);

      inFlightRef.current = persistFn(snapshot);
      try {
        await inFlightRef.current;
      } finally {
        inFlightRef.current = null;
        setIsSyncing(false);
        setIsDirty(false);
      }
    }
  }, [persistFn]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (timerRef.current || inFlightRef.current) {
        void flushDraft();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushDraft]);

  return { scheduleSync, flushDraft, isDirty, isSyncing };
}
