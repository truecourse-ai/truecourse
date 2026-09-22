/**
 * The client's auth state: who is signed in, and how to sign in or out.
 *
 * Auth is part of the product — the provider always probes the server-held
 * session at `/api/auth/me` and the gate puts the whole dashboard behind it.
 * `disabled` survives only as the context's DEFAULT value, so a tree rendered
 * WITHOUT a provider (fixture-only tests) reads as "no auth here" instead of
 * hanging on a probe that never happens. The provider itself never sets it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';
import type { AuthUser } from '@truecourse/shared';
import { PRODUCT_DESCRIPTION_MAX_CHARS, normalizeWorkspaceDescription } from '@truecourse/shared';
import { takeRememberedInvite } from '@/auth/invite-resume';
import { useServerMode } from '@/contexts/CapabilityContext';
import { SESSION_REFUSED_EVENT } from '@/lib/api';
import { resetUser } from '@/lib/posthog';
import { getServerUrl } from '@/lib/server-url';

// The server's public auth router.
const AUTH_BASE = '/api/auth';

type AuthStatus = 'disabled' | 'loading' | 'authed' | 'anon';

interface AuthValue {
  status: AuthStatus;
  user: AuthUser | null;
  signIn: () => void;
  /** End the session; the browser lands on the app root afterwards. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  status: 'disabled',
  user: null,
  signIn: () => {},
  signOut: async () => {},
});

/** The session the server holds right now: its user, or null for none. */
async function probeSession(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${getServerUrl()}${AUTH_BASE}/me`, { credentials: 'include' });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: AuthUser };
    return body.user;
  } catch {
    return null;
  }
}

/** Whether two probes answered the same person in the same workspace. */
function sameSession(a: AuthUser, b: AuthUser): boolean {
  return a.id === b.id && a.organizationId === b.organizationId;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  // What the last probe answered, for a later refusal to compare against.
  const probed = useRef<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void probeSession().then((next) => {
      if (cancelled) return;
      probed.current = next;
      setUser(next);
      setStatus(next ? 'authed' : 'anon');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A request refused as unauthenticated after the page loaded. The session is
  // probed again and compared with the one the page runs on. Gone: anonymous,
  // and the gate sends the browser to sign-in. The same person elsewhere or
  // nowhere (a member removed from this workspace, whom the probe moved into
  // their other one): a reload, which opens the right place. The same session:
  // nothing, so a refusal for any other reason cannot loop.
  useEffect(() => {
    let probing = false;
    const onRefused = () => {
      if (probing) return;
      probing = true;
      void probeSession()
        .then((next) => {
          const current = probed.current;
          if (!next) {
            probed.current = null;
            setUser(null);
            setStatus('anon');
          } else if (current && !sameSession(current, next)) {
            window.location.reload();
          }
        })
        .finally(() => {
          probing = false;
        });
    };
    window.addEventListener(SESSION_REFUSED_EVENT, onRefused);
    return () => window.removeEventListener(SESSION_REFUSED_EVENT, onRefused);
  }, []);

  // Ride the address the visitor asked for through login, so the callback
  // returns them to it rather than to the dashboard root.
  const signIn = useCallback(() => {
    const next = encodeURIComponent(
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.href = `${getServerUrl()}${AUTH_BASE}/login?next=${next}`;
  }, []);

  const signOut = useCallback(async () => {
    // The analytics identity ends with the session, before the browser leaves
    // for the logout: what the next person on this machine does is theirs.
    resetUser();
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

  const value = useMemo<AuthValue>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      {children}
    </div>
  );
}

/**
 * Onboarding for a signed-in user with no workspace yet. Names + DESCRIBES the
 * workspace and creates a WorkOS org (server re-mints the session into it),
 * then reloads so the auth gate re-probes `/me` and lets them into the
 * dashboard.
 *
 * The description is asked for here because it is what every document the
 * workspace ever holds is attributed against, and nothing can be connected
 * until it is set — a workspace created without one would begin at a refusal.
 */
function CreateWorkspace() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const described = normalizeWorkspaceDescription(description) !== null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !described || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getServerUrl()}${AUTH_BASE}/workspace`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, description }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // Session is now scoped to the new org → a reload IN PLACE re-probes
      // /me and drops the visitor on the page they were headed for.
      window.location.reload();
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
            Name your TrueCourse workspace and say what it builds.
          </p>
        </div>
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc."
          aria-label="Workspace name"
          className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <textarea
          rows={3}
          value={description}
          maxLength={PRODUCT_DESCRIPTION_MAX_CHARS}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What your product is, in one sentence."
          aria-label="What this workspace's product is"
          className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="text-left text-[11px] text-muted-foreground">
          Documentation is kept or dropped by whether it describes this product, so this sentence is
          what every document is judged against. You can change it later in Settings.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim() || !described}
          className="inline-flex w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create workspace'}
        </button>
      </form>
    </FullScreen>
  );
}

/**
 * Whole-dashboard auth gate: a spinner while the session probe is up, a
 * redirect to the hosted login when anonymous, and a retry screen when a
 * callback error came back (so we never redirect-loop). A tree with no
 * provider above it (`disabled`) renders straight through.
 *
 * A visitor who switched account on an invite page comes back to the root
 * signed out, with the invite remembered; the gate sends them there rather
 * than into sign-in, and the invite page takes it from there.
 *
 * A LOCAL SERVER has no sign-in: its session probe always answers, so the only
 * way to be anonymous there is a server that is not answering at all — and
 * sending the browser to a login that does not exist would hide that. It is
 * said instead.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, user, signIn } = useAuth();
  const local = useServerMode() === 'local';
  const authError = new URLSearchParams(window.location.search).get(
    'auth_error',
  );

  useEffect(() => {
    if (status !== 'anon' || authError || local) return;
    const invite = takeRememberedInvite();
    if (invite) window.location.replace(invite);
    else signIn();
  }, [status, authError, signIn, local]);

  if (status === 'disabled') return <>{children}</>;

  if (status === 'authed') {
    // Signed in but not yet in a workspace (AuthKit signups land org-less) →
    // self-serve onboarding before the rest of the dashboard.
    if (user && !user.organizationId) return <CreateWorkspace />;
    return <>{children}</>;
  }

  if (status === 'anon' && local) {
    return (
      <FullScreen>
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium">The server is not answering</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This dashboard runs on a server on this machine. Start it, then reload.
          </p>
        </div>
      </FullScreen>
    );
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
