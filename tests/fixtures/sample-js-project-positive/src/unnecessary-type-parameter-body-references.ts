/**
 * Generic type parameter that appears only once in the signature
 * (`saveFn: (data: T) => Promise<void>`) but is referenced multiple
 * times *inside the function body* — as ref element types, callback
 * parameters, and intermediate variables. Removing the parameter
 * would force every body use back to `unknown`, so it is not
 * unnecessary.
 */

declare function useRef<T>(initial: T): { current: T };
declare function useState<S>(initial: S): [S, (next: S) => void];

type BatcherHandle<T> = {
  enqueue: (data: T) => void;
  flush: () => Promise<void>;
  pending: boolean;
  delay: number;
};

export function buildBatcher<T>(saveFn: (data: T) => Promise<void>, delay = 1000): BatcherHandle<T> {
  const lastArgsRef = useRef<T | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  const enqueue = (data: T): void => {
    lastArgsRef.current = data;
    setPending(true);
  };

  const flush = async (): Promise<void> => {
    const args: T | null = lastArgsRef.current;
    if (args === null) {
      return;
    }
    await saveFn(args);
    setPending(false);
  };

  return { enqueue, flush, pending, delay };
}
