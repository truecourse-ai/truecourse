type SaveQueueEntry<T, R> = {
  data: T;
  onResponse?: (response: R) => void;
};

export const useDebouncedSave = <T, R = void>(
  onSave: (data: T) => Promise<R>,
  options: { delay?: number; maxRetries?: number } = {},
) => {
  const { delay = 2000, maxRetries = 3 } = options;

  const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  const saveQueueRef = React.useRef<SaveQueueEntry<T, R>[]>([]);
  const isProcessingRef = React.useRef(false);
  const retryCountRef = React.useRef(0);

  const processQueue = React.useCallback(async () => {
    if (isProcessingRef.current || saveQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;

    while (saveQueueRef.current.length > 0) {
      const entry = saveQueueRef.current.shift()!;

      try {
        const response = await onSave(entry.data);
        retryCountRef.current = 0;
        entry.onResponse?.(response);
      } catch (error) {
        console.error('Debounced save failed:', error);
        retryCountRef.current += 1;

        if (retryCountRef.current < maxRetries) {
          saveQueueRef.current.unshift(entry);
          await new Promise((resolve) => setTimeout(resolve, delay * retryCountRef.current));
        } else {
          retryCountRef.current = 0;
        }
      }
    }

    isProcessingRef.current = false;
  }, [onSave, delay, maxRetries]);

  const enqueue = React.useCallback(
    async (data: T, onResponse?: (response: R) => void) => {
      saveQueueRef.current.push({ data, onResponse });
      await processQueue();
    },
    [processQueue],
  );

  const schedule = React.useCallback(
    (data: T, onResponse?: (response: R) => void) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => void enqueue(data, onResponse), delay);
    },
    [enqueue, delay],
  );

  React.useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return { schedule, enqueue };
};
