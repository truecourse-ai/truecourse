/**
 * Enterprise auth state for the client (OSS side).
 *
 * In community mode this is inert (`disabled`). In enterprise it probes
 * the WorkOS-backed session via the platform auth endpoints and exposes
 * sign-in / sign-out. The endpoint paths are the stable platform auth
 * contract (served by ee-server); OSS references them by convention so
 * it doesn't need to import anything from `ee/`.
 *
 * <EnterpriseAuthGate> implements the "whole dashboard behind login"
 * model: in enterprise, an unauthenticated visitor is redirected to the
 * hosted WorkOS login. Community renders straight through.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import type { AuthUser } from '@truecourse/shared';
import { useCapabilityContext } from '@/contexts/CapabilityContext';
import { getServerUrl } from '@/lib/server-url';

// Platform auth contract (implemented by ee-server's public router).
const AUTH_BASE = '/api/ee/auth';

type AuthStatus = 'disabled' | 'loading' | 'authed' | 'anon';

interface EeAuthValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const EeAuthContext = createContext<EeAuthValue>({
  status: 'disabled',
  user: null,
  signIn: () => {},
  signOut: async () => {},
});

export function EeAuthProvider({ children }: { children: ReactNode }) {
  const { edition, isLoading } = useCapabilityContext();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (isLoading) return;
    if (edition !== 'enterprise') {
      setStatus('disabled');
      setUser(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetch(`${getServerUrl()}${AUTH_BASE}/me`, { credentials: 'include' })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const body = (await res.json()) as { user: AuthUser };
          setUser(body.user);
          setStatus('authed');
        } else {
          setUser(null);
          setStatus('anon');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('anon');
      });
    return () => {
      cancelled = true;
    };
  }, [edition, isLoading]);

  const signIn = useCallback(() => {
    window.location.href = `${getServerUrl()}${AUTH_BASE}/login`;
  }, []);

  const signOut = useCallback(async () => {
    try {
      const res = await fetch(`${getServerUrl()}${AUTH_BASE}/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as {
        logoutUrl?: string;
      };
      window.location.href = body.logoutUrl ?? '/';
    } catch {
      window.location.href = '/';
    }
  }, []);

  const value = useMemo<EeAuthValue>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  );

  return <EeAuthContext.Provider value={value}>{children}</EeAuthContext.Provider>;
}

export function useEeAuth(): EeAuthValue {
  return useContext(EeAuthContext);
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      {children}
    </div>
  );
}

/**
 * Whole-dashboard auth gate. Community / disabled renders through.
 * Enterprise: shows a spinner while probing, redirects to hosted login
 * when anonymous, and surfaces a retry screen if a callback error came
 * back (so we never redirect-loop).
 */
export function EnterpriseAuthGate({ children }: { children: ReactNode }) {
  const { status, signIn } = useEeAuth();
  const authError = new URLSearchParams(window.location.search).get(
    'auth_error',
  );

  useEffect(() => {
    if (status === 'anon' && !authError) signIn();
  }, [status, authError, signIn]);

  if (status === 'disabled' || status === 'authed') return <>{children}</>;

  if (status === 'anon' && authError) {
    return (
      <FullScreen>
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">Sign-in failed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            We couldn't complete authentication ({authError}).
          </p>
          <button
            onClick={signIn}
            className="mt-4 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </FullScreen>
    );
  }

  // loading, or anon mid-redirect
  return (
    <FullScreen>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </FullScreen>
  );
}
