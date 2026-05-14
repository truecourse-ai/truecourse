// AuthSessionProvider — react-tsx FP shape (context provider with hooks)
declare const authClient_session: { getSession: () => Promise<{ isAuthenticated: boolean; user?: unknown; session?: unknown }> };
declare const trpc_session: { workspace: { internal: { getWorkspaceSession: { query: (v: undefined, meta: unknown) => Promise<unknown> } } } };
declare const SKIP_QUERY_BATCH_META_session: { trpc: unknown };
declare const useLocation_session: () => { pathname: string };
declare const createContext_session: <T>(v: T | null) => { Provider: React.ComponentType<{ value: T | null; children: React.ReactNode }> };
declare const useContext_session: <T>(ctx: unknown) => T | null;
declare const useCallback_session: <T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]) => T;
declare const useEffect_session: (fn: () => void | (() => void), deps: unknown[]) => void;
declare const useState_session: <T>(v: T) => [T, (v: T) => void];

type WorkspaceSession = { session: unknown; user: unknown; workspaces: unknown };

interface AuthSessionContextValue {
  sessionData: WorkspaceSession | null;
  refreshSession: () => Promise<void>;
}

const AuthSessionContext = createContext_session<AuthSessionContextValue>(null);

export const useAuthSession = () => {
  const context = useContext_session<AuthSessionContextValue>(AuthSessionContext);
  if (!context) throw new Error('useAuthSession must be used within AuthSessionProvider');
  if (!context.sessionData) throw new Error('Session not found');
  return { ...context.sessionData, refreshSession: context.refreshSession };
};

export const useOptionalAuthSession = () => {
  const context = useContext_session<AuthSessionContextValue>(AuthSessionContext);
  if (!context) throw new Error('useOptionalAuthSession must be used within AuthSessionProvider');
  return context;
};

type AuthSessionProviderProps = {
  children: React.ReactNode;
  initialSession: WorkspaceSession | null;
};

export const AuthSessionProvider = ({ children, initialSession }: AuthSessionProviderProps) => {
  const [session, setSession] = useState_session<WorkspaceSession | null>(initialSession);
  const location = useLocation_session();

  const refreshSession = useCallback_session(async () => {
    const newSession = await authClient_session.getSession();
    if (!newSession.isAuthenticated) {
      setSession(null);
      return;
    }
    const workspaces = await trpc_session.workspace.internal.getWorkspaceSession
      .query(undefined, SKIP_QUERY_BATCH_META_session.trpc)
      .catch((e: unknown) => {
        const msg = typeof (e as { message?: string }).message === 'string'
          ? (e as { message: string }).message.toLowerCase()
          : '';
        const isNetworkErr = msg.includes('networkerror') || msg.includes('failed to fetch');
        if (isNetworkErr) return null;
        throw e;
      });
    if (workspaces === null) return;
    setSession({
      session: newSession.session,
      user: newSession.user,
      workspaces,
    } as WorkspaceSession);
  }, []);

  useEffect_session(() => {
    void refreshSession();
  }, [location.pathname]);

  return (
    <AuthSessionContext.Provider value={{ sessionData: session, refreshSession }}>
      {children}
    </AuthSessionContext.Provider>
  );
};
