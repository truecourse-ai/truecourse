/**
 * Type annotations that should NOT trigger duplicate-string or magic-string.
 *
 * - Interfaces with primitive type names (string, number, boolean) are in type_annotation
 *   context, which both magic-string and duplicate-string skip
 * - Union types and type aliases similarly live in type contexts
 * - Literal types in unions are skipped by both rules
 */

// Interfaces with primitive types — no magic-string or duplicate-string
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  age: number;
  active: boolean;
}

export interface ApiResponse {
  status: string;
  message: string;
  data: unknown;
  timestamp: number;
}

// Union types — literal_type context is skipped
export type Status = 'active' | 'inactive' | 'pending' | 'archived';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Type aliases with complex types
export type Handler = (request: unknown, response: unknown) => Promise<void>;

export type EventMap = Record<string, (...args: readonly unknown[]) => void>;

// Discriminated union
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// Mapped type
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P];
};

// Generic interface
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
}

// Using the types to ensure they are exported and used
export function createResponse(status: Status, message: string): ApiResponse {
  return {
    status,
    message,
    data: null,
    timestamp: Date.now(),
  };
}




// --- type-assertion-overuse shape: intentional adapter boundary (third-party return type incompatibility) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const backgroundJobRunner: { step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> } };
interface JobRunIO { output: unknown }

async function executeJobStep_2046(name: string, work: () => Promise<JobRunIO>): Promise<JobRunIO> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  // The external runner's return type is opaque; cast to any at the adapter boundary
  // before re-narrowing through our own interface.
  const result = await backgroundJobRunner.step.run(name, work as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return result as any;
}




// --- type-assertion-overuse shape: forced library workaround (ORM window-function orderBy type gap) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const queryBuilder_2f49: {
  selectFrom: (table: string) => {
    select: (cols: unknown[]) => {
      where: (col: string, op: string, val: unknown) => {
        orderBy: (col: string, dir: string) => { execute: () => Promise<unknown[]> }
      }
    }
  };
  fn: { agg: (col: string) => unknown }
};

async function getSignerRankings_2f49(teamId: string): Promise<unknown[]> {
  return queryBuilder_2f49
    .selectFrom('signers')
    .select(['id', 'name'])
    .where('teamId', '=', teamId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    // Kysely-style: fn() call cannot be used in orderBy without casting — library type gap
    .orderBy(queryBuilder_2f49.fn.agg('signedCount') as any, 'desc')
    .execute();
}




// --- type-assertion-overuse shape: canonical polyfill pattern (globalThis method attachment) ---
// Polyfill for Array.prototype.toSorted (ES2023) — TypeScript types lag behind the spec.
// Casting globalThis to any is the only way to attach the method at runtime.
if (!(Array.prototype as any).toSorted) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Array.prototype.toSorted = function <T>(compareFn?: (a: T, b: T) => number): T[] {
    return [...this].sort(compareFn);
  };
}




// --- type-assertion-overuse shape: intentional type escape before safe re-narrowing ---
declare const webhookProcessor_699d: { trigger: { schema: { parse: (data: unknown) => { eventType: string; payload: object } }; eventName: string } };
declare function handleWebhookEvent(event: { eventType: string; payload: object }): Promise<void>;

async function processWebhookTrigger_699d(rawEventData: unknown): Promise<void> {
  // Cast to any is intentional: the external webhook SDK returns an opaque generic
  // type that must be re-narrowed through our Zod schema before use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = webhookProcessor_699d.trigger.schema.parse(rawEventData as any);
  await handleWebhookEvent(parsed);
}



// Shape: z.preprocess with unknown val — val typed unknown by design in Zod preprocess
declare const z: {
  preprocess<T>(fn: (val: unknown) => unknown, schema: T): T;
  boolean(): { optional(): { default(v: boolean): unknown } };
  object(shape: Record<string, unknown>): unknown;
};

const QueryFlagSchema = z.preprocess(
  (val) => String(val) === 'true' || String(val) === '1',
  z.boolean().optional().default(false),
);



// Shape: .map<ExplicitType>() with explicit generic type parameter; nativeId || index fallback for id
interface ParticipantLite { id: number | string; name: string; email: string; role: string; }
interface SignerConfig { nativeId?: number | string; name?: string; email?: string; role: string; signingOrder?: number | null; }
declare const signerConfigs: SignerConfig[];

function normalizeSigner(signerConfigs: SignerConfig[]): ParticipantLite[] {
  return signerConfigs.map<ParticipantLite>((signer, index) => ({
    id: signer.nativeId || index,
    name: signer.name || '',
    email: signer.email || '',
    role: signer.role,
  }));
}



// Shape: nativeId || index used as id — id accepts number|string, index is number; valid union fallback
interface AttendeeRecord { id: number | string; label: string; groupId: string; }
interface AttendeeInput { externalId?: number | string; label?: string; groupId: string; }
declare const attendeeInputs: AttendeeInput[];

function buildAttendeeRecords(attendeeInputs: AttendeeInput[]): AttendeeRecord[] {
  return attendeeInputs.map((attendee, index) => ({
    id: attendee.externalId || index,
    label: attendee.label || '',
    groupId: attendee.groupId,
  }));
}



// Shape: z.array(z.object({...})) with optional numeric field — valid Zod schema
declare const z: {
  array<T>(schema: T): T[];
  object<T extends Record<string, unknown>>(shape: T): { parse(v: unknown): unknown };
  string(): { toLowerCase(): unknown; optional(): unknown; refine(fn: (v: string) => boolean, opts?: { message: string }): unknown };
  number(): { optional(): unknown };
  nativeEnum<T>(e: T): unknown;
};

const ParticipantUpdateSchema = z.array(
  z.object({
    id: z.number().optional(),
    email: z.string().toLowerCase(),
    name: z.string(),
    role: z.nativeEnum({ SIGNER: 'SIGNER', VIEWER: 'VIEWER' }),
  }),
);



// Shape 64173981af7f: z.string().refine() with regex.test(); value is string, regex.test accepts string.
declare const z: {
  string(): {
    refine(fn: (v: string) => boolean, opts: { message: string }): unknown
  }
};

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/u;

const passwordSchema = z
  .string()
  .refine(
    (value) => STRONG_PASSWORD_REGEX.test(value),
    { message: 'Password must be at least 8 characters with uppercase, lowercase, and number' },
  );

const slugSchema = z
  .string()
  .refine(
    (value) => /^[a-z0-9-]+$/u.test(value),
    { message: 'Slug must contain only lowercase letters, numbers, and hyphens' },
  );



// Shape 6429d197fd86: Zod schema definition using z.array(); no argument type mismatch.
declare const z: {
  string(): { min(n: number): unknown; max(n: number): unknown };
  array(schema: unknown): unknown;
  object(shape: Record<string, unknown>): unknown;
};

const checkboxOptionsSchema = z.array(
  z.object({
    label: z.string().min(1).max(100),
    value: z.string().min(1),
  }),
);



// Shape 6552fffd5f99: Zod schema definition with z.boolean().nullable(); no argument type mismatch.
declare const z: {
  boolean(): { nullable(): unknown; optional(): unknown };
  string(): { nullable(): unknown };
  object(shape: Record<string, unknown>): unknown;
};

const brandingPreferencesSchema = z.object({
  hideDefaultBranding: z.boolean().nullable(),
  customLogoEnabled: z.boolean().nullable(),
  primaryColor: z.string().nullable(),
});


// --- argument-type-mismatch FP: Zod .refine() with valid predicate; no type mismatch ---
declare const z: {
  string(): {
    url(): {
      refine(predicate: (val: string) => boolean, opts: { message: string }): unknown;
    };
  };
};
declare function isPrivateAddress(url: string): boolean;

const webhookUrlSchema = z
  .string()
  .url()
  .refine((url) => !isPrivateAddress(url), {
    message: 'Webhook URL cannot point to a private or loopback address',
  });


// --- argument-type-mismatch FP: Zod schema object with string and array fields; standard composition, no type mismatch ---
declare const z: {
  object<T extends object>(shape: T): { parse(val: unknown): unknown };
  string(): { optional(): unknown };
  array<T>(schema: T): { min(n: number, opts: { message: string }): unknown };
  nativeEnum<T extends object>(e: T): unknown;
};

enum WebhookEvent { DOCUMENT_SIGNED = 'DOCUMENT_SIGNED', DOCUMENT_SENT = 'DOCUMENT_SENT' }

const createWebhookSchema = z.object({
  webhookUrl: z.string().optional(),
  eventTriggers: z.array(z.nativeEnum(WebhookEvent)).min(1, { message: 'At least one event is required' }),
  secret: z.string().optional(),
});



// FP: z.array().refine() with deduplication check — standard Zod schema
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { min: (n: number) => unknown };
  array: (schema: unknown) => { refine: (fn: (items: string[]) => boolean, opts: { message: string }) => unknown };
};

const ZBulkDeleteSchema = z.object({
  resourceIds: z.array(z.string().min(1)).refine(
    (items: string[]) => new Set(items).size === items.length,
    { message: 'Resource IDs must be unique' },
  ),
});



// FP: z.array(z.object(...)) schema — standard Zod definition
declare const z: {
  object: (shape: Record<string, unknown>) => { min: (n: number) => unknown; superRefine: (fn: unknown) => unknown };
  string: () => { min: (n: number) => unknown };
  nativeEnum: (e: unknown) => unknown;
  array: (schema: unknown) => { min: (n: number) => { superRefine: (fn: unknown) => unknown } };
  number: () => unknown;
};
declare enum MemberRole { ADMIN = 'ADMIN', VIEWER = 'VIEWER' }

const ZAddMembersSchema = z.object({
  workspaceId: z.number(),
  members: z.array(
    z.object({
      userId: z.string().min(1),
      role: z.nativeEnum(MemberRole),
    }),
  ).min(1),
});



// FP: Object.values(Enum).includes(value as Enum) — explicit type assertion in type guard
declare enum TaskStatus { PENDING = 'PENDING', ACTIVE = 'ACTIVE', DONE = 'DONE' }

export const isTaskStatus = (value: unknown): value is TaskStatus => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.values(TaskStatus).includes(value as TaskStatus);
};



// FP shape: translation function called with lookup from typed constant map
declare function translate(descriptor: { id: string; message: string }): string;
declare const ROLE_LABELS: Record<string, { displayName: { id: string; message: string } }>;
declare const currentUser: { role: string };

function getRoleLabel(): string {
  return translate(ROLE_LABELS[currentUser.role].displayName);
}



// --- argument-type-mismatch shape: z.preprocess coercing empty string to undefined for optional validated field ---
declare const z: {
  object: (schema: object) => any;
  string: () => { email: () => any; optional: () => any; min: (n: number) => any };
  preprocess: (fn: (val: unknown) => unknown, schema: any) => any;
};

const ZContactFormSchema = z.object({
  name: z.string().min(1),
  replyTo: z.preprocess(
    (val) => (val === '' ? undefined : val),
    z.string().email().optional(),
  ),
  message: z.string().min(10),
});



// Zod union with transform to normalize array input
import { z } from 'zod';

const ZAccessAuthSchema = z.union([
  z.literal('ACCOUNT'),
  z.literal('EMAIL'),
  z.literal('PASSKEY'),
]);

const ZNormalizedAccessAuth = z
  .union([ZAccessAuthSchema, z.array(ZAccessAuthSchema)])
  .transform((val) => (Array.isArray(val) ? val : [val]))
  .optional()
  .default([]);



// Zod object schema with optional enum field
import { z } from 'zod';

const ZVisibilityEnum = z.enum(['PUBLIC', 'PRIVATE', 'TEAM']);

const ZDocumentSettingsSchema = z.object({
  templateType: z.enum(['GENERIC', 'PREFILLED']).optional(),
  externalId: z.string().optional(),
  visibility: ZVisibilityEnum.optional(),
  globalAccessAuth: z
    .array(z.union([z.literal('ACCOUNT'), z.literal('EMAIL'), z.literal('-1')]))
    .transform((val) => (val.length === 1 && val[0] === '-1' ? [] : val))
    .optional()
    .default([]),
});



// Zod string chain (trim/min/max/regex/refine)
import { z } from 'zod';

const RESERVED_SLUGS = ['admin', 'api', 'www', 'help'];

const ZWorkspaceSlugSchema = z
  .string()
  .trim()
  .min(3, { message: 'Slug must be at least 3 characters long.' })
  .max(30, { message: 'Slug must not exceed 30 characters.' })
  .toLowerCase()
  .regex(/^[a-z0-9].*[^_-]$/, 'Slug cannot start or end with dashes or underscores.')
  .regex(/^(?!.*[-_]{2})/, 'Slug cannot contain consecutive dashes or underscores.')
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'Slug can only contain letters, numbers, dashes and underscores.')
  .refine((slug) => !RESERVED_SLUGS.includes(slug), {
    message: 'This slug is reserved and cannot be used.',
  });



// Zod schema with array and superRefine for uniqueness validation (argument-type-mismatch FP)
declare const z: any;

const createTeamMembersSchema = z.object({
  teamId: z.string().uuid(),
  members: z.array(z.object({
    email: z.string().email(),
    role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
  })).superRefine((members, ctx) => {
    const emails = members.map((m: { email: string }) => m.email);
    const unique = new Set(emails);
    if (unique.size !== emails.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate email addresses are not allowed' });
    }
  }),
});



// Zod schema with extend and array uniqueness refine (argument-type-mismatch FP)
declare const z: any;

const baseWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
});

const createWebhookSchema = baseWebhookSchema.extend({
  name: z.string().min(1),
}).refine(
  (data: { events: string[] }) => new Set(data.events).size === data.events.length,
  { message: 'Duplicate events are not allowed', path: ['events'] }
);



// Zod object schema with optional id and email (argument-type-mismatch FP)
declare const z: any;

const recipientEntrySchema = z.object({
  id: z.number().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['SIGNER', 'APPROVER', 'VIEWER', 'CC']).default('SIGNER'),
});

const recipientsListSchema = z.array(recipientEntrySchema).min(1);



// Zod string schema with .default() value (argument-type-mismatch FP)
declare const z: any;

const DEFAULT_DATE_FORMAT = 'MM/DD/YYYY';
const DEFAULT_TIME_FORMAT = 'HH:mm';

const dateFormatSchema = z.object({
  dateFormat: z.string().default(DEFAULT_DATE_FORMAT),
  timeFormat: z.string().default(DEFAULT_TIME_FORMAT),
  timezone: z.string().optional(),
});



// argument-type-mismatch FP: Zod object schema with nested signers array
declare const z: {
  object: <T>(shape: T) => { parse: (v: unknown) => unknown };
  array: <T>(schema: T) => T;
  string: () => { min: (n: number) => unknown };
  number: () => unknown;
};

const addRecipientsSchema = z.object({
  signers: z.array(
    z.object({
      name: z.string().min(1),
      email: z.string().min(1),
      order: z.number(),
    })
  ),
});

export { addRecipientsSchema };



// argument-type-mismatch FP: Zod .refine() with array includes check
const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
declare const z: {
  instanceof: (cls: Function) => { refine: (fn: (f: File) => boolean, msg: string) => unknown };
};

const logoFileSchema = z
  .instanceof(File)
  .refine(
    (file) => ACCEPTED_MIME_TYPES.includes(file.type),
    'Only JPEG, PNG, WebP, or SVG files are accepted.'
  );

export { logoFileSchema };



// argument-type-mismatch FP: Zod .refine with multi-condition predicate
declare function isValidRedirectUrl(url: string): boolean;
declare const z: {
  string: () => { optional: () => { refine: (fn: (v: string | undefined) => boolean, msg: string) => unknown } };
};

const redirectUrlSchema = z
  .string()
  .optional()
  .refine(
    (value) => value === undefined || value === '' || isValidRedirectUrl(value),
    'Must be a valid redirect URL or empty.'
  );

export { redirectUrlSchema };



// --- empty-object-type shape: Vite ImportMetaEnv placeholder (extensible by consumers) ---
// This declaration intentionally overrides the built-in ImportMetaEnv to allow
// per-app augmentation. An empty body is valid and expected when no custom env
// vars are declared.
type AppImportMetaEnv = {};

interface AppImportMeta {
  readonly env: AppImportMetaEnv;
}



// --- invalid-void-type shape: void as callback return type in prop definition ---
// `(value: string) => void` is canonical idiomatic TypeScript for event/change
// callbacks in component prop types. Not an invalid position.
interface ReminderFrequencyPickerProps {
  value: string;
  amount: number;
  onChange: (value: string) => void;
  disabled: boolean;
  testId: string;
}

declare function ReminderFrequencyPicker(props: ReminderFrequencyPickerProps): unknown;



// --- invalid-void-type shape: void as multi-parameter callback return type ---
// `(_canvas: Canvas, _cleared: boolean) => void` is valid idiomatic TypeScript
// for expressing that the callback's return value is ignored.
declare type DrawingCanvas = { width: number; height: number; clear: () => void };

interface SignaturePadOptions {
  minWidth?: number;
  maxWidth?: number;
  onBegin?: (_canvas: DrawingCanvas) => void;
  onEnd?: (_canvas: DrawingCanvas, _cleared: boolean) => void;
  onClear?: (_canvas: DrawingCanvas, _cleared: boolean) => void;
}

declare function createSignaturePad(el: HTMLCanvasElement, opts?: SignaturePadOptions): DrawingCanvas;



// --- invalid-void-type shape: void as named-property callback return type ---
// `push: (_path: string) => void` in a prop interface is valid and idiomatic
// TypeScript for expressing 'caller does not use the return value'.
interface NavigationCommands {
  push: (_path: string) => void;
  replace: (_path: string) => void;
  back: () => void;
}

interface CommandMenuProps {
  navigation: NavigationCommands;
  pages: { label: string; path: string; shortcut?: string }[];
}

declare function CommandMenu(props: CommandMenuProps): unknown;



// Deliberate semantic grouping of named meta types for a shared renderer —
// not accidental complexity.
type InitialsFieldMeta = { type: 'initials'; fontSize?: number };
type SignatureFieldMeta = { type: 'signature'; fontSize?: number };
type NameFieldMeta = { type: 'name'; fontSize?: number };
type EmailFieldMeta = { type: 'email'; fontSize?: number };
type TextFieldMeta = { type: 'text'; fontSize?: number };
type NumberFieldMeta = { type: 'number'; minValue?: number; maxValue?: number };

export type GenericRenderableFieldMeta =
  | InitialsFieldMeta
  | SignatureFieldMeta
  | NameFieldMeta
  | EmailFieldMeta
  | TextFieldMeta
  | NumberFieldMeta;



// String-literal union used to constrain a generateId input parameter —
// standard discriminated string enum pattern, not a complexity smell.
export type EntityIdPrefix =
  | 'user'
  | 'org'
  | 'team'
  | 'project'
  | 'workspace'
  | 'invite'
  | 'session'
  | 'token';

declare function generateEntityId(prefix: EntityIdPrefix, length?: number): string;



// Foundational primitive union used to build a recursive serialisable type.
// Single-line, not complex — rule fires on member count alone.
export type SerializablePrimitive = string | number | boolean | null | undefined | Date;

export type SerializableArray = Serializable[];

export type SerializableRecord<T = unknown> = {
  [K in keyof T]: Serializable;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Serializable<T = any> = SerializablePrimitive | SerializableArray | SerializableRecord<T>;



// String-backed enum used for serialisation, API payloads, and DB persistence.
export enum RecipientStatusType {
  COMPLETED = 'completed',
  OPENED = 'opened',
  WAITING = 'waiting',
  UNSIGNED = 'unsigned',
  REJECTED = 'rejected',
}



// String-backed enum for signature type identifiers stored in DB and sent over API.
export enum DocumentSignatureType {
  DRAWN = 'drawn',
  TYPED = 'typed',
  UPLOADED = 'uploaded',
}



// String-backed enum for plan tier identifiers used at API and DB column boundaries.
export enum SubscriptionPlan {
  FREE = 'free',
  INDIVIDUAL = 'individual',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
  PLATFORM = 'platform',
}



// String-valued error code enum; values used in serialised error responses
// and pattern-matched in API adapters.
export enum AppErrorCode {
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  EXPIRED_CODE = 'EXPIRED_CODE',
  INVALID_BODY = 'INVALID_BODY',
  INVALID_REQUEST = 'INVALID_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
}



// String-backed enum used as serialised event names and plan identifiers.
export enum AuditEventType {
  DOCUMENT_CREATED = 'documentCreated',
  DOCUMENT_COMPLETED = 'documentCompleted',
  RECIPIENT_SIGNED = 'recipientSigned',
  RECIPIENT_VIEWED = 'recipientViewed',
}



// String-backed enum for serialisation, API error codes, and plan type identifiers.
export enum WebhookTriggerEvent {
  DOCUMENT_OPENED = 'document.opened',
  DOCUMENT_SIGNED = 'document.signed',
  DOCUMENT_COMPLETED = 'document.completed',
  DOCUMENT_REJECTED = 'document.rejected',
  DOCUMENT_EXPIRED = 'document.expired',
}



// String-backed enum used in Prisma types, API boundaries, and
// pattern-matched error codes.
export enum RecipientSigningStatus {
  NOT_SENT = 'not-sent',
  SENT = 'sent',
  VIEWED = 'viewed',
  SIGNED = 'signed',
  REJECTED = 'rejected',
}

export enum OrganisationTier {
  FREE = 'free',
  BUSINESS = 'business',
  ENTERPRISE = 'enterprise',
}



// Single schema file creates a discriminated union on 'type'; standard discriminant key, one usage
declare const z: {
  discriminatedUnion: (key: string, schemas: unknown[]) => unknown;
  object: (shape: Record<string, unknown>) => unknown;
  literal: (val: string) => unknown;
  string: () => unknown;
};

export const ZAuthMethodSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('password'), hash: z.string() }),
  z.object({ type: z.literal('oauth'), provider: z.string() }),
]);



// Single email template checks type === 'create'; 'create' is a discriminant string used once
declare const props: { type: 'create' | 'update'; orgName: string };

export function getEmailSubject(): string {
  if (props.type === 'create') {
    return `Welcome to ${props.orgName}`;
  }
  return `Your ${props.orgName} account has been updated`;
}



// Single route ternary picks 'template' or 'document' type; domain discriminants used once
declare const isTemplate: boolean;
declare function createItem(opts: { type: 'template' | 'document'; title: string }): Promise<void>;
declare const itemTitle: string;

export async function createCompletedItem() {
  const itemType = isTemplate ? 'template' : 'document';
  await createItem({ type: itemType, title: itemTitle });
}



// Single schema file defines version enum with default; standalone usage
declare const z: {
  object: (shape: Record<string, unknown>) => { parse: (v: unknown) => unknown };
  enum: (vals: string[]) => unknown;
  string: () => unknown;
  default: (v: string) => unknown;
};

export const ZFileUploadSchema = z.object({
  fileId: z.string(),
  version: (z.enum(['v1', 'v2', 'v3']) as any).default('v1'),
});



// Single file uses 'SELECT_TEMPLATE' as a prop default; same string may appear as a type union literal
type DialogMode = 'SELECT_TEMPLATE' | 'CONFIGURE' | 'CONFIRM';

declare function openDialog(opts: { mode?: DialogMode; templateId?: string }): void;

export function openTemplateSelector(templateId?: string) {
  openDialog({ mode: 'SELECT_TEMPLATE', templateId });
}



// Single tRPC middleware throws UNAUTHORIZED TRPCError code; standalone usage
declare class TRPCError extends Error {
  constructor(opts: { code: string; message: string });
}
declare const session: { userId?: number } | null;

export function requireAuth() {
  if (!session?.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'You must be signed in' });
  }
  return session.userId;
}



// FP shape: z.enum role strings in a single schema declaration (type-system-discriminant)
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  enum: (values: readonly string[]) => unknown;
  infer: unknown;
};

const ZUpdateMemberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']),
});



// FP shape: enum member values also present in a companion array in the same file (type-system-discriminant)
export enum ValidationRule {
  SELECT_AT_LEAST = 'Select at least',
  SELECT_EXACTLY = 'Select exactly',
  SELECT_AT_MOST = 'Select at most',
}

// Companion array mirrors the enum for runtime iteration — intentional within-file duplication
export const validationRuleLabels = ['Select at least', 'Select exactly', 'Select at most'];
export const validationRuleCounts = [1, 2, 3, 4, 5];



// FP shape: z.enum with distinct version option strings in a single schema (type-system-discriminant)
declare const z: {
  object: (s: Record<string, unknown>) => unknown;
  string: () => { describe: (d: string) => unknown };
  enum: (vals: readonly string[]) => {
    optional: () => { default: (v: string) => { describe: (d: string) => unknown } };
  };
};

const ZDownloadQuerySchema = z.object({
  envelopeItemId: z.string().describe('The ID of the envelope item to download.'),
  version: z
    .enum(['original', 'signed', 'pending'])
    .optional()
    .default('signed')
    .describe('The document version to download.'),
});



// Typed function with destructured options parameter
declare const renderAuditRow: (opts: { recipient: string; width: number; i18n: { t: (s: string) => string } }) => void;

function drawAuditEntry({
  recipient,
  width,
  i18n,
}: {
  recipient: string;
  width: number;
  i18n: { t: (s: string) => string };
}) {
  renderAuditRow({ recipient, width, i18n });
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Async function with named typed params
declare function fetchUserProfile(userId: string, teamId: string): Promise<{ name: string; email: string }>;

async function loadProfileData({
  userId,
  teamId,
  includeAvatar,
}: {
  userId: string;
  teamId: string;
  includeAvatar?: boolean;
}) {
  const profile = await fetchUserProfile(userId, teamId);
  return profile;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with many layout-related destructured params
declare function applyTextStyle(opts: {
  verticalAlign: string;
  textAlign: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  lineHeight: number;
}): void;

function renderTextField({
  verticalAlign,
  textAlign,
  fontSize,
  fontWeight,
  color,
  lineHeight,
}: {
  verticalAlign: string;
  textAlign: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  lineHeight: number;
}) {
  applyTextStyle({ verticalAlign, textAlign, fontSize, fontWeight, color, lineHeight });
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with Omit/Partial generic typed params
type FieldConfig = { id: string; label: string; required: boolean; defaultValue: string };
declare function registerField(config: Omit<FieldConfig, 'id'> & Partial<Pick<FieldConfig, 'defaultValue'>>): void;

function addFormField(
  config: Omit<FieldConfig, 'id'> & Partial<Pick<FieldConfig, 'defaultValue'>>
) {
  registerField(config);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Async handler with destructured payload params
declare function processNotification(recipientId: string, templateId: string, metadata: Record<string, string>): Promise<void>;

async function handleNotificationEvent({
  recipientId,
  templateId,
  metadata,
}: {
  recipientId: string;
  templateId: string;
  metadata: Record<string, string>;
}) {
  await processNotification(recipientId, templateId, metadata);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with default parameter value from a constant
const DEFAULT_REPORT_DATE_FORMAT = 'YYYY-MM-DD';
declare function formatReportDate(date: Date, format: string): string;

function renderDateCell(
  date: Date,
  format: string = DEFAULT_REPORT_DATE_FORMAT
) {
  return formatReportDate(date, format);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with token, fieldId and multiple typed params
declare function submitFieldValue(token: string, fieldId: string, value: string, signerEmail: string): Promise<void>;

async function handleFieldSubmit({
  token,
  fieldId,
  value,
  signerEmail,
}: {
  token: string;
  fieldId: string;
  value: string;
  signerEmail: string;
}) {
  await submitFieldValue(token, fieldId, value, signerEmail);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with fieldWidth and options destructuring
declare function renderFieldBox(fieldWidth: number, fieldHeight: number, options: { color: string; opacity: number }): void;

function drawFormField({
  fieldWidth,
  fieldHeight,
  options,
}: {
  fieldWidth: number;
  fieldHeight: number;
  options: { color: string; opacity: number };
}) {
  renderFieldBox(fieldWidth, fieldHeight, options);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with position and dimension destructured params
declare function placeOverlayElement(positionX: number, positionY: number, width: number, height: number, pageWidth: number, pageHeight: number): void;

function renderFieldOverlay({
  positionX,
  positionY,
  width,
  height,
  pageWidth,
  pageHeight,
}: {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}) {
  placeOverlayElement(positionX, positionY, width, height, pageWidth, pageHeight);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with Pick<...> and Pick<...>[] generic typed params
type UserRecord = { id: string; name: string; email: string; role: string; teamId: string };

declare function buildAccessReport(
  owner: Pick<UserRecord, 'id' | 'name' | 'email'>,
  members: Pick<UserRecord, 'id' | 'name' | 'role'>[]
): string;

function generateAccessReport(
  owner: Pick<UserRecord, 'id' | 'name' | 'email'>,
  members: Pick<UserRecord, 'id' | 'name' | 'role'>[]
) {
  return buildAccessReport(owner, members);
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// Function with union-typed param and meta object param
type SelectFieldMeta = { readOnly: boolean; required: boolean; options: string[]; defaultValue?: string };

function validateSelectField(
  value: string | undefined,
  fieldMeta: SelectFieldMeta,
  isSigningPage: boolean = false
): string[] {
  const errors: string[] = [];
  const { readOnly, required, options } = fieldMeta;

  if (readOnly && required) {
    errors.push('A field cannot be both read-only and required');
  }

  if (isSigningPage && required && !value) {
    errors.push('Selecting an option is required');
  }

  if (value && !options.includes(value)) {
    errors.push('Selected value is not a valid option');
  }

  return errors;
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// RFC 5321 defines max email address length as 254 characters
declare const z: any;
const RecipientSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(100).optional(),
});



// Admin document search pagination schema
declare const z: any;
const FindDocumentsInput = z.object({
  page: z.number().optional().default(1),
  perPage: z.number().optional().default(20),
  query: z.string().optional(),
});



// Template schema - 255 is standard DB VARCHAR field length
declare const z: any;
const TemplateMetaSchema = z.object({
  title: z.string().max(255).optional(),
  description: z.string().max(1000).optional(),
  redirectUrl: z.string().max(255).optional(),
});



// Password schema - min(6) minimum security, max(72) is bcrypt's hard limit
declare const z: any;
const CurrentPasswordSchema = z.object({
  currentPassword: z.string().min(6).max(72),
  newPassword: z.string().min(6).max(72),
});



// Document auth token schema - min/max explicitly bounded for security policy
declare const z: any;
const DocumentAuthSchema = z.object({
  accessToken: z.string().min(4).max(10),
  documentId: z.string(),
});



// Password complexity policy - longer passwords (>25 chars) skip special-char requirement
function validatePasswordComplexity(password: string): boolean {
  if (password.length > 25) {
    return true; // long passphrase exemption
  }
  return /[!@#$%^&*]/.test(password);
}



// Application error codes as TypeScript enum - string values are enum definitions
enum AppErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}



// Embedding router - discriminated union for document identifier type
type DocumentIdentifier =
  | { type: 'documentId'; documentId: number }
  | { type: 'externalId'; externalId: string };

function resolveDocumentId(identifier: DocumentIdentifier): string {
  if (identifier.type === 'documentId') {
    return String(identifier.documentId);
  }
  return identifier.externalId;
}



// typeof guard on a numeric field value — standard number type narrowing before arithmetic
function validateNumberFieldRange(data: { minValue?: unknown; maxValue?: unknown }): boolean {
  if (typeof data.minValue === 'number' && typeof data.maxValue === 'number') {
    return data.minValue <= data.maxValue;
  }
  return true;
}



// import type React — side-effect-free type import for JSX namespace
// The string 'react' here is a module specifier in an import type declaration
declare namespace React { type ReactNode = unknown; }

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
};

function ShareButton({ children, onClick }: ButtonProps) {
  return { children, onClick };
}



// textAlign: 'left' in a typed config object default — CSS-aligned field meta default value
type FieldAlignment = 'left' | 'center' | 'right';

type FieldMeta = {
  type: string;
  fontSize: number;
  textAlign: FieldAlignment;
};

function getInitialsFieldDefaults(): FieldMeta {
  return {
    type: 'initials',
    fontSize: 14,
    textAlign: 'left',
  };
}



// width: 'full' | 'column' = 'column' — TypeScript union type parameter with a string literal default
const FULL_COLUMN_WIDTH = 57.375;
const SINGLE_COLUMN_WIDTH = 19.125;

function calculateCellPosition(
  row: number,
  col: number,
  width: 'full' | 'column' = 'column',
): { positionX: number; positionY: number; width: number } {
  const gridStartX = 31;
  const gridStartY = 19;
  const rowHeight = 6.7;
  return {
    positionX: gridStartX + col * SINGLE_COLUMN_WIDTH,
    positionY: gridStartY + row * rowHeight,
    width: width === 'full' ? FULL_COLUMN_WIDTH : SINGLE_COLUMN_WIDTH,
  };
}



// --- magic-string FP shape: typed-discriminant-union (keyof typed discriminant comparison) ---
type NumberFieldMeta = { precision: number; format: string; allowNegative: boolean };

function handleFieldChange(field: keyof NumberFieldMeta, value: unknown): Partial<NumberFieldMeta> {
  if (field === 'precision') {
    return { precision: Number(value) };
  }
  if (field === 'format') {
    return { format: String(value) };
  }
  return {};
}



// --- magic-string FP shape: typed-discriminant-union (typed discriminant strings in object literal) ---
type SnapDirection = 'horizontal' | 'vertical';
type SnapKind = 'edge' | 'center';
type SnapPoint = { position: number; type: SnapKind; direction: SnapDirection };

function computeSnapPoints(bounds: { x: number; y: number; width: number; height: number }): SnapPoint[] {
  return [
    { position: bounds.y, type: 'edge', direction: 'horizontal' },
    { position: bounds.y + bounds.height / 2, type: 'center', direction: 'horizontal' },
    { position: bounds.x, type: 'edge', direction: 'vertical' },
    { position: bounds.x + bounds.width / 2, type: 'center', direction: 'vertical' },
  ];
}



// --- magic-string FP shape: typed-discriminant-union (ternary producing typed discriminant string) ---
type ContentSource = 'template' | 'document';
type ContentPayload = { type: ContentSource; id: string };

declare function buildCompletionPayload(templateId: string | undefined, documentId: string): ContentPayload;

function buildCompletionPayload(templateId: string | undefined, documentId: string): ContentPayload {
  const type: ContentSource = templateId ? 'template' : 'document';
  return { type, id: templateId ?? documentId };
}



// --- magic-string FP shape: typed-discriminant-union ('in' operator type guard) ---
type ActiveReminderConfig = { sendAfter: { days: number; unit: 'days' | 'weeks' } };
type DisabledReminderConfig = { sendAfter: { disabled: true } };
type ReminderConfig = ActiveReminderConfig | DisabledReminderConfig;

function isReminderDisabled(config: ReminderConfig): config is DisabledReminderConfig {
  return 'disabled' in config.sendAfter;
}



// --- magic-string FP shape: typed-discriminant-union (mode default parameter typed) ---
type RenderMode = 'edit' | 'preview' | 'readonly';
type SignatureFieldConfig = { x: number; y: number; width: number; height: number; recipientId: string };

declare function drawSignatureField(canvas: unknown, config: SignatureFieldConfig, mode: RenderMode): void;

function renderSignatureField(canvas: unknown, config: SignatureFieldConfig, mode: RenderMode = 'edit'): void {
  drawSignatureField(canvas, config, mode);
}



// 'as const' typed tuple of view option literals — the type itself is the constant definition.
const TemplateViewOptions = ['team', 'organisation'] as const;
type TemplateViewOption = (typeof TemplateViewOptions)[number];

export function isTemplateViewOption(value: string): value is TemplateViewOption {
  return TemplateViewOptions.includes(value as TemplateViewOption);
}



// TypeScript enum member definitions — these ARE the named constant definitions, not magic string usages.
export enum FieldValidationRule {
  SELECT_AT_LEAST = 'Select at least',
  SELECT_EXACTLY = 'Select exactly',
  SELECT_AT_MOST = 'Select at most',
}

export const fieldValidationRules = ['Select at least', 'Select exactly', 'Select at most'] as const;



// 'count' | 'cumulative' are TypeScript union type literals defining a two-option discriminant parameter.
declare function queryMonthlyMetrics(type: 'count' | 'cumulative'): Promise<Array<{ month: Date; value: number }>>;

export async function getMonthlyCompletedDocuments(type: 'count' | 'cumulative' = 'count') {
  const results = await queryMonthlyMetrics(type);

  if (type === 'cumulative') {
    return results.reduce<Array<{ month: Date; value: number }>>((acc, row) => {
      const prev = acc[acc.length - 1]?.value ?? 0;
      acc.push({ month: row.month, value: prev + row.value });
      return acc;
    }, []);
  }

  return results;
}




// --- magic-string shape: zod-describe-label (schema documentation) ---
declare const z: {
  string: () => { describe: (label: string) => unknown; uuid: () => { describe: (label: string) => unknown } };
  object: (shape: Record<string, unknown>) => { describe: (label: string) => unknown };
};

const templateIdSchema = z.string().uuid().describe('The ID of the template to use for document generation');
const templateNameSchema = z.string().describe('The display name for this template');



type NotificationVariant = 'default' | 'success' | 'error' | 'warning';

interface NotificationOptions {
  title: string;
  description?: string;
  variant?: NotificationVariant;
  duration?: number;
}

const NOTIFICATION_DEFAULTS: NotificationOptions = {
  title: '',
  variant: 'default',
  duration: 3000,
};

export { NOTIFICATION_DEFAULTS, type NotificationVariant, type NotificationOptions };



// FP: intermediate variable with explicit type annotation before return — annotation is semantically meaningful (compile-time type check), not redundant
interface TextFieldMeta {
  kind: 'text';
  maxLength: number;
  placeholder: string;
}

interface NumberFieldMeta {
  kind: 'number';
  min: number;
  max: number;
}

type FieldMeta = TextFieldMeta | NumberFieldMeta;

export function buildTextFieldMeta(maxLength: number, placeholder: string): FieldMeta {
  const meta: TextFieldMeta = { kind: 'text', maxLength, placeholder };
  return meta;
}

export function buildNumberFieldMeta(min: number, max: number): FieldMeta {
  const meta: NumberFieldMeta = { kind: 'number', min, max };
  return meta;
}



declare const React: { FC: <P>(c: (props: P) => unknown) => (props: P) => unknown };

type StepperProps = {
  steps: string[];
  currentStep: number;
  onStepChange?: (step: number) => void;
};

const Stepper: React.FC<StepperProps> = ({ steps, currentStep, onStepChange }) => {
  const handleClick = (index: number) => {
    if (onStepChange) {
      onStepChange(index);
    }
  };

  return { steps, currentStep, handleClick };
};

export { Stepper };



type SuperJsonFunction = <T>(data: T) => { data: T; __superJson: true };

declare const superjson: { stringify: <T>(data: T) => string; parse: <T>(str: string) => T };

const superLoaderJson: SuperJsonFunction = <T>(data: T) => ({
  data,
  __superJson: true as const,
});

export { superLoaderJson };



// Cross-environment pointer event handlers must accept the full set of mouse,
// pointer, and touch event shapes from both the DOM and React. The union is
// structurally 6 members by necessity — it cannot be collapsed without losing
// the runtime discrimination needed to read coordinates correctly.
declare type ReactMousePointEvent = { clientX: number; clientY: number; target: unknown };
declare type ReactPointerPointEvent = { clientX: number; clientY: number; pointerId: number; target: unknown };
declare type ReactTouchPointEvent = { touches: ReadonlyArray<{ clientX: number; clientY: number }>; target: unknown };
declare type DomMousePointEvent = { clientX: number; clientY: number; target: unknown };
declare type DomPointerPointEvent = { clientX: number; clientY: number; pointerId: number; target: unknown };
declare type DomTouchPointEvent = { touches: ReadonlyArray<{ clientX: number; clientY: number }>; target: unknown };

export function extractPointerCoordinates(
  event:
    | ReactMousePointEvent
    | ReactPointerPointEvent
    | ReactTouchPointEvent
    | DomMousePointEvent
    | DomPointerPointEvent
    | DomTouchPointEvent,
): { x: number; y: number } {
  if ('touches' in event) {
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  return { x: event.clientX, y: event.clientY };
}



// Serializable primitive used by the in-memory cache layer. Mirrors the
// JSON value space plus the few non-JSON scalars our serializer handles
// natively (Date round-trips to ISO strings, symbols are keyed by description).
export type CachePrimitive =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | symbol;

export type CacheArray = CacheValue[];

export type CacheRecord<T> = {
  [Property in keyof T]: CacheValue;
};

export type CacheValue<T = unknown> = CachePrimitive | CacheArray | CacheRecord<T>;



// Ambient types emitted by the ORM code generator live outside the module graph,
// so they have to be pulled in with a triple-slash reference directive.
/// <reference types="@acme/generated/orm-client-types.d.ts" />

declare const ormClientFactory: () => { connect(): Promise<void>; disconnect(): Promise<void> };

export const ormClient = ormClientFactory();



declare const StatusEnum: { COMPLETED: string[]; PENDING: string[] };
declare const SourceEnum: { UPLOAD: string[]; EMAIL: string[] };

export function isValidStatus(value: (typeof StatusEnum)[keyof typeof StatusEnum][number]): boolean {
  return [...StatusEnum.COMPLETED, ...StatusEnum.PENDING].includes(value as unknown as string);
}

export function isValidSource(value: (typeof SourceEnum)[keyof typeof SourceEnum][number]): boolean {
  return [...SourceEnum.UPLOAD, ...SourceEnum.EMAIL].includes(value as unknown as string);
}



declare const responseHeaders: unknown;

export function renderResponseHeaders(): { key: string; value: string }[] {
  return Object.entries(responseHeaders as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: value as string,
  }));
}



declare function validateField(opts: { characterLimit: number; readOnly: boolean }): string[];

export function handleFieldInput(field: string, value: string | boolean, fieldState: { characterLimit?: number; readOnly?: boolean }): string[] {
  const limit = field === 'characterLimit' ? Number(value) : Number(fieldState.characterLimit ?? 0);
  const readOnly = field === 'readOnly' ? Boolean(value) : Boolean(fieldState.readOnly);
  return validateField({ characterLimit: limit, readOnly });
}



declare interface Team { url: string; name: string }
declare const isOwner: boolean;
declare const currentTeam: Team | undefined;
declare const rowTeam: Team | undefined;

export function canManageDocument(): boolean {
  const isCurrentTeamDocument = currentTeam && rowTeam?.url === currentTeam.url;
  return Boolean(isOwner || isCurrentTeamDocument);
}



declare interface IconProps {
  size?: string | number;
  strokeWidth?: string | number;
  absoluteStrokeWidth?: boolean;
  color?: string;
}

export function computeIconStrokeWidth(props: IconProps): string | number {
  const { size = 24, strokeWidth = 1.5, absoluteStrokeWidth = false } = props;
  return absoluteStrokeWidth
    ? (Number(strokeWidth) * 24) / Number(size)
    : strokeWidth;
}



declare interface ProjectTeam { url: string }
declare const isProjectOwner: boolean;
declare const viewerTeam: ProjectTeam | undefined;
declare const resourceTeam: ProjectTeam | undefined;

export function userCanEditResource(): boolean {
  const isCurrentTeamResource = viewerTeam && resourceTeam?.url === viewerTeam.url;
  return Boolean(isProjectOwner || isCurrentTeamResource);
}



declare interface DecimalLike { valueOf(): number }
declare interface FieldPosition { positionX: DecimalLike; positionY: DecimalLike; width: DecimalLike; height: DecimalLike }
declare function getBoundingClientRect(el: Element): { width: number; height: number }

export function computeFieldCoords(field: FieldPosition, el: Element): { x: number; y: number; width: number; height: number } {
  const { width, height } = getBoundingClientRect(el);
  const fieldWidth = (Number(field.width) / 100) * width;
  const fieldHeight = (Number(field.height) / 100) * height;
  const fieldX = (Number(field.positionX) / 100) * width + fieldWidth;
  const fieldY = (Number(field.positionY) / 100) * height;
  return { x: fieldX, y: fieldY, width: fieldWidth, height: fieldHeight };
}



// Generic wrapper threading: T is passed directly to useState<T>, function body doesn't construct T
declare function useState<T>(initial: T): [T, (v: T) => void];
declare function useEffect(fn: () => (() => void) | void, deps: unknown[]): void;

export function useWindowedValue<T>(value: T, windowMs: number): T {
  const [windowed, setWindowed] = useState<T>(value);
  useEffect(() => {
    const id = setTimeout(() => setWindowed(value), windowMs);
    return () => clearTimeout(id);
  }, [value, windowMs]);
  return windowed;
}



// Generic wrapper threading: T types the payload param and the useRef<T> return
declare function useRef<T>(initial: T | null): { current: T | null };
declare function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: unknown[]): T;

export function usePeriodicSync<T>(syncFn: (data: T) => Promise<void>, intervalMs = 5000) {
  const pendingRef = useRef<T>(null);

  const schedule = useCallback(
    (data: T) => {
      pendingRef.current = data;
    },
    [syncFn, intervalMs],
  );

  return { schedule, pendingRef };
}



// --- magic-string shape: typeof-not-string-check (field value type narrowing) ---
type FieldValue = string | number | boolean | null;

interface FormField {
  key: string;
  value: FieldValue;
}

export function serializeFieldValue(field: FormField): string {
  if (typeof field.value !== 'string') {
    return JSON.stringify(field.value);
  }
  return field.value;
}




// --- magic-string shape: exported-string-constant-definition ---
export const FIELD_DEFAULT_GENERIC_ALIGN = 'left';
export const FIELD_DEFAULT_GENERIC_FONT_SIZE = '14px';
export const FIELD_DEFAULT_GENERIC_COLOR = '#000000';
export const FIELD_DEFAULT_DATE_FORMAT = 'MM/DD/YYYY';

