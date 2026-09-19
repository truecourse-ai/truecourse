/**
 * The LOCAL session: one implicit person, one implicit workspace, no sign-in.
 *
 * A server told `TRUECOURSE_MODE=local` is one developer's machine, and there
 * is nobody to authenticate — so the gate's verifier answers the same session
 * for every request instead of unsealing a cookie, and no WorkOS client is
 * built at all. Everything downstream is unchanged: the session still carries
 * an organization, so every workspace-scoped store, job and route scopes itself
 * exactly as it does hosted, against this one fixed id.
 */

import os from 'node:os';
import { Router } from 'express';
import type {
  AuthMeResponse,
  AuthUser,
  AuthVerifier,
  WorkspaceMembersResponse,
} from '@truecourse/shared';
import { editionOf } from '@truecourse/shared';
import { workspaceEntitlements } from '../services/entitlements.service.js';

/**
 * The one workspace a local server has. It is a real organization id as far as
 * every store is concerned — rows written under it are this machine's — and it
 * is fixed, so restarting the server does not orphan what the last one wrote.
 */
export const LOCAL_ORG_ID = 'org_local';

/** The one person. Their name is whoever is logged into the machine. */
export const LOCAL_USER_ID = 'user_local';

function localUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'local';
  }
}

/** The session every request in local mode carries. */
export function localUser(): AuthUser {
  return {
    id: LOCAL_USER_ID,
    // There is no identity provider and so no address; the shell draws the
    // name alone rather than inventing one.
    email: '',
    firstName: localUserName(),
    organizationId: LOCAL_ORG_ID,
    organizationName: 'Local',
  };
}

/** The gate's verifier: the same session, always, with no cookie to read. */
export function createLocalSessionVerifier(): AuthVerifier {
  const user = localUser();
  return async () => ({ user: { ...user } });
}

/**
 * The public auth routes in local mode. Only `/me` means anything: there is no
 * login to start, no session to end and no workspace to name. The routes that
 * exist hosted answer 404 here rather than pretending, so a client that asks
 * for one learns it is not there.
 *
 * It answers what this workspace may use, exactly as the hosted one does, and
 * the answer is everything the bundle beside this tree carries. One developer
 * on one machine IS the whole deployment: there is no operator to grant
 * anything and nobody to bill, so a local server withholding its own features
 * from itself would be locking a door with nobody on the other side of it.
 */
export function createLocalAuthRouter(): Router {
  const router = Router();
  router.get('/me', async (_req, res) => {
    const user = localUser();
    const entitlements = await workspaceEntitlements(LOCAL_ORG_ID);
    const body: AuthMeResponse = { user, edition: editionOf(entitlements), entitlements };
    res.json(body);
  });
  return router;
}

/**
 * The workspace's people in local mode: the one person using it. Invitations
 * need an identity provider to send them, so there are none, and the roster
 * cannot be changed from here.
 */
export function createLocalWorkspaceMembersRouter(): Router {
  const router = Router();
  router.get('/members', (_req, res) => {
    const user = localUser();
    const body: WorkspaceMembersResponse = {
      members: [
        {
          id: LOCAL_USER_ID,
          userId: LOCAL_USER_ID,
          name: user.firstName ?? 'local',
          email: user.email,
          joinedAt: new Date(0).toISOString(),
          isSelf: true,
        },
      ],
      invitations: [],
      inviteLinks: [],
    };
    res.json(body);
  });
  return router;
}
