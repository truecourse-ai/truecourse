/**
 * Enterprise-only error tracking (Sentry).
 *
 * This is the EE error-reporting seam — the OSS dashboard server has NO Sentry
 * dependency or import. Sentry is initialised inside the EE plugin's register()
 * (which the OSS loader awaits before building the Express app), and exceptions
 * are captured MANUALLY at the EE route/webhook seams via captureEeException().
 *
 * Two deliberate choices keep this strictly EE-scoped and secret-safe:
 *  - The global uncaughtException/unhandledRejection integrations are removed AND
 *    beforeSend drops any event without our `component` tag, so ONLY explicit
 *    captureEeException() calls from EE code egress — an uncaught error in an OSS
 *    route is never sent.
 *  - A default-deny scrubber (beforeSend) strips request data, breadcrumbs,
 *    contexts, stack-frame locals/source, and known secret patterns, and reduces
 *    the user to an opaque org id — so customer keys, the master secret,
 *    Confluence page bodies, and source never leave the box.
 *
 * No SENTRY_DSN ⇒ this module is a no-op (init does nothing; capture returns).
 */

import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';
import { log } from '@truecourse/core/lib/logger';

let enabled = false;
let initialized = false;

export type EeComponent = 'integrations' | 'knowledge' | 'llm' | 'github-gate' | 'admin';

export interface EeErrorContext {
  /** Which EE subsystem raised it — also the EE-only egress gate (see beforeSend). */
  component: EeComponent;
  /** Customer workspace org — the tenant attribution tag + opaque user id. */
  orgId?: string;
  /** LLM provider kind (anthropic/openai/…) for an llm-config failure. */
  provider?: string;
  /** Connector kind (confluence/…) for an integrations/knowledge failure. */
  connector?: string;
  /** Upstream HTTP status (401/403/404/5xx) when the failure was an HTTP call. */
  upstreamStatus?: number;
  /** The route/handler the failure came from, e.g. 'POST /api/ee/integrations/test'. */
  route?: string;
  /** Repo full name for a GitHub-gate failure. */
  repo?: string;
  /** PR number for a GitHub-gate failure. */
  pr?: number;
  level?: 'error' | 'warning';
}

// Default integrations removed because they would either leak secrets/source or
// capture errors raised OUTSIDE explicit EE calls (which would break "EE only").
const DROP_INTEGRATIONS = new Set<string>([
  'LocalVariables', //       stack-frame locals can hold decrypted tokens / page bodies
  'ContextLines', //         ships source lines around each frame
  'Console', //              sweeps console.* (interpolated messages) into breadcrumbs
  'RequestData', //          request bodies / headers / cookies
  'OnUncaughtException', //  would capture OSS errors too
  'OnUnhandledRejection', // would capture OSS errors too
]);

// Belt-and-suspenders message redaction. The submitted keys/tokens are never
// meant to reach an Error in the first place, but engine error messages can
// embed token-bearing URLs or auth headers — strip the obvious shapes.
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/x-access-token:[^@\s]+@/gi, 'x-access-token:***@'],
  [/(authorization:\s*(?:basic|bearer|token)\s+)\S+/gi, '$1***'],
  [/(api[-_]?key["':=\s]+)[\w.\-]{8,}/gi, '$1***'],
  [/\bsk-[A-Za-z0-9]{12,}\b/g, 'sk-***'],
  [/(token=)[^&\s]+/gi, '$1***'],
];

/** Redact known secret shapes from a free-text string. Exported for testing. */
export function redactText(text: string): string {
  let out = text;
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/**
 * Default-deny scrubber: drop whole categories that can carry bodies/headers/
 * PII/source, redact secret shapes from what survives, and reduce the user to an
 * opaque org id. Exported so the regression test can assert nothing leaks.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.contexts;
  delete event.modules;
  delete event.server_name;

  // User is an opaque org id only — never email/name/ip (set via setUser({id})).
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;

  if (event.message) event.message = redactText(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactText(value.value);
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars; //          local variables can hold decrypted secrets
      delete frame.pre_context; //    source lines — must not ship
      delete frame.post_context;
      delete frame.context_line;
    }
  }
  return event;
}

/**
 * EE-only egress gate + scrub. Events without our `component` tag are dropped,
 * so an uncaught error from an OSS route can never be sent even if some default
 * integration captured it. Exported for the regression test.
 */
export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (!event.tags || !event.tags.component) return null;
  return scrubEvent(event);
}

/**
 * Initialise Sentry for the EE process. Idempotent. A no-op when SENTRY_DSN is
 * unset, so local/dev EE runs without a DSN behave exactly as before.
 */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info('[ee-observability] SENTRY_DSN unset — error tracking off');
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    maxValueLength: 4096,
    tracesSampleRate: 0,
    integrations: (defaults) => defaults.filter((i) => !DROP_INTEGRATIONS.has(i.name)),
    beforeBreadcrumb: () => null, // no breadcrumbs at all (kills the console/http trail)
    beforeSend,
  });
  enabled = true;
  log.info('[ee-observability] Sentry error tracking on (EE only)');
}

/** Report an EE exception with tenant + failure-mode tags. No-op without a DSN. */
export function captureEeException(err: unknown, ctx: EeErrorContext): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.orgId) {
      scope.setUser({ id: ctx.orgId });
      scope.setTag('org_id', ctx.orgId);
    }
    scope.setTag('component', ctx.component);
    if (ctx.provider) scope.setTag('provider', ctx.provider);
    if (ctx.connector) scope.setTag('connector', ctx.connector);
    if (ctx.upstreamStatus != null) scope.setTag('upstream_status', String(ctx.upstreamStatus));
    if (ctx.route) scope.setTag('route', ctx.route);
    if (ctx.repo) scope.setTag('repo', ctx.repo);
    if (ctx.pr != null) scope.setTag('pr', String(ctx.pr));
    scope.setLevel(ctx.level ?? 'error');
    Sentry.captureException(err);
  });
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Best-effort flush on shutdown so request-driven events aren't lost on deploy. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    /* best-effort */
  }
}

/** Best-effort upstream HTTP status from a thrown error (UpstreamHttpError / AI-SDK / fetch). */
export function upstreamStatusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const raw = e?.status ?? e?.statusCode ?? e?.response?.status;
  return typeof raw === 'number' ? raw : undefined;
}
