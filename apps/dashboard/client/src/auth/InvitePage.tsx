/**
 * The page an invite link opens: `/invite/:token`, outside the auth gate.
 *
 * What the visitor is accepting and nothing more: who sent it, which
 * workspace, and, once signed in, the account they would join as. Nothing else
 * of the workspace shows, because the visitor is not in it yet. Anonymous →
 * Accept invite, which goes through the server's login with this page as the
 * destination and `accept=1` on it, so coming back signed in joins without a
 * second click; there is one sign-in screen for a newcomer and a member alike.
 * Signed in → Join as their email, since the link belongs to whoever holds it
 * and a wrong account here would be a wrong seat. Joining re-mints the session
 * into the workspace; the dashboard loads next.
 *
 * Switching account signs out, which lands on the app root; the page is
 * remembered first so the gate brings the visitor back (`invite-resume.ts`).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { INVITE_LINK_REFUSALS, type InviteLinkPreview, type InviteLinkRefusal } from '@truecourse/shared';
import { useAuth } from '@/auth/AuthContext';
import { rememberInvite } from '@/auth/invite-resume';
import { Brand } from '@/components/brand';
import { ApiError, acceptInviteLink, previewInviteLink } from '@/lib/api';
import { getServerUrl } from '@/lib/server-url';

type Refusal = InviteLinkRefusal | 'unknown';

type Preview =
  | { kind: 'loading' }
  | { kind: 'ready'; invite: InviteLinkPreview }
  | { kind: 'refused'; reason: Refusal };

const PRIMARY =
  'inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';
const SECONDARY =
  'inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/60';

/** The reason the server put beside its refusal, when it named one the page knows. */
function refusalOf(error: unknown): Refusal {
  const reason = error instanceof ApiError ? (error.body as { reason?: unknown } | null)?.reason : null;
  return INVITE_LINK_REFUSALS.find((r) => r === reason) ?? 'unknown';
}

/** What a refused link says: why, and the one thing to do about it. */
const REFUSED: Record<Refusal, { title: string; body: string }> = {
  invalid: {
    title: 'This invite link is not valid',
    body: 'Ask the person who sent it for a new one.',
  },
  used: {
    title: 'This invite link was already used',
    body: 'Ask the person who sent it for a new one.',
  },
  expired: {
    title: 'This invite link has expired',
    body: 'Ask the person who sent it for a new one.',
  },
  elsewhere: {
    title: 'This account is already in a workspace',
    body: 'Switch to another account to join this one.',
  },
  unknown: {
    title: 'This invite link cannot be opened',
    body: 'Try again in a moment.',
  },
};

/** One row of the manifest: a mono label and its value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[11px] uppercase leading-5 tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="m-0 text-[13px] leading-5 text-foreground">{children}</dd>
    </>
  );
}

export function InvitePage() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const { status, user, signOut } = useAuth();
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // Coming back from sign-in: the visitor already chose to join, so join.
  const autoAccept = params.get('accept') === '1';
  const here = `/invite/${encodeURIComponent(token)}`;

  useEffect(() => {
    let live = true;
    previewInviteLink(token)
      .then((invite) => live && setPreview({ kind: 'ready', invite }))
      .catch((error: unknown) => {
        if (live) setPreview({ kind: 'refused', reason: refusalOf(error) });
      });
    return () => {
      live = false;
    };
  }, [token]);

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    try {
      await acceptInviteLink(token);
      // The cookie now carries the workspace; the dashboard reads it fresh.
      window.location.assign('/');
    } catch (error) {
      // A refusal the page has words for replaces the manifest; anything else
      // is said under the button, and the visitor may try again.
      const reason = refusalOf(error);
      if (reason === 'unknown') {
        setJoinError(error instanceof Error ? error.message : 'Could not join the workspace.');
      } else {
        setPreview({ kind: 'refused', reason });
      }
      setJoining(false);
    }
  };

  const signedIn = status === 'authed' && user !== null;
  useEffect(() => {
    if (autoAccept && signedIn && preview.kind === 'ready' && !joining && !joinError) void join();
    // `join` closes over state that only changes through it; re-running on
    // every render would fire a second accept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, signedIn, preview.kind]);

  /** Through the server's login, back here to join. */
  const authenticate = () => {
    const next = encodeURIComponent(`${here}?accept=1`);
    window.location.href = `${getServerUrl()}/api/auth/login?next=${next}`;
  };

  /** Sign out and come back here, so the other account picks up the invite. */
  const switchAccount = () => {
    rememberInvite(here);
    void signOut();
  };

  const busy = preview.kind === 'loading' || status === 'loading';

  return (
    <div className="flex min-h-screen w-screen items-center bg-background px-6 py-14 text-foreground">
      <div className="mx-auto w-full max-w-[520px]">
        <div className="flex items-center gap-2">
          <Brand size={6} />
        </div>
        {busy ? (
          <Loader2 className="mt-10 h-6 w-6 animate-spin text-muted-foreground" />
        ) : preview.kind === 'refused' ? (
          <>
            <h1 className="mt-7 text-2xl font-semibold leading-tight tracking-tight">
              {REFUSED[preview.reason].title}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {REFUSED[preview.reason].body}
            </p>
            <div className="mt-7">
              {/* What to do next: switch accounts, or sign in, or go to the workspace you have. */}
              {signedIn && preview.reason === 'elsewhere' ? (
                <button type="button" onClick={switchAccount} className={SECONDARY}>
                  Switch account
                </button>
              ) : signedIn ? (
                <a href="/" className={SECONDARY}>
                  Open TrueCourse
                </a>
              ) : (
                <button type="button" onClick={authenticate} className={SECONDARY}>
                  Sign in
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-7 text-2xl font-semibold leading-tight tracking-tight">
              You&rsquo;re invited to {preview.invite.workspaceName}
            </h1>
            <dl className="my-7 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 border-y border-border py-5">
              <Fact label="Invited by">{preview.invite.inviterName ?? 'A workspace member'}</Fact>
              <Fact label="Workspace">{preview.invite.workspaceName}</Fact>
              {signedIn && <Fact label="Joining as">{user.email}</Fact>}
            </dl>
            {signedIn ? (
              <div className="grid gap-2.5">
                <button type="button" disabled={joining} onClick={() => void join()} className={PRIMARY}>
                  {joining ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Join ${preview.invite.workspaceName}`
                  )}
                </button>
                <button
                  type="button"
                  onClick={switchAccount}
                  className="text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Not {user.email}? Switch account
                </button>
              </div>
            ) : (
              <button type="button" onClick={authenticate} className={PRIMARY}>
                Accept invite
              </button>
            )}
            {joinError && <p className="mt-3 text-xs text-destructive">{joinError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
