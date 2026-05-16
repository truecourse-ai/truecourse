/**
 * Idiomatic null checks that should NOT trigger any rules.
 *
 * Uses idiomatic double-equals for null and undefined checks.
 * Truthiness checks on objects and arrays are safe.
 * Ref.current guard-and-use patterns are common React idioms.
 */

interface Config {
  timeout: number;
  retries: number;
}

interface TimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

export function processValue(value: string | null | undefined): string {
  if (value == null) {
    return 'default';
  }
  return value.trim();
}

export function hasValue(value: number | null | undefined): boolean {
  return value != null;
}

export function applyConfig(config: Config | null): Config {
  if (config) {
    return { timeout: config.timeout, retries: config.retries };
  }
  return { timeout: 5000, retries: 3 };
}

export function hasItems(arr: readonly string[]): boolean {
  return arr.length > 0;
}

export function clearTimer(ref: TimerRef): void {
  if (ref.current !== null) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

export function mergeOptions(
  base: Config,
  overrides: Partial<Config> | null,
): Config {
  if (overrides == null) {
    return { timeout: base.timeout, retries: base.retries };
  }
  return {
    timeout: overrides.timeout ?? base.timeout,
    retries: overrides.retries ?? base.retries,
  };
}



// H13: array.find() || null — intentional undefined-to-null coercion, no type mismatch
interface Member { id: number; email: string; role: string; }

declare const members: Member[];
declare const selectedMemberId: number | null;

const activeMember = members.find((m) => m.id === selectedMemberId) || null;

function getDefaultAssignee(candidates: Member[], preferredEmail: string): Member | null {
  return candidates.find((c) => c.email === preferredEmail) || null;
}



// H17: array.find with type comparison — standard find by type field, no type mismatch
interface Attachment { id: number; type: string; url: string; }

declare const submission: { attachments: Attachment[] };

function getPrimaryAttachment(submission: { attachments: Attachment[] }): Attachment | undefined {
  return submission.attachments.find((attachment) => attachment.type === 'primary');
}

function hasSignatureAttachment(submission: { attachments: Attachment[] }): boolean {
  return submission.attachments.find((a) => a.type === 'signature') !== undefined;
}



interface Task {
  id: number;
  priority: number | null;
  assignee: string;
}

interface User {
  priority: number | null;
}

/**
 * Filter tasks that have higher priority than a given user's priority.
 * Both priority fields may be null, defaulting to 0.
 * This is a valid number-to-number comparison, not a type mismatch.
 */
export function filterHigherPriorityTasks(
  tasks: Task[],
  user: User,
): Task[] {
  return tasks.filter((task) => (task.priority ?? 0) > (user.priority ?? 0));
}

/**
 * Filter tasks that have priority within a specific range.
 * Uses nullish coalescing to handle null priorities.
 */
export function filterTasksByPriorityRange(
  tasks: Task[],
  minPriority: number | null,
  maxPriority: number | null,
): Task[] {
  return tasks.filter(
    (task) =>
      (task.priority ?? 0) >= (minPriority ?? 0) &&
      (task.priority ?? 0) <= (maxPriority ?? 100),
  );
}



// FP: argument-type-mismatch -- optional chaining on subscript-indexed array item
// parseUserAgent(sessionEvents.SESSION_STARTED[0]?.userAgent) is correctly typed;
// the parameter accepts string | undefined, matching the optional-chain result.

declare function parseUserAgent(ua: string | undefined): string;
declare const sessionEvents: Record<string, Array<{ userAgent: string; timestamp: number }>>;

export function getSessionPlatform(): string {
  return parseUserAgent(sessionEvents.SESSION_STARTED[0]?.userAgent);
}



// Optional string param: truthiness selects which auth path to use — empty string is invalid
declare function validateTotpCode(opts: { code: string }): Promise<boolean>;
declare function validateBackupCode(opts: { code: string }): Promise<boolean>;
declare class AuthError extends Error { constructor(code: string); }

export async function disableSecondFactor(opts: {
  totpCode?: string;
  backupCode?: string;
  userId: number;
}): Promise<void> {
  const { totpCode, backupCode, userId: _userId } = opts;

  if (!totpCode && !backupCode) {
    throw new AuthError('MISSING_CODE');
  }

  let isValid = false;

  if (totpCode) {
    isValid = await validateTotpCode({ code: totpCode });
  } else if (backupCode) {
    isValid = await validateBackupCode({ code: backupCode });
  }

  if (!isValid) {
    throw new AuthError('INCORRECT_CODE');
  }
}



// Optional string field: truthiness skips rendering when name is absent or empty
declare class TextNode { constructor(opts: { text: string; fontSize: number; x: number; y: number }): void; add(node: TextNode): void; }
declare class LayerGroup { add(node: TextNode): void; }

interface ParticipantRecord {
  name: string;
  email: string;
  completedAt: string | null;
}

export function renderParticipantName(
  layer: LayerGroup,
  participant: ParticipantRecord,
  x: number,
  y: number,
): void {
  if (participant.name) {
    layer.add(new TextNode({ text: participant.name, fontSize: 12, x, y }));
  }
}



// Optional string field value: truthiness skips fields with no meaningful value
interface FormFieldMeta { defaultValue?: string; }
interface FormField { id: string; type: string; meta?: FormFieldMeta; }

export function filterMeaningfulFields(fields: FormField[]): FormField[] {
  return fields.filter((field) => {
    const value = field.meta?.defaultValue ?? '';
    if (value) {
      return true;
    }
    return field.type === 'signature';
  });
}



// String from .slice(1): `if (hash)` is idiomatic empty-string check
declare function navigateTo(path: string): void;

export function handleHashNavigation(rawUrl: string): void {
  const hashIndex = rawUrl.indexOf('#');
  const hash = hashIndex !== -1 ? rawUrl.slice(hashIndex + 1) : '';

  if (hash) {
    navigateTo(`#${hash}`);
  }
}



// Optional string ID param: truthiness guards parent folder DB lookup
declare function findFolderById(id: string): Promise<{ id: string; type: string } | null>;
declare class AppError extends Error { constructor(code: string, opts: { message: string }): void; }

export async function moveFolder(opts: {
  folderId: string;
  parentId?: string;
  userId: number;
}): Promise<void> {
  const { folderId, parentId, userId: _userId } = opts;

  if (parentId) {
    const parentFolder = await findFolderById(parentId);
    if (!parentFolder) {
      throw new AppError('NOT_FOUND', { message: 'Parent folder not found' });
    }
    if (parentId === folderId) {
      throw new AppError('INVALID_REQUEST', { message: 'Cannot move folder into itself' });
    }
  }
}



// Numeric ID: 0 is not a valid database ID so falsy check is semantically correct
declare function setRequestHeader(name: string, value: string): void;

export function injectTeamHeader(headers: Record<string, string>, teamId?: number): void {
  if (teamId) {
    headers['x-team-id'] = String(teamId);
  }
}



// Optional string prop typed as string|undefined: truthiness guards against undefined before indexing
const ZIndexes: Record<string, number> = {
  modal: 1000,
  tooltip: 900,
  dropdown: 800,
  overlay: 700,
};

interface StackedLayerProps {
  zIndex?: string;
  children: unknown;
}

export function resolveLayerZIndex(props: StackedLayerProps): number | undefined {
  const { zIndex } = props;
  if (zIndex) {
    return ZIndexes[zIndex];
  }
  return undefined;
}



// String retrieved from a Map<string,string>: truthiness guard checks whether cache entry exists
declare function fetchPageContent(slug: string): Promise<string>;

const pageCache = new Map<string, string>();

export async function getOrFetchPage(slug: string): Promise<string> {
  const cached = pageCache.get(slug);
  if (cached) {
    return cached;
  }
  const content = await fetchPageContent(slug);
  pageCache.set(slug, content);
  return content;
}



// Optional string folder ID param: truthiness guards folder existence validation
declare function findFolderById(id: string): Promise<{ id: string } | null>;
declare class ValidationError extends Error { constructor(msg: string): void; }

export async function createWorkspaceDocument(opts: {
  name: string;
  folderId?: string;
  teamId: number;
}): Promise<void> {
  const { name: _name, folderId, teamId: _teamId } = opts;

  if (folderId) {
    const folder = await findFolderById(folderId);
    if (!folder) {
      throw new ValidationError('Folder not found');
    }
  }
}



// String from params.toString(): truthiness distinguishes empty vs non-empty query string
declare function buildSearchUrl(base: string, query: string): string;

export function buildDocumentListUrl(base: string, filterParams: URLSearchParams): string {
  const queryString = filterParams.toString();
  if (queryString) {
    return `${base}?${queryString}`;
  }
  return base;
}



// Optional string: truthiness guards against undefined/empty before setting header
declare interface ServerResponse { setHeader(name: string, value: string): void; }

export function setCorsOriginHeader(res: ServerResponse, allowedOrigin: string | undefined): void {
  let allowed: string | undefined;

  if (allowedOrigin && allowedOrigin !== '*') {
    allowed = allowedOrigin;
  } else if (allowedOrigin === '*') {
    allowed = '*';
  }

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
  }
}



// Boolean field: truthiness check is semantically identical to strict boolean comparison
interface CorsConfig {
  allowCredentials: boolean;
  origin: string;
  methods: string[];
}

declare interface HttpResponse { setHeader(name: string, value: string): void; }

export function applyCorsHeaders(res: HttpResponse, config: CorsConfig): void {
  res.setHeader('Access-Control-Allow-Origin', config.origin);
  res.setHeader('Access-Control-Allow-Methods', config.methods.join(', '));

  if (config.allowCredentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}



// Optional string qrToken param: truthiness guards QR code rendering
declare function generateQrCodeImage(token: string): Promise<Buffer>;
declare class CanvasLayer { addImage(opts: { data: Buffer; x: number; y: number }): void; }

export async function renderQrSection(
  layer: CanvasLayer,
  qrToken: string | undefined,
  x: number,
  y: number,
): Promise<void> {
  if (qrToken) {
    const qrImage = await generateQrCodeImage(qrToken);
    layer.addImage({ data: qrImage, x, y });
  }
}



// Optional string query param: truthiness is standard undefined/empty guard for Prisma contains filter
declare function findManyEmails(where: { email?: { contains: string } }): Promise<{ id: string; email: string }[]>;

export async function searchOrganisationEmails(query?: string): Promise<{ id: string; email: string }[]> {
  const where: { email?: { contains: string } } = {};

  if (query) {
    where.email = { contains: query };
  }

  return findManyEmails(where);
}



// Optional string folder ID: truthiness guards URL construction
export function buildFolderUrl(teamUrl: string, parentId?: string): string {
  const base = `/t/${teamUrl}/folders`;
  if (parentId) {
    return `${base}?parentId=${encodeURIComponent(parentId)}`;
  }
  return base;
}



// Numeric team ID: 0 is not a valid team ID so falsy check is semantically correct
declare function findTeamMembers(teamId: number): Promise<{ email: string; name: string }[]>;
declare function findAllUsers(query: string): Promise<{ email: string; name: string }[]>;

export async function getRecipientSuggestions(
  query: string,
  teamId?: number,
): Promise<{ email: string; name: string }[]> {
  if (teamId) {
    return findTeamMembers(teamId);
  }
  return findAllUsers(query);
}



// Optional context string: truthiness guards adding a message only when non-empty
interface AiMessage { role: 'user' | 'system'; content: string; }

export function buildPromptMessages(
  basePrompt: string,
  context?: string,
): AiMessage[] {
  const messages: AiMessage[] = [{ role: 'system', content: basePrompt }];

  const trimmedContext = context?.trim();
  if (trimmedContext) {
    messages.push({ role: 'user', content: trimmedContext });
  }

  return messages;
}



// String|null from URLSearchParams.get(): truthiness guards against null/empty before pre-filling
declare function prefillForm(field: string, value: string): void;

export function initSigninForm(searchParams: URLSearchParams): void {
  const email = searchParams.get('email');

  if (email) {
    prefillForm('email', email);
  }
}



// Boolean prop: truthiness on a boolean is semantically identical to strict comparison
interface TableConfig {
  enableSelection: boolean;
  enablePagination: boolean;
  pageSize: number;
}

export function buildTableClassName(config: TableConfig): string {
  const classes: string[] = ['table'];

  if (config.enableSelection) {
    classes.push('table--selectable');
  }

  if (config.enablePagination) {
    classes.push('table--paginated');
  }

  return classes.join(' ');
}



// Zod schema object or undefined: truthiness guards payload validation
declare const z: { object(shape: Record<string, unknown>): { parse(data: unknown): unknown }; string(): unknown; number(): unknown; };

interface JobDefinition {
  name: string;
  trigger: {
    schema?: ReturnType<typeof z.object>;
  };
  handler: (payload: unknown) => Promise<void>;
}

export async function dispatchJob(definition: JobDefinition, rawPayload: unknown): Promise<void> {
  let payload = rawPayload;

  if (definition.trigger.schema) {
    payload = definition.trigger.schema.parse(rawPayload);
  }

  await definition.handler(payload);
}



// Numeric recipient ID: 0 is not a valid recipient ID so falsy check is semantically correct
declare function updateRecipient(id: number, data: { token: string }): Promise<void>;
declare function createRecipient(data: { token: string; templateId: string }): Promise<{ id: number }>;

export async function upsertDirectLinkRecipient(opts: {
  templateId: string;
  token: string;
  existingRecipientId?: number;
}): Promise<void> {
  const { templateId, token, existingRecipientId } = opts;

  if (existingRecipientId) {
    await updateRecipient(existingRecipientId, { token });
  } else {
    await createRecipient({ token, templateId });
  }
}



// Optional string email domain ID filter: truthiness guards id filter addition to whereClause
interface EmailDomainWhereClause { id?: string; organisationId: string; }

declare function findEmailDomains(where: EmailDomainWhereClause): Promise<{ id: string; domain: string }[]>;

export async function findOrganisationEmailDomains(opts: {
  organisationId: string;
  emailDomainId?: string;
}): Promise<{ id: string; domain: string }[]> {
  const { organisationId, emailDomainId } = opts;
  const where: EmailDomainWhereClause = { organisationId };

  if (emailDomainId) {
    where.id = emailDomainId;
  }

  return findEmailDomains(where);
}



// Optional string search param: truthiness guards domain contains-filter — empty string would match all
interface DomainWhereClause { organisationId: string; domain?: { contains: string }; }

declare function findDomains(where: DomainWhereClause): Promise<{ id: string; domain: string }[]>;

export async function searchEmailDomains(opts: {
  organisationId: string;
  query?: string;
}): Promise<{ id: string; domain: string }[]> {
  const { organisationId, query } = opts;
  const where: DomainWhereClause = { organisationId };

  if (query) {
    where.domain = { contains: query };
  }

  return findDomains(where);
}



// String|null from localStorage.getItem(): truthiness guards against null
declare const localStorage: { getItem(key: string): string | null; };
declare function showVerificationDialog(): void;

const DIALOG_KEY = 'email-verification-last-shown';
const DIALOG_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function maybeShowVerificationDialog(): void {
  const lastShown = localStorage.getItem(DIALOG_KEY);

  if (lastShown) {
    const elapsed = Date.now() - Number(lastShown);
    if (elapsed < DIALOG_COOLDOWN_MS) {
      return;
    }
  }

  showVerificationDialog();
}



// Numeric template ID: 0 is not a valid template ID so falsy check is semantically correct
interface DocumentWhereClause {
  teamId: number;
  templateId?: number;
  status?: string;
}

declare function findDocuments(where: DocumentWhereClause): Promise<{ id: string }[]>;

export async function queryDocuments(opts: {
  teamId: number;
  templateId?: number;
  status?: string;
}): Promise<{ id: string }[]> {
  const { teamId, templateId, status } = opts;
  const where: DocumentWhereClause = { teamId };

  if (templateId) {
    where.templateId = templateId;
  }

  if (status) {
    where.status = status;
  }

  return findDocuments(where);
}



// Optional string query filter: truthiness guards integer-parsing logic
export function buildAdminDocumentWhere(query?: string): {
  OR?: Array<{ id?: number; title?: { contains: string } }>;
} {
  if (query) {
    const numericId = parseInt(query, 10);
    const conditions: Array<{ id?: number; title?: { contains: string } }> = [
      { title: { contains: query } },
    ];
    if (!isNaN(numericId)) {
      conditions.unshift({ id: numericId });
    }
    return { OR: conditions };
  }
  return {};
}



// Optional string job ID from job data: truthiness guards DB update
declare function updateJobRecord(id: string, data: { status: string; completedAt: Date }): Promise<void>;

export async function markJobComplete(backgroundJobId: string | undefined): Promise<void> {
  if (backgroundJobId) {
    await updateJobRecord(backgroundJobId, {
      status: 'completed',
      completedAt: new Date(),
    });
  }
}



// Optional redirect path string: truthiness guards cookie setting
declare function setCookie(name: string, value: string, opts: { path: string; httpOnly: boolean }): void;

export function setOAuthRedirectCookie(
  redirectPath: string | undefined,
  sessionToken: string,
): void {
  if (redirectPath) {
    setCookie('oauth_redirect', redirectPath, { path: '/', httpOnly: true });
  }
  setCookie('oauth_session', sessionToken, { path: '/', httpOnly: true });
}



// Optional string field: truthiness guards payload property assignment
interface FieldPayload {
  id: string;
  type: string;
  placeholder?: string;
  required?: boolean;
}

interface ApiFieldPayload {
  id: string;
  type: string;
  placeholder?: string;
  required?: boolean;
}

export function buildFieldPayload(field: FieldPayload): ApiFieldPayload {
  const payload: ApiFieldPayload = { id: field.id, type: field.type };

  if (field.placeholder) {
    payload.placeholder = field.placeholder;
  }

  if (field.required !== undefined) {
    payload.required = field.required;
  }

  return payload;
}



// Optional string job ID inside catch block: truthiness guards DB status update
declare function updateJobStatus(id: string, data: { status: string; error: string }): Promise<void>;

export async function runJobWithErrorTracking(
  backgroundJobId: string | undefined,
  task: () => Promise<void>,
): Promise<void> {
  try {
    await task();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (backgroundJobId) {
      await updateJobStatus(backgroundJobId, { status: 'failed', error: message });
    }
    throw err;
  }
}



// File|null|undefined from form data: truthiness skips upload when no file is provided
declare function uploadFileToStorage(file: File): Promise<string>;
declare function updateBrandingLogo(url: string): Promise<void>;

export async function processBrandingUpload(
  brandingLogo: File | null | undefined,
): Promise<string | null> {
  if (brandingLogo) {
    const url = await uploadFileToStorage(brandingLogo);
    await updateBrandingLogo(url);
    return url;
  }
  return null;
}



// Buffer|undefined optional param: truthiness guards image optimization and DB storage
declare function optimizeImage(data: Buffer): Promise<Buffer>;
declare function storeAvatarBytes(userId: number, data: Buffer): Promise<void>;

export async function saveUserAvatar(
  userId: number,
  bytes: Buffer | undefined,
): Promise<void> {
  if (bytes) {
    const optimized = await optimizeImage(bytes);
    await storeAvatarBytes(userId, optimized);
  }
}



// Optional CSS string: truthiness guards injection of a style element
declare function createStyleElement(css: string): { remove(): void };

export function injectCssVars(css: string | undefined): (() => void) | undefined {
  if (css) {
    const el = createStyleElement(css);
    return () => el.remove();
  }
  return undefined;
}



// Array|undefined optional param: truthiness guards array validation — undefined means no values provided
export function validateRadioValues(
  values: string[] | undefined,
  selectedValue: string,
): { valid: boolean; error?: string } {
  if (values) {
    if (values.length === 0) {
      return { valid: false, error: 'No radio options defined' };
    }
    if (!values.includes(selectedValue)) {
      return { valid: false, error: 'Selected value is not in allowed options' };
    }
  }
  return { valid: true };
}



// Boolean field from job payload: truthiness check on a boolean is equivalent to strict comparison
interface BulkSendJobPayload {
  templateId: string;
  recipientEmails: string[];
  sendImmediately: boolean;
}

declare function scheduleDelivery(templateId: string, emails: string[]): Promise<void>;
declare function sendImmediately(templateId: string, emails: string[]): Promise<void>;

export async function processBulkSendJob(payload: BulkSendJobPayload): Promise<void> {
  const { templateId, recipientEmails, sendImmediately: immediate } = payload;

  if (immediate) {
    await sendImmediately(templateId, recipientEmails);
  } else {
    await scheduleDelivery(templateId, recipientEmails);
  }
}



// Optional string job ID: truthiness guards final-attempt DB update
declare function updateJobFinalStatus(id: string, data: { status: string; attempts: number }): Promise<void>;

export async function finalizeJobAttempt(
  backgroundJobId: string | undefined,
  attempts: number,
): Promise<void> {
  if (backgroundJobId) {
    await updateJobFinalStatus(backgroundJobId, {
      status: 'exhausted',
      attempts,
    });
  }
}



// Optional presign token string: truthiness guards query-param appending for presigned URL
export function buildDownloadUrl(
  baseUrl: string,
  opts: { presignToken?: string; envelopeId: string },
): string {
  const { presignToken, envelopeId } = opts;
  const url = new URL(baseUrl);
  url.searchParams.set('envelopeId', envelopeId);

  if (presignToken) {
    url.searchParams.set('token', presignToken);
  }

  return url.toString();
}



// Object|undefined optional param: truthiness guards PDF form-value insertion step
interface FormValues { [fieldId: string]: string | number | boolean; }
declare function insertPdfFormValues(pdfBytes: Uint8Array, values: FormValues): Promise<Uint8Array>;

export async function preparePdfWithFormValues(
  pdfBytes: Uint8Array,
  formValues: FormValues | undefined,
): Promise<Uint8Array> {
  if (formValues) {
    return insertPdfFormValues(pdfBytes, formValues);
  }
  return pdfBytes;
}



// Optional string URL param: truthiness is idiomatic guard for optional URL parameters
declare function loadEmbedSandbox(token: string): Promise<void>;

export async function initPlayground(params: { token?: string; mode?: string }): Promise<void> {
  if (params.token) {
    await loadEmbedSandbox(params.token);
  }
}



// Optional IP address string: truthiness guards optional form field append
declare class FormData { append(name: string, value: string): void; }
declare function verifyCaptchaToken(form: FormData): Promise<{ success: boolean }>;

export async function verifyCaptcha(
  token: string,
  ipAddress?: string,
): Promise<{ success: boolean }> {
  const form = new FormData();
  form.append('response', token);

  if (ipAddress) {
    form.append('remoteip', ipAddress);
  }

  return verifyCaptchaToken(form);
}



// Optional search query string: truthiness guards where-clause construction
interface OrgWhereClause { name?: { contains: string }; ownerId?: number; }

declare function findOrganisations(where: OrgWhereClause, pagination: { take: number; skip: number }): Promise<{ id: string; name: string }[]>;

export async function searchAdminOrganisations(opts: {
  query?: string;
  ownerId?: number;
  page: number;
  pageSize: number;
}): Promise<{ id: string; name: string }[]> {
  const { query, ownerId, page, pageSize } = opts;
  const where: OrgWhereClause = {};

  if (query) {
    where.name = { contains: query };
  }

  if (ownerId) {
    where.ownerId = ownerId;
  }

  return findOrganisations(where, { take: pageSize, skip: (page - 1) * pageSize });
}



// String|null from headers.get(): truthiness guards against null — standard HTTP header optional-value guard
declare interface Headers { get(name: string): string | null; }

export function extractClientIpAddress(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for');

  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  return undefined;
}



// Boolean preflight field in CorsOptions: truthiness check on a boolean is equivalent to strict comparison
interface CorsOptions {
  origin: string | string[];
  methods: string[];
  preflightContinue: boolean;
  optionsSuccessStatus: number;
}

declare interface HttpResponse { status(code: number): HttpResponse; end(): void; }

export function handlePreflightRequest(
  res: HttpResponse,
  opts: CorsOptions,
): boolean {
  if (opts.preflightContinue) {
    return false;
  }
  res.status(opts.optionsSuccessStatus).end();
  return true;
}



// Optional recipient token string: truthiness selects recipient-token URL vs session-auth URL
export function buildRecipientDownloadUrl(
  baseUrl: string,
  opts: { token?: string; envelopeId: string },
): string {
  const { token, envelopeId } = opts;
  const url = new URL(baseUrl);
  url.searchParams.set('envelopeId', envelopeId);

  if (token) {
    url.searchParams.set('token', token);
    return url.toString();
  }

  return url.toString();
}



// Optional string folder ID input: truthiness guards folder validation DB lookup
declare function findFolderById(id: string): Promise<{ id: string; teamId: number } | null>;
declare class NotFoundError extends Error { constructor(msg: string): void; }

export async function validateEnvelopeFolderUpdate(opts: {
  envelopeId: string;
  folderId?: string;
  teamId: number;
}): Promise<void> {
  const { folderId, teamId } = opts;

  if (folderId) {
    const folder = await findFolderById(folderId);
    if (!folder || folder.teamId !== teamId) {
      throw new NotFoundError('Folder not found or access denied');
    }
  }
}



// Optional redirect path string: truthiness guards window.location assignment
declare const window: { location: { href: string } };

export function redirectAfterSignIn(redirectPath?: string): void {
  if (redirectPath) {
    window.location.href = redirectPath;
  } else {
    window.location.href = '/dashboard';
  }
}



// Optional exposed headers string: truthiness prevents setting an empty Expose-Headers header
interface ExtendedCorsOptions {
  exposedHeaders?: string | string[];
  methods: string[];
}

declare interface HttpResponse { setHeader(name: string, value: string): void; }

export function applyExposeHeaders(res: HttpResponse, opts: ExtendedCorsOptions): void {
  const exposed = Array.isArray(opts.exposedHeaders)
    ? opts.exposedHeaders.join(',')
    : opts.exposedHeaders;

  if (exposed) {
    res.setHeader('Access-Control-Expose-Headers', exposed);
  }
}



// --- expression-complexity shape: idiomatic-boolean-expressions ---
// hasFieldMetaValues checks field type match AND parses meta AND checks values array.
// The chained && expression is idiomatic for optional-field validation — not complex.
declare const FieldType: { CHECKBOX: string; RADIO: string };
declare function parseCheckboxMeta(m: unknown): { values?: Array<{ checked: boolean }> } | null;
declare function parseRadioMeta(m: unknown): { values?: Array<{ checked: boolean }> } | null;

function hasFieldMetaValues(
  fieldType: string,
  fieldMeta: unknown,
  parser: typeof parseCheckboxMeta | typeof parseRadioMeta,
  targetType: string,
): boolean {
  if (fieldType !== targetType || !fieldMeta) {
    return false;
  }
  const parsedMeta = parser?.(fieldMeta);
  return parsedMeta !== null && parsedMeta !== undefined && Array.isArray(parsedMeta.values) && parsedMeta.values.length > 0;
}

export function checkFieldHasValues(
  field: { type: string; fieldMeta: unknown },
): boolean {
  return (
    hasFieldMetaValues(field.type, field.fieldMeta, parseCheckboxMeta, FieldType.CHECKBOX) ||
    hasFieldMetaValues(field.type, field.fieldMeta, parseRadioMeta, FieldType.RADIO)
  );
}



// FP: 3-clause OR sharing a common negation — derived boolean guard
declare const item: { submitted: boolean };
declare const selectedChoice: string | null;
declare const defaultChoice: string | null;
declare const fallbackChoice: string | null;

function computeAutoFillGuard() {
  const shouldAutoFill =
    (!item.submitted && selectedChoice !== null) ||
    (!item.submitted && defaultChoice !== null) ||
    (!item.submitted && fallbackChoice !== null);
  return shouldAutoFill;
}



// FP: typeof-ternary for API payload normalization — not a complex expression
declare const webhookPayload: { customer: string | { id: string } };

function normalizeCustomerId() {
  const customerId =
    typeof webhookPayload.customer === 'string'
      ? webhookPayload.customer
      : webhookPayload.customer.id;
  return customerId;
}



// FP: single typeof-ternary for API payload normalization — not a complex expression
declare const subscription: { customer: string | { id: string } };

function resolveSubscriptionCustomerId() {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;
  return customerId;
}



// FP: 4-clause equality OR chain in type guard — not a complex expression
type OAuthPrompt = 'none' | 'login' | 'consent' | 'select_account';

function isValidOAuthPrompt(value: string): value is OAuthPrompt {
  return (
    value === 'none' ||
    value === 'login' ||
    value === 'consent' ||
    value === 'select_account'
  );
}



// FP: three array-length OR checks — simple multi-array disjunction for change detection
declare const addedItems: unknown[];
declare const removedItems: unknown[];
declare const updatedItems: unknown[];

function willEnvelopeItemsBeModified(): boolean {
  return addedItems.length > 0 || removedItems.length > 0 || updatedItems.length > 0;
}



// Null-check with two equality comparisons — idiomatic guard
declare function getReportingPeriod(): string | null | undefined;
declare function formatPeriodLabel(period: string): string;

function getPeriodLabel() {
  const rawPeriod = getReportingPeriod();
  if (rawPeriod === null || rawPeriod === undefined) {
    return 'All time';
  }
  return formatPeriodLabel(rawPeriod);
}



// Field type membership check combined with null check
type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'signature';
declare const SIGNABLE_FIELD_TYPES: FieldType[];

function isSignableField(fieldType: FieldType | null) {
  return fieldType !== null && SIGNABLE_FIELD_TYPES.includes(fieldType);
}



// Parallel ternary-assignments for mutually exclusive form field state — not accidental complexity
declare type FormField = 'text' | 'number' | 'date';
declare type FieldState = { text: string | null; value: number | null; dateStr: string | null };
declare const fieldState: FieldState;
export function handleFieldInput(field: FormField, value: unknown): { text: string; numeric: number; date: string } {
  const text = field === 'text' ? String(value) : (fieldState.text ?? '');
  const numeric = field === 'number' ? Number(value) : (fieldState.value ?? 0);
  const date = field === 'date' ? String(value) : (fieldState.dateStr ?? '');
  return { text, numeric, date };
}



// FP: non-null assertion inside conditional branch that tests the same property — safe by invariant
interface WizardState {
  configuration: { documentId: string; title: string } | null;
  currentStep: number;
}

export function renderConfigStep(state: WizardState): string {
  if (state.configuration) {
    // configuration is guaranteed non-null in this branch
    return `Configuring: ${state.configuration!.title}`;
  }
  return 'Not yet configured';
}



// FP: non-null assertion inside ternary whose condition tests the same property — safe by invariant
interface UploadItem {
  externalId: string | null;
  filename: string;
}

declare function processUpload(id: string): void;

export function handleUploadAction(item: UploadItem): void {
  const action = item.externalId !== null
    ? () => processUpload(item.externalId!)
    : () => {};
  action();
}



// FP: non-null assertion after Map.has+set pattern — TypeScript can't prove get() is defined after has()+set()
export function groupByCategory(items: Array<{ category: string; value: number }>): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const item of items) {
    if (!grouped.has(item.category)) {
      grouped.set(item.category, []);
    }
    grouped.get(item.category)!.push(item.value);
  }
  return grouped;
}



// FP: non-null assertion after early-throw guard — at assertion site the value is guaranteed non-null
interface Subscription {
  id: string;
  status: 'active' | 'past_due' | 'cancelled';
}
interface Account {
  subscription: Subscription | null;
}

export function getActiveSubscriptionId(account: Account): string {
  if (!account.subscription) {
    throw new Error('Account has no subscription');
  }
  if (account.subscription.status === 'cancelled') {
    throw new Error('Subscription is cancelled');
  }
  // subscription is guaranteed non-null at this point by the guards above
  return account.subscription!.id;
}



// FP: non-null assertion on value immediately assigned and guarded by downstream check
interface HttpRequest {
  headers: { get(name: string): string | null };
}

export function getAllowedOrigin(req: HttpRequest, allowed: string | undefined): string | null {
  if (!allowed) {
    allowed = req.headers.get('Origin')!;
  }
  if (allowed) {
    return allowed;
  }
  return null;
}



// FP: non-null assertion on Map.get() after has()+set() in else branch — TypeScript can't prove get() is defined
export function buildIndex(entries: Array<{ key: string; index: number }>): Map<string, number[]> {
  const seen = new Map<string, number[]>();
  entries.forEach((entry, position) => {
    if (!seen.has(entry.key)) {
      seen.set(entry.key, []);
    }
    seen.get(entry.key)!.push(position);
  });
  return seen;
}



// FP: non-null assertion inside async callback after explicit null-guard — TypeScript can't narrow through closure boundary
declare function fetchConfig(): Promise<{ data: string } | null>;
declare function processData(data: string): Promise<void>;

export async function runWithGuard(): Promise<void> {
  const config = await fetchConfig();
  if (!config) return;
  // TypeScript loses narrowing in async callbacks — assertion is safe by the guard above
  await new Promise<void>((resolve) => {
    void processData(config!.data).then(resolve);
  });
}



// FP: non-null assertion inside $if(!!value, callback) — idiomatic Kysely/query-builder pattern, assertion safe by !! guard
declare const db: {
  selectFrom: (table: string) => {
    $if: (cond: boolean, fn: (qb: any) => any) => any;
    execute: () => Promise<any[]>;
  };
};

export async function findRecords(startDate?: Date): Promise<any[]> {
  return db
    .selectFrom('records')
    .$if(!!startDate, (qb) => qb.where('created_at', '>=', startDate!))
    .execute();
}



// FP: non-null assertion after sequential assignment on all code paths — TypeScript can't prove flow
export function encodePayload(data: string | Uint8Array): Uint8Array {
  let result: Uint8Array | null = null;
  if (typeof data === 'string') {
    const encoder = new TextEncoder();
    result = encoder.encode(data);
  } else {
    result = data;
  }
  // result is always non-null here: both branches assign it
  return result!;
}



// FP: non-null assertion inside if(isEmbedded) branch where value is set non-null when isEmbedded is true
interface UploadFile {
  name: string;
  remoteId: string | null;
  content: Uint8Array | null;
}

declare const isEmbedded: boolean;
declare function uploadToRemote(id: string, content: Uint8Array): void;

export function processFiles(files: UploadFile[]): void {
  if (isEmbedded) {
    for (const file of files) {
      // when isEmbedded, remoteId and content are guaranteed set by construction
      uploadToRemote(file.remoteId!, file.content!);
    }
  }
}



// FP: non-null assertion on Array.pop() inside if(array.length > perPage) — guaranteed non-undefined
interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export function paginate<T extends { id: string }>(items: T[], perPage: number): PaginatedResult<T> {
  const data = [...items];
  let nextCursor: string | null = null;
  if (data.length > perPage) {
    const extra = data.pop()!;
    nextCursor = extra.id;
  }
  return { items: data.slice(0, perPage), nextCursor };
}



// FP: non-null assertion inside if(isEmbedded) branch — data is guaranteed non-null in that branch by construction
interface FileEntry {
  path: string;
  checksum: string | null;
  binaryData: Uint8Array | null;
}

declare function storeFile(path: string, checksum: string, data: Uint8Array): void;

export function persistEmbeddedFiles(files: FileEntry[], isEmbedded: boolean): void {
  if (isEmbedded) {
    for (const f of files) {
      // both checksum and binaryData are set non-null for embedded files by the caller
      storeFile(f.path, f.checksum!, f.binaryData!);
    }
  }
}



// FP: non-null assertion inside useQuery callback guarded by enabled: !!value — idiomatic React Query pattern
declare function useQuery<T>(opts: { queryFn: () => Promise<T>; enabled: boolean }): { data: T | undefined };

export function useOrganizationData(orgId?: string) {
  return useQuery({
    queryFn: () => fetchOrganization(orgId!),
    enabled: !!orgId,
  });
}

declare function fetchOrganization(id: string): Promise<{ name: string }>;



// FP: non-null assertion inside JSX &&-short-circuit — TypeScript doesn't narrow through JSX && into nested callbacks
interface ListItem {
  id: string;
  attachmentId: string | null;
  label: string;
}

declare function deleteAttachment(id: string): void;

export function renderDeleteActions(items: ListItem[]): void {
  // This mirrors the JSX pattern: item.attachmentId && <Button onClick={() => deleteAttachment(item.attachmentId!)} />
  for (const item of items) {
    if (item.attachmentId) {
      const handler = () => deleteAttachment(item.attachmentId!);
      handler();
    }
  }
}



// Konva canvas helper — .find() with a CSS selector returns a Node array, never undefined.
// The result is immediately .filter()ed; no null check is needed.
declare const canvasStage: {
  find(selector: string): Array<{ id(): string; getClientRect(): { x: number; y: number; width: number; height: number } }>;
};

export function getVisibleLayers(excludeId?: string) {
  const layers = canvasStage.find('.canvas-layer').filter((node) => node.id() !== excludeId);
  return layers.map((node) => node.getClientRect());
}



// Array.prototype.find result immediately guarded with optional chaining — null check is present.
declare const workflowSteps: Array<{ id: string; actions: string[]; label: string }>;

export function getStepActions(stepId: string): string[] {
  const step = workflowSteps.find((s) => s.id === stepId);
  return step?.actions ?? [];
}



// Konva Group .find() with CSS selector returns a Node array; result is immediately .sort()ed.
declare const shapeGroup: {
  find(selector: string): Array<{ getZIndex(): number; name(): string }>;
};

export function getSortedChildShapes() {
  const children = shapeGroup.find('.child-shape').sort((a, b) => a.getZIndex() - b.getZIndex());
  return children.map((c) => c.name());
}
