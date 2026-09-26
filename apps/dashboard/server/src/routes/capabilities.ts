/**
 * GET /api/capabilities
 *
 * How this server RUNS, and nothing else. Public (mounted before the auth
 * gate), because it is the one thing the client cannot know for itself before
 * it has a session: a local server has no sign-in and offers the folder on this
 * machine as a repository, and the sign-in screen itself differs because of it.
 * Where this server's MCP is, when it has one, is the same kind of fact: the
 * protected-resource metadata publishes it to anyone already.
 *
 * What a caller MAY USE is not here. That is a fact about a workspace rather
 * than about the deployment — the same hosted server opens Atlassian to one
 * customer and keeps it closed for the next — so it rides the authenticated
 * answer (`GET /api/auth/me`), where there is a workspace to answer for. One
 * source, so the two can never disagree.
 */

import { Router } from 'express';
import type { CapabilitiesResponse, McpAvailability } from '@truecourse/shared';
import type { McpAuth } from '../auth/mcp.js';
import { serverMode } from '../mode.js';

/** `mcpAuth` null is a hosted server whose MCP sign-in is not configured. */
export function createCapabilitiesRouter(mcpAuth: McpAuth | null): Router {
  const router: Router = Router();
  const mcp: McpAvailability = mcpAuth ? { available: true, url: mcpAuth.url } : { available: false };

  router.get('/', (_req, res) => {
    const body: CapabilitiesResponse = { mode: serverMode(), mcp };
    res.json(body);
  });

  return router;
}
