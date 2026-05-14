/**
 * Helper module for relative namespace import test.
 */

export function capitalize(str: string): string {
  if (str.length === 0) return str;
  const first = str[0] ?? '';
  return first.toUpperCase() + str.slice(1);
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-/gu, '')
    .replace(/-$/gu, '');
}

// `el.innerHTML = ''` clears a node and `el.innerHTML = '<static literal>'`
// inserts a hard-coded HTML fragment - neither of these admits user-controlled
// input, so the disabled-auto-escaping detector must not fire on a static
// or empty RHS.

export function clearList(host: HTMLElement): void {
  host.innerHTML = '';
}

export function renderEmptyState(host: HTMLElement): void {
  host.innerHTML = '<p class="empty">No items yet.</p>';
}

export function renderTitleStatic(host: HTMLElement): void {
  host.innerHTML = `<h1>Dashboard</h1>`;
}

// IIFE wrappers used to scope module-private state. The expression-complexity
// detector counts operators on `expression_statement` nodes by recursing
// into all descendants - including the function bodies inside the IIFE -
// which inflates the count by the operators of every nested function. None
// of the inner function bodies has a complex expression on its own (each
// stays below the 5-op threshold) but together they push the IIFE's
// aggregate count over the limit, firing a false positive on the IIFE.
((): void => {
  function isPositive(n: number): boolean {
    return n > 0;
  }
  function isSmall(n: number): boolean {
    return n < 100;
  }
  function isOdd(n: number): boolean {
    return n % 2 === 1;
  }
  function isEven(n: number): boolean {
    return n % 2 === 0;
  }
  function combine(a: number, b: number): number {
    return a + b;
  }
  const total = combine(1, 2);
  globalThis.dispatchEvent(
    new CustomEvent('iife-ready', { detail: { total, isPositive, isSmall, isOdd, isEven } }),
  );
})();



// --- dead-method shape: test-file-usage-excluded-from-scope ---
// extractSessionToken is only called from e2e test files (excluded from analysis scope)
export function extractSessionToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}



// --- declarations-in-global-scope shape: deferred SSR import (universal module pattern) ---
// SkiaCanvas is lazily loaded server-side only; intentional module-level mutable assignment
let NativeImageRenderer: ((
  data: Uint8Array,
  width: number,
  height: number
) => Promise<Buffer>) | null = null;

async function getImageRenderer() {
  if (typeof window === 'undefined' && !NativeImageRenderer) {
    const mod = await import('canvas-native');
    NativeImageRenderer = mod.renderImage;
  }
  return NativeImageRenderer;
}

export async function renderSignatureToBuffer(
  pixels: Uint8Array,
  width: number,
  height: number
): Promise<Buffer | null> {
  const renderer = await getImageRenderer();
  if (!renderer) return null;
  return renderer(pixels, width, height);
}



// --- declarations-in-global-scope shape: module-level singleton state store (toast notifications) ---
// Intentional mutable module state — shadcn/ui use-toast pattern
interface ToastNotification {
  id: string;
  message: string;
  variant: 'default' | 'success' | 'error';
  duration: number;
}

type ToastListener = (notifications: ToastNotification[]) => void;

let memoryState: ToastNotification[] = [];
const listeners: ToastListener[] = [];

function dispatch(notification: ToastNotification) {
  memoryState = [notification, ...memoryState].slice(0, 20);
  listeners.forEach(l => l(memoryState));
}

export function addToast(message: string, variant: ToastNotification['variant'] = 'default') {
  dispatch({ id: Math.random().toString(36).slice(2), message, variant, duration: 5000 });
}

export function subscribeToToasts(listener: ToastListener) {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx > -1) listeners.splice(idx, 1);
  };
}




// --- argument-type-mismatch shape: Number.toFixed with integer literal argument ---
declare const canvasField_008f: { x: number; y: number; width: number };

function formatFieldCoordinates_008f(): string {
  const xStr = canvasField_008f.x.toFixed(2);
  const yStr = canvasField_008f.y.toFixed(2);
  const wStr = canvasField_008f.width.toFixed(2);
  return `x=${xStr}, y=${yStr}, w=${wStr}`;
}




// --- argument-type-mismatch shape: path.join with __dirname and template literal inside forEach ---
declare const pathUtils_00b9: { join: (...parts: string[]) => string };
declare const envLoader_00b9: { config: (opts: { path: string }) => void };

const envFiles_00b9 = ['.env.local', '.env.test'];

envFiles_00b9.forEach((envFile) => {
  envLoader_00b9.config({ path: pathUtils_00b9.join('/workspace', `config/${envFile}`) });
});




// --- argument-type-mismatch shape: typed array .map() shaping objects with typed properties ---
declare const envelopeResult_00d1: {
  recipients: Array<{ id: number; name: string; email: string; role: string }>
};

function formatEnvelopeRecipients_00d1(): Array<{ recipientId: number; name: string; email: string; role: string }> {
  return envelopeResult_00d1.recipients.map((recipient) => ({
    recipientId: recipient.id,
    name: recipient.name,
    email: recipient.email,
    role: recipient.role,
  }));
}




// --- argument-type-mismatch shape: typed find() returning Node[] then forEach with node methods ---
declare const canvasLayer_00ef: {
  current: {
    find: (selector: string) => Array<{ visible: () => boolean; opacity: () => number; hide: () => void; show: () => void }>
  }
};

function updateLayerGroupVisibility_00ef(isVisible: boolean): void {
  canvasLayer_00ef.current.find('Group').forEach((group) => {
    if (isVisible) {
      group.show();
    } else {
      group.hide();
    }
  });
}




// --- argument-type-mismatch shape: Object.entries filter with destructuring tuple, predicate returns boolean ---
function extractPublicEnvVars_0142(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith('PUBLIC_'))
  ) as Record<string, string>;
}




// --- argument-type-mismatch shape: typed object argument passing (API call with structured options) ---
declare function generateDocumentPdf(opts: {
  documentId: string;
  includeAuditLog: boolean;
  format: 'A4' | 'LETTER';
}): Promise<Uint8Array>;

async function buildDocumentPdfPayload_0157(
  documentId: string,
  format: 'A4' | 'LETTER',
): Promise<Uint8Array> {
  const pdfBytes = await generateDocumentPdf({
    documentId,
    includeAuditLog: true,
    format,
  });
  return pdfBytes;
}




// --- argument-type-mismatch shape: type predicate filter on typed array ---
type DirectTemplate = { id: string; title: string; isDirectTemplate: true };
type AnyTemplate = { id: string; title: string; isDirectTemplate?: boolean };

declare const allTemplates_0183: AnyTemplate[];

function getDirectTemplates_0183(): DirectTemplate[] {
  return allTemplates_0183.filter(
    (template): template is DirectTemplate => template.isDirectTemplate === true,
  );
}



// FP shape 01c4610c0cf2: Zod preprocess with undefined coercion — no type mismatch
declare function zString(): { optional(): unknown };
declare const z: { preprocess: (fn: (val: unknown) => unknown, schema: unknown) => unknown };

const phoneSchema = z.preprocess(
  (val) => (val === '' ? undefined : val),
  zString().optional()
);



// FP shape 0220965dae21: string method call with string literal — no type mismatch
declare const authToken: string;

function validateAuthToken(inputToken: string): void {
  if (!inputToken.startsWith('tok_')) {
    throw new Error('Invalid token format');
  }
}



// FP shape 025716cb010e: Array.includes with explicit cast for type narrowing — no type mismatch
type SupportedLocale = 'en' | 'fr' | 'de' | 'es';
declare const SUPPORTED_LOCALES: readonly SupportedLocale[];

function isSupportedLocale(code: string): code is SupportedLocale {
  return SUPPORTED_LOCALES.includes(code as SupportedLocale);
}



// FP shape 0275380fd713: Array.findIndex result passed to function accepting number — no type mismatch
interface Participant { id: string; name: string; color?: string; }
interface ColorStyle { badgeClass: string; avatarClass: string; }
declare function getParticipantColorStyle(indexOrColor: number | string): ColorStyle | undefined;
declare const participants: Participant[];
declare const currentParticipant: Participant;

const colorStyle = getParticipantColorStyle(
  participants.findIndex((p) => p.id === currentParticipant.id)
)?.badgeClass;



// FP shape 0302ecaafa19: flatMap to array passed to function — no type mismatch
interface TeamGroup { id: string; role: string; }
interface TeamMember { id: string; teamGroups: Array<{ group: TeamGroup }> }
declare function getHighestRoleInGroups(groups: TeamGroup[]): string | undefined;
declare const member: TeamMember;

const highestRole = getHighestRoleInGroups(
  member.teamGroups.flatMap((membership) => membership.group)
);



// FP shape 032dcf99cf5f: Object.values().filter().map() enum-to-options — no type mismatch
enum UserRole { ADMIN = 'ADMIN', EDITOR = 'EDITOR', VIEWER = 'VIEWER', GUEST = 'GUEST' }
declare const RESTRICTED_ROLES: UserRole[];

const roleOptions = Object.values(UserRole)
  .filter((role) => !RESTRICTED_ROLES.includes(role))
  .map((role) => ({ label: role.charAt(0) + role.slice(1).toLowerCase(), value: role }));



// FP shape 0332d9846177: Promise.all with chained promise and find predicate — no type mismatch
interface AppConfig { key: string; value: string; }
declare function getCurrentUser(requestId: string): Promise<{ id: string; email: string } | null>;
declare function loadAppConfigs(): Promise<AppConfig[]>;
declare const requestId: string;

async function loadPageData() {
  const [user, activeConfig] = await Promise.all([
    getCurrentUser(requestId),
    loadAppConfigs().then((configs) => configs.find((c) => c.key === 'active_theme')),
  ]);
  return { user, activeConfig };
}



// FP shape 04502e218af8: Object.entries iteration for typed headers — no type mismatch
interface HttpError extends Error { headers: Record<string, string> }
declare const httpError: HttpError;
declare const response: { setHeader: (k: string, v: string) => void };

function propagateErrorHeaders() {
  for (const [headerKey, headerValue] of Object.entries(httpError.headers)) {
    response.setHeader(headerKey, headerValue);
  }
}



// FP shape 060e10f50743: formatting utility called with number property — no type mismatch
interface Asset { name: string; size: number; mimeType: string; }
declare function formatBytes(bytes: number): string;
declare const asset: Asset;

function renderAssetInfo(): string {
  return `${asset.name} (${formatBytes(asset.size)})`;
}



// FP shape 062f32fbb1a0: formatting utility with typed object argument — no type mismatch
interface EventParticipant { id: string; name: string; email: string; role: string; }
declare function formatParticipantLabel(participant: EventParticipant): string;
declare const eventParticipant: EventParticipant;

function getParticipantDisplayText(): string {
  return formatParticipantLabel(eventParticipant);
}


// FP shape: formatter function called with typed enum accessor — no type mismatch
type WebhookEvent = 'CREATED' | 'UPDATED' | 'DELETED' | 'SIGNED';
declare function toFriendlyEventName(event: WebhookEvent): string;
interface EventRow { original: { event: WebhookEvent; status: string } }

function renderEventCell(row: EventRow): string {
  return toFriendlyEventName(row.original.event);
}


// FP shape: sort called with result of filter on typed array — no type mismatch
interface FormField { id: string; position: number; required: boolean; type: string }
declare function sortFieldsByPosition(fields: FormField[]): FormField[];

function getSortedRequiredFields(fields: FormField[]): FormField[] {
  const requiredFields = fields.filter((field) => field.required);
  return sortFieldsByPosition(requiredFields);
}


// FP shape: utility called with .findIndex result — no type mismatch
interface ColorStyle { backgroundColor: string; borderColor: string; color: string }
declare function getRecipientColorStyles(index: number): ColorStyle;

interface Assignee { id: string; name: string }
interface Task { assigneeId: string | null }

function getTaskAssigneeStyle(task: Task, assignees: Assignee[]): ColorStyle {
  return getRecipientColorStyles(
    assignees.findIndex((a) => a.id === task.assigneeId)
  );
}


// FP shape: .find with optional chaining ?.id — typed find. No type mismatch.
interface DraftItem { clientId: string; id?: string; label: string }

function resolveItemId(drafts: DraftItem[], clientId: string): string | undefined {
  return drafts.find((item) => item.clientId === clientId)?.id;
}


// FP shape: typed .find to locate item by id — no type mismatch
interface LineItem { id: string; orderId: string; quantity: number; price: number }

function findLineItem(items: LineItem[], targetId: string): LineItem | undefined {
  return items.find((item) => item.id === targetId);
}


// FP shape: .map spreading objects and adding index — no type mismatch
interface Contestant { id: string; name: string; score: number }
interface RankedContestant extends Contestant { index: number }

function rankContestants(contestants: Contestant[]): RankedContestant[] {
  return contestants.map((contestant, index) => ({
    ...contestant,
    index,
  }));
}


// FP shape: .find with compound OR predicate on typed array — no type mismatch
type Role = 'VIEWER' | 'EDITOR' | 'APPROVER' | 'OWNER';
interface Participant { id: string; email: string; role: Role }

function findPrimaryParticipant(
  participants: Participant[],
  preferredRole: Role
): Participant | undefined {
  return participants.find(
    (p) => p.role === preferredRole || p.role === 'OWNER'
  );
}


// FP shape: .some with typed predicate function — no type mismatch
type FieldType = 'SIGNATURE' | 'INITIALS' | 'DATE' | 'TEXT' | 'CHECKBOX';
interface FormField { id: string; type: FieldType; required: boolean }

declare function isSignatureFieldType(type: FieldType): boolean;

function hasSignatureField(fields: FormField[]): boolean {
  return fields.some((field) => isSignatureFieldType(field.type));
}


// FP shape: utility called with result of typed .map destructuring — no type mismatch
type OrgRole = 'MEMBER' | 'ADMIN' | 'OWNER';
interface OrgGroupMember { organisationMember: { role: OrgRole; userId: string } }
declare function getHighestOrgRole(roles: OrgRole[]): OrgRole;

function getGroupHighestRole(members: OrgGroupMember[]): OrgRole {
  return getHighestOrgRole(
    members.map(({ organisationMember }) => organisationMember.role)
  );
}


// FP shape: .filter with typed compound condition (type + id) — no type mismatch
type AuditLogType = 'FIELD_SIGNED' | 'DOCUMENT_VIEWED' | 'RECIPIENT_ADDED';
interface AuditLog { type: AuditLogType; data: { recipientId: string } }

function getSigningLogsForRecipient(logs: AuditLog[], recipientId: string): AuditLog[] {
  return logs.filter(
    (log) => log.type === 'FIELD_SIGNED' && log.data.recipientId === recipientId
  );
}


// FP shape: .filter with compound condition then .map() — no type mismatch
type ParticipantRole = 'VIEWER' | 'APPROVER' | 'SIGNER';
interface FieldAssignment { id: string; participantId: string; type: string; required: boolean }
interface Participant { id: string; role: ParticipantRole }

interface FieldWithParticipant extends FieldAssignment { participant: Participant }

function getSignerRequiredFields(
  fields: FieldWithParticipant[],
  participantId: string,
): FieldAssignment[] {
  return fields
    .filter(
      (field) =>
        field.participant.role !== 'VIEWER' ||
        field.participantId === participantId
    )
    .map((field) => ({ ...field }));
}


// FP shape: flatMap with nullish coalescing on optional array property — no type mismatch
interface FormSection { id: string; title: string; placeholders?: string[] }

function collectAllPlaceholders(sections: FormSection[]): string[] {
  return sections.flatMap((section) => section.placeholders ?? []);
}



// D06: Buffer.from accepts string|Buffer result of decrypt — no type mismatch
declare function symmetricDecrypt(opts: { key: string; data: string }): string | Buffer;

export function decryptToString(encryptedData: string, key: string): string {
  return Buffer.from(symmetricDecrypt({ key, data: encryptedData })).toString('utf-8');
}



// D17: Object.values on record of string arrays, .some with .length check — no type mismatch
type FieldErrors = Record<string, string[]>;

export function hasValidationErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some((error) => error.length > 0);
}



// D29: Lingui i18n _() call with tagged template — no type mismatch
declare function _(msg: TemplateStringsArray | { id: string }): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string };

export function getAuditLogLabel(eventType: string): string {
  switch (eventType) {
    case 'DOCUMENT_ENCLOSED':
      return _(msg\`Enclosed Document\`);
    case 'DOCUMENT_SENT':
      return _(msg\`Document Sent\`);
    default:
      return _(msg\`Unknown Event\`);
  }
}



// D31: formatter function called with typed object — no type mismatch
interface FieldRecipient {
  id: string;
  name: string;
  email: string;
  role: string;
}

declare function getRecipientDisplayText(recipient: FieldRecipient): string;

interface DocumentField {
  id: string;
  type: string;
  recipient: FieldRecipient;
}

export function formatFieldTooltip(field: DocumentField): string {
  return getRecipientDisplayText(field.recipient);
}



// D34: includes check on string array with ternary — no type mismatch
interface CheckboxOption {
  value: string;
  label: string;
}

export function isOptionChecked(
  checkedValues: string[],
  item: CheckboxOption,
  index: number
): boolean {
  return checkedValues.includes(
    item.value === '' ? `empty-value-${index + 1}` : item.value
  );
}



// D35: string[] find with startsWith predicate — no type mismatch
export function parseCookieValue(cookieHeader: string, cookieName: string): string | undefined {
  const cookiePairs = cookieHeader.split(';');
  const matchedPair = cookiePairs.find((pair) => pair.trim().startsWith(cookieName));
  return matchedPair?.split('=')[1]?.trim();
}



// D37: ts-pattern exhaustive match on enum — no type mismatch
declare function match<T>(value: T): MatchBuilder<T>;

interface MatchBuilder<T> {
  with<P>(pattern: P, handler: () => string): MatchBuilder<T>;
  exhaustive(): string;
  otherwise(handler: () => string): string;
}

enum SubscriptionTier {
  FREE = 'FREE',
  STARTER = 'STARTER',
  PROFESSIONAL = 'PROFESSIONAL',
  ENTERPRISE = 'ENTERPRISE',
}

export function getSubscriptionLabel(tier: SubscriptionTier): string {
  return match(tier)
    .with(SubscriptionTier.FREE, () => 'Free Plan')
    .with(SubscriptionTier.STARTER, () => 'Starter Plan')
    .with(SubscriptionTier.PROFESSIONAL, () => 'Professional Plan')
    .with(SubscriptionTier.ENTERPRISE, () => 'Enterprise Plan')
    .exhaustive();
}



// D38: i18n translation call with typed map lookup — no type mismatch
declare function _(message: { id: string }): string;

type FieldType = 'SIGNATURE' | 'DATE' | 'TEXT' | 'NUMBER' | 'CHECKBOX';

const FieldTypeLabels: Record<FieldType, { id: string }> = {
  SIGNATURE: { id: 'field.type.signature' },
  DATE: { id: 'field.type.date' },
  TEXT: { id: 'field.type.text' },
  NUMBER: { id: 'field.type.number' },
  CHECKBOX: { id: 'field.type.checkbox' },
};

export function getFieldTypeLabel(fieldType: FieldType): string {
  return _(FieldTypeLabels[fieldType]);
}



// D44: typed find predicate on string array for locale matching — no type mismatch
const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'pt', 'nl'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

interface I18nOptions {
  supportedLangs: readonly string[];
  defaultLang: string;
}

declare const APP_I18N_OPTIONS: I18nOptions;

export function resolveLocale(requestedLang: string): string {
  const matched = APP_I18N_OPTIONS.supportedLangs.find((l) => l === requestedLang);
  return matched ?? APP_I18N_OPTIONS.defaultLang;
}



// D47: Array.from(HTMLCollectionOf).forEach with setAttribute — correct API, no type mismatch
export function markInvalidFields(containerSelector: string): void {
  const fieldContainers = document.getElementsByClassName(containerSelector);

  Array.from(fieldContainers).forEach((element) => {
    element.setAttribute('data-validate', 'true');
  });

  const root = document.querySelector('[data-field-root]');
  root?.setAttribute('data-validate-fields', 'true');
}



// --- FP shape 193c8234542b: object literal with string literal type field and async arrayBuffer ---
declare function storeFileOnServer(file: {
  name: string;
  type: 'application/pdf' | 'image/png' | 'image/jpeg';
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<{ storageKey: string }>;

async function uploadPdfAttachment(
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  const result = await storeFileOnServer({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => data.buffer as ArrayBuffer,
  });
  return result.storageKey;
}



// --- FP shape 19d980de738b: i18n.date() call on optional Date in ternary ---
interface I18nInstance {
  date(value: Date, opts?: { dateStyle?: string }): string;
}

interface DomainRecord {
  id: string;
  domain: string;
  verifiedAt: Date | null;
}

declare const i18n: I18nInstance;

function formatVerificationDate(record: DomainRecord): string {
  return record.verifiedAt
    ? i18n.date(record.verifiedAt, { dateStyle: 'medium' })
    : 'Not verified';
}



// --- FP shape 1a252b9d856f: Array.isArray normalization to array ---
interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
}

interface RequestArgs {
  body: WebhookPayload | WebhookPayload[];
}

function normalizePayload(args: RequestArgs): WebhookPayload[] {
  return Array.isArray(args.body) ? args.body : [args.body];
}



// --- FP shape 1a768a07f5fe: role hierarchy array .map() with i18n lookup ---
type MemberRole = 'viewer' | 'editor' | 'admin' | 'owner';

const ROLE_HIERARCHY: Record<MemberRole, MemberRole[]> = {
  viewer: ['viewer'],
  editor: ['viewer', 'editor'],
  admin: ['viewer', 'editor', 'admin'],
  owner: ['viewer', 'editor', 'admin', 'owner'],
};

const ROLE_LABELS: Record<MemberRole, string> = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Administrator',
  owner: 'Owner',
};

declare function translateLabel(descriptor: { id: string; defaultMessage: string }): string;

function getRoleOptions(role: MemberRole): Array<{ value: MemberRole; label: string }> {
  return ROLE_HIERARCHY[role].map((r) => ({
    value: r,
    label: translateLabel({ id: `roles.${r}`, defaultMessage: ROLE_LABELS[r] }),
  }));
}



// --- FP shape 1a94eb15c994: Buffer crypto comparison (HMAC verification) ---
declare const crypto: {
  createHmac(algorithm: string, secret: string): {
    update(data: string): { digest(encoding: string): string };
  };
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
};

function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  const receivedBuf = Buffer.from(signature, 'utf-8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}



// --- FP shape 1aef9de7caa5: ts-pattern match().with().exhaustive() for enum ---
declare function match<T>(value: T): {
  with<R>(pattern: T, handler: () => R): { with<R2>(pattern: T, handler: () => R2): { exhaustive(): R | R2 }; exhaustive(): R };
};

type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

function getInvitationStatusLabel(status: InvitationStatus): string {
  return match(status)
    .with('PENDING', () => 'Awaiting response')
    .with('ACCEPTED', () => 'Accepted')
    .with('DECLINED', () => 'Declined')
    .with('EXPIRED', () => 'Expired')
    .exhaustive();
}



// --- FP shape 1b207b328375: string[].some() with template literal predicate ---
const RESERVED_PATH_SEGMENTS = ['admin', 'api', 'auth', 'static', 'health'] as const;

function isReservedPath(urlPath: string): boolean {
  return RESERVED_PATH_SEGMENTS.some((segment) => urlPath.startsWith(`/${segment}`));
}



// --- FP shape 1b5096f8c122: string split + filter boolean predicate ---
function extractBearerToken(authorizationHeader: string | null): string | undefined {
  const [token] = (authorizationHeader || '')
    .split('Bearer ')
    .filter((segment) => segment.length > 0);
  return token;
}



// --- FP shape 1be0e06186aa: i18n.date() call on Date ---
interface LocaleInstance {
  date(value: Date, opts?: { dateStyle?: 'short' | 'medium' | 'long' | 'full' }): string;
  number(value: number, opts?: { style?: string; currency?: string }): string;
}

declare const locale: LocaleInstance;

interface BillingPeriod {
  startDate: Date;
  endDate: Date;
  amountCents: number;
}

function formatBillingPeriod(period: BillingPeriod): string {
  const start = locale.date(period.startDate, { dateStyle: 'medium' });
  const end = locale.date(period.endDate, { dateStyle: 'medium' });
  return `${start} – ${end}`;
}



// --- FP shape 1c17f288ce31: i18n translation function with message descriptor ---
interface MessageDescriptor {
  id: string;
  defaultMessage: string;
}

declare function _(descriptor: MessageDescriptor): string;

type EmailSetting = 'sendOnComplete' | 'sendOnView' | 'sendReminders';

const EMAIL_SETTING_LABELS: Record<EmailSetting, MessageDescriptor> = {
  sendOnComplete: { id: 'email.sendOnComplete', defaultMessage: 'Send on completion' },
  sendOnView: { id: 'email.sendOnView', defaultMessage: 'Send on first view' },
  sendReminders: { id: 'email.sendReminders', defaultMessage: 'Send reminder emails' },
};

function translateEmailSetting(key: EmailSetting): string {
  return _(EMAIL_SETTING_LABELS[key]);
}



// --- FP shape 1c5cea40dcad: ts-pattern match() with object literal ---
declare function match<T>(value: T): {
  with<P, R>(pattern: P, handler: (val: T) => R): { otherwise: (fallback: (val: T) => R) => R };
  otherwise: <R>(fallback: (val: T) => R) => R;
};

interface DocumentAction {
  type: 'download' | 'share' | 'delete' | 'resend';
  documentId: string;
  userId?: string;
}

function getActionLabel(action: DocumentAction): string {
  return match({ type: action.type, hasUser: Boolean(action.userId) })
    .with({ type: 'download' }, () => 'Download document')
    .with({ type: 'share' }, () => 'Share with others')
    .with({ type: 'delete' }, () => 'Delete permanently')
    .with({ type: 'resend' }, () => 'Resend invitation')
    .otherwise(() => 'Unknown action');
}



// --- FP shape 1d4bdba5da5e: Array.from with length and mapper returning object ---
interface SeedTeamMember {
  name: string;
  email: string;
  role: 'member' | 'admin';
}

function generateSeedTeamMembers(count: number, teamSlug: string): SeedTeamMember[] {
  return Array.from({ length: count }).map((_, i) => ({
    name: `Team Member ${i + 1}`,
    email: `member-${i + 1}@${teamSlug}.example.com`,
    role: i === 0 ? ('admin' as const) : ('member' as const),
  }));
}



// G00: conditional update in map — no type mismatch
declare const currentAssignees: Array<{ id: string; role: string; order: number }>;
declare const selectedIndex: number;
declare const newRole: string;

function reorderAssignees(assignees: typeof currentAssignees, index: number, role: string) {
  return assignees.map((assignee, idx) => ({
    ...assignee,
    role: idx === index ? role : assignee.role,
  }));
}

const updatedAssignees = reorderAssignees(currentAssignees, selectedIndex, newRole);



// G01: Array.filter with includes — returns correctly typed string[]
declare const formErrors: string[];

function getRequiredFieldErrors(errors: string[]): string[] {
  return errors.filter(error => error.includes('required'));
}

const requiredErrors = getRequiredFieldErrors(formErrors);



// G03: Array.some with typed predicate — no type mismatch
declare const participants: Array<{ role: string; status: string }>;
declare const TARGET_ROLE: string;
declare const PENDING_STATUS: string;

function hasPendingParticipant(items: typeof participants): boolean {
  return items.some(
    (participant) =>
      participant.role !== TARGET_ROLE && participant.status === PENDING_STATUS,
  );
}

const hasPending = hasPendingParticipant(participants);



// G04: filter with nested find — no type mismatch
declare const groups: Array<{ id: string; name: string }>;
declare const team: { department: { groups: Array<{ id: string; label: string }> } };

function filterActiveGroups(
  groups: Array<{ id: string; name: string }>,
  team: { department: { groups: Array<{ id: string; label: string }> } },
) {
  return groups.filter((group) => {
    const deptGroup = team.department.groups.find((g) => g.id === group.id);
    return deptGroup !== undefined;
  });
}

const activeGroups = filterActiveGroups(groups, team);



// G05: ts-pattern match().with() — correct exhaustive pattern matching, not a type mismatch
declare function match<T>(value: T): { with: (pattern: T, fn: () => string) => { otherwise: (fn: () => string) => string } };
declare const ContractStatus: { DRAFT: 'DRAFT'; ACTIVE: 'ACTIVE'; EXPIRED: 'EXPIRED' };
declare const status: 'DRAFT' | 'ACTIVE' | 'EXPIRED';

function describeStatus(s: typeof status): string {
  return match(s)
    .with(ContractStatus.DRAFT, () => 'This contract is in draft')
    .otherwise(() => 'Contract is active or expired');
}

const description = describeStatus(status);



// G08: immutable update pattern in map — no type mismatch
declare type LineItem = { id: string; quantity: number; price: number };
declare const lineItems: LineItem[];
declare const updatedItem: LineItem;

function updateLineItem(items: LineItem[], updated: LineItem): LineItem[] {
  return items.map((item) =>
    item.id === updated.id ? { ...item, ...updated } : item,
  );
}

const refreshedItems = updateLineItem(lineItems, updatedItem);



// G13: new Set from mapped array — no type mismatch
declare const contacts: Array<{ email: string; name: string }>;

function buildEmailSet(contacts: Array<{ email: string; name: string }>): Set<string> {
  return new Set(contacts.map((contact) => contact.email.toLowerCase()));
}

const emailSet = buildEmailSet(contacts);



// G17: EventTarget[] includes EventTarget — no type mismatch
declare const containerRef: { current: EventTarget | null };

function isClickInsideContainer(event: Event): boolean {
  return event.composedPath().includes(containerRef.current as EventTarget);
}



// G18: filter with predicate function — accepts correct type; no type mismatch
declare type FormField = { id: string; required: boolean; type: string };
declare function isMandatoryField(field: FormField): boolean;
declare const formData: { fields: FormField[] };

function getMandatoryFields(data: typeof formData): FormField[] {
  return data.fields.filter((field) => isMandatoryField(field));
}

const mandatoryFields = getMandatoryFields(formData);



// G23: Promise.all with async map — standard parallel processing; no type mismatch
declare type Attachment = { id: string; url: string };
declare function fetchAttachmentContent(id: string): Promise<Buffer>;
declare const attachments: Attachment[];

async function downloadAllAttachments(items: Attachment[]): Promise<Buffer[]> {
  return Promise.all(
    items.map(async (attachment) => fetchAttachmentContent(attachment.id)),
  );
}

const contents = downloadAllAttachments(attachments);



// G24: i18n translate function accepting a message descriptor — correct; no type mismatch
declare type MessageDescriptor = { id: string; defaultMessage: string };
declare function translate(descriptor: MessageDescriptor): string;
declare const errorMessage: MessageDescriptor;

function getLocalizedError(descriptor: MessageDescriptor): string {
  return translate(descriptor);
}

const localizedError = getLocalizedError(errorMessage);



// G25: Array.filter with String.includes — standard filtering; no type mismatch
declare const folders: Array<{ name: string; id: string }>;
declare const searchQuery: string;

function filterFoldersByName(
  folders: Array<{ name: string; id: string }>,
  query: string,
): Array<{ name: string; id: string }> {
  return folders.filter((folder) =>
    folder.name.toLowerCase().includes(query.toLowerCase()),
  );
}

const matchingFolders = filterFoldersByName(folders, searchQuery);



// G27: optional-chain array map — no type mismatch
declare type Invitee = { email: string; name: string; role: string };
declare const invitees: Invitee[] | undefined;

function prepareInviteePayload(
  invitees: Invitee[] | undefined,
): Array<{ email: string; name: string; role: string }> | undefined {
  return invitees?.map((invitee) => ({
    email: invitee.email,
    name: invitee.name,
    role: invitee.role,
  }));
}

const payload = prepareInviteePayload(invitees);



// G32: explicit any cast on filter/map with discriminated union — intentional cast
declare type WidgetShape =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean };
declare const widgets: WidgetShape[];
declare const TARGET_KIND: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textWidgets = widgets.filter((w) => w.kind === TARGET_KIND).map<any>((w) => w.value);



// G33: string[] includes string — no type mismatch
declare const allowedOrigins: string[];
declare const requestOrigin: string;

function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.includes(origin);
}

const allowed = isAllowedOrigin(requestOrigin);



// G34: Zod schema composition via .shape chaining — standard Zod API; no type mismatch
declare const z: {
  object: <T extends object>(shape: T) => { shape: T; array: () => object; optional: () => object };
  string: () => { min: (n: number) => object };
  array: <T>(schema: T) => object;
};

const ZBaseInvitationSchema = z.object({
  email: z.string().min(1),
  role: z.string().min(1),
});

const ZBulkInvitationSchema = z.object({
  invitations: ZBaseInvitationSchema.shape,
});



// G39: dynamic import with template literal — standard pattern; no type mismatch
declare const locale: string;

async function loadLocaleMessages(locale: string): Promise<object> {
  const messages = await import(`../locales/${locale}/messages`);
  return messages.default;
}

const enMessages = loadLocaleMessages('en');



// G40: Zod array schema — standard Zod API chaining; no type mismatch
declare const z: {
  object: <T extends object>(shape: T) => { array: () => object };
  string: () => object;
  number: () => object;
};

const ZLineItemSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
});

const ZOrderSchema = z.object({
  lineItems: ZLineItemSchema.array(),
});



// G42: Zod string transform — standard Zod API; no type mismatch
declare const z: {
  object: <T extends object>(shape: T) => object;
  string: () => { toLowerCase: () => object; trim: () => object };
};

const ZEmailSchema = z.object({
  email: z.string().toLowerCase().trim(),
  domain: z.string().toLowerCase(),
});



// G48: flatMap with filter chain — standard array operations; no type mismatch
declare type Signer = { id: string; completedAt: Date | null; fields: Array<{ id: string; completed: boolean }> };
declare const completedSigners: Signer[];

function getIncompleteFields(
  signers: Signer[],
): Array<{ id: string; completed: boolean }> {
  return signers
    .flatMap((signer) => signer.fields)
    .filter((field) => !field.completed);
}

const incompleteFields = getIncompleteFields(completedSigners);



// G49: function called with correct argument types — no type mismatch
declare type I18nInstance = { locale: string; formats: object };
declare type AuditLogRow = { action: string; userId: string; timestamp: Date; metadata: object };
declare function formatAuditLogAction(i18n: I18nInstance, row: AuditLogRow): string;
declare const i18n: I18nInstance;
declare const logRow: AuditLogRow;

function renderAuditLogCell(i18n: I18nInstance, row: AuditLogRow): string {
  return formatAuditLogAction(i18n, row);
}

const cellText = renderAuditLogCell(i18n, logRow);



// H00: setErrors with functional update using validationErrors.filter — no type mismatch
declare function validateAmount(text: string, meta?: Record<string, unknown>, strict?: boolean): string[];
declare function setAmountErrors(updater: ((prev: { isNumber: string[]; required: string[]; minValue: string[]; maxValue: string[] }) => { isNumber: string[]; required: string[]; minValue: string[]; maxValue: string[] }) | { isNumber: string[]; required: string[]; minValue: string[]; maxValue: string[] }): void;

function handleAmountChange(text: string, parsedMeta?: Record<string, unknown>) {
  if (parsedMeta) {
    const validationErrors = validateAmount(text, parsedMeta, true);
    setAmountErrors({
      isNumber: validationErrors.filter((error) => error.includes('valid number')),
      required: validationErrors.filter((error) => error.includes('required')),
      minValue: validationErrors.filter((error) => error.includes('minimum value')),
      maxValue: validationErrors.filter((error) => error.includes('maximum value')),
    });
  } else {
    const validationErrors = validateAmount(text);
    setAmountErrors((prevErrors) => ({
      ...prevErrors,
      isNumber: validationErrors.filter((error) => error.includes('valid number')),
    }));
  }
}



// H02: array.find with type predicate — standard type narrowing, no type mismatch
type SupportedLocale = 'en' | 'fr' | 'de' | 'es';

declare const APP_CONFIG: { supportedLocales: SupportedLocale[] };

const parseLocaleFromHeader = (header: string): SupportedLocale | null => {
  const [lang] = header.split('-');

  const foundLocale = APP_CONFIG.supportedLocales.find(
    (locale): locale is SupportedLocale => locale === lang,
  );

  if (!foundLocale) {
    return null;
  }

  return foundLocale;
};



// H05: array.filter with array.includes — correct boolean predicate, no type mismatch
interface Task { id: string; assigneeEmail: string; priority: number; }

declare function setActiveTasks(updater: (prev: { tasks: Task[] }) => { tasks: Task[] }): void;

function filterTasksByAssignees(taskData: { tasks: Task[] }, assigneeEmails: string[]) {
  setActiveTasks((prev) => {
    if (!prev) {
      return prev;
    }
    return {
      tasks: taskData.tasks.filter((task) => assigneeEmails.includes(task.assigneeEmail)),
    };
  });
}



// H06: array.filter with compound predicate — standard filter, no type mismatch
interface AuditEntry { data: { userId: number; hasAttachment: boolean }; createdAt: string; }
interface AuditLog { RECORD_UPDATED: AuditEntry[] }

declare const auditLog: AuditLog;
declare function sortByDate(entries: AuditEntry[], key: string, order: string): AuditEntry[];

function getFilteredEntries(userId: number) {
  const filteredEntries = sortByDate(
    auditLog.RECORD_UPDATED.filter(
      (entry) => entry.data.userId === userId && entry.data.hasAttachment,
    ),
    'createdAt',
    'desc',
  );
  return filteredEntries;
}



// H08: map+filter to remove undefined — standard pattern, no type mismatch
interface CanvasShape { id(): string; }
interface FormField { formId: string; recipientId: number; }

declare const selectedShapes: CanvasShape[];
declare const formFields: { getByFormId(id: string): FormField | undefined };

function getSelectedFormFields(): FormField[] {
  return selectedShapes
    .map((shape) => formFields.getByFormId(shape.id()))
    .filter((field): field is FormField => field !== undefined);
}



// H11: ts-pattern match().with() exhaustive discriminated union — correct ts-pattern API usage, no type mismatch
declare const match: <T>(value: T) => { with<P>(pattern: P, handler: () => unknown): any; exhaustive(): unknown };

enum WidgetType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  CHART = 'CHART',
  TABLE = 'TABLE',
}

function renderWidgetEditor(widgetType: WidgetType) {
  return match(widgetType)
    .with(WidgetType.TEXT, () => 'text-editor')
    .with(WidgetType.IMAGE, () => 'image-editor')
    .with(WidgetType.CHART, () => 'chart-editor')
    .with(WidgetType.TABLE, () => 'table-editor')
    .exhaustive();
}



// H12: i18n translation function call with message descriptor — correct usage, no type mismatch
interface MessageDescriptor { id: string; message?: string; }
declare function _(descriptor: MessageDescriptor): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): MessageDescriptor;

function getEmptyStateTitle(category: string): string {
  const title = { id: `empty.${category}`, message: `No ${category} found` };
  return _(title);
}

function getWelcomeMessage(userName: string): string {
  return _(msg`Welcome back, ${userName}`);
}



// H14: setTimeout with async callback and null guard — standard timer usage, no type mismatch
declare function syncDraft(draftId: string): Promise<void>;

function scheduleAutoSync(draftId: string | null, delayMs: number) {
  setTimeout(async () => {
    if (!draftId) {
      return;
    }
    await syncDraft(draftId);
  }, delayMs);
}



// H15: Lingui i18n call with msg template — correct usage, no type mismatch
interface I18nMsg { id: string; values?: Record<string, unknown>; }
declare function _(descriptor: I18nMsg): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): I18nMsg;

function getStatusLabel(status: string): string {
  if (status === 'approved') {
    return _(msg`Approved`);
  } else if (status === 'rejected') {
    return _(msg`Rejected`);
  } else if (status === 'pending') {
    return _(msg`Pending Review`);
  }
  return _(msg`Unknown Status`);
}



// H16: Object.values(enum).map to option objects — standard enum transformation, no type mismatch
enum SubscriptionTier {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

declare const TIER_LABELS: Record<SubscriptionTier, { label: string }>;
declare function _(s: string): string;

const tierOptions = Object.values(SubscriptionTier).map((tier) => ({
  value: tier,
  label: _(TIER_LABELS[tier].label),
}));



// H20: nested find/some — correct types, no type mismatch
interface Team { id: number; slug: string; members: Array<{ userId: number }> }
interface Organization { id: number; teams: Team[] }

declare const organizations: Organization[];
declare const currentTeamSlug: string;

function findCurrentOrganization(): Organization | undefined {
  return organizations.find((org) =>
    org.teams.some((team) => team.slug === currentTeamSlug),
  );
}



// H21: array.map with instanceof RegExp check — standard config transformation, no type mismatch
declare const buildConfig: { ignore: (string | RegExp)[] };

function normalizeIgnorePatterns(overrides: (string | RegExp)[]): (string | RegExp)[] {
  return buildConfig.ignore.map((item) => {
    if (item instanceof RegExp) {
      return new RegExp(item.source, item.flags + 'i');
    }
    return item;
  });
}



// H22: array.find by id — standard lookup, no type mismatch
interface FormEntry { id: number; label: string; value: string; isRequired: boolean; }

declare const localFormEntries: FormEntry[];
declare const incomingEntry: { id: number; value: string };

function mergeIncomingEntry(localEntries: FormEntry[], incoming: { id: number; value: string }): FormEntry | undefined {
  return localEntries.find((e) => e.id === incoming.id);
}



// H27: new Set(array.map(...)).size — standard dedup check, no type mismatch
interface SelectOption { label: string; value: string; }

function validateNoDuplicateValues(options: SelectOption[]): boolean {
  const uniqueValueCount = new Set(options.map((item) => item.value)).size;
  return uniqueValueCount === options.length;
}



// H30: array.filter with method calls on elements — standard filter, no type mismatch
interface LayerGroup { id(): string; isSelected(): boolean; isLocked(): boolean; }

declare const selectedLayerGroups: LayerGroup[];

function getUnlockedSelectedLayers(): LayerGroup[] {
  return selectedLayerGroups.filter(
    (group) => group.isSelected() && !group.isLocked(),
  );
}



// H32: array.map returning spread objects — standard immutable update, no type mismatch
interface CheckboxOption { id: string; label: string; checked: boolean; disabled?: boolean; }

declare function useFormValues(): { options: CheckboxOption[] };
declare function watch(field: string): CheckboxOption[];

function toggleCheckboxOption(currentValues: CheckboxOption[], targetId: string): CheckboxOption[] {
  return currentValues.map((opt) =>
    opt.id === targetId ? { ...opt, checked: !opt.checked } : opt,
  );
}



// H35: _(LABEL_MAP[row.role]) — i18n underscore with enum-keyed map lookup, aligned types, no type mismatch
type ProjectRole = 'OWNER' | 'ADMIN' | 'VIEWER' | 'EDITOR';

declare const PROJECT_ROLE_LABELS: Record<ProjectRole, string>;
declare function _(label: string): string;

function getRoleDisplayName(role: ProjectRole): string {
  return _(PROJECT_ROLE_LABELS[role]);
}



// H36: optional chain map returning objects — standard array map, no type mismatch
interface PollChoice { label: string; value: string; isDefault?: boolean; }
interface PollMeta { choices?: PollChoice[] }

declare const parsedPollMeta: PollMeta | null;

const pollChoiceItems = parsedPollMeta?.choices?.map((choice) => ({
  label: choice.label,
  value: choice.value,
  checked: choice.isDefault ?? false,
})) ?? [];



// H38: _(msg`...`) Lingui translation macro pattern — no type mismatch
interface I18nDescriptor { id: string; message?: string; }
declare function _(descriptor: I18nDescriptor): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): I18nDescriptor;

function getAuditActionLabel(action: string): string {
  if (action === 'CREATED') return _(msg`Created`);
  if (action === 'UPDATED') return _(msg`Updated`);
  if (action === 'DELETED') return _(msg`Deleted`);
  if (action === 'SHARED') return _(msg`Shared`);
  return _(msg`Unknown Action`);
}



// H44: ts-pattern match().with() exhaustive discriminated union (enum) — correct ts-pattern API, no type mismatch
declare const match: <T>(value: T) => { with<P>(pattern: P, handler: () => unknown): any; exhaustive(): unknown };

enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
  WEBHOOK = 'WEBHOOK',
}

function getNotificationIcon(channel: NotificationChannel): string {
  return match(channel)
    .with(NotificationChannel.EMAIL, () => 'mail')
    .with(NotificationChannel.SMS, () => 'message-circle')
    .with(NotificationChannel.PUSH, () => 'bell')
    .with(NotificationChannel.WEBHOOK, () => 'link')
    .exhaustive() as string;
}



// H47: Lingui tagged template with interpolation — correct usage, no type mismatch
interface I18nMsg { id: string; values?: Record<string, unknown>; }
declare function _(descriptor: I18nMsg): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): I18nMsg;

function getBatchCompleteMessage(operationName: string, count: number): string {
  return _(msg`Batch operation "${operationName}" completed for ${count} items`);
}

function getExportReadyMessage(reportName: string): string {
  return _(msg`Your export for report "${reportName}" is ready to download`);
}



// FP shape 301a39b60772: new Date(nullable) comparison — standard expiry check
declare const record: { expiresAt: string | null };

export function isRecordExpired(): boolean {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt) <= new Date();
}



// Array map with single-argument passthrough — no type mismatch
declare function mapOrderToSummary(order: { id: string; total: number; status: string }): { id: string; total: number; label: string };
declare const orders: Array<{ id: string; total: number; status: string }>;

function getOrderSummaries() {
  return {
    data: orders.map((order) => mapOrderToSummary(order)),
  };
}



// i18n.date() with Date argument — correct usage, no type mismatch
declare const i18n: { date: (date: Date, options?: Record<string, any>) => string };
declare const renewalDate: Date;
declare const trialEndDate: Date;

function formatSubscriptionDates() {
  const renewalFormatted = i18n.date(renewalDate);
  const trialFormatted = i18n.date(trialEndDate);
  return { renewalFormatted, trialFormatted };
}



// Promise.all with async map — standard parallel execution pattern, no type mismatch
declare function buildNotificationPayload(opts: { userId: string; channel: string; template: string }): Promise<{ payload: string }>;
declare const allRecipients: Array<{ userId: string; channel: string }>;

async function sendBulkNotifications(template: string) {
  await Promise.all(
    allRecipients.map(async (recipient) => {
      const payload = buildNotificationPayload({
        userId: recipient.userId,
        channel: recipient.channel,
        template,
      });

      return payload;
    }),
  );
}



// row.getValue() as string — intentional runtime assertion, no type mismatch bug
declare const row: { getValue: (key: string) => unknown };

function renderCellTitle() {
  const title = row.getValue('title') as string;
  const ownerName = row.getValue('ownerName') as string;
  return { title, ownerName };
}



// Buffer.from(buffer) — standard Node.js Buffer creation, no type mismatch
declare const Buffer: { from: (data: ArrayBuffer | Uint8Array | Buffer | string) => Buffer };
declare const rawData: ArrayBuffer;

function wrapPdfBuffer(rawData: ArrayBuffer) {
  const pdfBuffer = Buffer.from(rawData);
  return pdfBuffer;
}



// Promise.all(array.map(asyncFn)) — correct parallel invocation, no type mismatch
declare function loadTranslation(locale: string): Promise<{ [key: string]: string }>;
declare const SUPPORTED_LOCALES: string[];

const allTranslations = Promise.all(SUPPORTED_LOCALES.map(loadTranslation));



// .filter() with boolean predicate callback — correct usage, no type mismatch
declare function isRequiredField(field: { type: string; required: boolean }): boolean;
declare const localFields: Array<{ type: string; required: boolean; signedValue?: string; inserted?: boolean }>;

function getRequiredFields() {
  return localFields.filter((field) => {
    return field.signedValue !== undefined && (isRequiredField(field) || field.inserted);
  });
}



// optional-chain array map — standard pattern, no type mismatch
type FieldMapping = { key: string; value: string; fieldId: string };
declare const customFieldData: FieldMapping[] | undefined;

function mapCustomFields() {
  return customFieldData?.map((mapping) => ({
    key: mapping.key,
    resolvedValue: mapping.value,
    id: mapping.fieldId,
  }));
}



// Number.isInteger(value) — correct Number static method usage, no type mismatch
function parsePositiveInteger(rawInput: string): number | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}



// string.startsWith() with string literal — correct usage, no type mismatch
function isInternalNetwork(ipAddress: string): boolean {
  const host = ipAddress.toLowerCase();

  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host.startsWith('172.')) return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe80:')) return true;

  return false;
}



// array.filter with compound predicate — standard array filter, no type mismatch
type FormField = { pageNumber: number; attachmentId: string; type: string };
declare const formFields: FormField[];
declare const currentAttachmentId: string;
declare const maxPages: number;

function getVisibleFields() {
  return formFields.filter(
    (field) => field.attachmentId !== currentAttachmentId || field.pageNumber <= maxPages,
  );
}



// Type guard call on env var string — correct usage, no type mismatch
declare const process: { env: { [key: string]: string | undefined } };
type AuthMode = 'sso' | 'basic' | 'none';

function isAuthMode(value: string | undefined): value is AuthMode {
  return value === 'sso' || value === 'basic' || value === 'none';
}

function resolveAuthMode(): AuthMode {
  let authMode: AuthMode = 'basic';

  if (process.env.AUTH_MODE && isAuthMode(process.env.AUTH_MODE)) {
    authMode = process.env.AUTH_MODE;
  }

  return authMode;
}



// array.map with ternary immutable update — standard pattern, no type mismatch
type UploadingFile = { attachmentId: string; title: string; status: string };
declare const localFiles: UploadingFile[];
declare const targetAttachmentId: string;
declare const newTitle: string;

function updateFileTitle() {
  const updatedFiles = localFiles.map((file) =>
    file.attachmentId === targetAttachmentId ? { ...file, title: newTitle } : file,
  );

  return updatedFiles;
}



// Promise.all with mixed tuple entries — standard parallel execution, no type mismatch
declare function getTeamPlan(opts: { teamId: string }): Promise<{ planName: string }>;
declare function getAuditEvents(entityId: string): Promise<Array<{ action: string; timestamp: Date }>>;
declare const translationsReady: Promise<Record<string, string>>;
declare const teamId: string;
declare const entityId: string;

async function loadAuditPageData() {
  const [teamPlan, auditEvents, messages] = await Promise.all([
    getTeamPlan({ teamId }),
    getAuditEvents(entityId),
    translationsReady,
  ]);

  return { teamPlan, auditEvents, messages };
}



// paginated data map with identity passthrough — no type mismatch
declare function normalizeOrderRecord(order: { id: string; total: number; userId: string }): { id: string; total: number; ownerId: string };
declare const orders: { data: Array<{ id: string; total: number; userId: string }>; total: number };

function getNormalizedOrders() {
  return {
    ...orders,
    data: orders.data.map((order) => normalizeOrderRecord(order)),
  };
}



// array.find with type comparison callback — standard array find, no type mismatch
type FormField = { type: string; customText: string };
declare const fields: FormField[];

const FIELD_TYPE_NAME = 'name';
const FIELD_TYPE_EMAIL = 'email';

function resolveRecipientDetails(fallbackName: string, fallbackEmail: string) {
  const nameField = fields.find((field) => field.type === FIELD_TYPE_NAME);
  const emailField = fields.find((field) => field.type === FIELD_TYPE_EMAIL);

  return {
    name: nameField?.customText || fallbackName,
    email: emailField?.customText || fallbackEmail,
  };
}



// array.filter((v) => v !== value) — standard exclusion filter, no type mismatch
declare let selectedOptions: string[];

function toggleOption(value: string) {
  const isSelected = selectedOptions.includes(value);

  if (isSelected) {
    selectedOptions = selectedOptions.filter((v) => v !== value);
  } else {
    selectedOptions = [...selectedOptions, value];
  }

  return selectedOptions;
}



// array.map with recipients.findIndex lookup — standard map with index lookup, no type mismatch
type Recipient = { id: string; email: string };
type LayoutItem = { recipientId: string; x: number; y: number };
declare const layoutItems: LayoutItem[];
declare const recipients: Recipient[];

function annotateLayoutItems() {
  return layoutItems.map((item) => {
    const recipientIndex = recipients.findIndex((r) => r.id === item.recipientId);

    return {
      ...item,
      recipientIndex: recipientIndex === -1 ? 0 : recipientIndex,
    };
  });
}



// .map().filter(Boolean) on string[] — Boolean as filter predicate is idiomatic TypeScript, no type mismatch
type CheckboxOption = { id: number; checked: boolean; value: string };
declare const options: CheckboxOption[];

function getInitialCheckedValues(options: CheckboxOption[]): string[] {
  return options
    .map((item) => (item.checked ? (item.value.length > 0 ? item.value : `empty-${item.id}`) : ''))
    .filter(Boolean);
}



// number[].includes(number) — correct type usage, no type mismatch
declare const selectedIndices: number[];

function isIndexSelected(index: number): boolean {
  return selectedIndices.includes(index);
}

function getSelectionState(items: string[]) {
  return items.map((item, index) => ({
    item,
    isSelected: selectedIndices.includes(index),
  }));
}



// Number.isNaN(numValue) — standard NaN check on number from Number(), no type mismatch
function parseFieldValue(rawValue: string, fieldType: string): number | null {
  if (
    fieldType === 'fontSize' ||
    fieldType === 'maxLength' ||
    fieldType === 'minValue'
  ) {
    const numValue = Number(rawValue);

    if (!Number.isNaN(numValue)) {
      return numValue;
    }
  }

  return null;
}



// array.map extracting IDs — standard map for uniqueness check, no type mismatch
type Signer = { id: string; email: string; name: string };

function validateUniqueSignerIds(signers: Signer[]): boolean {
  const ids = signers.map((signer) => signer.id);
  return new Set(ids).size === ids.length;
}



// Array.filter with boolean predicate — standard array filtering, no type mismatch
type Field = { id: string; type: string; inserted: boolean; recipient: { signingStatus: string } };
declare const SIGNING_STATUS_SIGNED: string;

function partitionFields(fields: Field[]) {
  const pendingFields = fields.filter(
    (field) => field.recipient.signingStatus !== SIGNING_STATUS_SIGNED,
  );

  const completedFields = fields.filter(
    (field) => field.recipient.signingStatus === SIGNING_STATUS_SIGNED,
  );

  return { pendingFields, completedFields };
}



// FP shape: standard async map for file uploads; no type mismatch
declare function uploadFile(item: { name: string; data: ArrayBuffer }): Promise<string>;
declare const filesToUpload: Array<{ name: string; data: ArrayBuffer }>;

async function uploadAll() {
  const urls = await Promise.all(
    filesToUpload.map(async (item) => uploadFile(item))
  );
  return urls;
}



// FP shape: array map with ternary substitution for immutable update; no type mismatch
declare const recipients: Array<{ id: string; fields: Array<{ id: string; value: string }> }>;
declare const targetFieldId: string;
declare const newValue: string;

const updated = recipients.map((r) => ({
  ...r,
  fields: r.fields.map((f) => (f.id === targetFieldId ? { ...f, value: newValue } : f)),
}));



// FP shape: P.when() pattern matching predicate; no type mismatch
declare function match<T>(val: T): { with: <P>(pattern: P, fn: (v: T) => unknown) => { otherwise: (fn: () => unknown) => unknown } };
declare const P: { when: (pred: (v: unknown) => boolean) => unknown };
declare const userCount: number;

const label = match(userCount)
  .with(P.when((n) => (n as number) > 100), () => 'large')
  .otherwise(() => 'small');



// FP shape: i18n translate fn called with MessageDescriptor; no type mismatch
declare const _: (msg: { id: string; message?: string }) => string;
declare const steps: Array<{ label: { id: string; message?: string } }>;

function renderStepLabels() {
  return steps.map((step) => _(step.label));
}



// FP shape: array.find by id in provider state; no type mismatch
declare const participant: { items: Array<{ id: string; value: string }> };
declare const targetId: string;

const found = participant.items.find((item) => item.id === targetId);



// FP shape: optional-chain array.find with boolean property; no type mismatch
declare const selections: Array<{ id: string; selected: boolean }> | undefined;

const defaultSelected = selections?.find((item) => item.selected);



// FP shape: i18n translate _ called with tagged template MessageDescriptor; no type mismatch
declare const _: (msg: { id: string; message?: string }) => string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string; message?: string };

const label = _(msg`Order Reference`);
const subtitle = _(msg`Tracking ID`);



// FP shape: i18n translate _ with MessageDescriptor from dict index; no type mismatch
declare const _: (msg: { id: string; message?: string }) => string;
declare const uploadHeadings: Record<string, { id: string; message?: string }>;
declare const uploadType: string;

const uploadLabel = _(uploadHeadings[uploadType]);



// FP shape: array.find matching by string property; no type mismatch
declare const workspaces: Array<{ url: string; id: string; displayName: string }>;
declare const currentWorkspaceUrl: string;

const activeWorkspace = workspaces.find((ws) => ws.url === currentWorkspaceUrl);



// FP shape: array.find with compound predicate — no type mismatch
declare const teamGroups: Array<{ groupType: string; members: Array<{ userId: number }> }>;
declare const currentUserId: number;

function findInternalGroup() {
  const internalGroup = teamGroups.find(
    (group) =>
      group.groupType === 'INTERNAL' &&
      group.members.some((member) => member.userId === currentUserId),
  );
  return internalGroup ? 'Member' : 'External';
}



// FP shape: STRING_ARRAY.find(item => item === value) — standard string find with ===
declare const SUPPORTED_LOCALES: string[];
declare const userPreferredLocale: string | undefined;

function resolveLocale(fallback: string): string {
  const matched = SUPPORTED_LOCALES.find((locale) => locale === userPreferredLocale);
  return matched ?? fallback;
}



// FP shape: opts.list.find with compound predicate — standard array find
declare const requestConfig: { operationList: Array<{ method: string; path: string; requiresAuth: boolean }> };
declare const currentMethod: string;
declare const currentPath: string;

function findMatchingOperation() {
  const match = requestConfig.operationList.find(
    (op) => op.method === currentMethod && op.path === currentPath && op.requiresAuth,
  );
  return match;
}



// FP shape: array.map with ternary substitution — no type mismatch
declare const participant: { formFields: Array<{ fieldId: string; value: string | null; placeholder: string }> };
declare const submittedValues: Record<string, string>;

function resolveFormFields() {
  return participant.formFields.map((field) => ({
    ...field,
    value: submittedValues[field.fieldId] !== undefined
      ? submittedValues[field.fieldId]
      : field.placeholder,
  }));
}



// FP shape: obj?.array.find(item => item.nested.some(...)) — standard optional-chain nested find/some
declare const order: { lineItems: Array<{ tags: string[]; category: string }> } | null | undefined;
declare const targetCategory: string;
declare const requiredTag: string;

function findMatchingLineItem() {
  return order?.lineItems.find(
    (item) => item.category === targetCategory && item.tags.some((tag) => tag === requiredTag),
  );
}



// FP shape: (data?.pages ?? []).flatMap(page => page.items) — nullish coalescing + flatMap
declare const activityFeed: { pages: Array<{ items: Array<{ id: string; message: string }> }> } | undefined;

function getAllActivityItems() {
  return (activityFeed?.pages ?? []).flatMap((page) => page.items);
}



// FP shape: array.find(item => item.id === targetId) — id comparison with number is correct
declare const participants: Array<{ id: number; name: string; email: string }>;
declare const selectedParticipantId: number | null;

function findSelectedParticipant() {
  const participant = participants.find(
    (participant) => participant.id === selectedParticipantId,
  );
  return participant;
}



// FP shape: array.filter(item => item.ownerId === person.id) — standard filter by id
declare const project: { tasks: Array<{ taskId: string; ownerId: number; title: string }> };
declare const assignee: { id: number; name: string };

function getTasksForAssignee() {
  return project.tasks.filter((task) => task.ownerId === assignee.id);
}



// FP shape: match(value).with({ type: Enum.VALUE }, handler) — ts-pattern discriminated union match
declare function match<T>(value: T): { with: (pattern: Partial<T>, fn: (v: T) => unknown) => any; otherwise: (fn: () => unknown) => unknown };
declare enum NotificationKind { EMAIL = 'EMAIL', SMS = 'SMS', PUSH = 'PUSH' }
declare const notification: { kind: NotificationKind; payload: unknown };

function renderNotificationPreview() {
  return match(notification)
    .with({ kind: NotificationKind.EMAIL }, (n) => `Email: ${JSON.stringify(n.payload)}`)
    .with({ kind: NotificationKind.SMS }, (n) => `SMS: ${JSON.stringify(n.payload)}`)
    .otherwise(() => 'Unknown notification type');
}



// Wave-M03: spread of function return value into object literal — no type mismatch
declare function clampPositionValues(data: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number };
declare function generateId(len: number): string;
declare function appendField(field: object): void;
declare function triggerUpdate(): void;
declare function setSelected(id: string, focus: boolean): void;

function addField(fieldData: { x: number; y: number; width: number; height: number; type: string }) {
  const field = {
    ...fieldData,
    formId: generateId(12),
    ...clampPositionValues(fieldData),
  };
  appendField(field);
  triggerUpdate();
  setSelected(field.formId, true);
  return field;
}



// Wave-M09: URLSearchParams.set(string, string) — both args are correct types
declare const searchParams: URLSearchParams;
declare const filterValue: string;

function buildFilteredUrl(baseUrl: string, filterValue: string): string {
  const params = new URLSearchParams(searchParams.toString());
  params.set('filter', filterValue);
  params.delete('page');
  return `${baseUrl}?${params.toString()}`;
}



// Wave-M17: String(num).padStart(width, padChar) — both args correct types
function formatDuration(totalMinutes: number): string {
  const hours = Math.abs(Math.floor(totalMinutes / 60));
  const minutes = Math.abs(totalMinutes % 60);
  const sign = totalMinutes >= 0 ? '+' : '-';
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}



// Wave-M28: i18n._(MAP[key]) — translation call with MessageDescriptor from a map
declare interface MessageDescriptor { id: string; message: string; }
declare const STATUS_LABEL_MAP: Record<string, MessageDescriptor>;
declare const i18n: { _: (descriptor: MessageDescriptor) => string };
declare const currentStatus: string;

const statusLabel = STATUS_LABEL_MAP[currentStatus]
  ? i18n._(STATUS_LABEL_MAP[currentStatus])
  : 'Unknown';



// Wave-M32: fn(array.flatMap((item) => item.subItems)) — flatMap result matches expected param type
declare const permissionGroups: Array<{ id: string; teamPermissions: Array<{ role: string; level: number }> }>;
declare function getHighestPermissionLevel(permissions: Array<{ role: string; level: number }>): string;

const highestLevel = getHighestPermissionLevel(
  permissionGroups.flatMap((group) => group.teamPermissions)
);



// Wave-M36: translate(taggedTemplateLiteral) — Lingui-style i18n call, correct type
declare function translate(descriptor: TemplateStringsArray, ...values: unknown[]): string;
declare const _: (template: TemplateStringsArray, ...values: unknown[]) => string;

// Simulated tagged-template i18n usage
const authLabel = _`Authentication Level`;
const statusLabel = _`Status`;
const roleLabel = _`User Role`;



// Wave-M43: getColorStyles(array.findIndex((r) => r.id === target.id)) — number result passed to fn expecting number
declare function getParticipantColorStyles(index: number): { backgroundColor: string; borderColor: string } | null;
declare const participants: Array<{ id: string; name: string }>;
declare const currentParticipant: { id: string };

const colorStyles = getParticipantColorStyles(
  participants.findIndex((p) => p.id === currentParticipant.id)
);



// FP: _(messageDescriptor) call where _ is i18n translation function accepting MessageDescriptor
interface MessageDescriptor { id: string; defaultMessage?: string; }
declare function _: (descriptor: MessageDescriptor) => string;
declare const pageTitle: MessageDescriptor;
declare const pageSubtitle: MessageDescriptor;

function getLocalizedTitles() {
  return {
    title: _(pageTitle),
    subtitle: _(pageSubtitle),
  };
}



// FP: _(msg`Reason`) lingui tagged template translation — types correct
interface MessageDescriptor { id: string; defaultMessage: string; }
declare function _: (descriptor: MessageDescriptor) => string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): MessageDescriptor;

const reasonLabel = _(msg`Reason`);
const statusLabel = _(msg`Status`);
const dateLabel = _(msg`Date signed`);



// FP: formatter.date(expiresAt) where expiresAt is a Date object, formatter.date accepts Date
declare const formatter: { date: (value: Date, options?: { dateStyle?: string }) => string };
declare const expiresAt: Date;
declare const createdAt: Date;

function formatSubscriptionDates() {
  return {
    expiry: formatter.date(expiresAt),
    created: formatter.date(createdAt, { dateStyle: 'long' }),
  };
}



// Array.find() with multi-condition predicate on nested properties
// All comparisons are type-correct (enum === enum, string === string)
declare const enum ProductCategory {
  ELECTRONICS = 'ELECTRONICS',
  CLOTHING = 'CLOTHING',
  BOOKS = 'BOOKS',
}

declare const enum StockStatus {
  IN_STOCK = 'IN_STOCK',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

interface InventoryItem {
  warehouse: {
    category: ProductCategory;
    region: string;
  };
  productId: string;
  status: StockStatus;
}

interface Inventory {
  items: InventoryItem[];
}

export function findElectronicsInStock(inventory: Inventory, productId: string): InventoryItem | undefined {
  const item = inventory.items.find(
    (item) =>
      item.warehouse.category === ProductCategory.ELECTRONICS &&
      item.productId === productId &&
      item.status === StockStatus.IN_STOCK,
  );
  
  return item;
}

export function findClothingLowStock(inventory: Inventory, region: string): InventoryItem | undefined {
  return inventory.items.find(
    (item) =>
      item.warehouse.category === ProductCategory.CLOTHING &&
      item.warehouse.region === region &&
      item.status === StockStatus.LOW_STOCK,
  );
}

export function findBookByIdAndRegion(inventory: Inventory, productId: string, region: string): InventoryItem | undefined {
  const result = inventory.items.find(
    (item) =>
      item.warehouse.category === ProductCategory.BOOKS &&
      item.warehouse.region === region &&
      item.productId === productId,
  );
  return result;
}



// Snippet: Object.entries with explicit type assertion to typed tuple array
declare const assigneesByRole: Record<string, unknown[]>;
type AssigneeRole = 'viewer' | 'editor' | 'owner';
type TAssigneeLite = { id: number; name: string; role: AssigneeRole };

export function getTypedAssigneeEntries() {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (Object.entries(assigneesByRole) as [AssigneeRole, TAssigneeLite[]][]).filter(
    ([role]) => role !== 'viewer',
  );
}



// Snippet: .filter() with multi-condition predicate comparing typed object properties
declare const pageIndex: number;
declare const currentItemId: string | undefined;
declare const annotationFields: Array<{ page: number; itemId: string; label: string }>;

export function getFieldsForPage() {
  return annotationFields.filter(
    (field) => field.page === pageIndex && field.itemId === currentItemId,
  );
}



// Snippet: Array.find with equality predicate on matching enum types
type MembershipLevel = 'basic' | 'pro' | 'enterprise';
declare const memberGroups: Array<{ id: string; membershipLevel: MembershipLevel; seats: number }>;
declare const currentLevel: MembershipLevel;

export function findGroupByLevel() {
  return memberGroups.find((group) => group.membershipLevel === currentLevel);
}



// Snippet: tagged template call used as nullish fallback — correct string return type
declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;
declare const auditRecord: { deviceInfo?: string } | undefined;

export function getDeviceDisplay(): string {
  return auditRecord?.deviceInfo ?? t`Unknown device`;
}



// Snippet: .filter() with compound inequality predicates on string-typed values
declare const selectedTags: string[];
declare const tagToRemove: { value: string };
declare const EMPTY_TAG_PREFIX = 'empty-';

export function removeTag(id: number): string[] {
  return selectedTags.filter(
    (v) => v !== tagToRemove.value && v !== `${EMPTY_TAG_PREFIX}${id}`,
  );
}



// Snippet: .filter() callback with strict inequality on correctly-typed id fields
declare const workspaces: Array<{ id: number; name: string }>;
declare const workspaceIdToRemove: number;

export function removeWorkspace(): Array<{ id: number; name: string }> {
  return workspaces.filter((ws) => ws.id !== workspaceIdToRemove);
}



// Snippet: Object.values().some() checking non-empty string arrays — no type mismatch
declare const validationErrors: Record<string, string[]>;

export function hasAnyValidationError(): boolean {
  return Object.values(validationErrors).some((errorList) => errorList.length > 0);
}



// Snippet: .map() over typed array building objects with destructured properties
declare const formFields: Array<{ id: number; pageNumber: number; x: number; y: number; width: number; height: number; kind: string }>;

export function normalizeFields() {
  return formFields.map((field) => ({
    id: field.id,
    page: field.pageNumber,
    positionX: Number(field.x),
    positionY: Number(field.y),
    width: Number(field.width),
    height: Number(field.height),
    type: field.kind,
  }));
}



// Snippet: chained getValues().filter() comparing formId fields of same type
declare const formValues: { collaborators: Array<{ formId: string; email: string }> };
declare const collaboratorToRemove: { formId: string };

export function removeCollaborator() {
  return formValues.collaborators.filter(
    (c) => c.formId !== collaboratorToRemove.formId,
  );
}



// Snippet: function call with string argument — correct types
declare function formatWorkspaceUrl(slug: string): string;
declare const workspace: { slug: string; name: string };

export function getDisplayUrl(): string {
  return formatWorkspaceUrl(workspace.slug);
}



// Snippet: addEventListener with correctly-typed MessageEvent handler
declare function useSetup(fn: () => void | (() => void)): void;
declare function processPostMessage(event: MessageEvent): void;

export function registerMessageListener() {
  useSetup(() => {
    window.addEventListener('message', processPostMessage);
    return () => window.removeEventListener('message', processPostMessage);
  });
}



// Snippet: optional chaining .some() comparing id fields of the same type
declare const parentGroup: { childGroups: Array<{ parentId: number }> } | null;
declare const parentId: number;

export function hasChildInParent(): boolean {
  return parentGroup?.childGroups.some((child) => child.parentId === parentId) ?? false;
}



// Snippet: Object.values().filter() with destructured property in predicate — types correct
declare const FEATURE_FLAGS: Record<string, { key: string; label: string }>;
declare const activeFlags: Record<string, boolean>;

export function getActiveFeatureLabels(): string[] {
  return Object.values(FEATURE_FLAGS)
    .filter(({ key }) => activeFlags[key])
    .map(({ label }) => label);
}



// Snippet: optional chaining with .map() — valid optional member access
declare const submission: { attachments?: Array<{ id: string; url: string }> };

export function getAttachmentUrls(): string[] | undefined {
  return submission.attachments?.map((attachment) => attachment.url);
}



// Snippet: standard array map with object spread — not a type mismatch
declare const participants: Array<{ id: string; nativeId: number; email: string; permissions?: string[] }>;

export function normalizeParticipants() {
  return participants.map((participant) => ({
    ...participant,
    id: participant.nativeId,
    permissions: participant.permissions ?? [],
  }));
}



// Snippet: inner async callback in nested async map — standard Promise.all pattern
declare const invoices: Array<{ id: string; lineItems: Array<{ sku: string; qty: number }> }>;
declare function chargeLineItem(invoiceId: string, sku: string, qty: number): Promise<void>;

export async function chargeAllInvoices() {
  await Promise.all(
    invoices.map(async (invoice) => {
      await Promise.all(
        invoice.lineItems.map(async (item) => chargeLineItem(invoice.id, item.sku, item.qty)),
      );
    }),
  );
}



// Snippet: Promise .catch usage with error typed as unknown — correct pattern
declare function uploadResource(payload: FormData): Promise<{ id: string }>;
declare const resourcePayload: FormData;

export async function handleUpload(): Promise<void> {
  const { id } = await uploadResource(resourcePayload).catch((error: unknown) => {
    console.error(error);
    throw error;
  });
  console.log('uploaded', id);
}



// Snippet: .find() callback with string equality predicate — both sides are strings
declare const validationRules: Array<{ label: string; value: number }>;
declare const selectedRule: string;

export function findSelectedRule() {
  return validationRules.find((rule) => rule.label === selectedRule);
}



// Shape: find() with typed equality comparison on object properties
declare const FieldType: { SIGNATURE: string; INITIALS: string };
interface ContractField { signatoryId: number; category: string; }
interface Signatory { id: number; email: string; }
declare const contractFields: ContractField[];
declare const signatories: Signatory[];

function getSignatureFieldForSignatory(signatory: Signatory): ContractField | undefined {
  return contractFields.find(
    (field) => field.signatoryId === signatory.id && field.category === FieldType.SIGNATURE,
  );
}



// Shape: find() callback comparing enum property on nested group object
declare const WorkspaceGroupType: { INTERNAL_TEAM: string; EXTERNAL: string };
interface WorkspaceGroup { workspaceRole: string; groupType: string; workspaceId: string; }
interface TeamRecord { workspaceGroups: WorkspaceGroup[]; }
declare const team: TeamRecord;
declare const workspaceId: string;

function findMemberGroup(team: TeamRecord): WorkspaceGroup | undefined {
  return team.workspaceGroups.find(
    (group) => group.groupType === WorkspaceGroupType.INTERNAL_TEAM && group.workspaceId === workspaceId,
  );
}



// Shape: Object.fromEntries() with Headers.entries() — correct iterable argument
declare const httpResponse: { headers: Headers; ok: boolean; status: number };

function extractResponseHeaders(response: { headers: Headers }): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}



// Shape: string.startsWith() with string literal — valid stdlib call
declare const searchQuery: string;

function resolveSearchFilter(searchQuery: string) {
  if (searchQuery && searchQuery.startsWith('invoice_')) {
    return { type: 'invoice', id: searchQuery };
  }
  if (searchQuery && searchQuery.startsWith('order_')) {
    return { type: 'order', id: searchQuery };
  }
  return { type: 'text', term: searchQuery };
}



// Shape: .filter() with type predicate narrowing PromiseRejectedResult
async function sendBatchInvites(invites: { email: string; token: string }[]) {
  const sendResults = await Promise.allSettled(
    invites.map(async ({ email, token }) => fetch(`/api/invite?token=${token}&email=${email}`)),
  );

  const failedResults = sendResults.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (failedResults.length > 0) {
    console.error('Some invites failed', failedResults.map((r) => r.reason));
  }
}



// Shape: tagged template literal translation function call with correct types
declare function _(msg: TemplateStringsArray | { id: string }): string;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): { id: string };

function getLocalizedLabel(key: string): string {
  switch (key) {
    case 'browser': return _(msg`Browser`);
    case 'device': return _(msg`Device`);
    case 'os': return _(msg`Operating System`);
    default: return _(msg`Unknown`);
  }
}



// Shape: .filter() with Set.has() to deduplicate — correct types
function deduplicateByEmail(participants: { email: string; name: string }[]): { email: string; name: string }[] {
  const seen = new Set<string>();
  return participants.filter((participant) => {
    if (seen.has(participant.email)) return false;
    seen.add(participant.email);
    return true;
  });
}



// Shape: .findIndex() with equality comparison on formId string property
interface SignerEntry { formId: string; email: string; name: string; }
declare const form: { getValues(field: 'participants'): SignerEntry[] };
declare const currentSigner: SignerEntry;

function removeSignerFromForm(currentSigner: SignerEntry) {
  const index = form.getValues('participants').findIndex((s) => s.formId === currentSigner.formId);
  return index;
}



// Shape: Array.every() with RegExp.test() — valid stdlib call
declare const emailRegex: RegExp;

function validateEmailList(emails: string[]): boolean {
  return emails.every((email) => emailRegex.test(email));
}

function validateSlugList(slugs: string[]): boolean {
  const slugPattern = /^[a-z0-9-]+$/;
  return slugs.every((slug) => slugPattern.test(slug));
}



// Shape: function call with string concatenation argument — both string, correct types
declare function buildCdnUrl(path: string): string;

function getStaticAssetUrl(baseUrl: string, assetKey: string): string {
  return buildCdnUrl('/assets/' + assetKey);
}

function getIconUrl(iconName: string): string {
  return buildCdnUrl('/icons/' + iconName + '.svg');
}



// Shape: Array.find() with optional chaining on config property — correct string comparison
declare const SUPPORTED_LOCALES: string[];
declare const userPreferences: { locale?: string } | null;

function resolveLocale(userPreferences: { locale?: string } | null): string {
  const matched = SUPPORTED_LOCALES.find((locale) => locale === userPreferences?.locale);
  return matched ?? 'en';
}



// Shape: .map() with ternary that replaces a matching item — valid array update pattern
interface FormWidget { id: string; value: string; completed: boolean; }
declare const widgets: FormWidget[];
declare const updatedWidget: FormWidget;

function replaceWidget(widgets: FormWidget[], updatedWidget: FormWidget): FormWidget[] {
  return widgets.map((widget) => (widget.id === updatedWidget.id ? updatedWidget : widget));
}



// Shape: .some() with equality comparison on string property — both strings, valid
interface Attendee { email: string; name: string; }
declare const attendees: Attendee[];

function isEmailRegistered(attendees: Attendee[], email: string): boolean {
  return attendees.some((attendee) => attendee.email === email);
}



// Shape: .map() building objects with undefined data field — valid object construction
interface AttachmentItem { title: string; itemId: string; data?: string; }
interface AttachmentSlot { title: string; itemId: string; data: string | undefined; }
declare const attachmentItems: AttachmentItem[];

function buildAttachmentSlots(items: AttachmentItem[]): AttachmentSlot[] {
  return items.map((item) => ({
    title: item.title,
    itemId: item.itemId,
    data: undefined,
  }));
}



// Shape: .map().filter() chained — map extracts IDs, filter narrows out undefined
interface CanvasNode { id(): string | undefined; hasName(name: string): boolean; }
declare const selectedNodes: CanvasNode[];

function getSelectedNodeIds(nodes: CanvasNode[]): string[] {
  return nodes
    .map((node) => node.id())
    .filter((id): id is string => id !== undefined);
}



// Shape: .find() with optional chain and nullish coalescing to default empty string
interface Member { id: number; accessToken: string; email: string; }
interface WidgetConfig { memberId: number; label: string; }
declare const members: Member[];

function getMemberTokenForWidget(widget: WidgetConfig): string {
  return members.find((member) => member.id === widget.memberId)?.accessToken ?? '';
}



// Shape: tagged template literal (t`...`) used as JSX expression/string — valid Lingui usage
declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;

function formatPlanLimit(limit: number | null): string {
  if (limit === null || limit === 0) {
    return t`Unlimited`;
  }
  return String(limit);
}



// Shape: Object.values().some() with cast via 'as keyof T' — explicit assertion pattern
interface FeatureFlags { betaAccess: boolean; advancedReporting: boolean; apiAccess: boolean; }
interface FeatureFlag { key: string; isEnterprise: boolean; label: string; }
declare const FEATURE_FLAGS: FeatureFlag[];
declare const licenseFlags: FeatureFlags | null;

function hasRestrictedFeatures(licenseFlags: FeatureFlags | null): boolean {
  return Object.values(FEATURE_FLAGS).some(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    (flag) => flag.isEnterprise && !licenseFlags?.[flag.key as keyof FeatureFlags],
  );
}



// Shape: .map() with destructured [key, values] tuple from entries — valid pattern
type CategoryMap = Map<string, { id: number; name: string }[]>;
declare const itemsByCategory: [string, { id: number; name: string }[]][];

function renderCategoryGroups(itemsByCategory: [string, { id: number; name: string }[]][], renderItem: (item: { id: number; name: string }) => string) {
  return itemsByCategory.map(([category, categoryItems], categoryIndex) => ({
    category,
    index: categoryIndex,
    items: categoryItems.map(renderItem),
  }));
}



// Shape: Array.includes(stringValue) — string item, string array, valid stdlib call
function validateCsvColumns(csvHeaders: string[], requiredColumns: string[]): void {
  for (const column of requiredColumns) {
    if (!csvHeaders.includes(column)) {
      throw new Error(`Missing required column: ${column}`);
    }
  }
}



// Shape: .filter((_, idx) => idx !== index) — number comparison on indices, valid
function removeItemAtIndex<T>(items: T[], index: number): T[] {
  return items.filter((_, idx) => idx !== index);
}



// Shape: .filter() on typed audit log array comparing log.type and log.data.recipientId
interface AuditLogEntry {
  type: string;
  data: { recipientId?: number; [key: string]: unknown };
  createdAt: Date;
}
declare const auditLogs: AuditLogEntry[];

function getRecipientAuditLogs(auditLogs: AuditLogEntry[], recipientId: number) {
  return {
    openedLogs: auditLogs.filter(
      (log) => log.type === 'DOCUMENT_OPENED' && log.data.recipientId === recipientId,
    ),
    completedLogs: auditLogs.filter(
      (log) => log.type === 'DOCUMENT_RECIPIENT_COMPLETED' && log.data.recipientId === recipientId,
    ),
  };
}



// Shape: string.startsWith() with string literal prefix — valid stdlib usage
declare const searchTerm: string;

function buildSearchFilter(searchTerm: string) {
  if (searchTerm && searchTerm.startsWith('org_')) {
    return { type: 'organisation', id: searchTerm };
  }
  if (searchTerm && searchTerm.startsWith('usr_')) {
    return { type: 'user', id: searchTerm };
  }
  return { type: 'text', term: searchTerm };
}



// Shape 6277dbd42fda: Object.assign(el.style, {...}) with valid CSS property names.
declare const drawingSurface: { style: CSSStyleDeclaration };

function initDrawingSurface(): void {
  Object.assign(drawingSurface.style, {
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'crosshair',
  });
}



// Shape 62e5731f0c4e: Tagged template literal for i18n translation; valid usage.
declare function t(strings: TemplateStringsArray, ...values: unknown[]): string;

const emptyStateLabel: string = t`None`;
const defaultPlaceholder: string = t`Select an option`;
const noResultsText: string = t`No results found`;



// Shape 6379556f6c10: Number(row.getValue(...)) in table cell renderer; intentional coercion.
interface TableRow<T> { getValue(key: string): T }
declare function createColumn<T>(key: string, cell: (row: TableRow<unknown>) => unknown): { key: string; cell: (row: TableRow<unknown>) => unknown }

const reportCountColumn = createColumn<number>('reportCount', (row) => {
  const count = Number(row.getValue('reportCount'));
  return count > 0 ? count : 0;
});

const sessionCountColumn = createColumn<number>('sessionCount', (row) => {
  return Number(row.getValue('sessionCount'));
});



// Shape 63b8659b1f12: Array.join() with separator string in table cell renderer.
interface UserRow { id: number; name: string; roles: string[] }
declare function renderCell(row: UserRow): string;

function formatUserRoles(user: UserRow): string {
  return user.roles.join(', ');
}



// Shape 6f8bbc886f95: Buffer.from(string, 'base64') — valid Buffer.from with encoding argument
declare const requestBody: { credentialId: string };

function resolveCredential(credentialId: string): Buffer {
  return Buffer.from(credentialId, 'base64');
}

const credentialBuffer = Buffer.from(requestBody.credentialId, 'base64');



// Shape 7121536f0972: Number(row.count) and .reverse() on mapped array — no type mismatch
interface MonthRow { month: Date; count: string; cume_count: string; }
declare const rows: MonthRow[];

const chartData = {
  labels: rows.map((row) => row.month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })).reverse(),
  datasets: [
    {
      label: 'Items per Month',
      data: rows.map((row) => Number(row.count)).reverse(),
    },
    {
      label: 'Cumulative Items',
      data: rows.map((row) => Number(row.cume_count)).reverse(),
    },
  ],
};



// Shape 7160e93977b7: Buffer.from(id.toString()) as userID — valid Buffer.from with string argument
declare const userId: number;

function buildPasskeyOptions(userId: number) {
  return {
    userID: Buffer.from(userId.toString()),
    userName: `user-${userId}`,
    timeout: 60000,
  };
}



// Shape 7174e4d67663: url.toString().replace('https://', 'postgres://') — string replace on URL; valid string operation
declare const rawDbUrl: string;

function normalizeDbUrl(rawUrl: string): string {
  const url = new URL(rawUrl.replace('postgres://', 'https://'));
  url.searchParams.set('sslmode', 'require');
  return url.toString().replace('https://', 'postgres://');
}



// Shape 72015d3cc68e: z.object({field: z.union(...)}) — standard Zod nested schema with union; no type mismatch
declare const z: {
  object: <T extends Record<string, unknown>>(shape: T) => { parse: (v: unknown) => unknown };
  string: () => { optional: () => unknown };
  number: () => { optional: () => unknown };
  union: (schemas: unknown[]) => unknown;
  literal: (val: unknown) => unknown;
  array: (schema: unknown) => { optional: () => unknown; default: (v: unknown) => unknown };
};

const ZRequestOptionsSchema = z.object({
  priority: z.union([z.literal('HIGH'), z.literal('NORMAL'), z.literal('LOW')]),
  retryPolicy: z.object({
    maxAttempts: z.number().optional(),
    backoffMs: z.number().optional(),
  }),
  tags: z.array(z.string()).optional().default([]),
});



// Shape 7260ecd2cabb: Zod schema with nested meta object — valid Zod schema with no type mismatch
declare const z: {
  object: <T>(shape: T) => { optional: () => unknown; default: (v: unknown) => unknown };
  string: () => { optional: () => unknown; default: (v: string) => unknown };
  nativeEnum: <T>(e: T) => { optional: () => unknown; default: (v: unknown) => unknown };
};
enum DeliveryMethod { EMAIL = 'EMAIL', LINK = 'LINK' }

const ZEnvelopeMetaSchema = z.object({
  subject: z.string().optional().default(''),
  message: z.string().optional().default(''),
  timezone: z.string().default('UTC'),
  dateFormat: z.string().default('MM/DD/YYYY'),
  deliveryMethod: z.nativeEnum(DeliveryMethod).optional().default(DeliveryMethod.EMAIL),
  redirectUrl: z.string().optional().default(''),
});



// Shape 74b0adbfaf24: Number(args.query.perPage) || 10 — standard Number() conversion with fallback
interface QueryParams { page?: string; perPage?: string; search?: string; }
declare const queryParams: QueryParams;

function parsePaginationParams(params: QueryParams) {
  const page = Number(params.page) || 1;
  const perPage = Number(params.perPage) || 10;
  return { page, perPage };
}



// --- argument-type-mismatch shape: enum comparison in find ---
// groups.find() checking a typed enum property — valid enum comparison, no type mismatch.
declare const WorkspaceGroupType: { INTERNAL: string; CUSTOM: string };
declare const MemberRole: { ADMIN: string; MEMBER: string };
interface WorkspaceGroup {
  workspaceGroupType: string;
  memberRole: string;
  id: string;
}
declare const workspaceGroups: WorkspaceGroup[];
const defaultMemberGroup = workspaceGroups.find(
  (group) =>
    group.workspaceGroupType === WorkspaceGroupType.INTERNAL &&
    group.memberRole === MemberRole.MEMBER,
);



// --- argument-type-mismatch shape: ts-pattern match on discriminated union ---
// match(parsedField).with({ type: FieldKind.CHECKBOX }, ...) — type-safe pattern match, no mismatch.
declare const FieldKind: { CHECKBOX: string; TEXT: string; NUMBER: string };
interface CheckboxField { type: string; values: string[] }
interface TextField { type: string; text: string }
type AnyField = CheckboxField | TextField;
declare function match<T>(value: T): any;
declare function parseField(raw: unknown): AnyField;
function handleFieldClick(raw: unknown, index: number): void {
  const parsed = parseField(raw);
  match(parsed)
    .with({ type: FieldKind.CHECKBOX }, (field) => {
      if (Number.isNaN(index)) return;
      console.log('checkbox clicked', field, index);
    })
    .with({ type: FieldKind.TEXT }, (field) => {
      console.log('text field', field);
    })
    .exhaustive();
}



// --- argument-type-mismatch shape: nested find inside filter ---
// existingItems.filter(existing => !incoming.find(f => f.id === existing.id)) — valid nested find/filter.
interface FieldEntry { id: number; name: string }
declare const incomingFields: FieldEntry[];
declare const existingFields: FieldEntry[];
const removedFields = existingFields.filter(
  (existingField) => !incomingFields.find((field) => field.id === existingField.id),
);
const linkedFields = incomingFields.map((field) => {
  const existing = existingFields.find((existingField) => existingField.id === field.id);
  return { ...field, isNew: !existing };
});



// --- argument-type-mismatch shape: forEach + find by formId ---
// savedFields.forEach with localFields.find by formId; standard ID reconciliation pattern.
interface LocalField { formId: string; id?: number }
interface SavedField { id: number; formId: string }
declare const localFields: LocalField[];
declare function setFieldId(formId: string, id: number): void;
function reconcileFieldIds(savedFields: SavedField[]): void {
  savedFields.forEach((field) => {
    const localField = localFields.find((lf) => lf.formId === field.formId);
    if (localField && !localField.id) {
      localField.id = field.id;
      setFieldId(localField.formId, field.id);
    }
  });
}



// --- argument-type-mismatch shape: filter comparing status to string literal ---
// recipients.filter(item => item.signingStatus !== 'SIGNED') — valid string comparison filter.
interface RecipientRow { id: number; email: string; signingStatus: string }
declare const recipients: RecipientRow[];
const unsignedRecipients = recipients.filter((item) => item.signingStatus !== 'SIGNED');



// --- argument-type-mismatch shape: forEach + findIndex for array mutation ---
// localFields.forEach with findIndex to locate and update a field value — standard imperative update.
interface LocalFieldEntry { id: number; type: string; value: string }
declare const localFields: LocalFieldEntry[];
function initFieldValues(fields: LocalFieldEntry[]): LocalFieldEntry[] {
  const updated = [...fields];
  fields.forEach((field) => {
    const index = updated.findIndex((f) => f.id === field.id);
    let value = '';
    if (field.type === 'TEXT') {
      value = 'default-text';
    } else if (field.type === 'NUMBER') {
      value = '0';
    }
    if (index !== -1) {
      updated[index] = { ...updated[index], value };
    }
  });
  return updated;
}



// --- argument-type-mismatch shape: find on constant array by value property ---
// DATE_FORMATS.find(format => format.value === inputValue) — valid find returning format or undefined.
interface DateFormatOption { label: string; value: string }
declare const DATE_FORMATS: DateFormatOption[];
declare const DEFAULT_DATE_FORMAT: string;
function resolveDisplayFormat(inputValue: string | undefined): DateFormatOption | undefined {
  if (inputValue) {
    return DATE_FORMATS.find((format) => format.value === inputValue);
  }
  return DATE_FORMATS.find((format) => format.value === DEFAULT_DATE_FORMAT);
}



// --- argument-type-mismatch shape: filter on boolean checked property ---
// (values || []).filter((v) => v.checked) — standard boolean property filter, no type mismatch.
interface CheckboxOption { label: string; checked: boolean }
declare const ValidationRule: { AT_LEAST: string; EXACTLY: string; AT_MOST: string }
declare function checkLength(actual: number, rule: string, required: number): boolean;
function validatePreselected(
  values: CheckboxOption[] | undefined,
  validationRule: string | undefined,
  validationLength: number | undefined,
): boolean {
  const preselected = (values || []).filter((value) => value.checked);
  if (validationLength && validationRule && preselected.length > 0) {
    return checkLength(preselected.length, validationRule, validationLength);
  }
  return true;
}



// --- argument-type-mismatch shape: sortBy with accessor-and-direction pairs ---
// sortBy(items, [(r) => r.order || MAX, 'asc'], [(r) => r.id, 'asc']) — lodash sortBy API design, no mismatch.
interface RecipientEntry { id: number; signingOrder?: number; email: string }
declare function sortBy<T>(arr: T[], ...iteratees: Array<[(item: T) => unknown, string]>): T[];
declare const recipients: RecipientEntry[];
const sortedRecipients = sortBy(
  recipients,
  [(r) => r.signingOrder || Number.MAX_SAFE_INTEGER, 'asc'],
  [(r) => r.id, 'asc'],
);



// --- argument-type-mismatch shape: map extracting id property ---
// recipients.map(recipient => recipient.id) — valid property extraction, no type mismatch.
interface RecipientSummary { id: number; email: string; role: string }
declare const envelopeRecipients: RecipientSummary[];
const recipientIds: number[] = envelopeRecipients.map((recipient) => recipient.id);


// --- argument-type-mismatch FP: DATE_FORMATS.find() with string comparison; valid find, no type mismatch ---
interface DateFormat { value: string; label: string; example: string }

declare const DATE_FORMATS: DateFormat[];
declare const DEFAULT_DATE_FORMAT: string;

function resolveDateFormat(requestedFormat?: string): DateFormat | undefined {
  return requestedFormat
    ? DATE_FORMATS.find((format) => format.value === requestedFormat)
    : DATE_FORMATS.find((format) => format.value === DEFAULT_DATE_FORMAT);
}


// --- argument-type-mismatch FP: ts-pattern match().with() on subscription object; valid ts-pattern usage, no type mismatch ---
declare const match: <T>(value: T) => {
  with<P>(pattern: P, fn: (val: T) => unknown): { otherwise(fn: (val: T) => unknown): unknown };
};
declare const P: { nonNullable: unique symbol };

interface Subscription { cancelAtPeriodEnd: boolean; periodEnd: Date | null; status: string }

declare const currentSubscription: Subscription;

const subscriptionLabel = match(currentSubscription)
  .with({ cancelAtPeriodEnd: true, periodEnd: P.nonNullable }, () => 'Cancels on period end')
  .otherwise(() => 'Active');


// --- argument-type-mismatch FP: String.startsWith() with string literal; no type mismatch ---
function buildSearchFilter(query: string): object {
  if (query.startsWith('envelope_')) {
    return { id: { equals: query } };
  }

  if (query.startsWith('document_')) {
    return { secondaryId: { equals: query } };
  }

  return { title: { contains: query, mode: 'insensitive' } };
}



// FP shape: array.map() extracting a single property — standard transform
declare const organisation: { teams: Array<{ id: number; name: string }> };

function extractTeamIds(): number[] {
  const teamIds = organisation.teams.map((team) => team.id);
  return teamIds;
}



// FP shape: array.map() with spread plus property rename — standard immutable transform
declare const attachments: Array<{ id: string; name: string; width: number; height: number; url: string }>;
declare function saveAttachments(items: Array<{ id: string; name: string; pageWidth: number; pageHeight: number; url: string }>): void;

function normalizeAttachments() {
  saveAttachments(
    attachments.map((attachment) => ({
      ...attachment,
      pageWidth: attachment.width,
      pageHeight: attachment.height,
    }))
  );
}



// FP shape: array.filter() with includes check — filter returns same type array
declare const validationMessages: string[];
declare function showFieldErrors(errors: { required: string[]; tooLong: string[] }): void;

function displayValidationErrors() {
  showFieldErrors({
    required: validationMessages.filter((msg) => msg.includes('required')),
    tooLong: validationMessages.filter((msg) => msg.includes('character limit')),
  });
}



// FP shape: map+filter chain — filter(value => value !== null) is valid TypeScript 5.5+ type narrowing
declare const rawOptions: Array<{ id: string; label: string | null }>;

function getActiveOptionLabels(): string[] {
  return rawOptions
    .map((opt) => opt.label)
    .filter((value) => value !== null);
}



// FP shape: array.filter() with chained optional property check and enum comparison
const TemplateType = { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' } as const;
type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

declare const allTemplates: Array<{
  id: string;
  type: TemplateType;
  directLink?: { enabled: boolean } | null;
}>;

const publicTemplates = allTemplates.filter(
  (template) => template.directLink?.enabled === true && template.type === TemplateType.PUBLIC
);

const privateTemplates = allTemplates.filter(
  (template) => template.directLink?.enabled === true && template.type === TemplateType.PRIVATE
);



// FP shape: Array.includes() check on string array literal — valid includes on string[]
const ADVANCED_FIELD_TYPES = ['NUMBER', 'RADIO', 'CHECKBOX', 'DROPDOWN', 'TEXT'] as const;
declare const fieldType: string;

function isAdvancedField(type: string): boolean {
  return (ADVANCED_FIELD_TYPES as readonly string[]).includes(type);
}

const result = isAdvancedField(fieldType);



// FP shape: Lingui t() translation call with object property — standard i18n pattern
declare const t: (descriptor: unknown) => string;
declare const step: { title: string; description: string };

function renderStepLabel() {
  const titleText = t(step.title);
  const descriptionText = t(step.description);
  return `${titleText}: ${descriptionText}`;
}



// FP shape: Array.filter() excluding current value — standard filter-out pattern
declare const selectedRoles: string[];
declare const currentValue: string;

function removeRole(roles: string[], valueToRemove: string): string[] {
  return roles.filter((value) => value !== valueToRemove);
}

const updatedRoles = removeRole(selectedRoles, currentValue);



// FP shape: Array.find() comparing item.id to lookup value — standard array lookup
declare const participants: Array<{ id: number; name: string; role: string }>;
declare const participantId: number;

function findParticipantById() {
  const participant = participants.find((p) => p.id === participantId);
  return participant;
}



// FP shape: Lingui _() translation call with MessageDescriptor — valid i18n usage
declare const _: (descriptor: { id: string; message?: string }) => string;
declare const activityInfo: { description: { id: string; message?: string }; label: { id: string; message?: string } };

function formatActivityLabel() {
  const description = _(activityInfo.description);
  const label = _(activityInfo.label);
  return `${label}: ${description}`;
}



// FP shape: i18n.date() with Date and format options — both arguments correctly typed
declare const i18n: { date: (value: Date, opts: Intl.DateTimeFormatOptions) => string };
declare const row: { original: { createdAt: Date } };

const dateFormat: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

function formatRowDate() {
  return i18n.date(row.original.createdAt, dateFormat);
}



// FP shape: array.concat() with .map() result — standard array concatenation
declare const existingItems: Array<{ id: string; value: number }>;
declare const newItems: Array<{ id: string; value: number }>;
declare const multiplier: number;

function mergeAndTransformItems() {
  return existingItems.concat(
    newItems.map((item) => ({ ...item, value: item.value * multiplier }))
  );
}



// FP shape: filter callback with Array.includes() exclusion check — standard filter
declare const allPermissions: string[];
declare const removedPermissions: string[];

function getActivePermissions(): string[] {
  return allPermissions.filter((permission) => !removedPermissions.includes(permission));
}



// FP shape: z.preprocess() with split() producing array for z.array() — valid Zod preprocessing
declare const z: {
  preprocess: (transform: (val: unknown) => unknown, schema: unknown) => unknown;
  array: (schema: unknown) => unknown;
  string: () => unknown;
};

const tagsSchema = z.preprocess(
  (val) => (typeof val === 'string' ? val.split(',').map((s: string) => s.trim()) : val),
  z.array(z.string())
);



// FP shape: z.string().refine() with array.includes() predicate — valid Zod string refinement
declare const z: { string: () => { refine: (predicate: (val: string) => boolean, opts?: { message: string }) => unknown } };

const RESERVED_SLUGS = ['admin', 'api', 'auth', 'dashboard', 'settings'];

const slugSchema = z.string().refine(
  (value) => !RESERVED_SLUGS.includes(value),
  { message: 'This slug is reserved and cannot be used.' }
);



// FP shape: Array.map() producing updated items with spread — standard immutable update
declare const subscribers: Array<{ id: string; email: string; status: string; updatedAt: Date }>;
declare const subscriberId: string;
declare const newStatus: string;

function updateSubscriberStatus(): typeof subscribers {
  return subscribers.map((sub) =>
    sub.id === subscriberId
      ? { ...sub, status: newStatus, updatedAt: new Date() }
      : sub
  );
}



// FP shape: .refine() with regex test predicate and object error config — valid Zod refinement
declare const z: { string: () => { min: (n: number) => { refine: (predicate: (val: string) => boolean, opts?: { message: string }) => unknown } } };

const strongPasswordSchema = z.string().min(8).refine(
  (value) => value.length > 25 || /[A-Z]/.test(value),
  { message: 'Password must be longer than 25 chars or contain an uppercase letter.' }
);



// FP shape 9192bbc208b6: function call with typed id object — standard function call, no type mismatch
type TemplateIdRef = { type: 'templateId'; id: number };
declare function updateTemplateFields(opts: {
  id: TemplateIdRef;
  userId: number;
  teamId: number | undefined;
  fields: { id: number; type: string }[];
}): Promise<void>;

async function applyTemplateFields(templateId: number, userId: number, teamId: number, fields: { id: number; type: string }[]) {
  return await updateTemplateFields({
    id: {
      type: 'templateId',
      id: templateId,
    },
    userId,
    teamId,
    fields: fields.map((f) => ({ id: f.id, type: f.type })),
  });
}



// FP shape 91c1d345a306: path.join() with process.cwd() and string literal — standard path construction, no type mismatch
declare const path: { join: (...parts: string[]) => string };
declare const process: { cwd: () => string };

function getFontDirectory(): string {
  return path.join(process.cwd(), 'public/fonts');
}

function getFontPath(fontFile: string): string {
  const fontDir = getFontDirectory();
  return path.join(fontDir, fontFile);
}



// FP shape 91d7b05cabbc: Object.entries() on typed record — standard iteration, no type mismatch
function parseRawMetadata(rawMeta: Record<string, string>): Record<string, boolean | number | string> {
  const parsed: Record<string, boolean | number | string> = {};
  const entries = Object.entries(rawMeta);

  for (const [key, value] of entries) {
    if (key === 'enabled' || key === 'required') {
      parsed[key] = value === 'true';
    } else if (key === 'count' || key === 'limit') {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        parsed[key] = num;
      }
    } else {
      parsed[key] = value;
    }
  }

  return parsed;
}



// FP shape 92604501fa62: z.string().superRefine() with regex test — value is string from zod, no type mismatch
declare const z: {
  string: () => {
    superRefine: (fn: (value: string, ctx: { addIssue: (issue: { code: string; message: string }) => void }) => void) => unknown;
    refine: (fn: (value: string) => boolean, opts: { message: string }) => unknown;
  };
  ZodIssueCode: { custom: string };
};

const positiveNumberSchema = z.string().superRefine((value, ctx) => {
  const isValid = /^[0-9]+(\.[0-9]+)?$/.test(value.toString());

  if (!isValid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Please enter a valid positive number',
    });
    return;
  }

  const num = parseFloat(value);
  if (num <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Number must be greater than zero',
    });
  }
});



// FP shape 92f912aa7a70: Array.filter() with predicate callback — standard filter, no type mismatch
interface Organisation {
  id: string;
  name: string;
  subscription: { status: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE' } | null;
}

function getEligibleOrganisations(orgs: Organisation[], excludeId: string): Organisation[] {
  return orgs.filter((org) => {
    if (org.id === excludeId) {
      return false;
    }

    const hasActiveSubscription =
      org.subscription &&
      (org.subscription.status === 'ACTIVE' || org.subscription.status === 'PAST_DUE');

    return !hasActiveSubscription;
  });
}



// FP shape 930cc38171c8: String.startsWith() with string literal — value is string, no type mismatch
function isPrivateIPAddress(host: string): boolean {
  const normalized = host.toLowerCase().trim();

  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('169.254.')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;

  if (normalized.startsWith('172.')) {
    const second = parseInt(normalized.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  return false;
}



// FP shape 931f6df35f9f: dynamic import() with .then() destructuring — standard lazy import, no type mismatch
async function getPresignedUrl(key: string): Promise<string> {
  const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
  return `https://example.com/${key}`;
}



// FP shape 934c86cdde7c: Array.find() comparing member id — standard lookup, no type mismatch
interface Member {
  id: string;
  userId: string;
  role: string;
}

function findMemberById(members: Member[], memberId: string): Member | undefined {
  return members.find((member) => member.id === memberId);
}

function findMemberByUserId(members: Member[], userId: string): Member | undefined {
  return members.find((member) => member.userId === userId);
}



// FP shape 9361d923a55b: function called with object literal matching parameter type — no type mismatch
declare function uploadNormalizedFile(opts: {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<{ id: string; url: string }>;

async function processAndUploadPdf(fileName: string, content: Uint8Array): Promise<string> {
  const { id } = await uploadNormalizedFile({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(content.buffer as ArrayBuffer),
  });
  return id;
}



// FP shape 937a9d4d38f9: chained .filter().map() producing typed array — no type mismatch
interface FormField {
  id: string;
  page: number;
  itemId: string;
  required: boolean;
  inserted: boolean;
}

interface Item {
  id: string;
  order: number;
}

function getRequiredFieldsForPage(
  fields: FormField[],
  page: number,
  itemId: string,
  items: Item[]
): (FormField & { itemOrder: number })[] {
  return fields
    .filter((field) => !field.inserted && field.required && field.page === page && field.itemId === itemId)
    .map((field) => {
      const item = items.find((it) => it.id === field.itemId);
      if (!item) throw new Error(`Item not found for field ${field.id}`);
      return { ...field, itemOrder: item.order };
    });
}



// FP shape 938cbe1b0a44: ts-pattern match().with() on enum values — standard pattern matching, no type mismatch
declare function match<T>(value: T): {
  with<U>(pattern: T, handler: () => U): { with: (...args: any[]) => any; exhaustive: () => U };
  with<U>(...args: any[]): { with: (...args: any[]) => any; exhaustive: () => U };
  exhaustive: () => any;
};

type DocumentStatus = 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REJECTED';

function getStatusMessage(status: DocumentStatus): string {
  return match(status)
    .with('COMPLETED', () => 'Document has been completed')
    .with('REJECTED', () => 'Document was rejected')
    .with('DRAFT', () => 'Document is in draft')
    .with('PENDING', () => 'Document is awaiting signatures')
    .exhaustive();
}



// FP shape 93dd5db0450e: Buffer.from(string, 'base64') — string from config, correct types, no type mismatch
declare function getEnvVar(name: string): string | undefined;
declare const fs: { readFileSync: (path: string) => Buffer };

function loadCertificate(): Buffer {
  const certContents = getEnvVar('CERT_FILE_CONTENTS');

  if (certContents) {
    return Buffer.from(certContents, 'base64');
  }

  const certPath = getEnvVar('CERT_FILE_PATH');

  if (certPath) {
    return fs.readFileSync(certPath);
  }

  throw new Error('No certificate configuration found');
}



// FP shape 93e11269ee8c: prisma.$transaction() with conditional create inside — standard ORM pattern, no type mismatch
declare const db: {
  $transaction: <T>(fn: (tx: {
    auditLog: { create: (opts: { data: Record<string, unknown> }) => Promise<void> };
    recipient: { update: (opts: { where: { id: string }; data: Record<string, unknown> }) => Promise<void> };
  }) => Promise<T>) => Promise<T>;
};

async function completeSigningStep(
  recipientId: string,
  nextSignerId: string | undefined,
  envelopeId: string
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (nextSignerId) {
      await tx.auditLog.create({
        data: {
          type: 'RECIPIENT_UPDATED',
          envelopeId,
          recipientId: nextSignerId,
        },
      });
    }

    await tx.recipient.update({
      where: { id: recipientId },
      data: { signingStatus: 'SIGNED' },
    });
  });
}



// FP shape 94233b8dd25e: ts-pattern exhaustive match on string union — all branches return same type, no type mismatch
type RenderMode = 'edit' | 'sign' | 'export';

function isOptionSelected(mode: RenderMode, checked: boolean, selectedValues: number[], index: number): boolean {
  return match(mode)
    .with('edit', () => checked)
    .with('sign', () => selectedValues.includes(index))
    .with('export', () => checked || selectedValues.includes(index))
    .exhaustive();
}



// FP shape 948b51ddaf9b: Zod .transform() normalizing single value to array — valid transform callback, no type mismatch
declare const z: {
  union: (...args: any[]) => { transform: (fn: (val: unknown) => unknown) => unknown };
  array: (schema: unknown) => unknown;
  string: () => unknown;
};

const authTypesSchema = z.union(z.string(), z.array(z.string()))
  .transform((val) => (Array.isArray(val) ? val : [val]));



// FP shape 9504bff33097: z.preprocess() converting string to boolean — correct Zod preprocess usage, no type mismatch
declare const z: {
  preprocess: (fn: (val: unknown) => unknown, schema: unknown) => unknown;
  boolean: () => unknown;
};

const boolFromStringSchema = z.preprocess(
  (val) => String(val) === 'true' || String(val) === '1',
  z.boolean(),
);



// FP shape 952cdc3015f3: Array.filter() with .some() check for set-difference — standard pattern, no type mismatch
interface GroupMember {
  organisationMemberId: string;
}

function computeMemberDiff(
  existingMembers: GroupMember[],
  desiredMemberIds: string[]
): { toAdd: string[]; toRemove: GroupMember[] } {
  const uniqueDesiredIds = Array.from(new Set(desiredMemberIds));

  const toRemove = existingMembers.filter(
    (member) => !uniqueDesiredIds.includes(member.organisationMemberId),
  );

  const toAdd = uniqueDesiredIds.filter(
    (id) => !existingMembers.some((member) => member.organisationMemberId === id),
  );

  return { toAdd, toRemove };
}



// FP shape 952fb9d3478f: Promise.all() with async map — standard async parallel pattern, no type mismatch
interface AutoInsertField {
  fieldId: string;
  customText: string;
}

declare const db: {
  field: {
    update: (opts: { where: { id: string }; data: { customText: string; inserted: boolean } }) => Promise<{ id: string }>;
  };
};

async function autoInsertFields(fields: AutoInsertField[]): Promise<{ id: string }[]> {
  return await Promise.all(
    fields.map(async (field) => {
      return await db.field.update({
        where: { id: field.fieldId },
        data: { customText: field.customText, inserted: true },
      });
    }),
  );
}



// FP shape 95447feabf3a: ts-pattern match with multiple enum patterns in .with() — standard exhaustive match, no type mismatch
type FieldType = 'SIGNATURE' | 'DRAWING' | 'TEXT' | 'DATE' | 'NUMBER' | 'CHECKBOX';

function buildFieldAuditPayload(
  fieldType: FieldType,
  fieldData: string,
): { type: FieldType; data: string } {
  return match(fieldType)
    .with('SIGNATURE', 'DRAWING', (type) => ({
      type,
      data: fieldData,
    }))
    .with('TEXT', 'DATE', 'NUMBER', 'CHECKBOX', (type) => ({
      type,
      data: fieldData,
    }))
    .exhaustive();
}



// FP shape 9564c7be2576: chained .filter().map() producing typed array — standard transformation, no type mismatch
interface FormField {
  id: string;
  page: number;
  envelopeItemId: string;
  inserted: boolean;
  customText: string;
  recipientId: string;
}

interface Recipient {
  id: string;
  signingStatus: 'SIGNED' | 'NOT_SIGNED';
}

function buildLocalFields(
  fields: FormField[],
  recipients: Recipient[],
  page: number,
  envelopeItemId: string,
) {
  return fields
    .filter((f) => f.page === page && f.envelopeItemId === envelopeItemId)
    .map((f) => {
      const recipient = recipients.find((r) => r.id === f.recipientId);
      if (!recipient) throw new Error(`Recipient not found: ${f.id}`);
      const inserted = recipient.signingStatus === 'SIGNED' && f.inserted;
      return { ...f, inserted, customText: inserted ? f.customText : '' };
    });
}



// FP shape 957293a96f99: Promise.all() with map over static group configs — standard async map, no type mismatch
interface TeamGroupConfig {
  type: string;
  role: string;
}

declare const TEAM_DEFAULT_GROUPS: TeamGroupConfig[];

declare const db: {
  organisationGroup: {
    create: (opts: { data: { type: string; role: string; teamId: string } }) => Promise<{ id: string }>;
  };
};

async function createDefaultTeamGroups(teamId: string): Promise<void> {
  await Promise.all(
    TEAM_DEFAULT_GROUPS.map(async (groupConfig) =>
      db.organisationGroup.create({
        data: {
          type: groupConfig.type,
          role: groupConfig.role,
          teamId,
        },
      }),
    ),
  );
}



// FP shape 95b3222bb942: Array.findIndex() comparing recipient ids — standard lookup, no type mismatch
interface Recipient {
  id: number;
  signingOrder: number | null;
}

function getNextRecipient(recipients: Recipient[], currentId: number): Recipient | undefined {
  const sorted = [...recipients].sort((a, b) => {
    if (a.signingOrder === null && b.signingOrder === null) return a.id - b.id;
    if (a.signingOrder === null) return 1;
    if (b.signingOrder === null) return -1;
    return a.signingOrder - b.signingOrder;
  });

  const currentIndex = sorted.findIndex((r) => r.id === currentId);
  return currentIndex !== -1 && currentIndex < sorted.length - 1
    ? sorted[currentIndex + 1]
    : undefined;
}



// FP shape 95c94ebb64aa: filter with intersection check and draggable() — standard canvas API usage, no type mismatch
declare const Konva: {
  Util: { haveIntersection: (r1: { x: number; y: number; width: number; height: number }, r2: { x: number; y: number; width: number; height: number }) => boolean };
};

interface CanvasShape {
  getClientRect: () => { x: number; y: number; width: number; height: number };
  draggable: () => boolean;
}

function getSelectedShapes(
  shapes: CanvasShape[],
  selectionBox: { x: number; y: number; width: number; height: number }
): CanvasShape[] {
  return shapes.filter(
    (shape) => Konva.Util.haveIntersection(selectionBox, shape.getClientRect()) && shape.draggable(),
  );
}



// FP shape 95f0b8140b33: Array.find() comparing recipient.email to user.email — string equality, no type mismatch
interface Recipient {
  id: string;
  email: string;
  signingStatus: 'SIGNED' | 'NOT_SIGNED';
}

interface CurrentUser {
  email: string;
  id: string;
}

function findCurrentUserRecipient(recipients: Recipient[], user: CurrentUser): Recipient | undefined {
  return recipients.find((recipient) => recipient.email === user.email);
}



// FP shape 95f4f8037032: runTask() with async callback using Promise.all — standard async job pattern, no type mismatch
declare const io: {
  runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

declare function renderTemplate(template: unknown, opts: { lang: string; plainText?: boolean }): Promise<string>;

async function sendNotificationEmail(
  template: unknown,
  lang: string,
  recipient: { email: string; name: string }
): Promise<void> {
  await io.runTask('send-notification-email', async () => {
    const [html, text] = await Promise.all([
      renderTemplate(template, { lang }),
      renderTemplate(template, { lang, plainText: true }),
    ]);

    console.log(`Sending email to ${recipient.email}: ${html.length} chars HTML, ${text.length} chars text`);
  });
}



// FP shape 965ebd200494: function call with typed object literal — all properties match signature, no type mismatch
type DocumentIdRef = { type: 'documentId'; id: string };

declare function syncDocumentFields(opts: {
  userId: string;
  teamId: string | undefined;
  id: DocumentIdRef;
  fields: { id: string; pageWidth: number; pageHeight: number }[];
}): Promise<void>;

async function applyDocumentFields(
  documentId: string,
  userId: string,
  teamId: string | null,
  rawFields: { id: string; width: number; height: number }[]
): Promise<void> {
  await syncDocumentFields({
    userId,
    teamId: teamId ?? undefined,
    id: {
      type: 'documentId',
      id: documentId,
    },
    fields: rawFields.map((f) => ({
      id: f.id,
      pageWidth: f.width,
      pageHeight: f.height,
    })),
  });
}



// FP shape 96bc67098162: Number.isNaN() and Number.isInteger() with number argument — both accept number, no type mismatch
function validateNumericToken(rawTokenId: string): number {
  const tokenId = Number(rawTokenId);

  if (Number.isNaN(tokenId) || !Number.isInteger(tokenId)) {
    throw new Error('Invalid token ID format: must be an integer');
  }

  return tokenId;
}

function validateAudienceId(rawAudienceId: string): number {
  const audienceId = Number(rawAudienceId);

  if (Number.isNaN(audienceId) || !Number.isInteger(audienceId)) {
    throw new Error('Invalid audience ID format: must be an integer');
  }

  return audienceId;
}



// FP shape 96c5b7aa632c: function called with number, string, and number args — all correct types, no mismatch
declare function validateSelectionLength(count: number, rule: string, maxLength: number): boolean;

interface ValidationRule {
  label: string;
  value: string;
}

function applySelectionValidation(
  selectedCount: number,
  ruleName: string,
  maxAllowed: number,
  availableRules: ValidationRule[]
): boolean {
  const rule = availableRules.find((r) => r.label === ruleName);

  if (!rule) {
    throw new Error(`Unknown validation rule: ${ruleName}`);
  }

  return validateSelectionLength(selectedCount, rule.value, maxAllowed);
}



// FP shape 96ca4975c7f0: String.startsWith() with string literal — value is string parameter, no type mismatch
function isBase64DataUrl(value: string): boolean {
  return value.startsWith('data:image/png;base64,');
}

function isBase64JpegDataUrl(value: string): boolean {
  return value.startsWith('data:image/jpeg;base64,');
}

function getDataUrlMediaType(value: string): string | null {
  if (value.startsWith('data:image/png;base64,')) return 'image/png';
  if (value.startsWith('data:image/jpeg;base64,')) return 'image/jpeg';
  if (value.startsWith('data:image/gif;base64,')) return 'image/gif';
  return null;
}



// FP shape 9721505a3870: Buffer.from(await file.arrayBuffer()) — arrayBuffer() returns ArrayBuffer, Buffer.from accepts it, no type mismatch
interface FileUpload {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

declare function normalizePdfBuffer(buf: Buffer): Promise<Buffer>;
declare function storePdfFile(opts: { name: string; data: Buffer }): Promise<{ id: string }>;

async function processUploadedFile(file: FileUpload): Promise<string> {
  let buffer = Buffer.from(await file.arrayBuffer());
  buffer = await normalizePdfBuffer(buffer);

  const { id } = await storePdfFile({
    name: file.name,
    data: buffer,
  });

  return id;
}



// --- FP shape: Object.values(Enum).includes() type-guard pattern ---
enum DocumentStatus { PENDING = 'PENDING', COMPLETE = 'COMPLETE', DRAFT = 'DRAFT' }

function isDocumentStatus(value: unknown): value is DocumentStatus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(DocumentStatus).includes(value as DocumentStatus);
}



// --- FP shape: Array.some() with enum type-check function call ---
type FieldType = 'SIGNATURE' | 'INITIALS' | 'TEXT' | 'DATE' | 'CHECKBOX';
declare function isSignatureFieldType(type: FieldType): boolean;
declare const recipientFields: Array<{ type: FieldType; id: number }>;

const hasSignatureFields = recipientFields.some((field) => isSignatureFieldType(field.type));



// --- FP shape: Buffer.from() called with return value of hash function ---
declare function sha256(data: string | Buffer): string;
declare const Buffer: { from(str: string, encoding?: string): Buffer };
declare const documentContent: string;

const contentHash = Buffer.from(sha256(documentContent));



// --- FP shape: Array.from() converting collection, then forEach callback ---
declare const fieldCardElements: HTMLCollectionOf<Element>;

Array.from(fieldCardElements).forEach((element) => {
  element.setAttribute('data-active', 'false');
});



// --- FP shape: type-check function called with enum-typed property ---
type FieldKind = 'SIGNATURE' | 'INITIALS' | 'FREE_SIGNATURE' | 'TEXT' | 'DATE';
declare function isSignatureKind(kind: FieldKind): boolean;
declare const field: { type: FieldKind; id: number };

const isSignature = isSignatureKind(field.type);



// --- FP shape: Uint8Array constructor called with Buffer.from() result ---
declare const Buffer2: { from(str: string, encoding: string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number } };
declare const encodedId: string;

const rawBytes = new Uint8Array(Buffer2.from(encodedId, 'base64') as unknown as ArrayBuffer);



// Data transformation helpers for array property extraction

declare const teamMembers: Array<{ id: string; name: string; email: string; role: string }>;

export function getTeamEmails(members: typeof teamMembers): string[] {
  const memberEmails = members.map((member) => member.email);
  return memberEmails;
}

export function extractUserIds(users: Array<{ id: string; username: string }>): string[] {
  const userIds = users.map((user) => user.id);
  return userIds;
}

export function getProductNames(products: Array<{ name: string; price: number; sku: string }>): string[] {
  const names = products.map((product) => product.name);
  return names;
}

export function filterActiveEmails(
  data: { signers: Array<{ email: string; status: string }> }
): string[] {
  const activeEmails = data.signers.map((signer) => signer.email);
  return activeEmails.filter((email) => email.length > 0);
}



// Form initialization helper that extracts IDs from team members for a multi-select field.
// Array.map() standard property extraction - no type mismatch.

declare const teamMembers: Array<{
  userId: string;
  fullName: string;
  email: string;
}>;

export function initializeMemberSelection() {
  const selectedIds = teamMembers.map((member) => member.userId);
  return selectedIds;
}



// URL constructor with string manipulation - valid argument type
// The .replace() call returns a string, which is a valid argument to URL constructor.
// This should NOT be flagged as an argument type mismatch.

declare const appConfig: { websocketEndpoint?: string };

export function normalizeWebSocketUrl(): URL | undefined {
  if (!appConfig.websocketEndpoint) {
    return undefined;
  }

  // Convert ws:// protocol to https:// for URL parsing
  const apiUrl = new URL(appConfig.websocketEndpoint.replace('ws://', 'https://'));
  
  return apiUrl;
}

export function buildApiEndpoint(baseUrl: string): URL {
  // Convert custom protocol to https for URL manipulation
  const normalized = new URL(baseUrl.replace('custom://', 'https://'));
  normalized.pathname = '/api/v1';
  return normalized;
}



// Parse comma-separated tags, filtering out empty strings
export function parseTags(input: string): string[] {
  return input.split(',').filter((value) => value !== '');
}

// Parse comma-separated email addresses from a form field
export function parseEmailList(emails: string | null): string[] {
  return (emails ?? '').split(',').filter((value) => value !== '');
}

// Extract valid identifiers from a delimited string
export function extractIdentifiers(raw: string | undefined): string[] {
  const normalized = raw ?? '';
  return normalized.split(',').filter((id) => id !== '');
}



// FP: filter().includes() — filter returns string[], assigned to typed field (no mismatch)
declare function validateNumericField(text: string): string[];

function handleInputChange(rawValue: string) {
  const validationErrors = validateNumericField(rawValue);
  setFieldErrors({
    isNumeric: validationErrors.filter((err) => err.includes('valid number')),
    required: validationErrors.filter((err) => err.includes('required')),
  });
}

declare function setFieldErrors(errors: { isNumeric: string[]; required: string[] }): void;



// FP: Array.find() comparing string properties — standard lookup
declare const workspaces: Array<{ id: number; slug: string; name: string }>;
declare const preferredSlug: string | undefined;

const activeWorkspace = workspaces.find((ws) => ws.slug === preferredSlug);



// FP: string split followed by filter produces string[] — no type mismatch
declare const authorizationHeader: string | null;

const [apiToken] = (authorizationHeader || '').split('Bearer ').filter((s) => s.length > 0);



// FP: setErrors with multiple filter calls — filter returns string[], fields accept string[]
declare function validateAmount(text: string, meta: unknown): string[];
declare function setAmountErrors(errors: { isNumber: string[]; required: string[]; minValue: string[] }): void;

function onPreSign(localAmount: string, fieldMeta: unknown) {
  const validationErrors = validateAmount(localAmount, fieldMeta);
  setAmountErrors({
    isNumber: validationErrors.filter((error) => error.includes('valid number')),
    required: validationErrors.filter((error) => error.includes('required')),
    minValue: validationErrors.filter((error) => error.includes('minimum value')),
  });
}



// FP: Object.entries().filter(([key]) => ...) — filter returns same entry tuple type
declare const membersByRole: Record<string, Array<{ id: number; name: string }>>;
const EXCLUDED_ROLES = ['OBSERVER', 'BOT'];

const displayableRoles = Object.entries(membersByRole)
  .filter(([role]) => !EXCLUDED_ROLES.includes(role))
  .map(([role, members]) => ({ role, members }));



// FP: Array.find() comparing id to selectedId — standard lookup
declare const assignees: Array<{ id: number; name: string; email: string }>;
declare const selectedAssigneeId: number | null;

const selectedAssignee = assignees.find((assignee) => assignee.id === selectedAssigneeId);



// FP: Array.findIndex() comparing id fields — standard lookup
declare const signers: Array<{ id: number; name: string }>;
declare const formField: { signerId: number; label: string };

const signerIndex = signers.findIndex((s) => s.id === formField.signerId);



// FP: Array.find() with schema parse inside — standard validation pattern
declare const ZAuthOptionsSchema: { parse: (data: unknown) => { method: string; level: number } };
declare const participants: Array<{ id: number; authOptions: unknown }>;

const participantWithStrongAuth = participants.find((participant) => {
  const authOptions = ZAuthOptionsSchema.parse(participant.authOptions);
  return authOptions.level > 1;
});



// FP: Array.includes() on number array with numeric index — both are numbers
declare const selectedIndices: number[];

const checkboxItems = [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }];
checkboxItems.forEach(({ label }, index) => {
  const isChecked = selectedIndices.includes(index);
  void isChecked; void label;
});



// FP: Array.findIndex() comparing IDs — standard array lookup
declare const collaborators: Array<{ id: number; email: string; role: string }>;
declare const selectedField: { collaboratorId: number; label: string };

const collaboratorIndex = collaborators.findIndex((c) => c.id === selectedField.collaboratorId);



// FP: getColorStyles(findIndex()).property — chained findIndex with style accessor
declare function getColorStyles(index: number): { itemClass: string; borderClass: string };
declare const participants: Array<{ id: number; name: string }>;
declare const activeParticipant: { id: number; name: string };

const styles = getColorStyles(participants.findIndex((p) => p.id === activeParticipant.id));
const itemClass = styles.itemClass;



// FP: filter with find predicate — returns same element type, no mismatch
interface SelectOption { value: string; label: string }
declare const allOptions: SelectOption[];
declare const selectedOptions: SelectOption[];

function getRemainingOptions(allOpts: SelectOption[], picked: SelectOption[]) {
  return allOpts.filter((opt) => !picked.find((p) => p.value === opt.value));
}

const remaining = getRemainingOptions(allOptions, selectedOptions);



// FP: Array.findIndex() with boolean predicate — no type mismatch
declare const options: Array<{ id: number; label: string; checked: boolean }>;

const firstCheckedIndex = options.findIndex((opt) => opt.checked);



// FP: Array.every() checking id equality — standard predicate
declare const selectedFields: Array<{ id: string; assigneeId: number; label: string }>;
declare const primaryField: { assigneeId: number };

const allFieldsSameAssignee = selectedFields.every((field) => field.assigneeId === primaryField.assigneeId);



// FP: cn() with className and spread — idiomatic cn() usage
declare const cn: (...args: (string | undefined | null | boolean)[]) => string;

interface FlowContainerProps { className?: string; children?: unknown; [key: string]: unknown }

function FlowContainer({ className, children, ...props }: FlowContainerProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)} {...props}>
      {children}
    </div>
  );
}



// FP: Array.from(Map.values()) — standard conversion, no type mismatch
declare const callbackRegistry: Map<string, () => Promise<void>>;

async function runAllCallbacks() {
  const callbacks = Array.from(callbackRegistry.values());
  await Promise.all(callbacks.map(async (cb) => cb()));
}



// FP: ts-pattern P.when() with predicate — standard pattern matching
declare const match: <T>(value: T) => {
  with: (...args: unknown[]) => { exhaustive: () => unknown; otherwise: (fn: () => unknown) => unknown };
};
declare const P: { when: (predicate: (v: unknown) => boolean) => unknown };
declare enum AuthType { PASSWORD = 'PASSWORD', PASSKEY = 'PASSKEY', TWO_FA = 'TWO_FA' }
declare const selectedAuth: AuthType;

const authLabel = (match(selectedAuth)
  .with(P.when((a: unknown) => a === AuthType.PASSWORD), () => 'Enter your password')
  .with(P.when((a: unknown) => a === AuthType.PASSKEY), () => 'Use your passkey')
  .otherwise(() => 'Authenticate') as unknown) as string;



// FP shape b20cd7e2a2db: chained member_expression receiver on a string property
// resource.mimeType is string; startsWith takes string -- no type mismatch.
export function validateUploadedResource(resource: { mimeType: string; size: number; name: string }): void {
  if (!resource.mimeType.startsWith('image/')) {
    throw new Error('Only image uploads are accepted');
  }
  if (resource.size > 8 * 1024 * 1024) {
    throw new Error('Upload exceeds the 8 MB size limit');
  }
}

export function isDocumentUpload(resource: { mimeType: string; name: string }): boolean {
  return resource.mimeType.startsWith('application/') && resource.name.endsWith('.pdf');
}



// z.string().refine() with a regex guard -- value comes from z.string() so it is
// already a string; calling .toString() before regex.test() is redundant but not
// a type mismatch.

declare const currencyFormatOptions: ReadonlyArray<{ value: string; regex: RegExp }>;

interface ZodStringSchema {
  refine(predicate: (val: string) => boolean, opts?: { message: string }): ZodStringSchema;
  superRefine(predicate: (val: string, ctx: { addIssue: (issue: { code: string; message: string }) => void }) => void): ZodStringSchema;
}
declare const z: {
  string(): ZodStringSchema;
  ZodIssueCode: { custom: string };
};

function buildCurrencyFieldSchema(format: string): ZodStringSchema {
  const entry = currencyFormatOptions.find((item) => item.value === format);

  if (entry) {
    return z.string().refine(
      (value) => {
        return entry.regex.test(value.toString());
      },
      { message: `Value must match currency format: ${format}` },
    );
  }

  return z.string().superRefine((value, ctx) => {
    const isValidAmount = /^[0-9,.]+$/.test(value.toString());
    if (!isValidAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Please enter a valid currency amount',
      });
    }
  });
}



declare const fs: { readFileSync(p: string | Buffer | URL, options?: BufferEncoding | { encoding?: BufferEncoding | null }): Buffer | string };
declare const path: { join(...segments: string[]): string; resolve(...segments: string[]): string };
declare const __dirname: string;

// Load static asset files -- path.join/resolve return string, readFileSync accepts string.
const reportTemplate = fs.readFileSync(path.join(__dirname, '../templates/report.html'));
const schemaContent = fs.readFileSync(path.resolve(__dirname, '../../schemas/openapi.json'));



// FF01 — Array.push with spread object literal; types match push target
type PricingTier = { amount: number; currency: string; memberCount: number };
type BillingInterval = 'monthly' | 'annual';
declare const subscriptionPlans: Array<Record<BillingInterval, { amount: number; currency: string }> & { memberCount: number }>;
declare const selectedInterval: BillingInterval;

function buildPriceList(): PricingTier[] {
  const result: PricingTier[] = [];
  for (const plan of subscriptionPlans) {
    result.push({ ...plan[selectedInterval], memberCount: plan.memberCount });
  }
  return result;
}



// FF15 — conditional immutable map with optional chaining; no type mismatch
type UploadItem = { id: string; name: string; isError: boolean };
declare const pendingUploads: UploadItem[];
declare function useState<T>(init: T): [T, (fn: (prev: T) => T) => void];

function useUploadManager() {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);

  function markFailed(failedItems: Array<{ id: string }>) {
    setUploadQueue((prev) =>
      prev.map((item) =>
        item.id === failedItems.find((f) => f.id === item.id)?.id
          ? { ...item, isError: true }
          : item
      )
    );
  }

  return { uploadQueue, markFailed };
}



// FF25 — Array.find with optional chaining property access; no type mismatch
type CurrencyFormat = { value: string; label: string; pattern: string };
declare const currencyFormats: CurrencyFormat[];
declare const selectedCurrency: string;

const currencyPattern = currencyFormats.find((fmt) => fmt.value === selectedCurrency)?.pattern;



// FP shape: array.map returning object literal from typed source array
declare const workflowConfig: { participants: Array<{ fullName: string; contactEmail: string; permission: string }> };
declare function scheduleWorkflow(opts: { participants: Array<{ name: string; email: string; role: string }> }): Promise<void>;

async function launchWorkflow() {
  await scheduleWorkflow({
    participants: workflowConfig.participants.map((participant) => ({
      name: participant.fullName,
      email: participant.contactEmail,
      role: participant.permission,
    })),
  });
}



// FP shape: Zod .refine() with predicate function - second arg can be string or object
import { z } from 'zod';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];

const ZFileUploadSchema = z.object({
  attachment: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_UPLOAD_SIZE, 'File exceeds maximum allowed size')
    .refine((file) => ALLOWED_MIME_TYPES.includes(file.type), 'Unsupported file type')
    .nullish(),
  label: z.string().max(200).optional(),
});



// FP shape: Zod refine with string error message (second arg can be string)
import { z } from 'zod';

const MAX_LOGO_SIZE = 2 * 1024 * 1024;
const VALID_LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/webp'];

const ZLogoUploadSchema = z.object({
  logoFile: z
    .instanceof(File)
    .refine((file) => file.size <= MAX_LOGO_SIZE, 'Logo file must be smaller than 2MB')
    .refine((file) => VALID_LOGO_TYPES.includes(file.type), 'Only PNG, SVG, or WebP logos are accepted')
    .optional(),
});



// FP shape: Array.find with id equality predicate on typed array
declare const orderItems: Array<{ id: number; productId: string; quantity: number }>;
declare const lineItemId: number;

function findOrderLineItem() {
  return orderItems.find((item) => item.id === lineItemId);
}



// FP shape: new RegExp() with template literal built from typed string arrays via .join('|')
const STATUS_PREFIXES = ['pending', 'active', 'archived', 'deleted'] as const;
const PRIORITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

const TASK_FILTER_PATTERN = {
  pattern: new RegExp(
    `(${STATUS_PREFIXES.join('|')})-(${PRIORITY_LEVELS.join('|')})(\\/(draft|final))?$`,
  ),
};



// FP shape: Zod schema with z.union().transform() chained correctly
import { z } from 'zod';

const ZNotificationPrefsSchema = z.object({
  frequency: z
    .union([z.literal('daily'), z.literal('weekly'), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .optional()
    .default([]),
  channels: z
    .union([z.string(), z.array(z.string())])
    .transform((val) => (Array.isArray(val) ? val : [val]))
    .optional()
    .default([]),
});



// FP shape: Array.flatMap extracting a nested array from typed objects
declare const companies: Array<{ id: string; name: string; branches: Array<{ id: string; location: string }> }>;

function getAllBranches() {
  return companies.flatMap((company) => company.branches);
}



// FP shape: enum-keyed object access followed by Array.filter on typed audit log array
declare const AUDIT_EVENT = { USER_SIGNED: 'USER_SIGNED', USER_REJECTED: 'USER_REJECTED', FILE_OPENED: 'FILE_OPENED' } as const;
declare type AuditEvent = typeof AUDIT_EVENT[keyof typeof AUDIT_EVENT];
declare type AuditLogEntry = { type: AuditEvent; data: { recipientId?: number } };
declare const auditLogs: Record<AuditEvent, AuditLogEntry[]>;
declare const recipientId: number;

function getRecipientRejectedLogs() {
  return auditLogs[AUDIT_EVENT.USER_REJECTED].filter(
    (log) => log.type === AUDIT_EVENT.USER_REJECTED && log.data.recipientId === recipientId,
  );
}



// FP shape: Array.filter using Array.includes as predicate
declare const UNSUPPORTED_AUTH_METHODS: readonly string[];
declare const userAuthMethods: string[];

function getSupportedAuthMethods() {
  return userAuthMethods.filter((method) => !UNSUPPORTED_AUTH_METHODS.includes(method));
}



// FP shape: array.map spreading element and overriding a property with compatible type
declare const formData: { rows: Array<{ id: number; nativeId: number; label: string; order: number }> };
declare function saveRows(rows: Array<{ id: number; label: string; order: number }>): Promise<void>;

async function persistFormRows() {
  await saveRows(
    formData.rows.map((row) => ({ ...row, id: row.nativeId })),
  );
}



// FP shape: typed enum value passed to Array.includes as membership check
declare const AllowedPermissions: readonly string[];
declare const userPermission: string;

function isPermissionAllowed(): boolean {
  return AllowedPermissions.includes(userPermission);
}

declare const SUPPORTED_REGIONS: readonly string[];
declare const requestRegion: string;

function isRegionSupported(): boolean {
  return SUPPORTED_REGIONS.includes(requestRegion);
}



// FP shape: Array.filter + .length for counting — no type mismatch
declare const taskAssignments: Array<{ taskId: number; assigneeId: number; status: string }>;
declare const assigneeId: number;

function countAssigneeTasks(): number {
  return taskAssignments.filter((assignment) => assignment.assigneeId === assigneeId).length;
}



// FP shape: Array.filter combining canvas API calls with a boolean method
declare const CanvasUtil: { Util: { haveIntersection: (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => boolean } };
declare const canvasShapes: Array<{ getClientRect: () => { x: number; y: number; width: number; height: number }; isSelectable: () => boolean; id: () => string }>;
declare const selectionBox: { x: number; y: number; width: number; height: number };

function getIntersectingSelectableShapes() {
  return canvasShapes.filter(
    (shape) => CanvasUtil.Util.haveIntersection(selectionBox, shape.getClientRect()) && shape.isSelectable(),
  );
}



// FP shape: filter/some callback passing typed enum value to a comparison function
declare function isRoleWithinHierarchy(currentRole: string, targetRole: string): boolean;
declare const currentMemberRole: string;
declare const pendingInvitations: Array<{ email: string; proposedRole: string }>;

function getInvalidRoleInvitations() {
  return pendingInvitations.filter(
    (invite) => !isRoleWithinHierarchy(currentMemberRole, invite.proposedRole),
  );
}



// FP shape: String.prototype.startsWith called with IP prefix string literals
function isPrivateNetworkAddress(host: string): boolean {
  const normalized = host.replace(/\.+$/, '');

  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }

  if (normalized.startsWith('127.')) {
    return true;
  }

  if (normalized.startsWith('10.')) {
    return true;
  }

  if (normalized.startsWith('192.168.')) {
    return true;
  }

  if (normalized.startsWith('169.254.')) {
    return true;
  }

  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  return false;
}



// FP shape: Array.filter with id equality predicate on typed array
declare const workflowSteps: Array<{ id: number; assigneeId: number; name: string; completed: boolean }>;
declare const assigneeId: number;

function getStepsForAssignee() {
  return workflowSteps.filter((step) => step.assigneeId === assigneeId);
}



// FP shape: string array .includes() for membership check — no type mismatch
declare const selectedTags: string[];
declare const availableTags: Array<{ value: string; label: string }>;

function filterSelectedTags() {
  return availableTags.filter((tag) => selectedTags.includes(tag.value));
}

function isTagSelected(tagValue: string): boolean {
  return selectedTags.includes(tagValue);
}



// FP shape: Array.every with nested Array.find — no type mismatch
declare const requestedPermissions: Array<{ permissionId: string; scope: string }>;
declare const allowedPermissions: Array<{ id: string; allowedScopes: string[] }>;

function allPermissionsGranted(): boolean {
  return requestedPermissions.every((requested) => {
    const allowed = allowedPermissions.find(({ id }) => id === requested.permissionId);
    return allowed != null && allowed.allowedScopes.includes(requested.scope);
  });
}



// FP shape: Array.find with id equality on typed array items
declare const cartItems: Array<{ id: string; productId: string; quantity: number; price: number }>;
declare const orderLineId: string;

function findCartItem() {
  return cartItems.find((item) => item.id === orderLineId);
}



// FP shape: Array.find with enum comparison and nullish coalescing fallback
declare const DeliveryStatus: { PENDING: string; SENT: string; FAILED: string };
declare const queuedRecipients: Array<{ id: number; name: string; sendStatus: string }>;

function getNextRecipientToProcess() {
  return queuedRecipients.find((r) => r.sendStatus !== DeliveryStatus.SENT) ?? queuedRecipients[0];
}



// FP shape: Array.filter excluding by id — standard exclude-by-id pattern
declare const mediaItems: Array<{ id: string; filename: string; mimeType: string; size: number }>;
declare const removedItemId: string;

function removeMediaItem() {
  return mediaItems.filter((item) => item.id !== removedItemId);
}



// caf0715037bf: Array.find with string equality label check
declare const validationRules: Array<{ label: string; value: string }>;
declare const selectedRule: string;

function resolveValidationRule() {
  const matched = validationRules.find((rule) => rule.label === selectedRule);
  return matched ?? null;
}



// cb2391701144: Array.filter callback comparing numeric indices
declare function setItems(updater: (prev: string[]) => string[]): void;

function removeItemAtIndex(index: number) {
  setItems((prev) => prev.filter((_, i) => i !== index));
}



// cbcc632ff513: Number.prototype.toFixed(2) call on a numeric property
declare const layoutField: { pageHeight: number; pageWidth: number };

function formatFieldDimensions() {
  const height = layoutField.pageHeight.toFixed(2);
  const width = layoutField.pageWidth.toFixed(2);
  return `${width} x ${height}`;
}



// cc61e61a0b3e: Array.find with destructured id param, optional chaining, and default string
declare const selectedUsers: Array<{ id: string; name: string }>;
declare const participant: { groupMemberId: string };

function resolveParticipantName(): string {
  return selectedUsers.find(({ id }) => id === participant.groupMemberId)?.name || '';
}



// cc69a1a9c54f: Lingui _() translation function called with a MessageDescriptor from property access
declare function _(descriptor: { id: string; message?: string }): string;
declare const navItem: { label: { id: string; message?: string }; description: { id: string; message?: string } };

function translateNavItem() {
  const label = _(navItem.label);
  const description = _(navItem.description);
  return { label, description };
}



// ccacd1fe084b: i18n.date() with ternary cell renderer — Date passed to i18n.date()
declare const i18n: { date(d: Date | string): string };

type TableRow = { original: { lastProcessedAt: Date | null } };

const processedAtColumn = {
  header: 'Processed At',
  cell: ({ row }: { row: TableRow }) =>
    row.original.lastProcessedAt ? i18n.date(row.original.lastProcessedAt) : 'N/A',
};



// cd05e7ad9ebc: Object.values().includes() enum membership check
const SUBSCRIPTION_TIER = {
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
} as const;

function isKnownSubscriptionTier(tier: string): boolean {
  return Object.values(SUBSCRIPTION_TIER).includes(tier as (typeof SUBSCRIPTION_TIER)[keyof typeof SUBSCRIPTION_TIER]);
}



// cd0b56ea7424: Object.entries() destructured for-of loop
type FilterOption = Record<string, string | boolean | number>;

function mergeFilterOptions(target: FilterOption, overrides: FilterOption): FilterOption {
  const cloneTarget = { ...target };
  for (const [key, value] of Object.entries(overrides)) {
    cloneTarget[key] = value;
  }
  return cloneTarget;
}



// cd1ea708af53: .filter((value) => value !== null) — filtering nullable array
function collectNonNullScores(rawScores: (number | null)[]): (number | null)[] {
  return rawScores.filter((value) => value !== null);
}



// cd28cd6091c5: _(title) Lingui translation function call with a MessageDescriptor variable
declare function _(descriptor: { id: string; message?: string }): string;
declare const stepTitle: { id: string; message?: string };

function getLocalizedTitle(): string {
  return _(stepTitle);
}



// cdbd73265f63: pMap with async callback using index parameter
declare function pMap<T, R>(input: T[], mapper: (item: T, index: number) => Promise<R>, options?: { concurrency?: number }): Promise<R[]>;
declare function renderPageThumbnail(pageIndex: number): Promise<string>;
declare const pageCount: number;

async function generateThumbnails(): Promise<string[]> {
  return pMap(
    Array.from({ length: pageCount }),
    async (_, pageIndex) => renderPageThumbnail(pageIndex),
    { concurrency: 3 },
  );
}



// ce7699d0c19a: Array.map() returning an object literal transformation
declare const order: { recipients: Array<{ id: string; name: string; email: string; status: string }> };

function buildRecipientSummary() {
  return order.recipients.map((recipient) => ({
    recipientId: recipient.id,
    name: recipient.name,
    email: recipient.email,
    completionStatus: recipient.status,
  }));
}



// cea9a9b14d2a: Array.findIndex with id equality check
declare const assignees: Array<{ id: string; name: string }>;
declare const task: { assigneeId: string };

function findAssigneeIndex(): number {
  return assignees.findIndex((a) => a.id === task.assigneeId);
}



// ceec57cef844: .filter(item => !item.pinned) boolean negation filter
declare const allBookmarks: Array<{ id: string; title: string; pinned: boolean }>;

function getUnpinnedBookmarks() {
  return allBookmarks.filter((bookmark) => !bookmark.pinned);
}



// cefacf7ce369: Array.find with optional chaining on nested property
declare const contacts: Array<{ id: string; name: string }>;
declare const invitation: { referral?: { primaryContactId: string } };

function findPrimaryContact() {
  return contacts.find((contact) => contact.id === invitation.referral?.primaryContactId);
}



// cefe8803826d: Array.filter with a boolean predicate function reference
declare const formFields: Array<{ id: string; required: boolean; value: string | null }>;
declare function isRequiredAndEmpty(field: { id: string; required: boolean; value: string | null }): boolean;

function collectIncompleteFields() {
  return formFields.filter((field) => isRequiredAndEmpty(field));
}



// cf05a461348e: .map((row) => { const [a, b] = row; ... }) destructuring a string[] row
declare const parsedData: { data: string[][] };

function extractImportedUsers() {
  return parsedData.data.map((row) => {
    const [email, username, role] = row;
    return { email, username, role: role ?? 'member' };
  });
}



// cf1c7b25bd6c: Object.fromEntries(arr.map(s => s.split('='))) — string split used as entry tuple
declare const queryMetadata: string[];

function parseQueryMetadata(): Record<string, string> {
  return Object.fromEntries(queryMetadata.map((property) => property.split('=')));
}



// cf31b912e754: functional state update with find inside map — conditional item replacement
declare function setAttachments(updater: (prev: Array<{ id: string; status: string }>) => Array<{ id: string; status: string }>): void;
declare const incomingAttachments: Array<{ id: string; status: string }>;

function applyAttachmentUpdates() {
  setAttachments((prev) =>
    prev.map((attachment) =>
      attachment.id === incomingAttachments.find((a) => a.id === attachment.id)?.id
        ? { ...attachment, status: 'updated' }
        : attachment,
    ),
  );
}



// cf3c8f76d79d: conditional map with early return for non-matching id
declare const editorWidgets: Array<{ id: string; value: string; type: string }>;
declare const update: { widgetId: string; newValue: string };

function applyWidgetUpdate() {
  return editorWidgets.map((widget) => {
    if (widget.id !== update.widgetId) return widget;
    return { ...widget, value: update.newValue };
  });
}



// cf3e69c7612c: Array.find with fieldId equality
declare const submittedValues: Array<{ fieldId: string; value: string }>;
declare const templateField: { id: string; label: string };

function findSubmittedValueForField() {
  return submittedValues.find((entry) => entry.fieldId === templateField.id);
}



// cf79f6490cf3: Number.prototype.toFixed(2) on a numeric width property
declare const canvasElement: { pageWidth: number; pageHeight: number };

function formatCanvasDimensionsStyle() {
  return `width: ${canvasElement.pageWidth.toFixed(2)}%; height: ${canvasElement.pageHeight.toFixed(2)}%;`;
}



// cfa8b750982d: optional chaining Array.find with email equality check
declare const teamMembers: Array<{ email: string; name: string }> | undefined;
declare const selection: { value: string };

function resolveTeamMemberName(): string {
  const member = teamMembers?.find((m) => m.email === selection.value);
  return member?.name || selection.value;
}



// cfb3f0fbed12: map+filter nested pattern — map recipients, filter fields inside
declare const contract: {
  participants: Array<{ id: string; name: string }>;
  sections: Array<{ participantId: string; content: string }>;
};

function groupSectionsByParticipant() {
  return contract.participants.map((participant) => {
    const participantSections = contract.sections.filter(
      (section) => section.participantId === participant.id,
    );
    return { ...participant, sections: participantSections };
  });
}



// d00614625d7b: Promise.allSettled with async map callback
declare const teamInvites: Array<{ email: string; token: string }>;
declare function sendTeamInviteEmail(opts: { email: string; token: string; teamName: string }): Promise<void>;
declare const teamName: string;

async function dispatchAllInviteEmails(): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(
    teamInvites.map(async ({ email, token }) =>
      sendTeamInviteEmail({ email, token, teamName }),
    ),
  );
}



// --- shape daea13b64357: path.join with require.resolve to compute content glob ---
declare const path: { join: (...parts: string[]) => string };
declare function requireResolve(id: string): string;

const uiComponentsGlob = `${path.join(requireResolve('@myorg/ui'), '..')}/components/**/*.{ts,tsx}`;
const uiIconsGlob = `${path.join(requireResolve('@myorg/ui'), '..')}/icons/**/*.{ts,tsx}`;

const contentPaths = [
  './app/**/*.{ts,tsx}',
  uiComponentsGlob,
  uiIconsGlob,
];



// --- shape dbc9487481f2: Object.values().some() to check if any array has items ---
declare const validationErrors: Record<string, string[]>;

const hasAnyErrors = Object.values(validationErrors).some((errors) => errors.length > 0);



// --- shape dc1e7b9543b3: array.filter excluding by id to remove deleted item ---
declare const uploadedFiles: Array<{ itemId: string; name: string; isReplacing: boolean }>;
declare const uploadingFiles: Array<{ itemId: string; name: string }>;

function onFileDelete(itemId: string): Array<{ itemId: string; name: string }> {
  return uploadingFiles.filter((uploadingFile) => uploadingFile.itemId !== itemId);
}

function removeFieldsByItem(fields: Array<{ itemId: string; fieldId: string }>, deletedItemId: string) {
  return fields.filter((field) => field.itemId !== deletedItemId);
}



// --- shape dcaac60c3d3e: recipients.map(r => r.id) extracting IDs ---
declare const recipients: Array<{ id: number; email: string; name: string }>;

const recipientIds = recipients.map((recipient) => recipient.id);



// --- shape dd0ac916d062: array.includes(error.code) for TRPC error code check ---
declare const error: { code: string; cause?: unknown };
const errorCodesToAlertOn = ['UNKNOWN_ERROR', 'INTERNAL_SERVER_ERROR'];

const isLoggableTrpcError = errorCodesToAlertOn.includes(error.code);



// --- shape dd3f8df93a9f: flatMap + find with optional chaining ---
declare const groups: Array<{ id: string; clientId: string; members: Array<{ id: number; clientId: string }> }>;
declare const updatedMembers: Array<{ clientId: string; role: string }> | undefined;

const resolvedMembers = groups.flatMap((group) => group.members).find(
  (member) => member.clientId === updatedMembers?.find((m) => m.clientId === member.clientId)?.clientId,
);



// --- shape dde56705abda: array.some(domain => email.endsWith('@' + domain)) ---
declare const allowedDomains: string[];
declare const email: string;

const isDomainAllowed =
  allowedDomains.length === 0 || allowedDomains.some((domain) => email.endsWith(`@${domain}`));

if (!isDomainAllowed) {
  throw new Error('Email domain not allowed');
}



// --- shape ddeb3900a76c: array.some comparing signer.role to an enum value ---
const RecipientRole = {
  ASSISTANT: 'ASSISTANT',
  SIGNER: 'SIGNER',
  VIEWER: 'VIEWER',
} as const;
type RecipientRoleType = typeof RecipientRole[keyof typeof RecipientRole];

declare const signers: Array<{ role: RecipientRoleType; email: string }>;

const hasAssistantRole = signers.some((signer) => signer.role === RecipientRole.ASSISTANT);



// --- shape deefdfa20b28: filter with type predicate narrowing ---
interface BaseTemplate { id: number; type: string; directLink?: { enabled: boolean; token: string } }
interface DirectTemplate extends BaseTemplate { directLink: { enabled: true; token: string } }

declare const templates: BaseTemplate[];

const directTemplates = templates.filter(
  (template): template is DirectTemplate => template.directLink?.enabled === true,
);



// --- shape dfc8d2b043f2: array.filter with optional-chained equality ---
declare const formFields: Array<{ id: string; recipientId: number | null }>;
declare const selectedRecipient: { id: number } | null | undefined;

const selectedRecipientFields = formFields.filter(
  (field) => field.recipientId === selectedRecipient?.id,
);



// --- shape dfea1084b90d: array.filter(e => e.includes('required')) ---
declare const validationMessages: string[];

const requiredErrors = validationMessages.filter((error) => error.includes('required'));
const lengthErrors = validationMessages.filter((error) => error.includes('character limit'));



// i18n underscore method call with message descriptor
declare function parseMessageDescriptor(fn: Function, descriptor: unknown): string;
declare const i18n: { _: Function };
declare const confirmText: { id: string; defaultMessage: string } | undefined;

function getConfirmLabel(): string {
  if (confirmText) {
    return parseMessageDescriptor(i18n._, confirmText);
  }
  return 'Confirm';
}



// Math.max with spread of mapped array values
declare interface FormOption { id: number; label: string; checked: boolean; }
declare function getFormOptions(): FormOption[];

function addNextOption(): void {
  const currentOptions = getFormOptions();
  const newId =
    currentOptions.length > 0
      ? Math.max(...currentOptions.map((opt) => opt.id)) + 1
      : 1;
  console.log('next id:', newId);
}



// Typed function call passing a typed object argument
declare interface Assignee { id: string; name: string; email: string; role: string; }
declare function getAssigneeDisplayLabel(assignee: Assignee): string;
declare const selectedAssignee: Assignee | null;

function renderAssigneeLabel(): string {
  if (selectedAssignee) {
    return getAssigneeDisplayLabel(selectedAssignee);
  }
  return 'No assignee';
}



// Math.max with spread and nullish coalescing
declare interface SigningParticipant { signingOrder?: number; name: string; }
declare function getParticipants(): SigningParticipant[];

function getNextSigningOrder(): number {
  const participants = getParticipants();
  const nextOrder =
    participants.length > 0
      ? Math.max(...participants.map((p) => p.signingOrder ?? 0)) + 1
      : 1;
  return nextOrder;
}



// i18n translation call with fallback (_(LABELS[type]) || type)
declare function i18nTranslate(key: string): string;
declare const FIELD_TYPE_LABELS: Record<string, string>;

function getFieldTypeLabel(type: string): string {
  return i18nTranslate(FIELD_TYPE_LABELS[type]) || type;
}

function renderFieldList(fieldTypes: string[]): string[] {
  return fieldTypes.map((type) => getFieldTypeLabel(type));
}



// getAssetUrl with string argument - valid url helper call (argument-type-mismatch FP)
declare function getAssetUrl(path: string): string;

const documentImageUrl = getAssetUrl('/static/document.png');
const logoUrl = getAssetUrl('/static/logo.svg');
const placeholderUrl = getAssetUrl('/static/placeholder.webp');



// Array.map with index access into parallel array (argument-type-mismatch FP)
interface PageInfo { width: number; height: number }
interface FieldMatch { pageIndex: number; x: number; y: number }

function mapFieldsToPages(matches: FieldMatch[], pages: PageInfo[]): Array<FieldMatch & PageInfo> {
  return matches.map((match) => {
    const page = pages[match.pageIndex];
    return { ...match, width: page.width, height: page.height };
  });
}



// Array.some with case-insensitive email comparison (argument-type-mismatch FP)
interface Participant { email: string; name: string }

function isAlreadyEnrolled(participants: Participant[], candidateEmail: string): boolean {
  return participants.some(
    (p) => p.email.toLowerCase() === candidateEmail.toLowerCase()
  );
}



// i18n.date() formats a Date - valid LinguiJS date argument (argument-type-mismatch FP)
declare const i18n: { date: (d: Date, options?: Intl.DateTimeFormatOptions) => string };

function formatJobDate(submittedAt: Date): string {
  return i18n.date(submittedAt, { dateStyle: 'medium', timeStyle: 'short' });
}



// Array.some with startsWith negation predicate (argument-type-mismatch FP)
interface UploadedFile { name: string; type: string; size: number }

function hasNonPdfFiles(files: UploadedFile[]): boolean {
  return files.some((file) => !file.type.startsWith('application/pdf'));
}

function validateFileUploads(files: UploadedFile[]): { valid: boolean; reason?: string } {
  if (hasNonPdfFiles(files)) {
    return { valid: false, reason: 'Only PDF files are accepted' };
  }
  return { valid: true };
}



// Multi-condition filter with optional chain - valid boolean expression (argument-type-mismatch FP)
interface FormField { id: string; type: string; recipientId?: string; value?: string }
interface Envelope { fields: FormField[] }

function getUnassignedTextFields(envelope: Envelope, recipientId: string): FormField[] {
  return envelope.fields.filter(
    (field) =>
      field.type === 'TEXT' &&
      (!field.recipientId || field.recipientId === recipientId) &&
      !field.value
  );
}



// Array.find with string equality for current user (argument-type-mismatch FP)
interface Recipient { email: string; name: string; role: string }
interface CurrentUser { email: string; id: string }

function findCurrentUserRecipient(
  recipients: Recipient[],
  user: CurrentUser
): Recipient | undefined {
  return recipients.find((recipient) => recipient.email === user.email);
}



// String split then filter empty values - standard string parsing (argument-type-mismatch FP)
function parseTagsFromInput(raw: string): string[] {
  return raw.split(',').filter((value) => value !== '').map((v) => v.trim());
}

function parseEventTriggers(raw: string): string[] {
  return raw.split(',').filter((value) => value !== '');
}



// Lingui i18n tagged template literal call - valid string translation (argument-type-mismatch FP)
declare function _(msg: any): string;
declare function msg(strings: TemplateStringsArray, ...values: any[]): any;

const statusLabels = {
  viewed: _(msg`Viewed`),
  signed: _(msg`Signed`),
  declined: _(msg`Declined`),
  pending: _(msg`Pending`),
};



// Array.filter with multi-condition enum exclusion (argument-type-mismatch FP)
enum ParticipantRole { SIGNER = 'SIGNER', APPROVER = 'APPROVER', CC = 'CC', VIEWER = 'VIEWER' }

interface TemplateRecipient { role: ParticipantRole; name: string; email: string }

function getAssignableRecipients(recipients: TemplateRecipient[]): TemplateRecipient[] {
  return recipients.filter(
    (recipient) =>
      recipient.role !== ParticipantRole.CC &&
      recipient.role !== ParticipantRole.VIEWER
  );
}



// Array.map with two arguments (item + index) - standard mapping (argument-type-mismatch FP)
interface AuditEntry { action: string; performedAt: string; performedBy: string }

function formatAuditLog(logs: AuditEntry[]): string[] {
  return logs.map((entry, index) =>
    `[${index + 1}] ${entry.action} by ${entry.performedBy} at ${entry.performedAt}`
  );
}



// Simple boolean filter predicate - filter(field => !field.complete) (argument-type-mismatch FP)
interface FormField { id: string; label: string; complete: boolean; required: boolean }

function getPendingRequiredFields(fields: FormField[]): FormField[] {
  return fields.filter((field) => !field.complete && field.required);
}

function getIncompleteFields(fields: FormField[]): FormField[] {
  return fields.filter((field) => !field.complete);
}



// Array.map transforming groups to membership payload objects (argument-type-mismatch FP)
interface OrgGroup { id: string; name: string; defaultRole: string }

function buildGroupMemberships(
  groups: OrgGroup[],
  teamRole: string
): Array<{ organisationGroupId: string; teamRole: string }> {
  return groups.map((group) => ({
    organisationGroupId: group.id,
    teamRole: teamRole || group.defaultRole,
  }));
}



// Array.map with ternary spread for immutable role update (argument-type-mismatch FP)
interface ParticipantEntry { id: string; email: string; role: string; name: string }

function updateParticipantRole(
  participants: ParticipantEntry[],
  targetId: string,
  newRole: string
): ParticipantEntry[] {
  return participants.map((p) =>
    p.id === targetId ? { ...p, role: newRole } : p
  );
}



// Function call with nullish coalescing in argument - valid typed call (argument-type-mismatch FP)
declare function setDocumentRecipients(args: {
  userId: string;
  teamId?: string;
  documentId: string;
  recipients: Array<{ email: string; role: string }>;
}): Promise<void>;

interface ApiToken { teamId: string | null }

async function applyRecipients(
  apiToken: ApiToken,
  userId: string,
  documentId: string,
  recipients: Array<{ email: string; role: string }>
): Promise<void> {
  await setDocumentRecipients({
    userId,
    teamId: apiToken.teamId ?? undefined,
    documentId,
    recipients,
  });
}



// argument-type-mismatch FP: intentional ts-expect-error for 3rd-party canvas compat
declare function renderPage(options: { canvas: unknown; viewport: unknown }): void;
declare const canvasEl: unknown;
declare const viewportData: unknown;

function renderWithNativeCanvas(): void {
  // @ts-expect-error napi-rs/canvas has a different canvas type than dom Canvas
  renderPage({ canvas: canvasEl, viewport: viewportData });
}

export { renderWithNativeCanvas };



// argument-type-mismatch FP: typed async function call with structured object arg
declare function createTemplate(params: { title: string; dataId: string }): Promise<{ id: string }>;

async function initializeTemplate(title: string, dataId: string): Promise<{ id: string }> {
  return await createTemplate({ title, dataId });
}

export { initializeTemplate };



// argument-type-mismatch FP: i18n translation call with message descriptor
interface MessageDescriptor { id: string; defaultMessage?: string }
declare function translate(descriptor: MessageDescriptor): string;
declare const welcomeMessage: MessageDescriptor;

function getTranslatedText(): string {
  return translate(welcomeMessage);
}

export { getTranslatedText };



// argument-type-mismatch FP: Promise.all with typed call array
declare function updateDocument(params: { id: string; title: string }): Promise<void>;
declare function notifyRecipients(docId: string): Promise<void>;

async function saveDocumentAndNotify(id: string, title: string): Promise<void> {
  await Promise.all([updateDocument({ id, title }), notifyRecipients(id)]);
}

export { saveDocumentAndNotify };



// argument-type-mismatch FP: discriminated union id passed to typed function
type DocumentRef =
  | { type: 'envelopeId'; id: string }
  | { type: 'templateId'; id: string };

declare function sendDocument(params: {
  id: DocumentRef;
  senderId: string;
  message?: string;
}): Promise<void>;

async function dispatchEnvelope(envelopeId: string, senderId: string): Promise<void> {
  await sendDocument({
    id: { type: 'envelopeId', id: envelopeId },
    senderId,
    message: 'Please sign this document.',
  });
}

export { dispatchEnvelope };



// argument-type-mismatch FP: dynamic import with destructuring
async function captureScreenshot(url: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const screenshot = await page.screenshot({ type: 'png' });
  await browser.close();
  return screenshot;
}

export { captureScreenshot };



// argument-type-mismatch FP: Promise.all with multiple typed async calls
declare function renderEmailHtml(params: { to: string; subject: string }): Promise<string>;
declare function renderEmailText(params: { to: string; subject: string }, opts: { plainText: boolean }): Promise<string>;

async function renderEmailVariants(to: string, subject: string): Promise<[string, string]> {
  return Promise.all([
    renderEmailHtml({ to, subject }),
    renderEmailText({ to, subject }, { plainText: true }),
  ]);
}

export { renderEmailVariants };



// argument-type-mismatch FP: optional-chained userId passed to typed function
interface Session { user?: { id: number } }
declare function getEnvelopeForSigning(params: { token: string; userId?: number }): Promise<unknown>;
declare const currentSession: Session | null;

async function loadSigningEnvelope(token: string): Promise<unknown> {
  return getEnvelopeForSigning({
    token,
    userId: currentSession?.user?.id,
  });
}

export { loadSigningEnvelope };



// argument-type-mismatch FP: Prisma transaction with async callback
interface TxClient {
  field: { delete: (args: { where: { id: string } }) => Promise<{ id: string }> };
  auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<void> };
}
declare const prisma: { $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T> };

async function deleteFieldWithAudit(fieldId: string, userId: string): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const deletedField = await tx.field.delete({ where: { id: fieldId } });
    await tx.auditLog.create({ data: { action: 'field.deleted', fieldId, userId } });
    return deletedField;
  });
}

export { deleteFieldWithAudit };



// argument-type-mismatch FP: setInterval return assigned to NodeJS.Timeout | null variable
declare function setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
declare function clearInterval(id: ReturnType<typeof setInterval> | null): void;

function createPollingManager(pollFn: () => void, intervalMs: number) {
  let interval: ReturnType<typeof setInterval> | null = null;

  function start(): void {
    if (!interval) {
      interval = setInterval(pollFn, intervalMs);
    }
  }

  function stop(): void {
    clearInterval(interval);
    interval = null;
  }

  return { start, stop };
}

export { createPollingManager };



// argument-type-mismatch FP: Promise.all with multiple parallel ORM queries
interface User { id: string; email: string; name: string }
interface Envelope { id: string; title: string; status: string }
interface Recipient { id: string; envelopeId: string; email: string }
declare const db: {
  user: { findFirstOrThrow: (args: object) => Promise<User> };
  envelope: { findFirstOrThrow: (args: object) => Promise<Envelope> };
  recipient: { findFirstOrThrow: (args: object) => Promise<Recipient> };
};

async function loadSigningContext(envelopeId: string, userId: string, recipientId: string) {
  const [user, envelope, recipient] = await Promise.all([
    db.user.findFirstOrThrow({ where: { id: userId } }),
    db.envelope.findFirstOrThrow({ where: { id: envelopeId } }),
    db.recipient.findFirstOrThrow({ where: { id: recipientId } }),
  ]);
  return { user, envelope, recipient };
}

export { loadSigningContext };



// argument-type-mismatch FP: typed function call with object arg containing async fn property
declare function uploadFile(params: {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<{ fileId: string }>;

async function storeDocumentPdf(title: string, pdfBytes: Uint8Array): Promise<{ fileId: string }> {
  return uploadFile({
    name: title,
    type: 'application/pdf',
    arrayBuffer: async () => pdfBytes.buffer as ArrayBuffer,
  });
}

export { storeDocumentPdf };



// argument-type-mismatch FP: dynamic import inside IIFE for conditional loading
async function loadNativeCanvasIfAvailable(): Promise<boolean> {
  try {
    await (async () => {
      const canvas = await import('skia-canvas');
      return canvas;
    })();
    return true;
  } catch {
    return false;
  }
}

export { loadNativeCanvasIfAvailable };



// argument-type-mismatch FP: i18n helper receiving descriptor from object index lookup
interface MessageDescriptor { id: string; defaultMessage?: string }
enum FieldType { TEXT = 'TEXT', DATE = 'DATE', NUMBER = 'NUMBER', CHECKBOX = 'CHECKBOX' }
declare function parseMessageDescriptor(
  translate: (d: MessageDescriptor) => string,
  descriptor: MessageDescriptor
): string;
declare function translate(descriptor: MessageDescriptor): string;

const FRIENDLY_FIELD_TYPE: Record<FieldType, MessageDescriptor> = {
  [FieldType.TEXT]: { id: 'field.type.text', defaultMessage: 'Text' },
  [FieldType.DATE]: { id: 'field.type.date', defaultMessage: 'Date' },
  [FieldType.NUMBER]: { id: 'field.type.number', defaultMessage: 'Number' },
  [FieldType.CHECKBOX]: { id: 'field.type.checkbox', defaultMessage: 'Checkbox' },
};

function getFieldTypeLabel(fieldType: FieldType): string {
  return parseMessageDescriptor(translate, FRIENDLY_FIELD_TYPE[fieldType]);
}

export { getFieldTypeLabel };


// Array.every with exhaustive ts-pattern match in predicate — valid pattern.
declare function match<T>(value: T): { with<R>(pattern: unknown, fn: () => R): { otherwise(fn: () => R): R; with<R2>(pattern: unknown, fn: () => R2): any } };

type AuthMethod = 'password' | 'oauth' | 'magic-link';

function allAuthMethodsSupported(methods: AuthMethod[]): boolean {
  return methods.every((auth) =>
    match(auth)
      .with('password', () => true)
      .with('oauth', () => true)
      .with('magic-link', () => true)
      .otherwise(() => false),
  );
}


// forEach with match() exhaustive pattern — valid ts-pattern exhaustive match.
declare function match<T>(value: T): {
  with<R>(p: unknown, fn: () => R): { with<R2>(p2: unknown, fn2: () => R2): { exhaustive(): R | R2 } };
};

type RenderMode = 'edit' | 'sign';
interface CheckboxItem { value: string; checked: boolean; }

function applyCheckboxValues(items: CheckboxItem[], mode: RenderMode, selected: number[]) {
  items.forEach(({ value, checked }, index) => {
    const _isChecked = match(mode)
      .with('edit', () => checked)
      .with('sign', () => selected.includes(index))
      .exhaustive();
    console.log(value, _isChecked);
  });
}


// String array includes check on enum value — no type mismatch.
type FieldType = 'NUMBER' | 'RADIO' | 'CHECKBOX' | 'DROPDOWN' | 'TEXT' | 'SIGNATURE';

function isAdvancedFieldType(type: FieldType): boolean {
  return ['NUMBER', 'RADIO', 'CHECKBOX', 'DROPDOWN', 'TEXT'].includes(type);
}



// --- index-of-positive-check shape: indexOf(...) >= 0 is correct idiom ---
// Checking >= 0 is semantically equivalent to !== -1 for presence detection.
// Not a bug; both forms are valid and widely used.
declare type CanvasNode = { id: string; hasName: (n: string) => boolean };
declare type Transformer = { nodes: () => CanvasNode[] };

function isNodeSelected(transformer: Transformer, node: CanvasNode): boolean {
  return transformer.nodes().indexOf(node) >= 0;
}

export function toggleNodeSelection(
  transformer: Transformer,
  node: CanvasNode,
  multiSelect: boolean,
  currentSelection: CanvasNode[],
): CanvasNode[] {
  const isSelected = transformer.nodes().indexOf(node) >= 0;

  if (!multiSelect && !isSelected) {
    return [node];
  } else if (multiSelect && isSelected) {
    return currentSelection.filter((n) => n.id !== node.id);
  } else if (multiSelect && !isSelected) {
    return [...currentSelection, node];
  }

  return currentSelection;
}



// --- void-zero-argument FP shape: browser-close-finally (void browser.close() in finally block) ---
declare class HeadlessBrowser {
  launch(): Promise<void>;
  newPage(): Promise<HeadlessPage>;
  close(): Promise<void>;
}
declare class HeadlessPage {
  goto(url: string): Promise<void>;
  screenshot(): Promise<Buffer>;
}
declare const chromium: { launch(): HeadlessBrowser };

async function capturePageScreenshot(url: string): Promise<Buffer> {
  const browser = chromium.launch();
  try {
    await browser.launch();
    const page = await browser.newPage();
    await page.goto(url);
    return await page.screenshot();
  } finally {
    void browser.close();
  }
}



// --- void-zero-argument FP shape: onclick-copy-clipboard (void onCopyToClipboard(id) in onClick) ---
declare function copyToClipboard(text: string): Promise<void>;
declare function showToast(msg: string): void;

function AdminTeamRow({ organisationId }: { organisationId: string }) {
  const onCopyToClipboard = async (value: string) => {
    await copyToClipboard(value);
    showToast('Copied to clipboard');
  };

  return {
    onOrgIdClick: () => void onCopyToClipboard(organisationId),
  };
}



// --- void-zero-argument FP shape: callback-prop-copy-with-args (onCopy={() => void onCopy('format', value)}) ---
declare function onCopy(format: string, value: number): Promise<void>;

interface TimestampDisplayProps {
  unix: number;
  iso: string;
}

function TimestampDisplay({ unix, iso }: TimestampDisplayProps) {
  return {
    onCopyUnix: () => void onCopy('Unix', unix),
    onCopyIso: () => void onCopy('ISO', Date.parse(iso)),
  };
}



// --- void-zero-argument FP shape: page-cleanup-error-path (void page.cleanup() fire-and-forget in error path) ---
declare class RenderPage {
  render(): Promise<Buffer>;
  cleanup(): Promise<void>;
}
declare function createRenderPage(source: Buffer): Promise<RenderPage>;

async function convertPdfPageToImage(pdfSource: Buffer, pageIndex: number): Promise<Buffer | null> {
  let page: RenderPage | null = null;
  try {
    page = await createRenderPage(pdfSource);
    return await page.render();
  } catch (_err) {
    if (page) {
      void page.cleanup();
    }
    return null;
  }
}



// --- void-zero-argument FP shape: onclick-copy-id-string (void onCopyToClipboard(String(id)) in onClick) ---
declare function copyToClipboard(text: string): Promise<void>;
declare function showToast(msg: string): void;

function AdminTeamIdCell({ teamId }: { teamId: number }) {
  const onCopyToClipboard = async (value: string) => {
    await copyToClipboard(value);
    showToast('ID copied');
  };

  return {
    onCopyTeamId: () => void onCopyToClipboard(String(teamId)),
  };
}



// Outer if checks key type; inner if checks state — cannot collapse because the
// outer block also contains an independent 'Escape' branch that would be dropped.
declare const inputEl: { value: string; blur(): void };
declare const selectedItems: Array<{ fixed?: boolean; value: string }>;
declare function removeItem(item: { value: string }): void;

function handleKeyNavigation(key: string): void {
  if (key === 'Delete' || key === 'Backspace') {
    if (inputEl.value === '' && selectedItems.length > 0) {
      const last = selectedItems[selectedItems.length - 1];
      if (!last.fixed) {
        removeItem(last);
      }
    }
  }

  if (key === 'Escape') {
    inputEl.blur();
  }
}



// Two-step guard: outer checks nullability, inner validates value.
// Collapsing would obscure the null-vs-invalid distinction.
declare function throwInvalid(msg: string): never;

function validateTeamId(rawTeamId: string | null): number | null {
  const parsed = rawTeamId !== null ? Number(rawTeamId) : null;

  if (typeof parsed === 'number') {
    if (Number.isNaN(parsed) || parsed <= 0) {
      throwInvalid('Invalid team ID provided');
    }
  }

  return parsed;
}



// Render helper: single file destructures mode with default string param
declare const renderLayer: (opts: { mode?: string; layerId: string }) => void;

export function renderTextField(options: { layerId: string; mode?: string }) {
  const { layerId, mode = 'edit' } = options;
  renderLayer({ mode, layerId });
}



// Single route component that sets a 'status' URL search param
declare const useSearchParams: () => URLSearchParams;
declare const navigate: (url: string) => void;

export function applyStatusFilter(value: string) {
  const params = useSearchParams();
  params.set('status', value);
  navigate(`?${params.toString()}`);
}



// Single route handler accesses a 'requestMetadata' context key; standalone usage
declare const ctx: { get: (key: string) => unknown };

export function handleSignOut() {
  const metadata = ctx.get('requestMetadata');
  if (!metadata) {
    throw new Error('Missing request metadata');
  }
  return metadata;
}



// Test constants file uses 'full' and 'column' as width param literals; distinct option values
declare function buildLayout(opts: { width: string; columns: number }): object;

export const LAYOUT_FULL = buildLayout({ width: 'full', columns: 1 });
export const LAYOUT_COLUMN = buildLayout({ width: 'column', columns: 2 });



// Single utils file checks env var === 'true'; standard boolean-string env check
declare function getEnv(key: string): string | undefined;

const isVerboseLogging = getEnv('APP_VERBOSE') === 'true';
const isMetricsEnabled = getEnv('APP_METRICS') === 'true';

export function shouldLog(): boolean {
  return isVerboseLogging;
}

export function shouldTrackMetrics(): boolean {
  return isMetricsEnabled;
}



// Single banner component compares license status strings; 'EXPIRED' and 'UNAUTHORIZED' are domain enum values
declare const licenseStatus: string;

export function getLicenseBannerStyle(): string {
  if (licenseStatus === 'EXPIRED' || licenseStatus === 'UNAUTHORIZED') {
    return 'bg-destructive text-destructive-foreground';
  }
  return 'bg-warning text-warning-foreground';
}



// Two parallel analytics queries use DATE_TRUNC('MONTH') on different columns; symmetric analytics
declare function sqlLit(val: string): unknown;
declare function dateTrunc(fn: unknown, col: string): unknown;
declare const db: { selectFrom: (t: string) => any };

export async function getMonthlySignups() {
  return db
    .selectFrom('User')
    .select(() => [dateTrunc(sqlLit('MONTH'), 'User.createdAt')])
    .groupBy('month');
}

export async function getMonthlyActivations() {
  return db
    .selectFrom('Subscription')
    .select(() => [dateTrunc(sqlLit('MONTH'), 'Subscription.activatedAt')])
    .groupBy('month');
}



// Single add-signers component sorts by signingOrder asc; standalone sort directive
declare function sortBy<T>(arr: T[], fields: [string, string][]): T[];
declare function prop(key: string): string;

type Signer = { id: number; signingOrder: number; name: string };

export function sortSigners(signers: Signer[]): Signer[] {
  return sortBy(signers, [[prop('signingOrder'), 'asc'], [prop('id'), 'asc']]);
}



// Single text field settings checks field === 'text' and accesses fieldState.text; 'text' used once
declare const fieldState: { text?: string; fontSize?: number };

export function resolveTextValue(field: string, value: string | boolean): string {
  const text = field === 'text' ? String(value) : (fieldState.text ?? '');
  return text;
}



// Single grid-lines file creates guide-line objects with 'edge' type and 'horizontal' direction
type GuideLine = { type: string; direction: string; position: number };

export function createEdgeGuideLines(pageHeight: number): GuideLine[] {
  return [
    { type: 'edge', direction: 'horizontal', position: 0 },
    { type: 'edge', direction: 'horizontal', position: pageHeight },
  ];
}



// Two field editor forms set Zod error path to different field names; same 'path' key, different contexts
declare const ctx: { addIssue: (issue: { path: string[]; message: string; code: string }) => void };

export function validateRadioValues(values: string[]) {
  if (values.length === 0) {
    ctx.addIssue({ path: ['values'], message: 'At least one option required', code: 'custom' });
  }
}

export function validateRadioText(text: string) {
  if (!text.trim()) {
    ctx.addIssue({ path: ['text'], message: 'Label text is required', code: 'custom' });
  }
}



// Single file uses 'customDocumentData' as a form field name; one usage, not a duplicate
declare const form: { watch: (field: string) => unknown; setValue: (field: string, value: unknown) => void };

export function watchCustomData() {
  return form.watch('customDocumentData');
}



// Single field-item component uses '' as a minHeight fallback; standalone usage
declare const fieldMeta: { minHeight?: string } | undefined;

export function resolveMinHeight(): string {
  return fieldMeta?.minHeight ?? '';
}



// Single recipient-colors file defines design tokens; within-file palette repetition
type ColorPalette = { baseRing: string; baseText: string; baseBg: string };

export const RECIPIENT_COLORS: ColorPalette[] = [
  { baseRing: 'ring-blue-500', baseText: 'text-blue-700', baseBg: 'bg-blue-100' },
  { baseRing: 'ring-green-500', baseText: 'text-green-700', baseBg: 'bg-green-100' },
  { baseRing: 'ring-purple-500', baseText: 'text-purple-700', baseBg: 'bg-purple-100' },
];



// Single file uses 'values' as a form field name in getValues; independently used in dropdown form
declare const form: { getValues: (field: string) => unknown };

export function getDropdownValues(): unknown {
  return form.getValues('values');
}



// Single dialog usage of 'original' in an onClick callback; one usage, not a cross-file duplicate
declare function downloadFile(variant: string, fileId: string): void;
declare const fileId: string;

export function handleDownloadOriginal() {
  downloadFile('original', fileId);
}



// Single test fixture uses type = 'DOCUMENT' as a default parameter; standalone usage
declare function createEnvelope(opts: { title: string; type?: string; ownerId: number }): Promise<{ id: number }>;

export async function seedDocumentEnvelope(opts: { title: string; ownerId: number; type?: string }) {
  return createEnvelope({ type: 'DOCUMENT', ...opts });
}



// Single insights query selects from 'Team as t'; standalone SQL alias usage
declare const prisma: { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]> };

export async function getTeamInsights(orgId: number) {
  return prisma.$queryRaw`
    SELECT t.id, t.name, COUNT(tm.id) as memberCount
    FROM "Team as t"
    JOIN "TeamMember" tm ON tm.teamId = t.id
    WHERE t.organisationId = ${orgId}
    GROUP BY t.id
  `;
}



// Single reminder-settings picker checks 'disabled' in value.sendAfter; one usage
declare const value: { sendAfter?: string };

export function isReminderDisabled(): boolean {
  return value.sendAfter === 'disabled';
}



// Single dropzone constants file uses type: 'spring' in animation config; one usage
type AnimationTransition = { type: string; stiffness: number; damping: number };

export const DROPZONE_ANIMATION_TRANSITION: AnimationTransition = {
  type: 'spring',
  stiffness: 260,
  damping: 20,
};



// Single file uses 'signers' as a form field name; appears once in this embed configure component
declare const form: { register: (name: string) => object; getValues: (name: string) => unknown };

export function getSigners() {
  return form.getValues('signers');
}



// Single SSO confirmation route uses 'invalid-token' as a match branch; one usage
declare function match<T>(value: T): { with: (pattern: T, fn: () => unknown) => { otherwise: (fn: () => unknown) => unknown } };
declare const tokenStatus: string;

export function getSsoConfirmationMessage(): string {
  return match(tokenStatus)
    .with('invalid-token', () => 'This confirmation link is no longer valid.')
    .otherwise(() => 'Something went wrong.') as string;
}



// Single render-signature-field file destructures mode with default 'edit'; standalone param default
declare const signatureLayer: { draw: (opts: { mode: string }) => void };

export function renderSignatureField(options: { fieldId: string; mode?: string }) {
  const { fieldId, mode = 'edit' } = options;
  signatureLayer.draw({ mode });
  return fieldId;
}



// Form field path ['invitations', index, 'email'] in a single file; schema field names, not extractable constants
declare const form: { register: (path: string) => object; formState: { errors: Record<string, unknown> } };

export function InvitationEmailField({ index }: { index: number }) {
  return form.register(`invitations.${index}.email`);
}



// FP shape: 'disabled' key check with 'in' operator in a single mode-detection function (single-usage-false-trigger)
type ExpirationConfig = { disabled: true } | { durationDays: number } | null | undefined;
type ExpirationMode = 'inherit' | 'disabled' | 'duration';

function resolveExpirationMode(value: ExpirationConfig): ExpirationMode {
  if (!value) {
    return 'inherit';
  }

  if ('disabled' in value) {
    return 'disabled';
  }

  return 'duration';
}



// FP shape: typeof type-guard string in a single OAuth callback handler (type-system-discriminant)
declare class AuthError extends Error {
  constructor(code: string, opts?: { message: string });
}

function validateOAuthClaims(claims: Record<string, unknown>): { email: string; name: string; sub: string } {
  const { email, name, sub } = claims;

  if (typeof email !== 'string') {
    throw new AuthError('INVALID_REQUEST', { message: 'Missing email' });
  }

  if (typeof name !== 'string') {
    throw new AuthError('INVALID_REQUEST', { message: 'Missing name' });
  }

  if (typeof sub !== 'string') {
    throw new AuthError('INVALID_REQUEST', { message: 'Missing subject' });
  }

  return { email, name, sub };
}



// FP shape: sentinel string comparison 'window' in a single scroll hook (single-usage-false-trigger)
declare function useState<T>(init: T): [T, (v: T) => void];
declare function useEffect(fn: () => void | (() => void), deps: unknown[]): void;
declare function useRef<T>(init: T): { current: T };

type ScrollTarget = 'window' | React.RefObject<HTMLElement>;

interface React {
  RefObject<T>: { current: T | null };
}

function useVirtualListScroll(scrollRef: ScrollTarget) {
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    if (scrollRef === 'window') {
      const handleResize = () => setViewportHeight(window.innerHeight);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, [scrollRef]);

  return viewportHeight;
}



// FP shape: unique string literals in a const-as-tuple array (single-usage-false-trigger)
const TEMPLATE_VIEWS = ['team', 'organisation'] as const;
type TemplateView = (typeof TEMPLATE_VIEWS)[number];

function isTemplateView(value: string): value is TemplateView {
  return TEMPLATE_VIEWS.includes(value as TemplateView);
}

function resolveTemplateView(raw: string | null): TemplateView {
  return raw && isTemplateView(raw) ? raw : 'team';
}



// FP shape: computed bracket-access string key in a single auth client method (single-usage-false-trigger)
declare const apiClient: Record<string, {
  authorize: {
    $post: (opts: { json: Record<string, unknown> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  };
}>;

async function authenticateWithEmailPassword(email: string, password: string, csrfToken: string) {
  const response = await apiClient['email-password'].authorize.$post({
    json: { email, password, csrfToken },
  });

  if (!response.ok) {
    throw new Error('Authentication failed');
  }

  return response.json();
}



// FP shape: match branch string literal in a single auth function (single-usage-false-trigger)
declare function match<T>(value: T): {
  with: (pattern: T, fn: () => unknown) => { with: (p2: T, fn2: () => unknown) => { exhaustive: () => unknown } };
};

type AuthType = 'ACCESS' | 'ACCESS_2FA' | 'ACTION';

function resolveRecipientAuthMethods(type: AuthType, derivedAccess: string[], derivedAction: string[]) {
  const authMethods = match(type)
    .with('ACCESS', () => derivedAccess)
    .with('ACTION', () => derivedAction)
    .exhaustive();

  return authMethods;
}



// FP shape: unique step name strings in a single const array (single-usage-false-trigger)
type EditStep = 'settings' | 'signers' | 'fields' | 'subject';
const EditSteps: EditStep[] = ['settings', 'signers', 'fields', 'subject'];

function isValidStep(value: string): value is EditStep {
  return EditSteps.includes(value as EditStep);
}

function getNextStep(current: EditStep): EditStep | null {
  const index = EditSteps.indexOf(current);
  return index < EditSteps.length - 1 ? EditSteps[index + 1] : null;
}



// FP shape: data-URI prefix string in a single conditional in one component (single-usage-false-trigger)
interface SignaturePayload {
  value: string;
}

interface Signature {
  id: number;
  created: Date;
  recipientId: number;
  fieldId: number;
  signatureImageAsBase64: string | null;
  typedSignature: string | null;
}

function buildSignatureFromPayload(payload: SignaturePayload, recipientId: number, fieldId: number): Signature {
  return {
    id: 1,
    created: new Date(),
    recipientId,
    fieldId,
    signatureImageAsBase64: payload.value && payload.value.startsWith('data:') ? payload.value : null,
    typedSignature: payload.value && !payload.value.startsWith('data:') ? payload.value : null,
  };
}



// FP shape: function with single null-guard return (not a complex expression)
declare const canvasRef: { current: HTMLCanvasElement | null };

const checkCanvasValidity = (): boolean => {
  if (!canvasRef.current) return false;

  const ctx = canvasRef.current.getContext('2d');
  if (!ctx) return false;

  return true;
};



// Factory function returning object with || fallback properties
declare function getDefaults(): { title: string; description: string; priority: number };

function buildTaskConfig(overrides?: Partial<{ title: string; description: string; priority: number }>) {
  const defaults = getDefaults();
  return {
    title: overrides?.title || defaults.title,
    description: overrides?.description || defaults.description,
    priority: overrides?.priority || defaults.priority,
  };
}



// Function building nested object literal for API payload
declare function postApiRequest(endpoint: string, body: object): Promise<void>;

async function createWorkflowStep(name: string, workflowId: string, config: Record<string, unknown>) {
  await postApiRequest('/api/steps', {
    data: {
      name,
      workflowId,
      config,
    },
  });
}



// Object literal with new Date() construction
declare function saveAuditEntry(entry: { action: string; timestamp: Date; userId: string }): void;

function logUserAction(action: string, userId: string) {
  saveAuditEntry({
    action,
    timestamp: new Date(),
    userId,
  });
}



// Return object with a single ternary in one property
declare const isPremium: boolean;

function getPlanConfig(userId: string) {
  return {
    userId,
    maxProjects: isPremium ? 100 : 5,
    storageGb: 10,
  };
}



// Async function with body destructuring from awaited call
declare function fetchProjectData(projectId: string): Promise<{ name: string; ownerId: string; status: string }>;

async function loadProject(projectId: string) {
  const { name, ownerId, status } = await fetchProjectData(projectId);
  return { name, ownerId, status };
}



// Function with single if-branch guard — not a complex expression
declare function formatMultiline(text: string): string;

function processTextContent(text: string, isSingleLine: boolean) {
  let result = text;
  if (isSingleLine) {
    result = text.replace(/\n/g, ' ');
  }
  return result;
}



// Function call with nested function call as argument
declare function encodePayload(data: object): string;
declare function sendWebhook(url: string, body: string): Promise<void>;
declare function buildEventPayload(eventType: string, resourceId: string): object;

async function dispatchWebhookEvent(url: string, eventType: string, resourceId: string) {
  await sendWebhook(url, encodePayload(buildEventPayload(eventType, resourceId)));
}



// Feature-flag check with 3-clause OR disjunction — idiomatic boolean
declare const flags: { betaExport: boolean; advancedSearch: boolean; auditLog: boolean };

function hasAnyAdvancedFeature() {
  return flags.betaExport || flags.advancedSearch || flags.auditLog;
}



// Multi-field inequality chain for change detection — idiomatic boolean
type RecipientRecord = { name: string; email: string; role: string; signingOrder: number };

function hasRecipientChanged(prev: RecipientRecord, next: RecipientRecord) {
  return (
    prev.name !== next.name ||
    prev.email !== next.email ||
    prev.role !== next.role ||
    prev.signingOrder !== next.signingOrder
  );
}



// Three parallel ternary-assignments — idiomatic pattern
declare const plan: string;

function getPlanLimits(plan: string) {
  const maxUsers = plan === 'enterprise' ? 500 : plan === 'pro' ? 25 : 5;
  const maxStorage = plan === 'enterprise' ? 1000 : plan === 'pro' ? 100 : 10;
  const maxProjects = plan === 'enterprise' ? 999 : plan === 'pro' ? 50 : 3;
  return { maxUsers, maxStorage, maxProjects };
}



// Return object with OR-fallback properties
declare function getSessionUser(): { name?: string; email?: string; avatarUrl?: string } | null;

function getCurrentUserDisplay() {
  const user = getSessionUser();
  return {
    name: user?.name || 'Anonymous',
    email: user?.email || 'unknown@example.com',
    avatarUrl: user?.avatarUrl || '/default-avatar.png',
  };
}



// Function with single inequality guard !== -1 — not a complex expression
declare const recipients: Array<{ id: string; email: string }>;
declare function setValue(key: string, value: string, opts: { shouldValidate: boolean }): void;

function onAddCurrentUser(currentEmail: string) {
  const emptySlotIndex = recipients.findIndex((r) => r.email === '');
  if (emptySlotIndex !== -1) {
    setValue(`recipients.${emptySlotIndex}.email`, currentEmail, { shouldValidate: true });
  }
}



// Handler function with type-cast assignments — not a complex expression
declare class CanvasShape { width(): number; height(): number; findOne(sel: string): CanvasShape | undefined; }
declare class CanvasEvent<T> { currentTarget: T; target: T; }

function handleShapeClick(e: CanvasEvent<CanvasShape>) {
  const currentTarget = e.currentTarget as CanvasShape;
  const target = e.target as CanvasShape;

  const boundingRect = currentTarget.findOne('.bounding-rect');
  const shapeWidth = boundingRect ? boundingRect.width() : currentTarget.width();
  const shapeHeight = boundingRect ? boundingRect.height() : currentTarget.height();

  void target;
  void shapeWidth;
  void shapeHeight;
}



// Typed positional parameters with generic types — not a complex expression
declare type FieldCategory = 'text' | 'number' | 'date' | 'boolean';
export function buildFieldIndex(rawFieldMeta: Record<string, string>, fieldCategory: FieldCategory): Map<string, string> {
  const index = new Map<string, string>();
  for (const [key, val] of Object.entries(rawFieldMeta)) {
    index.set(key, val);
  }
  return index;
}



// Single null-guard early return — not a complex expression
declare const canvasRef: { current: HTMLCanvasElement | null };
export function renderSignaturePreview(text: string): void {
  if (!canvasRef.current) return;
  const ctx = canvasRef.current.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  ctx.fillText(text, 10, 40);
}



// Async server function with many destructured parameters — not a complex expression
declare type OrderDirection = 'asc' | 'desc';
declare type OrderField = 'createdAt' | 'updatedAt' | 'title';
export async function findDocumentsForTeam({
  userId,
  teamId,
  page,
  perPage,
  orderByDirection,
  orderByField,
  search,
  status,
}: {
  userId: number;
  teamId: number;
  page: number;
  perPage: number;
  orderByDirection: OrderDirection;
  orderByField: OrderField;
  search?: string;
  status?: string;
}): Promise<{ items: unknown[]; total: number }> {
  return { items: [], total: 0 };
}



// Aliased destructuring from a DOM bounding rect call — not a complex expression
declare function getContainerRect(el: Element): { top: number; left: number; height: number; width: number };
declare const pageElement: Element;
export function getFieldBounds(): { relTop: number; relLeft: number; relHeight: number; relWidth: number } {
  const { top: pageTop, left: pageLeft, height: pageHeight, width: pageWidth } = getContainerRect(pageElement);
  return { relTop: pageTop, relLeft: pageLeft, relHeight: pageHeight, relWidth: pageWidth };
}



// Generic function with destructured typed params — not a complex expression
declare type AuditEventType = 'create' | 'update' | 'delete' | 'view';
export function createAuditLogEntry<T extends Record<string, unknown>>({
  resourceId,
  eventType,
  actorId,
  payload,
}: {
  resourceId: string;
  eventType: AuditEventType;
  actorId: string;
  payload: T;
}): { resourceId: string; eventType: AuditEventType; actorId: string; payload: T; timestamp: Date } {
  return { resourceId, eventType, actorId, payload, timestamp: new Date() };
}



// Simple ref access — not a complex expression
declare const textContainerRef: { current: HTMLDivElement | null };
export function adjustFontSize(targetWidth: number): void {
  const container = textContainerRef.current;
  if (!container) return;
  let fontSize = 16;
  while (container.scrollWidth > targetWidth && fontSize > 8) {
    fontSize -= 1;
    container.style.fontSize = `${fontSize}px`;
  }
}



// Async function with typed options parameter — not a complex expression
declare type ToggleFieldOptions = { fieldId: string; checked: boolean; teamId?: number };
export async function handleToggleFieldClick(options: ToggleFieldOptions): Promise<void> {
  const { fieldId, checked } = options;
  await Promise.resolve({ fieldId, checked });
}



// Standard typed parameter list with a default value — not a complex expression
export function calculateCellPosition(row: number, column: number, cellWidth: number = 120): { x: number; y: number } {
  const x = column * cellWidth;
  const y = row * 40;
  return { x, y };
}



// Simple destructuring from a context/helper call — not a complex expression
declare function getOptionalRequestContext(): { requestMetadata: Record<string, string> | null } | null;
export async function signDocumentLoader(token: string): Promise<void> {
  const context = getOptionalRequestContext();
  const { requestMetadata } = context ?? { requestMetadata: null };
  await Promise.resolve({ token, requestMetadata });
}



// Async function with a single typed string parameter — not a complex expression
declare type SessionInfo = { userId: string; expiresAt: Date; valid: boolean };
export async function validateSessionToken(token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  return { userId: 'u_123', expiresAt: new Date(), valid: true };
}



// Schema parse call in function body — not a complex expression
declare const ZRecipientAuthSchema: { parse: (v: unknown) => { method: string; required: boolean } };
declare type Recipient = { id: string; authOptions: unknown };
export function hasRecipientAuthChanged(recipient: Recipient, incoming: Recipient): boolean {
  const currentAuth = ZRecipientAuthSchema.parse(recipient.authOptions);
  const newAuth = ZRecipientAuthSchema.parse(incoming.authOptions);
  return currentAuth.method !== newAuth.method || currentAuth.required !== newAuth.required;
}



// Options-object destructuring — not a complex expression
declare type CellRenderOptions = {
  label: string; text: string; width: number; align: 'left' | 'right' | 'center';
  x: number; y: number; fontFamily: string;
};
declare const pdfPage: { drawText: (text: string, opts: Record<string, unknown>) => void };
export function renderPdfCell(options: CellRenderOptions): void {
  const { label, text, width, align, x, y, fontFamily } = options;
  pdfPage.drawText(`${label}: ${text}`, { x, y, size: width, font: fontFamily, align });
}



// Typed positional parameter using Omit<T, K> — not a complex expression
declare type EnvelopeRecord = { id: string; title: string; recipients: string[]; fields: unknown[] };
export function buildCreateEnvelopeRequest(envelope: Omit<EnvelopeRecord, 'id'>): Record<string, unknown> {
  return {
    title: envelope.title,
    recipients: envelope.recipients,
    fieldCount: envelope.fields.length,
  };
}



// Async handler with try/catch and destructuring from await — not a complex expression
declare function updateDocumentPreferences(data: Record<string, unknown>): Promise<{ documentId: string; updated: boolean }>;
export async function onPreferencesFormSubmit(formData: Record<string, unknown>): Promise<void> {
  try {
    const { documentId, updated } = await updateDocumentPreferences(formData);
    if (updated) {
      console.log('Saved', documentId);
    }
  } catch (err) {
    console.error(err);
  }
}



// Single array length-guard early return — not a complex expression
declare type BoundingBox = { x: number; y: number; width: number; height: number };
declare type ImageBuffer = { data: Uint8Array; width: number; height: number };
export async function maskDetectedRegions(regions: BoundingBox[], image: ImageBuffer): Promise<ImageBuffer> {
  if (regions.length === 0) return image;
  const masked = { ...image };
  for (const region of regions) {
    masked.data[region.y * image.width + region.x] = 0;
  }
  return masked;
}



// Promise.all with object-literal arguments — not a complex expression
declare function seedTemplate(opts: { title: string; recipientCount: number; fieldCount: number }): Promise<void>;
export async function seedInitialTemplates(): Promise<void> {
  await Promise.all([
    seedTemplate({ title: 'Template 1', recipientCount: 2, fieldCount: 5 }),
    seedTemplate({ title: 'Template 2', recipientCount: 1, fieldCount: 3 }),
    seedTemplate({ title: 'Template 3', recipientCount: 3, fieldCount: 8 }),
  ]);
}



// Single event-type check assignment — not a complex expression
declare type FieldEvent = { type: string; fieldId: string; x: number; y: number };
export function handleFieldResizeOrMove(event: FieldEvent): void {
  const isDragEvent = event.type === 'dragend';
  const isResizeEvent = event.type === 'resizeend';
  if (isDragEvent || isResizeEvent) {
    console.log('Field repositioned:', event.fieldId);
  }
}



// Single destructuring from options parameter — not a complex expression
declare type OverviewCardOptions = { width: number; text: string; x: number; y: number };
declare const pdfDoc: { page: { drawText: (t: string, o: Record<string, unknown>) => void } };
export function renderOverviewCardLabels(options: OverviewCardOptions): void {
  const { width, text } = options;
  pdfDoc.page.drawText(text, { maxWidth: width });
}



// Object literal argument passed to an append function — not a complex expression
declare function nanoid(size?: number): string;
declare type SignerEntry = { formId: string; name: string; email: string };
declare const currentUser: { name: string; email: string };
declare function appendSigner(entry: SignerEntry): void;
export function addCurrentUserAsSigner(): void {
  appendSigner({ formId: nanoid(12), name: currentUser.name ?? '', email: currentUser.email ?? '' });
}



// Double null-check guard in async handler body — not a complex expression
declare type EmbedConfig = { documentData: Uint8Array | null; title: string } | null;
export async function createDocumentFromEmbed(configuration: EmbedConfig): Promise<{ id: string } | null> {
  if (!configuration || !configuration.documentData) {
    return null;
  }
  return { id: 'doc_' + Date.now() };
}



// Nullish coalescing assignment in async function body — not a complex expression
declare function launchEmbeddedViewer(token: string): Promise<void>;
declare const token: string | null;
export async function launchEmbed(overrideToken?: string): Promise<void> {
  const inputToken = overrideToken ?? token;
  if (!inputToken) throw new Error('No token provided');
  await launchEmbeddedViewer(inputToken);
}



// Single ternary inside an object literal return — not a complex expression
declare const FULL_WIDTH = 540;
declare const COLUMN_WIDTH = 260;
declare const ROW_HEIGHT = 40;
export function calculateGridCell(row: number, column: number, width: 'full' | 'half'): { x: number; y: number; width: number; height: number } {
  return {
    x: column * COLUMN_WIDTH,
    y: row * ROW_HEIGHT,
    width: width === 'full' ? FULL_WIDTH : COLUMN_WIDTH,
    height: ROW_HEIGHT,
  };
}



// Two let declarations in function body — not a complex expression
declare type PdfPage = { getViewport: (opts: { scale: number }) => { width: number; height: number } };
export function getPageDimensions(page: PdfPage, scale: number): { width: number; height: number } {
  let mediaBox;
  let cropBox;
  const viewport = page.getViewport({ scale });
  mediaBox = { width: viewport.width, height: viewport.height };
  cropBox = mediaBox;
  return cropBox;
}



// Single numeric-guard early return — not a complex expression
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}



// Async function with many standard typed destructured parameters — not a complex expression
declare type DocumentStatus = 'draft' | 'pending' | 'completed' | 'rejected';
declare type SortOrder = 'asc' | 'desc';
export async function findDocuments({
  userId,
  teamId,
  status,
  page,
  perPage,
  sortOrder,
  search,
}: {
  userId: string;
  teamId?: string;
  status?: DocumentStatus;
  page: number;
  perPage: number;
  sortOrder: SortOrder;
  search?: string;
}): Promise<{ results: unknown[]; total: number }> {
  return { results: [], total: 0 };
}



// Options-object destructuring with many fields — not a complex expression
declare type AuditReportOptions = {
  envelope: Record<string, unknown>;
  envelopeItems: unknown[];
  envelopeOwner: { name: string; email: string };
  recipients: Array<{ name: string; email: string; role: string }>;
  width: number;
  i18n: { t: (key: string) => string };
};
declare const pdfRenderer: { renderSection: (opts: Record<string, unknown>) => void };
export function renderAuditReport(options: AuditReportOptions): void {
  const { envelope, envelopeItems, envelopeOwner, recipients, width, i18n } = options;
  pdfRenderer.renderSection({
    title: i18n.t('audit.title'),
    owner: envelopeOwner.name,
    recipientCount: recipients.length,
    itemCount: envelopeItems.length,
    envelopeId: (envelope as Record<string, string>)['id'],
    pageWidth: width,
  });
}



// Destructured parameter list — many options params triggers expression-complexity FP
function computeHorizontalLayout({
  textAlign,
  baseX,
  baseY,
  baseWidth,
  baseHeight,
  groupX,
  pageWidth,
}: {
  textAlign: string;
  baseX: number;
  baseY: number;
  baseWidth: number;
  baseHeight: number;
  groupX: number;
  pageWidth: number;
}): number {
  const effectiveWidth = pageWidth - groupX - baseX;
  return textAlign === 'right' ? effectiveWidth - baseWidth : baseX + baseY * 0.5;
}



// Object literal mapping field properties — triggers expression-complexity FP
interface FormField {
  kind: string;
  recipientKey: string;
  label: string;
  required: boolean;
  placeholder: string;
}

function normalizeFormField(field: FormField) {
  return {
    kind: field.kind,
    recipientKey: field.recipientKey,
    label: field.label,
    required: field.required,
    placeholder: field.placeholder,
  };
}



// Destructuring options with defaults inside function body — triggers FP
interface RenderOptions {
  canvasWidth: number;
  canvasHeight: number;
  mode?: string;
  locale?: string;
}

declare const options: RenderOptions;

function renderOverlay(opts: RenderOptions): void {
  const { canvasWidth, canvasHeight, mode = 'preview', locale = 'en' } = opts;
  const scale = canvasWidth / canvasHeight;
  console.log(mode, locale, scale);
}



// Async function with many destructured params with defaults — triggers FP
declare function queryDb(opts: Record<string, unknown>): Promise<unknown[]>;

async function fetchUserTokens({
  userId,
  search = '',
  page = 1,
  perPage = 10,
  sortBy,
}: {
  userId: string;
  search?: string;
  page?: number;
  perPage?: number;
  sortBy?: string;
}): Promise<unknown[]> {
  return queryDb({ userId, search, page, perPage, sortBy });
}



// Return object with OR-fallback in property — triggers expression-complexity FP
interface Participant {
  displayName: string | null;
  email: string;
  role: string;
}

function summarizeParticipant(participant: Participant) {
  return {
    name: participant.displayName || participant.email,
    role: participant.role,
  };
}



// schema.parse() with object literal argument — triggers expression-complexity FP
declare const ResponseSchema: { parse: (v: unknown) => unknown };
declare const contract: { id: string; title: string };
declare const party: { id: string; name: string };

function buildContractResponse() {
  return ResponseSchema.parse({
    contract,
    party,
    generatedAt: new Date().toISOString(),
  });
}



// Typed positional parameters — async function with two typed params triggers FP
declare interface ApiContext { baseUrl: string }

async function seedTestWorkspace(ctx: ApiContext, authToken: string): Promise<void> {
  const resp = await fetch(`${ctx.baseUrl}/workspaces`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ name: 'test-workspace' }),
  });
  if (!resp.ok) throw new Error(`seed failed: ${resp.status}`);
}



// Function call with object literal argument — triggers expression-complexity FP
declare function generateId(len: number): string;
declare function appendEntry(entry: {
  entryId: string;
  label: string;
  value: string;
  order: number;
}): void;

function addNewEntry(label: string, value: string, order: number): void {
  appendEntry({
    entryId: generateId(12),
    label,
    value,
    order,
  });
}



// Function with typed param and default value — triggers expression-complexity FP
enum DeliveryMethod { EMAIL = 'EMAIL', SMS = 'SMS' }

interface Recipient { email: string; phone?: string }

function resolveDeliveryChannel(
  recipient: Recipient,
  method = DeliveryMethod.EMAIL
): string {
  if (method === DeliveryMethod.SMS && recipient.phone) {
    return recipient.phone;
  }
  return recipient.email;
}



// Typed null initialization inside function — triggers expression-complexity FP
declare namespace pdfLib {
  interface RenderTask { cancel(): void }
}

function renderPageAtScale(canvas: HTMLCanvasElement, scale: number): void {
  let activeTask: pdfLib.RenderTask | null = null;

  function cancelPrevious() {
    if (activeTask !== null) {
      activeTask.cancel();
      activeTask = null;
    }
  }

  cancelPrevious();
  canvas.width = canvas.width * scale;
}



// Simple let declarations from object properties — triggers expression-complexity FP
declare interface MediaAsset { naturalWidth: number; naturalHeight: number }

function scaleAssetToFit(asset: MediaAsset, maxWidth: number): { width: number; height: number } {
  let assetWidth = asset.naturalWidth;
  let assetHeight = asset.naturalHeight;
  const ratio = maxWidth / assetWidth;
  return { width: assetWidth * ratio, height: assetHeight * ratio };
}



// Function with two typed positional params — triggers expression-complexity FP
interface InputFieldMeta { maxLength?: number; pattern?: string; required?: boolean }

function validateInputField(value: string, fieldMeta: InputFieldMeta): string[] {
  const errors: string[] = [];
  if (fieldMeta.required && !value) errors.push('Required');
  if (fieldMeta.maxLength && value.length > fieldMeta.maxLength) errors.push('Too long');
  if (fieldMeta.pattern && !new RegExp(fieldMeta.pattern).test(value)) errors.push('Invalid format');
  return errors;
}



// Async function with many destructured typed params — triggers expression-complexity FP
declare function dbSelect(opts: Record<string, unknown>): Promise<unknown[]>;

async function fetchAssetsByIds({
  ids,
  ownerId,
  includeArchived = false,
  limit = 50,
}: {
  ids: string[];
  ownerId: string;
  includeArchived?: boolean;
  limit?: number;
}): Promise<unknown[]> {
  return dbSelect({ ids, ownerId, includeArchived, limit });
}



// Async function with try-block and simple header access — triggers expression-complexity FP
declare interface IncomingRequest { headers: { get(name: string): string | null } }
declare interface OutgoingResponse { json(data: unknown): void; status(code: number): OutgoingResponse }

async function handleWebhookRequest(req: IncomingRequest, res: OutgoingResponse): Promise<void> {
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
}



// Multi-field inequality OR-chain for change detection — triggers expression-complexity FP
interface ContactRecord { email: string; phone: string; fullName: string; role: string }

function hasContactChanged(current: ContactRecord, updated: ContactRecord): boolean {
  return (
    current.email !== updated.email ||
    current.phone !== updated.phone ||
    current.fullName !== updated.fullName ||
    current.role !== updated.role
  );
}



// Object literal with OR-fallback chains for settings merge — triggers expression-complexity FP
declare const DEFAULT_LOCALE: string;
declare const DEFAULT_TIMEZONE: string;

interface UserPrefs { locale?: string; timezone?: string; theme?: string }
interface GlobalSettings { defaultLocale: string; defaultTimezone: string; defaultTheme: string }

function mergeUserPreferences(prefs: UserPrefs, settings: GlobalSettings) {
  return {
    locale: prefs.locale || settings.defaultLocale || DEFAULT_LOCALE,
    timezone: prefs.timezone || settings.defaultTimezone || DEFAULT_TIMEZONE,
    theme: prefs.theme || settings.defaultTheme,
  };
}



// Typed let declaration inside async function — triggers expression-complexity FP
declare interface TokenClaims { sub: string; exp: number }
declare function parseToken(token: string): TokenClaims;

async function verifyAccessToken(rawToken: string): Promise<TokenClaims> {
  let decodedClaims: TokenClaims | null = null;
  try {
    decodedClaims = parseToken(rawToken);
  } catch {
    throw new Error('Invalid token');
  }
  if (!decodedClaims) throw new Error('Empty claims');
  return decodedClaims;
}



// Destructured params with underscore-prefixed second param — triggers expression-complexity FP
interface RouterContext { requestId: string; userId?: string }
interface RouterErrorInfo { code: string; message: string; path?: string }

function handleRouterError(
  { code, message, path }: RouterErrorInfo,
  _source: string
): void {
  console.error(`[${code}] ${message}`, path ? `at ${path}` : '');
}



// Object literal construction from local variables — triggers expression-complexity FP
declare const workspaceId: string;
declare const workspace: { id: string; name: string };
declare const memberId: string;

function buildMemberRecord() {
  return {
    id: memberId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    joinedAt: new Date().toISOString(),
  };
}



// Return object with arithmetic and ternary in properties — triggers expression-complexity FP
function computeGridCellLayout(
  rowHeight: number,
  rowQuantity: number,
  colWidth: number,
  colQuantity: number,
  isCompact: boolean
): { height: number; width: number; padding: number } {
  return {
    height: rowHeight * rowQuantity,
    width: isCompact ? colWidth * 0.8 : colWidth * colQuantity,
    padding: isCompact ? 4 : 8,
  };
}



// Return object with OR-fallbacks and Number() casts — triggers expression-complexity FP
declare const teamCount: { count?: string } | null;
declare const memberCount: { count?: string } | null;
declare const activeCount: { count?: string } | null;

function buildOrgInsights() {
  return {
    totalTeams: Number(teamCount?.count || 0),
    totalMembers: Number(memberCount?.count || 0),
    activeMembers: Number(activeCount?.count || 0),
  };
}



// Simple if-guard with single inequality — triggers expression-complexity FP
declare function getItems(): { id: string; label: string }[];
declare function updateItem(id: string, label: string): void;

function addDefaultItemIfMissing(items: { id: string; label: string }[]): void {
  const emptyItemIndex = items.findIndex((item) => item.label.trim() === '');
  if (emptyItemIndex !== -1) {
    updateItem(items[emptyItemIndex].id, 'Untitled');
  }
}



// Multi-field inequality chain for change-detection — triggers expression-complexity FP
interface ParticipantRecord { email: string; name: string; role: string; phone: string }

function hasParticipantChanged(
  current: ParticipantRecord,
  updated: ParticipantRecord
): boolean {
  return (
    current.email !== updated.email ||
    current.name !== updated.name ||
    current.role !== updated.role ||
    current.phone !== updated.phone
  );
}



// ID-generation helpers used by form-field and row-tracking utilities.

declare function nanoid(size?: number): string;

/**
 * Creates a new tracked row entry with a short unique key suitable for
 * React list rendering and optimistic UI updates.
 */
export function createTrackedRow<T extends object>(data: T): T & { rowKey: string } {
  return { ...data, rowKey: nanoid(12) };
}

/**
 * Builds a fresh form field descriptor with a stable client-side id.
 */
export function makeFieldDescriptor(label: string, type: string): { id: string; label: string; type: string } {
  return { id: nanoid(12), label, type };
}



// File upload configuration using a 1 MB size limit expressed as 1024 * 1024.
// The product is universally understood as one binary megabyte, so the rule
// must not flag it as a magic number.

declare function useFileDropzone(options: {
  maxSize?: number;
  accept?: Record<string, string[]>;
  multiple?: boolean;
  onDropAccepted?: (files: File[]) => void;
  onDropRejected?: (files: { file: File; errors: { code: string }[] }[]) => void;
}): { getRootProps: () => object; getInputProps: () => object };

export function initAvatarUploader() {
  const { getRootProps, getInputProps } = useFileDropzone({
    maxSize: 1024 * 1024,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg'],
    },
    multiple: false,
    onDropAccepted: ([file]) => {
      file.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        console.log('Accepted file bytes:', bytes.length);
      });
    },
  });

  return { getRootProps, getInputProps };
}



// Snap an arbitrary rotation angle to the nearest cardinal multiple of 90 degrees.
// 90 is the standard rotation unit for page/element orientation (0°, 90°, 180°, 270°).
function snapToCardinalRotation(angleDeg: number): number {
  return Math.round(angleDeg / 90) * 90;
}

// Determine whether a rotated element is in landscape orientation.
function isLandscapeOrientation(angleDeg: number): boolean {
  const snapped = Math.round(angleDeg / 90) * 90;
  return snapped === 90 || snapped === 270;
}



// RFC 5321 caps email addresses at 254 octets — not a magic number.
declare function zEmail(): { trim(): any; toLowerCase(): any; max(n: number): any; optional(): any; min(n: number): any };
declare const zSchema: {
  object<T extends Record<string, unknown>>(shape: T): { optional(): any };
  string(): { min(n: number): any; max(n: number): any; optional(): any; trim(): any };
};

export const ZContactUpdateSchema = zSchema.object({
  replyTo: zEmail().trim().toLowerCase().max(254).optional(),
  displayName: zSchema.string().min(1).max(100).optional(),
});



// formatBytes converts a raw byte count to a human-readable IEC string.
// 1024 is the binary base (2^10) used for KiB/MiB/GiB conversion;
// Math.log(1024) derives the tier index via logarithm identity.
export function formatBytes(size: number): string {
  if (size === 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const tier = Math.floor(Math.log(size) / Math.log(1024));
  return `${parseFloat((size / 1024 ** tier).toFixed(2))} ${units[tier]}`;
}



// Token generation helpers - ID length is a standard convention parameter
declare function nanoid(size: number): string;

export function generateRecipientToken(): string {
  return nanoid(12);
}



// Field ID generation - nanoid(12) is the standard convention for short IDs
declare function nanoid(size?: number): string;

export function generateFieldId(): string {
  return nanoid(12);
}

export function generatePlaceholderId(): string {
  return nanoid(12);
}



// Seed ID generation using customAlphabet - 10 is the standard ID length
declare function customAlphabet(alphabet: string, size: number): () => string;

const alphaNumericId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10);

export function generateSeedUserId(): string {
  return alphaNumericId();
}



// Template placeholder recipient ID generation - nanoid(12) is a standard ID length
declare function nanoid(size: number): string;

export function generatePlaceholderRecipientId(): string {
  return nanoid(12);
}



// Short ID generation for document fields - nanoid(8) is the standard short ID length
declare function nanoid(size: number): string;

export function generateShortFieldId(): string {
  return nanoid(8);
}

export function generateDocumentFieldId(): string {
  return nanoid(8);
}



// Recipient local ID generation - nanoid(12) uses 12 as standard short ID length
declare function nanoid(size: number): string;

export function generateLocalRecipientId(): string {
  return nanoid(12);
}



// Font scale shrink loop - threshold 0.8 is minimum readable scale
declare function measureTextWidth(text: string, fontSize: number): number;
declare const containerWidth: number;
declare const text: string;

function fitTextToContainer(initialFontSize: number): number {
  let size = initialFontSize;
  while (size > 0.8 && measureTextWidth(text, size) > containerWidth) {
    size -= 0.05;
  }
  return size;
}



// Recipient color utility - alpha 0.3 for hover ring translucency
declare const Color: { new(hex: string): { alpha(a: number): { toString(): string } } };

function getRecipientHoverColor(hexColor: string): string {
  return new Color(hexColor).alpha(0.3).toString();
}



// Debounce hook with 500ms default delay
declare function useState<T>(v: T): [T, (v: T) => void];
declare function useEffect(fn: () => (() => void) | void, deps: any[]): void;

function useDebounce<T>(value: T, delay?: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay || 500);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}



// Generate short 8-char recipient placeholder ID for form entries
declare function nanoid(size: number): string;

function createRecipientPlaceholderId(): string {
  return nanoid(8);
}



// Bezier spline smoothing - minimum 4 control points required for cubic bezier
interface Point { x: number; y: number }

function smoothBezierPath(points: Point[]): Point[] {
  const len = points.length;
  if (len < 4) {
    return points;
  }
  const smoothed: Point[] = [];
  for (let i = 1; i < len - 2; i++) {
    smoothed.push({
      x: (points[i].x + points[i + 1].x) / 2,
      y: (points[i].y + points[i + 1].y) / 2,
    });
  }
  return smoothed;
}



// ID generation using 21-char alphabet (nanoid standard default length)
declare function customAlphabet(alphabet: string, size: number): () => string;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateId = customAlphabet(ALPHABET, 21);

function createEntityId(): string {
  return generateId();
}



// Admin document listing with fallback pagination size
declare function fetchDocuments(params: { page: number; perPage: number }): Promise<any[]>;

async function listAdminDocuments(page: number, perPage?: number): Promise<any[]> {
  return fetchDocuments({ page, perPage: perPage || 20 });
}



// Field seed data - default 10% position for form fields in PDF
interface FieldSeed {
  positionX?: number;
  positionY?: number;
  width?: number;
  height?: number;
}

function normalizeFieldPosition(seed: FieldSeed) {
  return {
    positionX: seed.positionX ?? 10,
    positionY: seed.positionY ?? 10,
    width: seed.width ?? 15,
    height: seed.height ?? 5,
  };
}



// Generate 8-char local ID for embed document view fields
declare function nanoid(size: number): string;

function generateEmbedFieldId(): string {
  return nanoid(8);
}



// Generate 12-char local ID for envelope editor drag-drop fields
declare function nanoid(size: number): string;

function createEnvelopeFieldLocalId(): string {
  return nanoid(12);
}



// Embed document editing route - 8-char field nonce for idempotent edits
declare function nanoid(size: number): string;

function createDocumentFieldNonce(): string {
  return nanoid(8);
}



// Generate 32-char verification token for secure email links
declare function nanoid(size: number): string;

function generateVerificationToken(): string {
  return nanoid(32);
}



// Editor fields hook - generate 12-char local field ID for unsaved fields
declare function nanoid(size: number): string;

function createLocalFieldId(): string {
  return nanoid(12);
}



// Catmull-Rom to Bezier conversion - /6 is the standard tension factor
interface Point { x: number; y: number }

function catmullRomToBezier(p0: Point, p1: Point, p2: Point, p3: Point) {
  return {
    cp1: {
      x: p1.x + (p2.x - p0.x) / 6,
      y: p1.y + (p2.y - p0.y) / 6,
    },
    cp2: {
      x: p2.x - (p3.x - p1.x) / 6,
      y: p2.y - (p3.y - p1.y) / 6,
    },
  };
}



// PDF field insertion - 90 degree rotation check for landscape pages
interface PageDimensions { width: number; height: number }

function adjustFieldForPageRotation(
  field: { x: number; y: number; width: number; height: number },
  pageRotationInDegrees: number,
  page: PageDimensions
) {
  if (pageRotationInDegrees === 90 || pageRotationInDegrees === 270) {
    return {
      x: field.y,
      y: page.height - field.x - field.width,
      width: field.height,
      height: field.width,
    };
  }
  return field;
}



// Signature pad canvas - Catmull-Rom Y-axis control point calculation
interface CanvasPoint { x: number; y: number; pressure: number }

function computeSplineControlY(p0: CanvasPoint, p1: CanvasPoint, p2: CanvasPoint): number {
  return p1.y + (p2.y - p0.y) / 6;
}



// Document upload size limit - named constant multiplied by 1024 * 1024 to get bytes
declare const APP_DOCUMENT_UPLOAD_SIZE_LIMIT: number;
declare function createDropzone(opts: { maxSize: number }): any;

const documentDropzone = createDropzone({
  maxSize: APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024,
});



// App feature flags - boolean env var strings are compared to 'true'
declare const process: { env: Record<string, string | undefined> };

const isFeatureEnabled = process.env.FEATURE_DARK_MODE === 'true';
const isMaintenanceMode = process.env.MAINTENANCE_MODE === 'true';



// form.getValues with a field name key, filtering on empty string value — idiomatic react-hook-form pattern
declare const form: { getValues: (key: string) => Array<{ email: string }> };
declare function useCallback<T extends (...args: unknown[]) => unknown>(fn: T, deps: unknown[]): T;

const emptyRecipients = useCallback(
  () => form.getValues('signers').filter((signer) => signer.email === ''),
  [form],
);



// DOM setAttribute with a validation data attribute — standard DOM API usage
declare function getElementsByClassName(name: string): HTMLCollectionOf<Element>;

function markFieldsForValidation() {
  const fieldCards = document.getElementsByClassName('field-card-container');
  Array.from(fieldCards).forEach((element) => {
    element.setAttribute('data-validate', 'true');
  });
}



// as const object with string literal action type keys — standard Redux-style action type pattern
const notificationActionTypes = {
  ADD_NOTIFICATION: 'ADD_NOTIFICATION',
  UPDATE_NOTIFICATION: 'UPDATE_NOTIFICATION',
  DISMISS_NOTIFICATION: 'DISMISS_NOTIFICATION',
  REMOVE_NOTIFICATION: 'REMOVE_NOTIFICATION',
} as const;

type NotificationActionType = typeof notificationActionTypes;



// Ternary comparing string form values to 'true'/'false' literals — select widget boolean coercion
function coerceBooleanSelectValue(value: string): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null;
}



// item.value.includes() with a sentinel prefix string — field rendering placeholder detection
function getDisplayLabel(itemValue: string): string {
  return itemValue.includes('empty-value-') ? '' : itemValue;
}



// new StorageEvent('storage', ...) — browser storage event dispatch, standard Web API
declare const window: { dispatchEvent: (e: Event) => void };

function dispatchStorageChange(key: string, newValue: string | null) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}



// document.addEventListener('mousedown', ...) — browser DOM event listener with standard event name
declare const document: {
  addEventListener: (event: string, handler: (e: MouseEvent) => void) => void;
  removeEventListener: (event: string, handler: (e: MouseEvent) => void) => void;
};

function attachOutsideClickHandler(handler: (e: MouseEvent) => void, active: boolean) {
  if (active) {
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchend', handler as any);
  } else {
    document.removeEventListener('mousedown', handler);
    document.removeEventListener('touchend', handler as any);
  }
}



// event.type === 'dragend' — DOM event type comparison against a standard event name string
declare interface KonvaEvent { type: string; target: unknown; }

function handleFieldReposition(event: KonvaEvent) {
  const isDragEvent = event.type === 'dragend';
  return isDragEvent;
}



// [prop('fieldName'), 'asc'] — sort direction string used in a sort utility call
declare function prop(key: string): (obj: Record<string, unknown>) => unknown;
declare function sortBy<T>(arr: T[], ...criteria: unknown[]): T[];

function sortRecipientsBySigningOrder<T extends { signingOrder?: number; nativeId?: number }>(recipients: T[]): T[] {
  return sortBy(
    recipients,
    [prop('signingOrder'), 'asc'],
    [prop('nativeId'), 'asc'],
  );
}



// Standard typeof check — 'string' is a language-defined primitive type name, not a magic string.
declare function decodeTokenClaims(token: string): Record<string, unknown>;
declare class AuthError extends Error { constructor(code: string, opts: { message: string }); }

export function validateTokenClaims(token: string): { userId: string; email: string } {
  const claims = decodeTokenClaims(token);

  const email = claims['email'];
  const sub = claims['sub'];

  if (typeof email !== 'string') {
    throw new AuthError('INVALID_TOKEN', { message: 'Missing email claim' });
  }

  if (typeof sub !== 'string') {
    throw new AuthError('INVALID_TOKEN', { message: 'Missing sub claim' });
  }

  return { userId: sub, email };
}



// Standard typeof check with a language-defined primitive type name — not a magic string.
export function validateNumericRange(
  value: number,
  minValue?: unknown,
  maxValue?: unknown,
): string[] {
  const errors: string[] = [];

  if (typeof minValue === 'number' && minValue > 0 && value < minValue) {
    errors.push(`Value ${value} is below the minimum of ${minValue}`);
  }

  if (typeof maxValue === 'number' && maxValue > 0 && value > maxValue) {
    errors.push(`Value ${value} exceeds the maximum of ${maxValue}`);
  }

  if (typeof minValue === 'number' && typeof maxValue === 'number' && minValue > maxValue) {
    errors.push('Minimum cannot be greater than maximum');
  }

  return errors;
}



// error.includes('valid number') is an error message substring filter for categorizing validation errors.
declare function validateNumberField(value: string): string[];

export function categorizeNumberErrors(value: string) {
  const validationErrors = validateNumberField(value);
  return {
    isNumber: validationErrors.filter((error) => error.includes('valid number')),
    required: validationErrors.filter((error) => error.includes('required')),
    minValue: validationErrors.filter((error) => error.includes('minimum value')),
  };
}



// ts-pattern .with('ACCESS', ...) matches a typed union discriminant — not an arbitrary magic string.
declare function match<T>(value: T): { with: <P>(pattern: P, fn: () => unknown) => { exhaustive: () => unknown } };
type AuthCheckType = 'ACCESS' | 'ACTION';

export function resolveAuthMethods(type: AuthCheckType, methods: string[]) {
  return match(type)
    .with('ACCESS', () => methods.filter((m) => m.startsWith('access:')))
    .with('ACTION', () => methods.filter((m) => m.startsWith('action:')))
    .exhaustive();
}



// 'data:' is the standard data URI scheme prefix (RFC 2397) — a well-known URL scheme, not a magic string.
export function classifySignatureValue(value: string) {
  if (value.startsWith('data:')) {
    return { isImageSignature: true, imageData: value, typedText: null };
  }

  return { isImageSignature: false, imageData: null, typedText: value };
}



// typeof comparison with 'number' — a language-defined primitive type name, not a magic string.
declare const z: {
  string: () => {
    superRefine: (fn: (value: string, ctx: { addIssue: (issue: { code: string; message: string }) => void }) => void) => unknown;
  };
};

declare const minValue: unknown;
declare const maxValue: unknown;

export const numberRangeValidator = z.string().superRefine((value, ctx) => {
  const parsed = parseFloat(value);

  if (typeof minValue === 'number' && parsed < minValue) {
    ctx.addIssue({ code: 'too_small', message: `Value must be at least ${minValue}` });
    return;
  }

  if (typeof maxValue === 'number' && parsed > maxValue) {
    ctx.addIssue({ code: 'too_big', message: `Value must be at most ${maxValue}` });
  }
});



// error.includes('required') is a substring match for categorizing validation error messages — not a magic string.
declare function validateTextField(value: string): string[];

export function categorizeTextFieldErrors(value: string) {
  const validationErrors = validateTextField(value);
  return {
    required: validationErrors.filter((error) => error.includes('required')),
    characterLimit: validationErrors.filter((error) => error.includes('character limit')),
  };
}




// --- max-nesting-depth shape: flat-else-if-chain-on-discriminated-union ---
type SyncResult = 'verified' | 'reregistered' | 'pending' | 'failed';

interface BatchResult {
  status: 'fulfilled' | 'rejected';
  value?: SyncResult;
  reason?: unknown;
}

declare function logger(msg: string): void;

export function tabulateSyncResults(results: BatchResult[]): { verified: number; reregistered: number; failed: number } {
  let verifiedCount = 0;
  let reregisteredCount = 0;
  let failedCount = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      failedCount++;
      logger(`Failed to process: ${String(result.reason)}`);
    } else if (result.value === 'verified') {
      verifiedCount++;
    } else if (result.value === 'reregistered') {
      reregisteredCount++;
    }
  }

  return { verified: verifiedCount, reregistered: reregisteredCount, failed: failedCount };
}




// --- missing-destructuring shape: single-property-extraction-from-flags-object ---
interface PlanFlags {
  hideBranding: boolean;
  embedSigning: boolean;
  advancedFields: boolean;
  apiAccess: boolean;
}

interface OrgClaim {
  flags: PlanFlags;
  planId: string;
}

declare function getOrgClaim(orgId: string): OrgClaim;

export function resolveEmbedPermissions(orgId: string): { hideBranding: boolean; canEmbed: boolean } {
  const claim = getOrgClaim(orgId);

  const hideBranding = claim.flags.hideBranding;
  const canEmbed = claim.flags.embedSigning;

  if (!claim.flags.apiAccess) {
    return { hideBranding: false, canEmbed: false };
  }

  return { hideBranding, canEmbed };
}




// --- missing-destructuring shape: record-string-unknown-fields-needing-typeof-narrowing ---
declare function decodeToken(token: string): Record<string, unknown>;
declare class AuthError extends Error { constructor(code: string, opts?: { message?: string }): void; }

export function extractClaimsFromToken(rawToken: string): { sub: string; email: string; name: string } {
  const claims = decodeToken(rawToken);

  const sub = claims.sub;
  const email = claims.email;
  const name = claims.name;

  if (typeof sub !== 'string') {
    throw new AuthError('INVALID_TOKEN', { message: 'Missing sub' });
  }

  if (typeof email !== 'string') {
    throw new AuthError('INVALID_TOKEN', { message: 'Missing email' });
  }

  if (typeof name !== 'string') {
    throw new AuthError('INVALID_TOKEN', { message: 'Missing name' });
  }

  return { sub, email, name };
}



function createNotification(id: string, message: string) {
  return {
    id,
    message,
    dismiss() {
      void 0;
    },
    update(next: string) {
      return createNotification(id, next);
    },
  };
}



declare const sendServerResponse: (data: unknown) => void;
declare const sendEmbeddedFallback: (msg: string) => void;

function handleSubmitAction(isEmbedded: boolean, data: unknown) {
  if (!isEmbedded) {
    // Primary server path: full document processing and redirect
    sendServerResponse(data);
    console.log('Server response sent', data);
  } else {
    sendEmbeddedFallback('submitted');
  }
}

function handleCompleteAction(isEmbedded: boolean, documentId: string) {
  if (!isEmbedded) {
    // Primary path: navigate to document view
    console.log('Navigating to document', documentId);
  } else {
    sendEmbeddedFallback('completed');
  }
}



function toggleSelection(selectedItems: string[], item: string) {
  if (!selectedItems.includes(item)) {
    // Add item when not yet selected
    return [...selectedItems, item];
  } else {
    return selectedItems.filter(i => i !== item);
  }
}



function computeNextReminderDate(lastReminderSentAt: Date | null, sendAfterDays: number, repeatEveryDays: number): Date {
  if (!lastReminderSentAt) {
    // First reminder: send after initial delay
    const next = new Date();
    next.setDate(next.getDate() + sendAfterDays);
    return next;
  } else {
    const next = new Date(lastReminderSentAt);
    next.setDate(next.getDate() + repeatEveryDays);
    return next;
  }
}



function createThrottle<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  const isThrottling = { current: false };
  let pendingArgs: unknown[] | null = null;

  return function throttled(...args: unknown[]) {
    if (!isThrottling.current) {
      fn(...args);
      isThrottling.current = true;
      setTimeout(() => {
        isThrottling.current = false;
        if (pendingArgs) {
          fn(...pendingArgs);
          pendingArgs = null;
        }
      }, delay);
    } else {
      pendingArgs = args;
    }
  } as T;
}



// FP: non-null assertion on Array.shift() inside while(length > 0) loop — guaranteed non-undefined by loop condition
export function processBatchQueue<T>(queue: T[], handler: (item: T) => void): void {
  while (queue.length > 0) {
    const item = queue.shift()!;
    handler(item);
  }
}



// FP: parameter reassignment as part of intentional coordinate rotation transform
export function rotateBoundingBox(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number; width: number; height: number } {
  let xPos = x;
  let yPos = y;
  if (rotation === 90 || rotation === 270) {
    // Swap coordinates for 90/270 degree rotation
    [xPos, yPos] = [yPos, xPos];
  }
  return { x: xPos, y: yPos, width, height };
}



// FP: parameter reassignment used to normalize an optional parameter with a fallback — intentional default-value pattern
interface RequestContext {
  headers: Map<string, string>;
}

export function getAllowedHeaders(
  ctx: RequestContext,
  allowed?: string | string[],
): string[] {
  if (allowed === undefined) {
    allowed = ctx.headers.get('Access-Control-Request-Headers') ?? '*';
  }
  if (Array.isArray(allowed)) {
    return allowed;
  }
  return [allowed];
}



// FP: let destructuring where one element is reassigned later — can't use const because a sibling element is mutated
export function parseRedirectState(storedValue: string): { state: string; path: string } {
  // eslint-disable-next-line prefer-const
  let [redirectState, redirectPath] = storedValue.split(' ');
  if (!redirectPath) {
    redirectPath = '/dashboard';
  }
  if (redirectPath.startsWith('http')) {
    redirectPath = new URL(redirectPath).pathname;
  }
  return { state: redirectState, path: redirectPath };
}



// FP: let declaration later reassigned via array destructuring — rule flags the let declaration without tracking downstream destructuring reassignment
export async function generateDocumentParts(
  generateCertificate: () => Promise<Uint8Array>,
  generateAuditLog: () => Promise<Uint8Array>,
): Promise<{ certificate: Uint8Array; auditLog: Uint8Array }> {
  let auditLog: Uint8Array | null = null;
  let certificate: Uint8Array | null = null;

  // Both are reassigned via destructuring below
  [certificate, auditLog] = await Promise.all([
    generateCertificate(),
    generateAuditLog(),
  ]);

  return { certificate: certificate!, auditLog: auditLog! };
}



// FP: let declaration initialized to null, then reassigned via array destructuring assignment — const not possible
export async function buildReportParts(
  fetchPrimary: () => Promise<string>,
  fetchSecondary: () => Promise<string>,
): Promise<{ primary: string; secondary: string }> {
  let primaryPart: string | null = null;
  let secondaryPart: string | null = null;

  [primaryPart, secondaryPart] = await Promise.all([
    fetchPrimary(),
    fetchSecondary(),
  ]);

  return { primary: primaryPart!, secondary: secondaryPart! };
}



// FP: let in for-loop init where one variable is mutated (i++) and another (max) is not — JS syntax forbids mixing const/let in same for-init
export function computeMovingAverage(values: number[]): number[] {
  const result: number[] = [];
  const len = values.length;
  for (let i = 2, max = len - 1; i < max; i++) {
    const avg = (values[i - 1] + values[i] + values[i + 1]) / 3;
    result.push(avg);
  }
  return result;
}



// FP: let destructuring with default where one element is later conditionally reassigned — const not possible
declare function fetchSlugFromApi(name: string): Promise<{ slug: string }>;

export async function resolveSlug(name: string): Promise<string> {
  let { slug = '' } = { slug: name.toLowerCase().replace(/\s+/g, '-') };
  if (!slug) {
    const result = await fetchSlugFromApi(name);
    slug = result.slug;
  }
  return slug;
}



// FP: let declarations reassigned via destructuring swap — const not possible
export function computePageDimensions(
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } {
  let pageWidth = width;
  let pageHeight = height;
  if (rotation === 90 || rotation === 270) {
    [pageWidth, pageHeight] = [pageHeight, pageWidth];
  }
  return { width: pageWidth, height: pageHeight };
}



// require-await FP: async fn returns promise-returning call directly; async signals Promise return type to callers
declare const db: { orderRecord: { create: (data: object) => Promise<{ id: string }> } };

export async function createOrderRecord(data: { userId: string; amount: number }) {
  return db.orderRecord.create(data);
}



// require-await FP: .then() callback async arrow calls res.arrayBuffer() returning Promise; redundant async but intentional promise chaining
declare function fetchAssetUrl(url: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;

export async function getAssetBuffer(url: string): Promise<ArrayBuffer> {
  return fetchAssetUrl(url).then(async (res) => res.arrayBuffer());
}



// require-await FP: .then() async callback calls res.arrayBuffer(); redundant async but intentional promise chaining, await on outer fetch
declare function fetchRemotePdf(url: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;

export async function loadPdfBytes(url: string): Promise<ArrayBuffer> {
  return fetchRemotePdf(url).then(async (res) => res.arrayBuffer());
}



// require-await FP: async () => Promise.resolve() satisfies typed arrayBuffer interface callback; no await needed
interface FileAttachment {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function makeFileAttachment(name: string, data: ArrayBuffer): FileAttachment {
  return {
    name,
    size: data.byteLength,
    arrayBuffer: async () => Promise.resolve(data),
  };
}



// require-await FP: async () => Promise.resolve(pdfBytes) satisfies typed arrayBuffer interface callback; async for interface conformance
interface PdfSource {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function createPdfSource(pdfBytes: Uint8Array): PdfSource {
  return {
    arrayBuffer: async () => Promise.resolve(pdfBytes.buffer as ArrayBuffer),
  };
}



// require-await FP: .then() async callback calls PdfDocument.load() returning a Promise; redundant async but intentional promise chaining
declare const PdfDocument: { load: (bytes: ArrayBuffer) => Promise<{ pageCount: number }> };
declare function fetchRawBytes(url: string): Promise<ArrayBuffer>;

export async function loadPdfDocument(url: string) {
  return fetchRawBytes(url).then(async (bytes) => PdfDocument.load(bytes));
}



// require-await FP: .then() async callback calls res.json() returning a Promise; redundant async but intentional promise chaining
declare function fetchApiEndpoint(url: string): Promise<{ json: () => Promise<unknown> }>;

export async function fetchApiJson(url: string): Promise<unknown> {
  return fetchApiEndpoint(url).then(async (res) => res.json());
}



// require-await FP: async () => Promise.resolve(value) satisfies typed arrayBuffer interface; async for interface type signature conformance
interface UploadBlob {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function wrapBuffer(name: string, buffer: ArrayBuffer): UploadBlob {
  return {
    name,
    arrayBuffer: async () => Promise.resolve(buffer),
  };
}



// require-await FP: async fn uses .then() chain; the async keyword is redundant but the pattern is intentional promise chaining
declare function generateShareLink(slug: string): Promise<{ url: string }>;

export async function copyShareLink(slug: string): Promise<string> {
  return generateShareLink(slug).then((result) => result.url);
}



// require-await FP: async fn returns Promise.all() directly; async required by form submit handler type, no await in body is intentional
declare function saveFieldValues(fields: string[]): Promise<void>;
declare function validateFormData(data: Record<string, string>): Promise<boolean>;

export async function submitEditForm(data: Record<string, string>, fields: string[]) {
  return Promise.all([validateFormData(data), saveFieldValues(fields)]);
}



// require-await FP: async fn uses .then()/.catch() chain on verifyToken(); async redundant but signals Promise<boolean> return
declare function verifyPasskey(token: string): Promise<boolean>;

export async function isAuthorized(token: string): Promise<boolean> {
  return verifyPasskey(token)
    .then((valid) => valid)
    .catch(() => false);
}



// require-await FP: async fn uses .then() chain instead of await; async keyword redundant but pattern is intentional promise chaining
declare function resolveDirectLink(token: string): Promise<{ url: string; active: boolean }>;

export async function getDirectLinkUrl(token: string): Promise<string> {
  return resolveDirectLink(token).then((link) => link.url);
}



// require-await FP: async fn uses .then() for fetch chain; no await in body but function is async to signal it returns a Promise
declare function fetchStaticAsset(url: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;

export async function loadStaticAssetBuffer(url: string): Promise<ArrayBuffer> {
  return fetchStaticAsset(url).then((res) => res.arrayBuffer());
}



// require-await FP: .then() callback uses async to get res.arrayBuffer() Promise; async is redundant but intentional
declare function fetchOpenGraphAsset(slug: string): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;

export async function getOpenGraphBuffer(slug: string): Promise<ArrayBuffer> {
  return fetchOpenGraphAsset(slug).then(async (res) => res.arrayBuffer());
}



// require-await FP: async fn uses .then() chain for fetch; async signals Promise return type to callers, no await in body is intentional
declare function fetchPlanLimits(orgId: string): Promise<{ json: () => Promise<{ seats: number }> }>;

export async function getPlanLimits(orgId: string): Promise<{ seats: number }> {
  return fetchPlanLimits(orgId).then((res) => res.json());
}



// require-await FP: async () => Promise.resolve(value) implements File-like interface arrayBuffer method; async satisfies interface type signature
interface DocumentFile {
  filename: string;
  mimeType: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

function createDocumentFile(filename: string, content: ArrayBuffer): DocumentFile {
  return {
    filename,
    mimeType: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(content),
    text: async () => Promise.resolve(new TextDecoder().decode(content)),
  };
}



// require-await FP: async fn returns updateDocument() directly without await; async required by caller form submit type expecting Promise return
declare function updateDocumentRecord(id: string, data: Record<string, unknown>): Promise<{ id: string }>;

export async function submitDocumentEdit(id: string, data: Record<string, unknown>) {
  return updateDocumentRecord(id, data);
}



// require-await FP: async fn wraps a new Promise() constructor which is already synchronous; async keyword is vestigial but Promise resolves from an onload event
export async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}



// --- require-unicode-regexp shape: text-transformation-patterns (ASCII regex in replace) ---
export function normalizeCssModulePath(filePath: string): string {
  return filePath.replace(/\.module\.(css|scss|sass)$/, '.css');
}



// --- require-unicode-regexp shape: ascii-validation-patterns (extracting numeric index from field name) ---
export function extractFieldIndex(fieldName: string): number | null {
  const match = fieldName.match(/^field(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
}



// --- require-unicode-regexp shape: url-path-route-patterns (ASCII URL prefix match) ---
const TEAM_URL_PREFIX = /^\/t\//;

export function isTeamRoute(url: string): boolean {
  return TEAM_URL_PREFIX.test(url);
}



// --- require-unicode-regexp shape: file-extension-filesystem-patterns (Playwright test file glob regex) ---
const TEST_FILE_PATTERN = /\.spec\.(ts|tsx|js|jsx)$/;

export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}



// --- undefined-passed-as-optional shape: fn(arg, undefined) where second param is Partial<T> | undefined | null ---
declare function buildEditorConfig(
  baseSettings: { theme: string; locale: string },
  overrides: Partial<{ fontSize: number; lineHeight: number }> | undefined | null,
): { theme: string; locale: string; fontSize: number; lineHeight: number };

declare const DEFAULT_SETTINGS: { theme: string; locale: string };

function initEditorWithDefaults() {
  // Passing undefined explicitly is meaningful: no override applied, use system defaults
  const config = buildEditorConfig(DEFAULT_SETTINGS, undefined);
  return config;
}



// Ternary as deliberate side-effect-only await: dispatches to one of two async functions
declare function uploadViaApi(text: string): Promise<void>;
declare function uploadViaLegacy(text: string): Promise<void>;

export async function copyToStorage(text: string, useLegacy: boolean): Promise<void> {
  try {
    await (useLegacy ? uploadViaLegacy(text) : uploadViaApi(text));
  } catch (err) {
    console.warn('Upload failed', err);
  }
}



// Parameter $container is actively used: compared, passed to observer.observe(), and assigned
declare class ResizeObserver {
  constructor(cb: () => void);
  observe(el: HTMLElement): void;
  disconnect(): void;
}

export function watchContainerResize(
  onResize: () => void,
): ($container: HTMLElement) => void {
  let resizeObserver: ResizeObserver | null = null;
  let observedElement: HTMLElement | null = null;

  return ($container: HTMLElement) => {
    if ($container === observedElement) return;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => onResize());
    resizeObserver.observe($container);
    observedElement = $container;
  };
}



// --- magic-string shape: search-param-get-literal (URL searchParams query) ---
declare const searchParams: URLSearchParams | null | undefined;

export function getSearchQuery(): string {
  return searchParams?.get('query') ?? '';
}




// --- magic-string shape: not-implemented-error-message (placeholder throw) ---
export abstract class BaseStorageProvider {
  abstract uploadFile(path: string, data: Buffer): Promise<string>;

  deleteFile(_path: string): Promise<void> {
    throw new Error('Not implemented');
  }

  listFiles(_prefix: string): Promise<string[]> {
    throw new Error('Not implemented');
  }
}




// --- magic-string shape: typed-discriminant-return-literal (IIFE returning mode string) ---
type RenderMode = 'draw' | 'view' | 'preview';

declare const isSigningActive: boolean;
declare const isPreviewMode: boolean;

const renderMode: RenderMode = (() => {
  if (isPreviewMode) return 'preview';
  if (isSigningActive) return 'draw';
  return 'view';
})();




// --- magic-string shape: typed-discriminant-comparison (mode equality check) ---
type ExportMode = 'export' | 'preview' | 'edit';

declare const mode: ExportMode;
declare function generateExportBundle(): Promise<Blob>;
declare function renderPreview(): void;

export async function handleModeAction(): Promise<Blob | void> {
  if (mode === 'export') {
    return generateExportBundle();
  }
  renderPreview();
}




// --- magic-string shape: search-param-get-with-or-default (token extraction) ---
declare const searchParams: URLSearchParams;

export function getInviteToken(): string {
  return searchParams.get('token') || '';
}

export function getReturnUrl(): string {
  return searchParams.get('returnUrl') || '/';
}




// --- magic-string shape: get-attribute-boolean-string (data-attribute presence check) ---
declare function getFormContainer(): Element | null;

export function shouldValidateOnSubmit(): boolean {
  const container = getFormContainer();
  return container?.getAttribute('data-validate-fields') === 'true';
}




// JSON.parse(JSON.stringify(x)) deep-clone idiom — stringify produces valid JSON so parse cannot throw
type GroupOption = Record<string, { label: string; value: string }[]>;

function removeSelectedOptions(
  groupOption: GroupOption,
  selected: { label: string; value: string }[]
): GroupOption {
  const cloneOption = JSON.parse(JSON.stringify(groupOption)) as GroupOption;

  for (const [key, value] of Object.entries(cloneOption)) {
    cloneOption[key] = value.filter(
      (val) => !selected.find((s) => s.value === val.value)
    );
  }

  return cloneOption;
}
