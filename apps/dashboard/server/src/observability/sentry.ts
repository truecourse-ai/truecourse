import * as Sentry from '@sentry/node';
import type { ErrorEvent } from '@sentry/node';

let initialized = false;
let enabled = false;

/** Mask credentials that upstream failures sometimes include in their messages. */
export function redactText(text: string): string {
  return text
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***@')
    .replace(/x-access-token:[^@\s]+@/gi, 'x-access-token:***@')
    .replace(/(authorization["':=\s]+(?:basic|bearer|token)\s+)\S+/gi, '$1***')
    .replace(/((?:api[-_]?key|(?:access[-_]?|refresh[-_]?)?token|password|client[-_]?secret|truecourse_secret_key)["':=\s]+)[^\s&"',}]+/gi, '$1***')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, 'github-***');
}

/** Keep only explicit server errors, without request data, source, or users. */
export function beforeSend(event: ErrorEvent): ErrorEvent | null {
  if (event.tags?.component !== 'dashboard-server') return null;
  delete event.request;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.contexts;
  delete event.modules;
  delete event.server_name;
  delete event.user;
  event.tags = { component: 'dashboard-server' };
  if (event.message) event.message = redactText(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactText(value.value);
    // Custom Error properties can be copied into mechanism metadata by SDKs.
    delete value.mechanism?.data;
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.post_context;
      delete frame.context_line;
      if (frame.filename) frame.filename = redactText(frame.filename);
      if (frame.abs_path) frame.abs_path = redactText(frame.abs_path);
    }
  }
  return event;
}

/** Optional error reporting. No automatic instrumentation or performance tracing. */
export function initSentry(): void {
  if (initialized) return;
  initialized = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT
      ?? (process.env.TRUECOURSE_DEV === '1' ? 'development' : process.env.NODE_ENV ?? 'production'),
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    maxValueLength: 4096,
    tracesSampleRate: 0,
    // Manual capture keeps HTTP bodies, SQL, console breadcrumbs, source lines,
    // local variables, and SDK process-exit handlers out of this integration.
    defaultIntegrations: false,
    skipOpenTelemetrySetup: true,
    beforeBreadcrumb: () => null,
    beforeSend,
  });
  enabled = true;
}

export function captureServerException(error: unknown): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('component', 'dashboard-server');
    scope.setLevel('error');
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

/** Give queued errors a bounded chance to leave before a deployment stops Node. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Reporting failure must not prevent the process shutting down.
  }
}
