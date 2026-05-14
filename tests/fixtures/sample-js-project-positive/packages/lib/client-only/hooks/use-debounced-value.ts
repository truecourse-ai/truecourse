
declare function useState2<T>(init: T): [T, (v: T) => void];
declare function useEffect2(fn: () => (() => void) | void, deps: unknown[]): void;

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState2(value);

  useEffect2(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
