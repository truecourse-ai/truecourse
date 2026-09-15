/**
 * The page an invite link opens: `/invite/:token`, outside the auth gate.
 *
 * A manifest of what the visitor is accepting: who sent it, which workspace,
 * how long the link stands, and, once signed in, the account they would join
 * as. Nothing else of the workspace shows, because the visitor is not in it
 * yet. Anonymous → Accept, which goes through the server's login on its
 * sign-up screen with this page as the destination and `accept=1` on it, so
 * coming back signed in joins without a second click; or Sign in, the same
 * way, for someone who already has an account. Signed in → Join as their
 * email, since the link belongs to whoever holds it and a wrong account here
 * would be a wrong seat. Joining re-mints the session into the workspace;
 * the dashboard loads next.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { INVITE_LINK_REFUSALS, type InviteLinkPreview, type InviteLinkRefusal } from '@truecourse/shared';
import { useAuth } from '@/auth/AuthContext';
import { Brand } from '@/components/brand';
import { expiresIn } from '@/dashboard/shell/real-runs';
import { ApiError, acceptInviteLink, previewInviteLink } from '@/lib/api';
import { getServerUrl } from '@/lib/server-url';

type Refusal = InviteLinkRefusal | 'unknown';

type Preview =
  | { kind: 'loading' }
  | { kind: 'ready'; invite: InviteLinkPreview }
  | { kind: 'refused'; reason: Refusal; message: string };

const PRIMARY =
  'inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';
const SECONDARY =
  'inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted/60';

/** The reason the server put beside its refusal, when it named one the page knows. */
function refusalOf(error: unknown): Refusal {
  const reason = error instanceof ApiError ? (error.body as { reason?: unknown } | null)?.reason : null;
  return INVITE_LINK_REFUSALS.find((r) => r === reason) ?? 'unknown';
}

const REFUSED: Record<Refusal, { title: string; body: string }> = {
  invalid: {
    title: 'This invite link does not exist',
    body: 'It may have been revoked, or the address was copied incompletely. Ask the person who sent it for a fresh link.',
  },
  used: {
    title: 'This invite link was already used',
    body: 'Each link admits one person. Ask the person who sent it for a new one, or sign in if you already joined.',
  },
  expired: {
    title: 'This invite link has expired',
    body: 'Invite links are short-lived on purpose. Ask the person who sent it for a new one.',
  },
  elsewhere: {
    title: 'You are already in a workspace',
    body: 'An account is in one workspace here. To join this one, switch to another account.',
  },
  unknown: {
    title: 'This invite link cannot be opened',
    body: 'Something went wrong reading it. Try again in a moment.',
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
  // Coming back from sign-up or sign-in: the visitor already chose to join, so join.
  const autoAccept = params.get('accept') === '1';
  const here = `/invite/${encodeURIComponent(token)}`;

  useEffect(() => {
    let live = true;
    previewInviteLink(token)
      .then((invite) => live && setPreview({ kind: 'ready', invite }))
      .catch((error: unknown) => {
        if (!live) return;
        const reason = refusalOf(error);
        setPreview({
          kind: 'refused',
          reason,
          message: error instanceof Error ? error.message : REFUSED[reason].body,
        });
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
      const message = error instanceof Error ? error.message : 'Could not join the workspace.';
      if (reason === 'unknown') setJoinError(message);
      else setPreview({ kind: 'refused', reason, message });
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

  /** Through the server's login, back here to join; `screen` picks AuthKit's first screen. */
  const authenticate = (screen: 'sign-up' | 'sign-in') => {
    const next = encodeURIComponent(`${here}?accept=1`);
    const hint = screen === 'sign-up' ? '&screen=sign-up' : '';
    window.location.href = `${getServerUrl()}/api/auth/login?next=${next}${hint}`;
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
              {preview.reason === 'unknown' ? preview.message : REFUSED[preview.reason].body}
            </p>
            <div className="mt-7">
              {/* What to do next: switch accounts, or sign in, or go to the workspace you have. */}
              {signedIn && preview.reason === 'elsewhere' ? (
                <button type="button" onClick={() => void signOut(here)} className={SECONDARY}>
                  Switch account
                </button>
              ) : signedIn ? (
                <a href="/" className={SECONDARY}>
                  Open TrueCourse
                </a>
              ) : (
                <button type="button" onClick={() => authenticate('sign-in')} className={SECONDARY}>
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
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {preview.invite.inviterName
                ? `${preview.invite.inviterName} shared this link with you.`
                : 'A member of the workspace shared this link with you.'}{' '}
              Accept it to join their TrueCourse workspace.
            </p>
            <dl className="my-7 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 border-y border-border py-5">
              <Fact label="Invited by">{preview.invite.inviterName ?? 'A workspace member'}</Fact>
              <Fact label="Workspace">{preview.invite.workspaceName}</Fact>
              {signedIn && <Fact label="Joining as">{user.email}</Fact>}
              <Fact label="Link">Single use, expires {expiresIn(preview.invite.expiresAt)}</Fact>
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
                {/* Signing out lands back here, so the other account picks up the invite. */}
                <button
                  type="button"
                  onClick={() => void signOut(here)}
                  className="text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Not {user.email}? Switch account
                </button>
              </div>
            ) : (
              <div className="grid gap-2.5">
                <button type="button" onClick={() => authenticate('sign-up')} className={PRIMARY}>
                  Accept and create your account
                </button>
                <button type="button" onClick={() => authenticate('sign-in')} className={SECONDARY}>
                  I already have an account
                </button>
              </div>
            )}
            {joinError && <p className="mt-3 text-xs text-destructive">{joinError}</p>}
            <p className="mt-7 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">What happens next.</span>{' '}
              {signedIn
                ? `You become a member of ${preview.invite.workspaceName} right away. The workspace's members can remove you at any time.`
                : 'You choose any email and verify it with a code. Nothing of the workspace is shared with you until you are in. You land there as a member; its members can remove you at any time.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
