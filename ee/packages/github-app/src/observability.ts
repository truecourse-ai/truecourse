/**
 * GitHub-App error reporting for the fire-and-forget webhook handlers.
 *
 * These handlers run OUTSIDE the Express request lifecycle and the auth gate, so
 * the EE central capture never sees them — each handler's `.catch()` reports
 * here instead. Sentry is initialised by `@truecourse/ee-server` (which composes
 * this plugin); we reach the same global client. No DSN ⇒ captureException is a
 * no-op, so this is safe in local/dev and tests. The scrub/EE-only gate lives in
 * ee-server's beforeSend; we set the `component` tag it requires.
 */

import * as Sentry from '@sentry/node';
import { log } from '@truecourse/core/lib/logger';
import type { GateStore } from './store/index.js';

/** Strip any credentials that might appear in a logged/reported message. */
export function redactSecrets(msg: string): string {
  return msg
    .replace(/x-access-token:[^@\s]+@/g, 'x-access-token:***@')
    .replace(/(extraheader=Authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, '$1***');
}

/**
 * Log + report a failure from a webhook handler. Resolves the customer org
 * best-effort (repo → workspaceOrgId) so the issue is tenant-attributed.
 */
export async function reportGithubError(
  store: GateStore,
  task: string,
  ctx: { repo?: string; pr?: number },
  err: unknown,
): Promise<void> {
  const message = redactSecrets(err instanceof Error ? err.message : String(err));
  log.error(`[github-app] ${task}${ctx.repo ? ` for ${ctx.repo}` : ''}: ${message}`);

  let orgId: string | undefined;
  try {
    if (ctx.repo) orgId = (await store.getRepo(ctx.repo))?.workspaceOrgId ?? undefined;
  } catch {
    /* best-effort tenant resolution — never let reporting throw */
  }

  Sentry.withScope((scope) => {
    if (orgId) {
      scope.setUser({ id: orgId });
      scope.setTag('org_id', orgId);
    }
    scope.setTag('component', 'github-gate');
    scope.setTag('github_task', task);
    if (ctx.repo) scope.setTag('repo', ctx.repo);
    if (ctx.pr != null) scope.setTag('pr', String(ctx.pr));
    Sentry.captureException(err);
  });
}
