export function confirmAction(message: string): boolean { return message.length > 0; }
export function isReady(): boolean { return true; }
export function noDefault(action: string): string {
  if (action === 'start') return 'starting';
  if (action === 'stop') return 'stopping';
  return 'unknown';
}
export function dotAccess(obj: Record<string, unknown>): unknown { return obj.name; }
export function singlePropAccess(attrs: Record<string, unknown>): unknown[] {
  const features = attrs.features;
  return Array.isArray(features) ? features : [];
}
export function compute(a: number, b: number): number { return a + b; }
export function flagParam(isVerbose: boolean): string { return isVerbose ? 'detailed' : 'short'; }
export function hookWithUndefined(): void { React.useState<string | undefined>(undefined); }
declare const React: { useState: <T>(v: T) => [T, (v: T) => void] };
export const unicodeRegex = /hello/u;
export const digitPattern = /\d+/u;
export function namedGroups(text: string): { year: string; month: string } | null {
  const pattern = /(?<year>\d{4})-(?<month>\d{2})/u;
  const match = pattern.exec(text);
  if (match?.groups === undefined) return null;
  return { year: match.groups.year, month: match.groups.month };
}

// Positive: unused-function-parameter — Next.js route handler pattern
export async function routeHandler(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    return await Promise.resolve(Response.json({ id: params.id }));
  } catch {
    return Response.json({ error: 'fail' });
  }
}

// Positive: dot-notation-enforcement — bracket access on Record type
export function recordAccess(input: Record<string, number>): number { const counts: Record<string, number> = input; return counts['active'] || 0; }

// Positive: ungrouped-shorthand-properties — domain-grouped shorthand/non-shorthand
export function groupedProps(name: string, age: number): Record<string, unknown> {
  return { name, age, title: 'Dr.', address: '123 St' };
}

// Positive: unnamed-regex-capture — alternation-only group (not a capture)
export function matchExtension(url: string): boolean { return /\.css(\?|$)/iu.test(url); }

// Positive: unnecessary-boolean-compare — strict comparison on tri-state
export function triStateCheck(flag: boolean | null): string { return flag === true ? 'yes' : 'no'; }

// Positive: empty-function / no-empty-function — catch with empty handler
export function fireAndForget(): void { Promise.resolve().catch(() => {}); }

// Positive: type-guard-preference — classification with complex logic
export function classify(x: unknown): boolean {
  if (typeof x === 'string') return true;
  if (typeof x === 'number') return x > 0;
  return false;
}

// Positive: default-case-in-switch — exhaustive switch on string union
export function exhaustiveAction(a: 'start' | 'stop' | 'pause'): string {
  switch (a) { case 'start': return 'go'; case 'stop': return 'halt'; case 'pause': return 'wait'; }
  return '';
}

// Positive: missing-destructuring — access on type-asserted expression
export function anyAccess(data: unknown): string { const name = (data as Record<string, unknown>).name; return String(name); }

// Positive: unused-scope-definition — variable used in shorthand property
export function shorthandUsage(): Record<string, number> { const count = 42; return { count }; }

// Positive: static-method-candidate — method in class with extends (override)
class Base { prefix = ''; process(s: string): string { return this.prefix + s; } }
export class Handler extends Base { process(s: string): string { return s.toUpperCase(); } }

// Positive: useless-concat — multi-line string literal concatenation (compile-time constant)
const desc = `Hello world from here`;
export function getDesc(): string { return desc; }

// Positive: env-in-library-code — process.env.NODE_ENV in a config module
export const isDev = process.env.NODE_ENV === 'development';

// Positive: redundant-template-expression — template with || fallback (dynamic expression)
export function formatVal(val: string | null): string { return `Value: ${val || 'none'}`; }

// Positive: mutable-private-member — class with private readonly Map (container mutation is fine)
export class Registry {
  private readonly items = new Map<string, number>();
  set(k: string, v: number): void { this.items.set(k, v); }
  get(k: string): number | undefined { return this.items.get(k); }
}

// Positive: prefer-single-boolean-return — filter predicate with if/return true/return false
export function getPositive(nums: readonly number[]): number[] {
  return nums.filter((n) => {
    if (n > 0) return true;
    return false;
  });
}

// Positive: required-type-annotations — parameter with default value (inferred type)
export function greet(name = 'world'): string { return `Hello ${name}`; }

// Positive: missing-env-validation — env var validated on next line
export function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL required');
  return url;
}



// Positive: dot-notation-enforcement — typed permission constant map lookup (project-wide bracket style)
declare const ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP: Record<'MANAGE_ORGANISATION' | 'MANAGE_TEAM' | 'DELETE_TEAM', readonly string[]>;
export function getOrganisationManagerRoles(): readonly string[] {
  return ORGANISATION_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_ORGANISATION'];
}

// Positive: dot-notation-enforcement — enum-keyed grouped map mirrors computed-property definition
type AuditLogEvent = 'DOCUMENT_SENT' | 'DOCUMENT_OPENED' | 'DOCUMENT_RECIPIENT_COMPLETED';
declare const auditLogs: Record<AuditLogEvent, readonly { id: string }[]>;
export function getOpenedAuditLogCount(): number {
  const opened = auditLogs['DOCUMENT_OPENED'];
  const completed = auditLogs['DOCUMENT_RECIPIENT_COMPLETED'];
  return opened.length + completed.length;
}

// Positive: dot-notation-enforcement — Hono RPC chain with sibling hyphen/colon segments forcing brackets
declare const honoClient: {
  readonly 'email-password': { readonly signup: { $post: (req: { json: { email: string } }) => Promise<Response> } };
  readonly account: { readonly ':accountId': { $delete: (req: { json: { reason: string } }) => Promise<Response> } };
};
export async function signupViaEmailPassword(email: string): Promise<Response> {
  return honoClient['email-password']['signup'].$post({ json: { email } });
}
export async function deleteAccountById(reason: string): Promise<Response> {
  return honoClient['account'][':accountId'].$delete({ json: { reason } });
}

// Positive: dot-notation-enforcement — defensive bracket access after 'in' guard for synthetic form-state error key
export function getSignersRootError(errors: Record<string, { message?: string } | undefined>): string | false {
  if ('signers__root' in errors && errors['signers__root']) {
    return errors['signers__root']?.message ?? 'invalid';
  }
  return false;
}

// Positive: dot-notation-enforcement — external API metadata dict and process.env runtime lookup
declare const stripeProduct: { metadata: Record<string, string> };
export function isSeatBasedPlan(): boolean {
  return stripeProduct.metadata['isSeatBased'] === 'true';
}
export function getWebhookBypassHosts(): string {
  return process.env['NEXT_PRIVATE_WEBHOOK_SSRF_BYPASS_HOSTS'] ?? '';
}



// Positive: env-in-library-code — dedicated env-normalizer entrypoint (helper.ts pattern).
// This function is the canonical env-normalization point for the database layer,
// mapping cloud-provider env vars to internal connection vars. Config bootstrapping,
// not scattered library logic.
export function getDatabaseUrl(): void {
  if (process.env.POSTGRES_PRISMA_URL) {
    process.env.NEXT_PRIVATE_DATABASE_URL = process.env.POSTGRES_PRISMA_URL;
    process.env.NEXT_PRIVATE_DIRECT_DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
  } else if (process.env.DATABASE_URL) {
    process.env.NEXT_PRIVATE_DATABASE_URL = process.env.DATABASE_URL;
    process.env.NEXT_PRIVATE_DIRECT_DATABASE_URL = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  }
}

// Positive: env-in-library-code — module-level config constants read once at
// module init to produce frozen telemetry configuration. This module is the
// designated config consumer for these vars — the appropriate config boundary.
export const HAS_LICENSE_KEY = !!process.env.NEXT_PRIVATE_DOCUMENSO_LICENSE_KEY;
export const TELEMETRY_KEY = process.env.NEXT_PRIVATE_TELEMETRY_KEY;
export const TELEMETRY_HOST = process.env.NEXT_PRIVATE_TELEMETRY_HOST;
export const TELEMETRY_DISABLED = !!process.env.DOCUMENSO_DISABLE_TELEMETRY || HAS_LICENSE_KEY;

// Positive: env-in-library-code — single-purpose config-resolver function whose
// sole responsibility is deriving one config value (service-account email) from
// env vars with a hostname fallback. Config logic, not library logic.
declare const URL: { new (input: string): { hostname: string } };
export function getDeletedServiceAccountEmail(): string {
  // eslint-disable-next-line no-process-env
  if (process.env.NEXT_PRIVATE_DELETED_SERVICE_ACCOUNT_EMAIL) {
    // eslint-disable-next-line no-process-env
    return process.env.NEXT_PRIVATE_DELETED_SERVICE_ACCOUNT_EMAIL;
  }
  // eslint-disable-next-line no-process-env
  const { hostname } = new URL(process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000');
  return `deleted-account@${hostname}`;
}

// Positive: env-in-library-code — single-purpose captcha config resolver. Reads
// NEXT_PRIVATE_TURNSTILE_SECRET_KEY once to make captcha opt-in when unconfigured.
// Standard config-presence check in a server-only utility.
declare function verifyCaptchaToken(token: string, secret: string): Promise<boolean>;
export async function verifyCaptcha(token: string): Promise<boolean> {
  // eslint-disable-next-line no-process-env
  const secretKey = process.env.NEXT_PRIVATE_TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return true;
  }
  return verifyCaptchaToken(token, secretKey);
}

// Positive: env-in-library-code — debug/feature-flag guard with explicit
// eslint-disable comment acknowledging the intentional pattern. DEBUG_PDF_INSERT
// is a dev-time flag intentionally read inside server-only PDF code.
declare const consoleDbg: { log: (...args: unknown[]) => void };
export function insertPdfField(fieldId: string): void {
  // eslint-disable-next-line no-process-env
  const debug = process.env.DEBUG_PDF_INSERT === 'true';
  if (debug) {
    consoleDbg.log(`[pdf:insert] inserting field ${fieldId}`);
  }
}



// Positive: for-in-without-filter — controlled plain object typed as Partial of a TS interface;
// no prototype-inherited enumerable properties, so hasOwnProperty guard is unnecessary.
type TClaimFlags = { canSign: boolean; canShare: boolean; canEdit: boolean };
export function mergeClaimFlagPatch(
  base: Record<keyof TClaimFlags, boolean>,
  patch: Partial<TClaimFlags>,
): Record<keyof TClaimFlags, boolean> {
  const flags: Record<keyof TClaimFlags, boolean> = { ...base };
  for (const key in patch) {
    const typedKey = key as keyof TClaimFlags;
    const value = patch[typedKey];
    if (value !== undefined) {
      flags[typedKey] = value;
    }
  }
  return flags;
}



// Positive: missing-env-validation — !!process.env.X boolean presence-check for a feature flag (license key exists), no string value consumed
export const isEnterpriseLicensed = !!process.env.NEXT_PRIVATE_ENTERPRISE_LICENSE_KEY;
export function reportTelemetry(event: string): void {
  if (!isEnterpriseLicensed) return;
  void event;
}


/**
 * Mode: flat-literal-alternation-bot-detection
 *
 * Bot/crawler detection on a request's User-Agent header is conventionally a
 * single case-insensitive regex of OR'd literal client names. The pattern is
 * longer than 50 characters only because product owners keep extending the
 * list of crawlers (Facebook, WhatsApp link previews, Bing's link unfurler,
 * MetaInspector, etc). Structurally it is the simplest possible regex shape:
 *  - alternation of plain literals only (no character classes, ranges, sets);
 *  - zero capture groups, zero non-capturing groups, zero backreferences;
 *  - no quantifiers, no anchors, no lookaheads/lookbehinds, no nesting.
 *
 * regex-complexity exists to flag patterns that are hard for a human to read
 * (deep nesting, lookarounds, many groups). A flat list of literal user-agent
 * substrings is the opposite of that — it is trivially scannable and adding
 * a named-constant indirection here would obscure intent, not clarify it.
 */
export function isBotUserAgent(userAgent: string): boolean {
  return /bot|facebookexternalhit|WhatsApp|google|bing|duckduckbot|MetaInspector/i.test(userAgent);
}



// Positive: required-type-annotations — shape-fe9541387cad
// const is annotated with a function type alias; params on the arrow function
// inherit types from the alias and do not need their own annotations.
type RtaSuperJsonFunction = (data: unknown, init?: { headers?: Record<string, string> }) => { body: string; init: { headers?: Record<string, string> } };
export const rtaSuperLoaderJson: RtaSuperJsonFunction = (data, init = {}) => {
  return { body: JSON.stringify(data), init };
};

// Positive: required-type-annotations — shape-52af5b888577
// Exported const annotated as FC<Props>; destructured params are typed via the const's type.
type RtaFC<P> = (props: P) => { type: string; props: P } | null;
type RtaStepperProps = { children: unknown; onComplete: () => void; currentStep: number };
export const RtaStepper: RtaFC<RtaStepperProps> = ({ children, onComplete, currentStep }) => {
  if (currentStep < 0) {
    onComplete();
    return null;
  }
  return { type: 'stepper', props: { children, onComplete, currentStep } };
};



// Positive: too-many-breaks — idiomatic enum-to-CSS-class switch.
// shape-f3fcc006c40c: a flat switch over an enum/string-literal union where
// each case assigns a CSS class string and breaks. Six breaks total (five
// cases + default) but the structure is a plain lookup table, not complex
// branching logic.
declare const RecipientStatusType: {
  readonly UNSIGNED: 'UNSIGNED';
  readonly OPENED: 'OPENED';
  readonly WAITING: 'WAITING';
  readonly COMPLETED: 'COMPLETED';
  readonly REJECTED: 'REJECTED';
};
type RecipientStatus = (typeof RecipientStatusType)[keyof typeof RecipientStatusType];

export function recipientStatusClass(type: RecipientStatus): string {
  let classes = '';
  switch (type) {
    case RecipientStatusType.UNSIGNED:
      classes = 'border-gray-300 bg-gray-100 text-gray-700';
      break;
    case RecipientStatusType.OPENED:
      classes = 'border-blue-300 bg-blue-100 text-blue-700';
      break;
    case RecipientStatusType.WAITING:
      classes = 'border-yellow-300 bg-yellow-100 text-yellow-700';
      break;
    case RecipientStatusType.COMPLETED:
      classes = 'border-green-300 bg-green-100 text-green-700';
      break;
    case RecipientStatusType.REJECTED:
      classes = 'border-red-300 bg-red-100 text-red-700';
      break;
    default:
      classes = 'border-slate-300 bg-slate-100 text-slate-700';
      break;
  }
  return classes;
}

// Positive: too-many-breaks — idiomatic date-range switch.
// shape-998d08b31880: a flat switch over a string-literal union mapping each
// preset to a [start, end] tuple. Four breaks (three cases + default) — this
// is the canonical switch-as-lookup shape, not problematic break overuse.
declare const DateTime: {
  now: () => {
    minus: (d: { days?: number; years?: number }) => { toJSDate: () => Date };
    toJSDate: () => Date;
  };
};

export function resolveDateRange(
  dateRange: 'last30days' | 'last90days' | 'lastYear' | 'allTime',
): { startDate: Date; endDate: Date } {
  let startDate: Date;
  let endDate: Date;
  switch (dateRange) {
    case 'last30days':
      startDate = DateTime.now().minus({ days: 30 }).toJSDate();
      endDate = DateTime.now().toJSDate();
      break;
    case 'last90days':
      startDate = DateTime.now().minus({ days: 90 }).toJSDate();
      endDate = DateTime.now().toJSDate();
      break;
    case 'lastYear':
      startDate = DateTime.now().minus({ years: 1 }).toJSDate();
      endDate = DateTime.now().toJSDate();
      break;
    default:
      startDate = DateTime.now().minus({ years: 10 }).toJSDate();
      endDate = DateTime.now().toJSDate();
      break;
  }
  return { startDate, endDate };
}


// Positive: unknown-catch-variable - safe-value-pass-no-property-access. The
// catch binding `err` is passed whole to console.error and to a logger, but no
// member access is performed on it. The rule still fires because the binding
// itself lacks the `: unknown` annotation that TypeScript's
// useUnknownInCatchVariables otherwise requires.
declare const logger: { error: (msg: string, err: unknown) => void };
declare const sendBulkTemplate: (id: string) => Promise<void>;
export async function bulkSendTemplate(templateId: string): Promise<void> {
  try {
    await sendBulkTemplate(templateId);
  } catch (err) {
    console.error(err);
    logger.error('bulk send failed', err);
  }
}

// Positive: unknown-catch-variable - catch-variable-never-accessed. The catch
// binding `err` is bound but never referenced inside the block; the handler
// only renders a fixed toast. The binding is still untyped, so the rule fires
// on the missing `: unknown` annotation.
declare const toast: { error: (msg: string) => void };
declare const deleteAccount: () => Promise<void>;
export async function deleteUserAccount(): Promise<void> {
  try {
    await deleteAccount();
  } catch (err) {
    toast.error('We were unable to delete your account. Please try again.');
  }
}

// Positive: unknown-catch-variable - instanceof-narrowed-before-access. The
// catch binding `error` is properly narrowed via `instanceof` guards before
// any property access, but the binding declaration itself omits the
// `: unknown` type annotation, which is what this rule checks.
class AppError extends Error { constructor(public code: string, message: string) { super(message); } }
declare const createPresignToken: (docId: string) => Promise<string>;
export async function presignDocument(docId: string): Promise<string> {
  try {
    return await createPresignToken(docId);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new AppError('UNKNOWN', error.message);
    }
    throw new AppError('UNKNOWN', 'Failed to presign document');
  }
}

// Positive: unknown-catch-variable - narrowed-via-parse-wrap-utility. The
// catch binding `err` is immediately handed to a parse utility that performs
// internal narrowing, and the typed return value drives subsequent logic.
// The original binding still lacks the `: unknown` annotation, so the rule
// fires on the declaration site.
declare const AppErrorParser: { parseError: (e: unknown) => { code: string; message: string } };
declare const moveDocumentToFolder: (docId: string, folder: string) => Promise<void>;
export async function moveDocument(docId: string, folder: string): Promise<void> {
  try {
    await moveDocumentToFolder(docId, folder);
  } catch (err) {
    const parsed = AppErrorParser.parseError(err);
    console.error(parsed.code);
    toast.error(parsed.message);
  }
}

// Positive: unknown-catch-variable - underscore-prefixed-intentional-discard.
// The catch binding is named `_err` to signal an intentional discard, and the
// handler only emits a generic toast. Even with the underscore convention
// the binding is still present and untyped, so the rule fires (no
// `: unknown` annotation on `_err`).
declare const disableAuthenticatorApp: () => Promise<void>;
export async function disableAuthenticator(): Promise<void> {
  try {
    await disableAuthenticatorApp();
  } catch (_err) {
    toast.error('Unable to disable the authenticator app. Please try again.');
  }
}



// Positive: unread-private-attribute (shape-b04ab87bf919) — private interval handle
// written via setInterval but never read anywhere in the class. The stored timer
// id is dead state: nothing ever calls clearInterval on it, and no method or
// external accessor reads `this.heartbeatInterval`.
declare const setIntervalUnused: (cb: () => void, ms: number) => number;
export class HeartbeatEmitter {
  private heartbeatInterval: number | null = null;
  private readonly intervalMs: number;
  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }
  start(): void {
    this.heartbeatInterval = setIntervalUnused(() => {
      // emit a heartbeat tick; the timer handle itself is never read back
      void this.intervalMs;
    }, this.intervalMs);
  }
}
