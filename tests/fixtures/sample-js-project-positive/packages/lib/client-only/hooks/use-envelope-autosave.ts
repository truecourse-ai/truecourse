
declare function useState5<T>(init: T): [T, (v: T) => void];
declare function useRef5<T>(init: T): { current: T };
declare function useCallback5<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

function useFormAutosave(onSave: (data: Record<string, unknown>) => Promise<void>, delayMs = 2000) {
  const [isPending, setIsPending] = useState5(false);
  const [isCommitting, setIsCommitting] = useState5(false);
  const timerRef = useRef5<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback5((data: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsPending(true);
    timerRef.current = setTimeout(async () => {
      setIsCommitting(true);
      try {
        await onSave(data);
      } finally {
        setIsPending(false);
        setIsCommitting(false);
      }
    }, delayMs);
  }, [onSave, delayMs]);

  const flush = useCallback5(async (data: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsCommitting(true);
    try {
      await onSave(data);
    } finally {
      setIsPending(false);
      setIsCommitting(false);
    }
  }, [onSave]);

  return { triggerSave, flush, isPending, isCommitting };
}
