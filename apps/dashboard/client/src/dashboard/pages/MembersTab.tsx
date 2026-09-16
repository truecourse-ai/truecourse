/**
 * Settings › Members: the workspace's people.
 *
 * The rows are the WorkOS organization's, read live from
 * `GET /api/workspace/members`: the members it holds, the invitations standing
 * against it and the invite links it has out, one list, because a person who
 * was invited is on their way in and belongs beside the people already here.
 *
 * Every action is one request and then a re-read: Remove, Revoke and the invite
 * itself change what the server holds, so what the page shows afterwards is
 * what it answered, never a row patched in place. There is no confirmation
 * dialog on Remove or Revoke; both are reversible by inviting again, and the
 * two that are not reversible cannot be reached at all: you can never remove
 * yourself, and the last member can never be removed.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  INVITE_LINK_DAYS,
  type InviteLinkDays,
  type WorkspaceInvitation,
  type WorkspaceInviteLink,
  type WorkspaceMember,
  type WorkspaceMembersResponse,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createWorkspaceInviteLink,
  inviteWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  revokeWorkspaceInviteLink,
} from '@/lib/api';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { StatusWord } from '@/dashboard/ui/status-word';
import { expiresIn, relativeTime } from '@/dashboard/shell/real-runs';
import { useDashboardUser } from '@/dashboard/shell/use-dashboard-user';

/** How long the copied address is acknowledged, in ms. */
const COPIED_MS = 2000;

/** The two ways in: an invitation WorkOS mails, or a link the inviter shares. */
export type InviteKind = 'email' | 'link';

/** The lifetime the link dialog starts on. */
const DEFAULT_LINK_DAYS: InviteLinkDays = 7;

const FIELD =
  'mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * Copy the text and say so for a moment. A clipboard the browser withholds
 * (no permission, an insecure origin) leaves `failed` on the id instead, so
 * the caller can show the text for copying by hand.
 */
function useCopied() {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setFailed(id);
      return;
    }
    setFailed(null);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), COPIED_MS);
  };
  return { copied, failed, copy };
}

const ACTION =
  'shrink-0 rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted/60 disabled:opacity-50';

const reasonOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** Invite one person: the email, and what the server said if it refused. */
function InviteDialog({
  open,
  onOpenChange,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await inviteWorkspaceMember(email);
      setEmail('');
      onOpenChange(false);
      onSent();
    } catch (e) {
      setError(reasonOf(e, 'The invitation could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite by email</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block text-[11px] font-medium text-muted-foreground">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
              className={FIELD}
            />
          </label>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
          <DialogFooter className="mt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Send
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Invite by link: pick how long the link stands, mint it, copy it. The link is
 * shown once here and again as a row, so closing without copying loses nothing.
 * The dialog says only what the inviter must know to hand the link on.
 */
function InviteLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [days, setDays] = useState<InviteLinkDays>(DEFAULT_LINK_DAYS);
  const [link, setLink] = useState<WorkspaceInviteLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, failed, copy } = useCopied();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { link: created } = await createWorkspaceInviteLink(days);
      setLink(created);
      onCreated();
    } catch (e) {
      setError(reasonOf(e, 'The link could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setLink(null);
          setDays(DEFAULT_LINK_DAYS);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite by link</DialogTitle>
        </DialogHeader>
        {link ? (
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground">
              Link
              <input
                readOnly
                value={link.url}
                aria-label="Invite link"
                className={FIELD}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            {failed === link.id && (
              <p className="mt-2 text-[11px] text-destructive">
                Copy failed. Select the link and copy it.
              </p>
            )}
            <DialogFooter className="mt-4 items-center">
              {copied === link.id && <StatusWord tone="success" word="Copied" />}
              <button
                type="button"
                onClick={() => void copy(link.id, link.url)}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Copy link
              </button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <p className="text-[11px] text-muted-foreground">
              Anyone with the link can join this workspace once.
            </p>
            <label className="mt-3 block text-[11px] font-medium text-muted-foreground">
              Link expires in
              <select
                value={days}
                onChange={(e) =>
                  setDays(
                    INVITE_LINK_DAYS.find((d) => String(d) === e.target.value) ?? DEFAULT_LINK_DAYS,
                  )
                }
                aria-label="Link expires in"
                className={FIELD}
              >
                {INVITE_LINK_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1 day' : `${d} days`}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
            <DialogFooter className="mt-4">
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Create link
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MembersTab({
  invite,
  onInviteChange,
}: {
  /** Which invite dialog is open, opened from the page header's actions. */
  invite: InviteKind | null;
  onInviteChange: (invite: InviteKind | null) => void;
}) {
  const user = useDashboardUser();
  const signedIn = user !== null;
  const [data, setData] = useState<WorkspaceMembersResponse | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const { copied, failed, copy } = useCopied();
  /** Bumped by every action, which is what re-reads the list. */
  const [reads, setReads] = useState(0);
  const reread = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    // With no session there is nobody to ask about: the list stays empty rather
    // than the page inventing a workspace.
    if (!signedIn) return;
    let live = true;
    void listWorkspaceMembers()
      .then((next) => {
        if (!live) return;
        setData(next);
        setReason(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setReason(reasonOf(error, 'The members could not be read.'));
      });
    return () => {
      live = false;
    };
  }, [signedIn, reads]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await run();
      setReason(null);
      reread();
    } catch (e) {
      setReason(reasonOf(e, 'That could not be done.'));
    } finally {
      setBusy(null);
    }
  };

  const members: WorkspaceMember[] = data?.members ?? [];
  const invitations: WorkspaceInvitation[] = data?.invitations ?? [];
  const inviteLinks: WorkspaceInviteLink[] = data?.inviteLinks ?? [];
  const q = query.trim().toLowerCase();
  const matches = (...fields: string[]) =>
    !q || fields.some((field) => field.toLowerCase().includes(q));
  const shownMembers = members.filter((m) => matches(m.name, m.email));
  const shownInvitations = invitations.filter((i) => matches(i.email));
  // A link names nobody, so a search for someone hides them.
  const shownLinks = q ? [] : inviteLinks;
  const nothingMatches = q !== '' && shownMembers.length === 0 && shownInvitations.length === 0;
  const lastMember = members.length === 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search members"
          placeholder="Search members"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {reason && <p className="px-6 py-3 text-[11px] text-destructive">{reason}</p>}
      <ul className="divide-y divide-border border-b border-border" aria-label="Members">
        {shownMembers.map((member) => (
          <li key={member.id} className="flex items-center gap-4 px-6 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground">{member.name}</span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {member.email}
              </span>
            </div>
            <StatusWord tone="success" word="Member" />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(member.joinedAt)}
            </span>
            {!member.isSelf &&
              (lastMember ? (
                <HoverPopover content="The last member of a workspace cannot be removed.">
                  <button type="button" disabled className={ACTION}>
                    Remove
                  </button>
                </HoverPopover>
              ) : (
                <button
                  type="button"
                  disabled={busy === member.id}
                  onClick={() => void act(member.id, () => removeWorkspaceMember(member.id))}
                  className={ACTION}
                >
                  Remove
                </button>
              ))}
          </li>
        ))}
        {shownInvitations.map((invitation) => (
          <li key={invitation.id} className="flex items-center gap-4 px-6 py-3">
            {/* An invitation has no name yet: the email IS the person. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground">
                {invitation.email}
              </span>
            </div>
            <StatusWord
              tone={invitation.state === 'expired' ? 'failure' : 'neutral'}
              word={invitation.state === 'expired' ? 'Expired' : 'Invited'}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(invitation.createdAt)}
            </span>
            {copied === invitation.id && <StatusWord tone="success" word="Copied" />}
            <button
              type="button"
              onClick={() => void copy(invitation.id, invitation.acceptUrl)}
              className={ACTION}
            >
              Copy link
            </button>
            <button
              type="button"
              disabled={busy === invitation.id}
              onClick={() => void act(invitation.id, () => revokeWorkspaceInvitation(invitation.id))}
              className={ACTION}
            >
              Revoke
            </button>
          </li>
        ))}
        {shownLinks.map((link) => (
          <li key={link.id} className="flex items-center gap-4 px-6 py-3">
            {/* A link has nobody behind it yet: what it is stands where the name would.
                Beside it, when the link runs out; the status word alone says so once it has.
                The address itself shows only when the clipboard would not take it. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-foreground">Invite link</span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {failed === link.id ? (
                  <span className="select-all text-foreground">{link.url}</span>
                ) : link.state === 'expired' ? null : (
                  `expires ${expiresIn(link.expiresAt)}`
                )}
              </span>
            </div>
            <StatusWord
              tone={link.state === 'expired' ? 'failure' : 'neutral'}
              word={link.state === 'expired' ? 'Expired' : 'Unused'}
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(link.createdAt)}
            </span>
            {copied === link.id && <StatusWord tone="success" word="Copied" />}
            <button type="button" onClick={() => void copy(link.id, link.url)} className={ACTION}>
              Copy link
            </button>
            <button
              type="button"
              disabled={busy === link.id}
              onClick={() => void act(link.id, () => revokeWorkspaceInviteLink(link.id))}
              className={ACTION}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {nothingMatches && <p className="px-6 py-3 text-[11px] text-muted-foreground">Nothing matches.</p>}
      <InviteDialog
        open={invite === 'email'}
        onOpenChange={(open) => onInviteChange(open ? 'email' : null)}
        onSent={reread}
      />
      <InviteLinkDialog
        open={invite === 'link'}
        onOpenChange={(open) => onInviteChange(open ? 'link' : null)}
        onCreated={reread}
      />
    </div>
  );
}
