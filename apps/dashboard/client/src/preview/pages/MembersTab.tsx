/**
 * Settings › Members: the workspace's people.
 *
 * The rows are the WorkOS organization's, read live from
 * `GET /api/workspace/members`: the members it holds and the invitations
 * standing against it, one list, because a person who was invited is on their
 * way in and belongs beside the people already here.
 *
 * Every action is one request and then a re-read: Remove, Revoke and the invite
 * itself change what WorkOS holds, so what the page shows afterwards is what it
 * answered, never a row patched in place. There is no confirmation dialog on
 * Remove or Revoke; both are reversible by inviting again, and the two that are
 * not reversible cannot be reached at all: you can never remove yourself, and
 * the last member can never be removed.
 */

import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceInvitation, WorkspaceMember, WorkspaceMembersResponse } from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  inviteWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from '@/lib/api';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { StatusWord } from '@/preview/ui/status-word';
import { relativeTime } from '@/preview/shell/real-runs';
import { usePreviewUser } from '@/preview/shell/use-preview-user';

/** How long the copied address is acknowledged, in ms. */
const COPIED_MS = 2000;

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
          <DialogTitle>Invite member</DialogTitle>
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
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
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

export function MembersTab({
  inviteOpen,
  onInviteOpenChange,
}: {
  /** The invite dialog, opened from the page header's action. */
  inviteOpen: boolean;
  onInviteOpenChange: (open: boolean) => void;
}) {
  const user = usePreviewUser();
  const signedIn = user !== null;
  const [data, setData] = useState<WorkspaceMembersResponse | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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

  const copy = async (invitation: WorkspaceInvitation) => {
    await navigator.clipboard.writeText(invitation.acceptUrl);
    setCopied(invitation.id);
    setTimeout(() => setCopied((c) => (c === invitation.id ? null : c)), COPIED_MS);
  };

  const members: WorkspaceMember[] = data?.members ?? [];
  const invitations: WorkspaceInvitation[] = data?.invitations ?? [];
  const q = query.trim().toLowerCase();
  const matches = (...fields: string[]) =>
    !q || fields.some((field) => field.toLowerCase().includes(q));
  const shownMembers = members.filter((m) => matches(m.name, m.email));
  const shownInvitations = invitations.filter((i) => matches(i.email));
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
              onClick={() => void copy(invitation)}
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
      </ul>
      {nothingMatches && <p className="px-6 py-3 text-[11px] text-muted-foreground">Nothing matches.</p>}
      <InviteDialog open={inviteOpen} onOpenChange={onInviteOpenChange} onSent={reread} />
    </div>
  );
}
