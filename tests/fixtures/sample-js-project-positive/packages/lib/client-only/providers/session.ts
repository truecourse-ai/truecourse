
// --- void-zero-argument FP shape: useeffect-body-promise-discard (session refresh) ---
// void refreshSession() inside useEffect is intentional fire-and-forget, not void 0
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useState<T>(init: T): [T, (v: T) => void];
declare function fetchCurrentSession(): Promise<{ userId: string; expiresAt: string } | null>;

function SessionProvider({ children }: { children: unknown }) {
  const [session, setSession] = useState<{ userId: string; expiresAt: string } | null>(null);

  async function refreshSession() {
    const data = await fetchCurrentSession();
    setSession(data);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  return children;
}
