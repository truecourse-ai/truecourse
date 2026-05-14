
// --- readonly-parameter-types FP: generic constraint T extends (...args: unknown[]) => unknown ---
// The rule should not flag constraint positions in generic type params
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useRef<T>(val: T): { current: T };

function useThrottleFn<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms?: number,
): [(...args: Parameters<T>) => void, boolean, () => void] {
  const [isThrottling, setIsThrottling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const throttled = (...args: Parameters<T>) => {
    if (isThrottling) return;
    fn(...args as unknown[]);
    setIsThrottling(true);
    timerRef.current = setTimeout(() => setIsThrottling(false), ms ?? 500);
  };

  const cancel = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsThrottling(false);
  };

  return [throttled, isThrottling, cancel];
}
