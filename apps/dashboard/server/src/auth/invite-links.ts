/**
 * The public half of invite by link, mounted at /api/auth beside the auth
 * router, public because the person redeeming a link is not in the workspace
 * yet.
 *
 *   GET  /invite/:token          what the invite page shows before they decide
 *   POST /invite/:token/accept   put the signed-in visitor into the workspace
 *
 * The links themselves are minted and revoked on Settings › Members
 * (`workspace-members.ts`); this is the only place one is redeemed.
 */

import { Router, type Response } from 'express';
import type {
  AuthVerifier,
  InviteLinkPreview,
  InviteLinkRefusal,
  WorkspaceInviteLinkRecord,
  WorkspaceInviteLinkStore,
} from '@truecourse/shared';
import { log } from '@truecourse/core/lib/logger';
import { parseCookies } from './cookies.js';
import { SESSION_COOKIE, sealedFromSetCookie, type WorkspaceSessionTools } from './workos-auth.js';

/**
 * Why a link cannot be redeemed, read off the row: no row at all, a redemption
 * already recorded, or a date gone by. Null when it still stands.
 */
function inviteLinkRefusal(link: WorkspaceInviteLinkRecord | null): InviteLinkRefusal | null {
  if (!link) return 'invalid';
  if (link.consumedAt) return 'used';
  if (Date.parse(link.expiresAt) <= Date.now()) return 'expired';
  return null;
}

const INVITE_REFUSED: Record<InviteLinkRefusal, { status: number; error: string }> = {
  invalid: { status: 404, error: 'This invite link is not valid.' },
  used: { status: 409, error: 'This invite link has already been used.' },
  expired: { status: 410, error: 'This invite link has expired.' },
  elsewhere: {
    status: 409,
    error: 'This account is already in a workspace. Switch to another account to join this one.',
  },
};

/** Refuse the invite in the invite page's words, with the reason beside them. */
function refuseInvite(res: Response, reason: InviteLinkRefusal): void {
  const refused = INVITE_REFUSED[reason];
  res.status(refused.status).json({ error: refused.error, reason });
}

/** WorkOS's answer to a membership that already exists. */
function isConflict(err: unknown): boolean {
  return (err as { status?: unknown } | null)?.status === 409;
}

export interface InviteLinkRouterOptions {
  /** The gate's verifier, so an accept sees the same session the gate would. */
  verify: AuthVerifier;
  tools: WorkspaceSessionTools;
  inviteLinks: WorkspaceInviteLinkStore;
  /**
   * Whether a person may be in more than one workspace here. When not, a
   * session already in another workspace is refused rather than moved: the
   * edition has no way back.
   */
  manyWorkspaces: boolean;
}

export function createInviteLinkRouter({
  verify,
  tools,
  inviteLinks,
  manyWorkspaces,
}: InviteLinkRouterOptions): Router {
  const router = Router();

  // What an invite link is for, before anyone signs up for it: the workspace's
  // name, who sent it and how long it stands. Nothing more of the workspace
  // leaves here, since the visitor is not in it, and nothing is asked of WorkOS
  // that the row does not already hold: the route is public and unmetered.
  router.get('/invite/:token', async (req, res) => {
    const token = req.params.token as string;
    try {
      const link = await inviteLinks.findByToken(token);
      const refusal = inviteLinkRefusal(link);
      if (!link || refusal) {
        refuseInvite(res, refusal ?? 'invalid');
        return;
      }
      const body: InviteLinkPreview = {
        workspaceName: (await tools.organizationName(link.workspaceOrgId)) ?? 'a workspace',
        inviterName: link.inviterName,
        expiresAt: link.expiresAt,
      };
      res.json(body);
    } catch (err) {
      // The page is public: the failure is logged here, not shown to whoever holds the link.
      log.error(`[Auth] could not read invite link: ${(err as Error).message}`);
      res.status(500).json({ error: 'Could not read the invite link. Try again in a moment.' });
    }
  });

  // Redeem an invite link for the signed-in visitor. The consume is what makes
  // the link single-use: it is one conditional update, so of two visitors
  // racing the same link exactly one is let in and the other told it was used.
  // The link is released again only when it gave nobody a seat: WorkOS refused
  // the membership, or the visitor was a member already and did not need it.
  // Once the membership exists the link stays spent whatever happens next.
  router.post('/invite/:token/accept', async (req, res) => {
    const token = req.params.token as string;
    const result = await verify(req.headers.cookie);
    if (!result) {
      res.status(401).json({ error: 'Sign in to accept this invite.' });
      return;
    }
    // The verifier may have rotated the session; the browser must get the new
    // cookie whatever this route answers, or its next request is signed out.
    if (result.setCookie) res.append('Set-Cookie', result.setCookie);
    const sealed =
      sealedFromSetCookie(result.setCookie) ?? parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!sealed) {
      res.status(401).json({ error: 'Sign in to accept this invite.' });
      return;
    }

    let link: WorkspaceInviteLinkRecord;
    try {
      const found = await inviteLinks.findByToken(token);
      const refusal = inviteLinkRefusal(found);
      if (!found || refusal) {
        refuseInvite(res, refusal ?? 'invalid');
        return;
      }
      const current = result.user.organizationId ?? null;
      if (current && current !== found.workspaceOrgId && !manyWorkspaces) {
        refuseInvite(res, 'elsewhere');
        return;
      }
      // A link that read as standing and is refused here was redeemed in between.
      const consumed = await inviteLinks.consume(token, result.user.id);
      if (!consumed) {
        refuseInvite(res, 'used');
        return;
      }
      link = consumed;
    } catch (err) {
      log.error(`[Auth] could not redeem invite link for ${result.user.id}: ${(err as Error).message}`);
      res.status(500).json({ error: 'Could not redeem the invite link. Try again in a moment.' });
      return;
    }

    try {
      const membership = await tools.workos.userManagement.createOrganizationMembership({
        organizationId: link.workspaceOrgId,
        userId: result.user.id,
      });
      tools.rememberOrganizationName(link.workspaceOrgId, membership.organizationName);
    } catch (err) {
      await inviteLinks.release(link.id).catch(() => {});
      if (!isConflict(err)) {
        // The visitor is an outsider: WorkOS's words stay in the log.
        log.error(
          `[Auth] could not put ${result.user.id} into ${link.workspaceOrgId} by invite link: ${(err as Error).message}`,
        );
        res.status(502).json({ error: 'Could not join the workspace. Try again in a moment.' });
        return;
      }
      // Already a member, so nothing to create: the session is moved into the
      // workspace all the same, and the link stands for someone who needs it.
    }

    try {
      const minted = await tools.mintSessionInto(sealed, link.workspaceOrgId);
      const organizationName = await tools.organizationName(link.workspaceOrgId);
      res.setHeader('Set-Cookie', minted.setCookie);
      res.json({
        user: tools.toAuthUser(minted.user, minted.organizationId, organizationName),
      });
    } catch (err) {
      log.error(
        `[Auth] ${result.user.id} joined ${link.workspaceOrgId} but the session could not follow: ${(err as Error).message}`,
      );
      res.status(502).json({
        error: 'You joined the workspace. Sign out and back in to open it.',
      });
    }
  });

  return router;
}
