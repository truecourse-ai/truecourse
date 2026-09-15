/**
 * The workspace's people: Settings › Members, read live from WorkOS.
 *
 *   GET    /api/workspace/members              the memberships, the open invitations, the open invite links
 *   POST   /api/workspace/invitations          { email } and the invitation WorkOS mails
 *   DELETE /api/workspace/invitations/:id      revoke one
 *   POST   /api/workspace/invite-links         { expiresInDays } and the link to share
 *   DELETE /api/workspace/invite-links/:id     revoke one
 *   DELETE /api/workspace/members/:id          remove one
 *
 * There is no roster of our own: the members ARE the WorkOS organization's
 * active memberships and the invitations ARE its standing ones, so nothing here
 * can drift from what the identity provider holds. The one thing stored here is
 * the invite LINKS, which WorkOS has no shape for: an invitation with no email,
 * redeemed by whoever opens it (`workos-auth.ts` has the redeeming routes).
 * Every route is scoped to the session's organization, which the auth gate put
 * on the request, and a session with no organization has no members to read.
 */

import { Router, type Request, type Response } from 'express';
import type { Invitation, OrganizationMembership, User, WorkOS } from '@workos-inc/node';
import { log } from '@truecourse/core/lib/logger';
import {
  INVITE_LINK_DAYS,
  type InviteLinkDays,
  type WorkspaceInvitation,
  type WorkspaceInviteLink,
  type WorkspaceInviteLinkRecord,
  type WorkspaceInviteLinkStore,
  type WorkspaceMember,
  type WorkspaceMembersResponse,
} from '@truecourse/shared';
import type { WorkosConfig } from './config.js';

/** How long an invitation stands before it expires; a link's lifetime is the inviter's pick. */
const INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** First + last, or null when the user has neither. */
function fullName(
  user: { firstName?: string | null; lastName?: string | null } | undefined,
): string | null {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || null;
}

/** First + last, else the email: the only two things a WorkOS user always has. */
function displayName(user: User | undefined, email: string): string {
  return fullName(user) ?? email;
}

/**
 * A plausible email: trimmed, lower-cased, one `@` with text on both sides and
 * no whitespace anywhere. Whether the address exists is the mail's answer, not
 * ours; this only refuses what cannot be one.
 */
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || /\s/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return email;
}

/**
 * An invitation as one row. WorkOS's own `state` decides whether the invitation
 * is still standing; the date decides whether it reads as expired, so one whose
 * deadline has passed says so even before WorkOS restates it.
 */
function toInvitation(invitation: Invitation): WorkspaceInvitation {
  const expired =
    invitation.state === 'expired' || Date.parse(invitation.expiresAt) <= Date.now();
  return {
    id: invitation.id,
    email: invitation.email,
    state: expired ? 'expired' : 'pending',
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    acceptUrl: invitation.acceptInvitationUrl,
  };
}

/** The invitations worth a row: neither accepted nor revoked. */
function isOpen(invitation: Invitation): boolean {
  return invitation.state === 'pending' || invitation.state === 'expired';
}

/** The invite page's address for a token: the link the inviter shares. */
export function inviteLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/invite/${encodeURIComponent(token)}`;
}

/** An invite link as one row: the same reading of expiry an invitation gets. */
function toInviteLink(link: WorkspaceInviteLinkRecord, appUrl: string): WorkspaceInviteLink {
  return {
    id: link.id,
    url: inviteLinkUrl(appUrl, link.token),
    state: Date.parse(link.expiresAt) <= Date.now() ? 'expired' : 'pending',
    expiresAt: link.expiresAt,
    createdAt: link.createdAt,
  };
}

/** One of the lifetimes the dialog offers, else null. */
function linkDays(raw: unknown): InviteLinkDays | null {
  return INVITE_LINK_DAYS.find((d) => d === raw) ?? null;
}

export function createWorkspaceMembersRouter(
  workos: WorkOS,
  cfg: Pick<WorkosConfig, 'appUrl'>,
  inviteLinks: WorkspaceInviteLinkStore,
): Router {
  const router = Router();

  /** The caller and their organization, or null once the 401 has been sent. */
  function scope(
    req: Request,
    res: Response,
  ): { userId: string; name: string | null; org: string } | null {
    const user = req.user;
    const org = user?.organizationId;
    if (!user || !org) {
      res.status(401).json({ error: 'This session has no workspace.' });
      return null;
    }
    return { userId: user.id, name: fullName(user), org };
  }

  /** A refused WorkOS call is the workspace's answer, said in WorkOS's words. */
  function upstreamFailed(res: Response, what: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[Members] ${what} failed: ${message}`);
    res.status(502).json({ error: message });
  }

  async function activeMemberships(org: string): Promise<OrganizationMembership[]> {
    const page = await workos.userManagement.listOrganizationMemberships({
      organizationId: org,
      statuses: ['active'],
    });
    return (await page.autoPagination()).filter((m) => m.status === 'active');
  }

  /** The workspace's standing invitations, as rows: one reading of state for every route. */
  async function openInvitations(org: string): Promise<WorkspaceInvitation[]> {
    const page = await workos.userManagement.listInvitations({ organizationId: org });
    return (await page.autoPagination()).filter(isOpen).map(toInvitation);
  }

  // The members and the invitations, in one read: they are one list on the page.
  router.get('/members', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    try {
      const [memberships, usersPage, invitations, links] = await Promise.all([
        activeMemberships(caller.org),
        workos.userManagement.listUsers({ organizationId: caller.org }),
        openInvitations(caller.org),
        inviteLinks.listOpen(caller.org),
      ]);
      const users = new Map<string, User>();
      for (const user of await usersPage.autoPagination()) users.set(user.id, user);

      const members: WorkspaceMember[] = memberships
        .map((m): WorkspaceMember => {
          const user = users.get(m.userId);
          const email = user?.email ?? '';
          return {
            id: m.id,
            userId: m.userId,
            name: displayName(user, email || m.userId),
            email,
            joinedAt: m.createdAt,
            isSelf: m.userId === caller.userId,
          };
        })
        // Oldest first: the workspace in the order it was joined.
        .sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));

      const body: WorkspaceMembersResponse = {
        members,
        // Newest first: an invitation is news until it is taken up.
        invitations: [...invitations].sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
        inviteLinks: links
          .map((link) => toInviteLink(link, cfg.appUrl))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
      };
      res.json(body);
    } catch (err) {
      upstreamFailed(res, `reading the members of ${caller.org}`, err);
    }
  });

  // Invite one person. WorkOS sends the mail; what comes back is the row.
  router.post('/invitations', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    const email = normalizeEmail((req.body as { email?: unknown })?.email);
    if (!email) {
      res.status(400).json({ error: 'Enter an email address.' });
      return;
    }
    try {
      const [memberships, usersPage, invitations] = await Promise.all([
        activeMemberships(caller.org),
        workos.userManagement.listUsers({ organizationId: caller.org }),
        openInvitations(caller.org),
      ]);
      const members = new Set(memberships.map((m) => m.userId));
      const alreadyIn = (await usersPage.autoPagination()).some(
        (u) => members.has(u.id) && u.email.toLowerCase() === email,
      );
      if (alreadyIn) {
        res.status(409).json({ error: 'That person is already in this workspace.' });
        return;
      }
      // An expired invitation is not standing in the way: inviting again is how
      // it is renewed.
      if (invitations.some((i) => i.email.toLowerCase() === email && i.state === 'pending')) {
        res.status(409).json({ error: 'That email already has an invitation.' });
        return;
      }
      const invitation = await workos.userManagement.sendInvitation({
        email,
        organizationId: caller.org,
        inviterUserId: caller.userId,
        expiresInDays: INVITATION_DAYS,
      });
      res.status(201).json({ invitation: toInvitation(invitation) });
    } catch (err) {
      upstreamFailed(res, `inviting ${email} to ${caller.org}`, err);
    }
  });

  // Revoke an invitation. Only this workspace's, so an id from elsewhere is
  // absent rather than someone else's to withdraw.
  router.delete('/invitations/:id', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    const id = req.params.id as string;
    try {
      const invitations = await openInvitations(caller.org);
      if (!invitations.some((i) => i.id === id)) {
        res.status(404).json({ error: 'No such invitation.' });
        return;
      }
      await workos.userManagement.revokeInvitation(id);
      res.status(204).end();
    } catch (err) {
      upstreamFailed(res, `revoking invitation ${id}`, err);
    }
  });

  // Mint an invite link. Nothing leaves this server: the inviter copies the
  // address and shares it however they like.
  router.post('/invite-links', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    const days = linkDays((req.body as { expiresInDays?: unknown })?.expiresInDays);
    if (days === null) {
      res.status(400).json({
        error: `The link must last ${INVITE_LINK_DAYS.join(', ')} days.`,
      });
      return;
    }
    try {
      // The sender's name travels on the row, so the invite page never has to
      // ask WorkOS who they were.
      const link = await inviteLinks.create({
        workspaceOrgId: caller.org,
        inviterUserId: caller.userId,
        inviterName: caller.name,
        expiresAt: new Date(Date.now() + days * DAY_MS).toISOString(),
      });
      res.status(201).json({ link: toInviteLink(link, cfg.appUrl) });
    } catch (err) {
      upstreamFailed(res, `creating an invite link for ${caller.org}`, err);
    }
  });

  // Revoke an invite link. The store only deletes this workspace's, so an id
  // from elsewhere is absent rather than someone else's to withdraw.
  router.delete('/invite-links/:id', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    const id = req.params.id as string;
    try {
      if (!(await inviteLinks.delete(caller.org, id))) {
        res.status(404).json({ error: 'No such invite link.' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      upstreamFailed(res, `revoking invite link ${id}`, err);
    }
  });

  // Remove a member. Never yourself, and never the last one: a workspace with
  // nobody in it can never be reached again.
  router.delete('/members/:id', async (req: Request, res: Response) => {
    const caller = scope(req, res);
    if (!caller) return;
    const id = req.params.id as string;
    try {
      const memberships = await activeMemberships(caller.org);
      const membership = memberships.find((m) => m.id === id);
      if (!membership) {
        res.status(404).json({ error: 'No such member.' });
        return;
      }
      if (membership.userId === caller.userId) {
        res.status(400).json({ error: 'You cannot remove yourself from the workspace.' });
        return;
      }
      if (memberships.length === 1) {
        res.status(400).json({ error: 'The last member of a workspace cannot be removed.' });
        return;
      }
      await workos.userManagement.deleteOrganizationMembership(id);
      res.status(204).end();
    } catch (err) {
      upstreamFailed(res, `removing membership ${id}`, err);
    }
  });

  return router;
}
