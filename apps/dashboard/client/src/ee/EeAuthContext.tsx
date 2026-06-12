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
  type FormEvent,
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
 * Onboarding for a signed-in user with no workspace yet. Names + creates a
 * WorkOS org (server re-mints the session into it), then reloads so the auth
 * gate re-probes `/me` and lets them into the dashboard.
 */
function CreateWorkspace() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getServerUrl()}${AUTH_BASE}/workspace`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // Session is now scoped to the new org → full reload re-probes /me.
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <FullScreen>
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 text-center">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Create your workspace</h1>
          <p className="text-xs text-muted-foreground">
            Name your TrueCourse workspace to get started.
          </p>
        </div>
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
          className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create workspace'}
        </button>
      </form>
    </FullScreen>
  );
}

/**
 * Whole-dashboard auth gate. Community / disabled renders through.
 * Enterprise: shows a spinner while probing, redirects to hosted login
 * when anonymous, and surfaces a retry screen if a callback error came
 * back (so we never redirect-loop).
 */
export function EnterpriseAuthGate({ children }: { children: ReactNode }) {
  const { status, user, signIn } = useEeAuth();
  const authError = new URLSearchParams(window.location.search).get(
    'auth_error',
  );

  useEffect(() => {
    if (status === 'anon' && !authError) signIn();
  }, [status, authError, signIn]);

  if (status === 'disabled') return <>{children}</>;

  if (status === 'authed') {
    // Signed in but not yet in a workspace (AuthKit signups land org-less) →
    // self-serve onboarding before the rest of the dashboard.
    if (user && !user.organizationId) return <CreateWorkspace />;
    return <>{children}</>;
  }

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
