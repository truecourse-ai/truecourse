import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../shared/errors.js';

/**
 * Decode an Okta SSO session. Production validates the session with Okta and
 * reads the agent + roles (ADR 0001); for the fixture the `x-ops-session`
 * header carries `agentId:role1,role2`.
 */
function decode(raw: string): { agentId: string; roles: string[] } | null {
  const [agentId, rolesPart = ''] = raw.split(':');
  if (!agentId) return null;
  return { agentId, roles: rolesPart.split(',').filter(Boolean) };
}

/**
 * Okta-SSO gate for the ops console. There is NO Bearer-JWT path here; every
 * `/ops/*` endpoint requires a session carrying the `ops-agent` role (ADR 0001).
 * Missing session → 401; wrong role → 403.
 */
export function requireOpsAgent(req: Request, _res: Response, next: NextFunction): void {
  const raw = req.header('x-ops-session');
  const ctx = raw ? decode(raw) : null;
  if (!ctx) {
    throw new ApiError(401, 'unauthenticated', 'Missing or invalid Okta session');
  }
  if (!ctx.roles.includes('ops-agent')) {
    throw new ApiError(403, 'forbidden', 'Requires the ops-agent role');
  }
  req.agent = ctx;
  next();
}
