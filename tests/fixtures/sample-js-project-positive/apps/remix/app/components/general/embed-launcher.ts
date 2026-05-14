
// FP: useEffect with intentionally empty deps [] that fires once on mount to check a param.
// The missing dep (launchWidget) is intentional — the effect should only run once.
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useRef<T>(init: T): { current: T };
declare const searchParams: { get: (key: string) => string | null };

function useAutoLaunch(launchWidget: (token: string) => Promise<void>) {
  const hasLaunchedRef = useRef(false);

  useEffect(() => {
    if (hasLaunchedRef.current) {
      return;
    }

    const token = searchParams.get('token');

    if (token) {
      hasLaunchedRef.current = true;
      void launchWidget(token);
    }
  }, []);
}



// FP: useEffect with [] auto-launches on mount only if a query param is present.
// Intentional empty deps to prevent re-running on subsequent renders.
declare function useEffect2(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useRef2<T>(init: T): { current: T };
declare const queryParams: { get: (key: string) => string | null };

function useTokenAutoLaunch(openSession: (token: string) => Promise<void>) {
  const hasRunRef = useRef2(false);

  useEffect2(() => {
    if (hasRunRef.current) return;

    const sessionToken = queryParams.get('sessionToken');
    if (sessionToken) {
      hasRunRef.current = true;
      void openSession(sessionToken);
    }
  }, []);
}
