
// FP: void flush() inside a beforeunload event handler — intentional fire-and-forget.
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;

function useAutosave(saveFn: () => Promise<void>) {
  const pendingRef = { current: false };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      await saveFn();
    }
  }, [saveFn]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (timerRef.current || pendingRef.current) {
        void flush();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [flush]);
}



// FP: pendingPromiseRef.current = saveFn(args) — the promise is stored in a ref then awaited.
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;
declare function useState<T>(init: T): [T, (val: T) => void];

function useDebouncedSave<TArgs>(saveFn: (args: TArgs) => Promise<void>, delay: number) {
  const pendingRef = { current: null as Promise<void> | null };
  const timerRef = { current: null as ReturnType<typeof setTimeout> | null };
  const lastArgsRef = { current: null as TArgs | null };
  const [, setIsPending] = useState(false);
  const [, setIsCommitting] = useState(false);

  const trigger = useCallback(
    (data: TArgs) => {
      lastArgsRef.current = data;
      setIsPending(true);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      timerRef.current = setTimeout(async () => {
        if (!lastArgsRef.current) return;

        const args = lastArgsRef.current;
        lastArgsRef.current = null;
        timerRef.current = null;

        setIsCommitting(true);
        pendingRef.current = saveFn(args);

        try {
          await pendingRef.current;
        } finally {
          // eslint-disable-next-line require-atomic-updates
          pendingRef.current = null;
          setIsCommitting(false);
          setIsPending(false);
        }
      }, delay);
    },
    [saveFn, delay],
  );

  return { trigger };
}
