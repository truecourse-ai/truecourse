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



// shape-d7044ee5a7c5: Kysely window function .over() requires `as any` because
// the Prisma extension does not expose a typed orderBy in this position.
declare const kyselyDb: {
  selectFrom: (table: string) => {
    select: (expr: unknown) => { groupBy: (col: string) => { execute: () => Promise<unknown[]> } };
  };
};
declare const fn: (name: string, args: readonly unknown[]) => { over: (cb: (ob: OrderByBuilder) => unknown) => unknown };
declare const sql: { lit: (value: string) => unknown };
interface OrderByBuilder {
  orderBy: (expr: unknown) => OrderByBuilder;
}

export async function getMonthlyCompletedDocuments(): Promise<unknown[]> {
  const completedCount = fn('COUNT', ['Envelope.id']).over((ob) =>
    // Feels like a bug in the Kysely extension but I just can not do this orderBy in a type-safe manner.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    ob.orderBy(fn('DATE_TRUNC', [sql.lit('MONTH'), 'Envelope.updatedAt']) as any),
  );
  return kyselyDb.selectFrom('Envelope').select(completedCount).groupBy('month').execute();
}

// shape-2f494d3a3acf: Same Kysely .over() orderBy gap on a different fn() call.
export async function getSignerConversion(): Promise<unknown[]> {
  const signerCount = fn('COUNT', ['User.id']).over((ob) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    ob.orderBy(fn('DATE_TRUNC', [sql.lit('MONTH'), 'User.createdAt']) as any),
  );
  return kyselyDb.selectFrom('User').select(signerCount).groupBy('month').execute();
}

// shape-3d63ee078e1f: Polyfill for Promise.withResolvers (ES2024). Casting
// globalThis.Promise to `any` is the only way to dynamically attach the new
// static method since TypeScript's built-in lib types don't include it yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
const GlobalPromise = globalThis.Promise as any;
if (typeof GlobalPromise.withResolvers !== 'function') {
  GlobalPromise.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new GlobalPromise((res: typeof resolve, rej: typeof reject) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}


// Vite-style env declaration: user-extensible placeholder that overrides Vite's
// built-in ImportMetaEnv. Empty body is intentional boilerplate when no custom
// env vars are declared yet — this is the documented Vite pattern.
export interface ImportMetaEnv {}

export interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const meta: ImportMeta;
export const viteMode: string = meta.env ? 'configured' : 'default';


// Mode: void-as-callback-return-type — void as the return type of a callback
// parameter (e.g. `(x: T) => void`) is idiomatic TypeScript and must not flag.
export interface AutosaveOptions<R> {
  readonly delayMs: number;
  readonly onResponse?: (response: R) => void;
  readonly onError?: (error: unknown) => void;
}

export function registerAutosave<R>(options: AutosaveOptions<R>): () => void {
  declare const dispose: () => void;
  return dispose;
}

// Mode: void-as-promise-type-argument — Promise<void> is the canonical async
// return type when no meaningful value is produced.
export type FlushFn = () => Promise<void>;

export interface EnvelopeAutosaveApi {
  readonly flush: () => Promise<void>;
  readonly cancel: () => Promise<void>;
}

export async function runFlush(api: EnvelopeAutosaveApi): Promise<void> {
  await api.flush();
  await api.cancel();
}

// Mode: mixed-valid-void-uses — both Promise<void> and `() => void` appear in
// the same declaration; each is valid and the rule must validate occurrences
// independently.
export interface EnvelopeEditorContext {
  readonly flush: () => Promise<void>;
  readonly registerCleanup: (cleanup: () => void) => () => void;
  readonly subscribe: (listener: (event: { id: string }) => void) => () => void;
}

declare const editorContext: EnvelopeEditorContext;
export const unregister: () => void = editorContext.registerCleanup(() => {
  /* no-op cleanup */
});


// Classes that only implement interfaces (no extends clause) should NOT
// trigger missing-super-call. There is no superclass, so super() is neither
// required nor valid.

interface Transport<T> {
  send(message: T): Promise<void>;
}

interface SentMessageInfo {
  messageId: string;
  accepted: string[];
}

declare const fetchImpl: (url: string, init: { method: string; body: string }) => Promise<{ ok: boolean }>;

export class MailChannelsTransport implements Transport<SentMessageInfo> {
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(endpoint: string, apiKey: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey;
  }

  async send(message: SentMessageInfo): Promise<void> {
    const response = await fetchImpl(this.endpoint, {
      method: 'POST',
      body: JSON.stringify({ ...message, apiKey: this.apiKey }),
    });
    if (!response.ok) {
      throw new Error('MailChannels send failed');
    }
  }
}

interface PointLike {
  x: number;
  y: number;
  time: number;
}

export class Point implements PointLike {
  public readonly x: number;
  public readonly y: number;
  public readonly time: number;

  constructor(x: number, y: number, time: number) {
    this.x = x;
    this.y = y;
    this.time = time;
  }

  distanceTo(other: PointLike): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  velocityFrom(start: PointLike): number {
    const dt = this.time - start.time;
    return dt === 0 ? 0 : this.distanceTo(start) / dt;
  }
}



// ---------------------------------------------------------------------------
// Idiomatic type assertions that should NOT trigger unsafe-type-assertion.
// ---------------------------------------------------------------------------

// Mode: object-keys-entries-string-widening
// Object.keys / Object.entries widen to string; restoring the key-of type
// is a well-known TypeScript idiom, not an unsafe cast.
type RecipientRole = 'SIGNER' | 'APPROVER' | 'VIEWER';
type RecipientLite = { id: string; email: string };
declare const recipientsByRole: Record<RecipientRole, RecipientLite[]>;
export const recipientEntries = Object.entries(recipientsByRole) as [
  RecipientRole,
  RecipientLite[],
][];

type DocumentEmailSettings = { signed: boolean; viewed: boolean; rejected: boolean };
declare const EMAIL_SETTINGS_LABELS: Record<keyof DocumentEmailSettings, string>;
export const emailSettingsKeys = Object.keys(
  EMAIL_SETTINGS_LABELS,
) as (keyof DocumentEmailSettings)[];

// Mode: dom-eventtarget-to-node
// Inside a DOM event handler the target is always a Node; casting from
// EventTarget to Node is required to call Node.contains().
declare const containerEl: HTMLElement;
export function isClickInsideContainer(event: MouseEvent): boolean {
  return containerEl.contains(event.target as Node);
}
export function isTouchInsideContainer(event: TouchEvent): boolean {
  return containerEl.contains(event.target as Node | null);
}

// Mode: react-context-and-accumulator-placeholder
// `{} as T` / `[] as T[]` placeholders consumed by createContext or reduce
// seeds where TypeScript cannot infer the accumulator type.
type FormFieldContextValue = { name: string; error?: string };
declare function createContext<T>(value: T): { Provider: unknown; current: T };
export const FormFieldContext = createContext({} as FormFieldContextValue);

type FormItemContextValue = { id: string };
export const FormItemContext = createContext({} as FormItemContextValue);

type LanguageCode = 'en' | 'fr' | 'de';
type I18nInstance = { code: LanguageCode; messages: Record<string, string> };
type AllI18nInstances = Record<LanguageCode, I18nInstance>;
declare const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[];
declare function loadInstance(code: LanguageCode): I18nInstance;
export const allInstances = SUPPORTED_LANGUAGE_CODES.reduce((acc, code) => {
  acc[code] = loadInstance(code);
  return acc;
}, {} as AllI18nInstances);

// Mode: function-object-property-memoization
// Widening a function value to an intersection with an optional typed
// property is the canonical pattern for caching state on the function ref.
function measureScale(text: string): number {
  const cached = measureScale as typeof measureScale & {
    canvas?: HTMLCanvasElement;
  };
  if (!cached.canvas) {
    cached.canvas = document.createElement('canvas');
  }
  const ctx = cached.canvas.getContext('2d');
  return ctx ? ctx.measureText(text).width : 0;
}
export const measuredWidth = measureScale('hello');

// Mode: structurally-guaranteed-safe-cast
// (a) Template-literal-typed input where the suffix is statically known.
type WindowUnit = 's' | 'm' | 'h' | 'd';
type WindowStr = `${number}${WindowUnit}`;
export function parseWindowUnit(window: WindowStr): WindowUnit {
  return window.charAt(window.length - 1) as WindowUnit;
}

// (b) JSON round-trip deep clone — input is structurally JSON-safe.
type GroupOption = { label: string; values: string[] };
declare const groupOption: GroupOption;
export const clonedGroup = JSON.parse(JSON.stringify(groupOption)) as GroupOption;

// (c) Browser-injected global accessed via `window as unknown as {...}`.
declare const Konva: { version: string };
export function readKonvaVersion(): string {
  return (window as unknown as { Konva: typeof Konva }).Konva.version;
}



// FP shapes for bugs/deterministic/use-before-define
//
// shape-1b75022faf19: A type alias on an earlier line references `typeof` of a
// const defined later in the same module. The `typeof` here is the
// type-level operator, so there is no runtime forward reference.
export type TConfigureEmbedFormSchema = {
  url: (typeof ZConfigureEmbedFormSchema)['_inputShape']['url'];
  signature: (typeof ZConfigureEmbedFormSchema)['_inputShape']['signature'];
};

export const ZConfigureEmbedFormSchema = {
  _inputShape: {
    url: '' as string,
    signature: false as boolean,
  },
};

// shape-b2eeaf6f2ed8: A top-of-file `declare const` (the in-module analogue of
// an `import type`) is used later via `typeof`. The declaration precedes the
// usage textually — no use-before-define occurs.
declare const TemplateTypePrisma: {
  readonly PUBLIC: 'PUBLIC';
  readonly PRIVATE: 'PRIVATE';
};

export type TemplateTypePrismaValue = (typeof TemplateTypePrisma)[keyof typeof TemplateTypePrisma];

export function describeTemplateType(value: TemplateTypePrismaValue): string {
  if (value === TemplateTypePrisma.PUBLIC) {
    return 'public';
  }
  return 'private';
}

// shape-948e641d1dcd: Aliased declarations at the top of the module (the
// in-module analogue of aliased ES module imports) are referenced only by
// later function bodies. The aliases are defined before any use.
declare const bcryptCompareSync: (plain: string, hashed: string) => boolean;
declare const bcryptHashSync: (plain: string, rounds: number) => string;

export function verifyPassword(plain: string, hashed: string): boolean {
  return bcryptCompareSync(plain, hashed);
}

export function makePasswordHash(plain: string): string {
  return bcryptHashSync(plain, 12);
}



/*
 * Duplicate string literals that should NOT trigger duplicate-string.
 *
 * Several real-world patterns from a Remix codebase repeat the same string
 * literal three or more times in a single file by design:
 *   - HTTP protocol vocabulary thrown from independent route loaders
 *   - URL search-param names read by parallel route handlers
 *   - Discriminated-union literals constructed in each loader return
 *   - Within-file structural design tokens (font weights, method literals)
 * Each occurrence is owned by its own entry point or carries type-narrowing
 * meaning, so extracting a shared constant would add coupling with no value.
 */

declare const jsonResponse: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => Response;
declare const readSearchParam: (key: string) => string | null;
declare const renderHeader: (text: string, style: string) => string;

type InviteResult =
  | { kind: 'Success'; token: string }
  | { kind: 'InvalidLink'; reason: string };

// protocol-api-vocabulary: standard HTTP 404 thrown from each independent loader.
export async function loaderSignIndex(): Promise<Response> {
  const ok = Math.random() > 0.5;
  if (!ok) throw jsonResponse({ message: 'Document not found' }, { status: 404 });
  return jsonResponse({ ok: true });
}
export async function loaderSignComplete(): Promise<Response> {
  const ok = Math.random() > 0.5;
  if (!ok) throw jsonResponse({ message: 'Document not found' }, { status: 404 });
  return jsonResponse({ done: true });
}
export async function loaderSignExpired(): Promise<Response> {
  const ok = Math.random() > 0.5;
  if (!ok) throw jsonResponse({ message: 'Document not found' }, { status: 404 });
  return jsonResponse({ expired: true });
}

// parallel-independent-call-sites: the URL search-param name 'query' is
// read by three independent admin route handlers; each is a standalone
// entry point so sharing a constant would only add coupling.
export function loaderAdminClaims(): { query: string } {
  const a = readSearchParam('query') ?? '';
  const b = readSearchParam('query') ?? '';
  const c = readSearchParam('query') ?? '';
  return { query: (a || b || c).trim() };
}
export function loaderAdminOrganisations(): { query: string } {
  const raw = readSearchParam('query') ?? '';
  return { query: raw.toLowerCase() };
}
export function loaderAdminMembers(): { query: string } {
  const raw = readSearchParam('query') ?? '';
  return { query: raw };
}

// type-system-discriminant: 'InvalidLink' is a discriminated-union literal
// constructed by three independent loaders to satisfy TypeScript narrowing.
export function loaderDeclineToken(token: string): InviteResult {
  if (!token) return { kind: 'InvalidLink', reason: 'missing token' };
  return { kind: 'Success', token };
}
export function loaderInviteToken(token: string): InviteResult {
  if (token.length < 8) return { kind: 'InvalidLink', reason: 'short token' };
  return { kind: 'Success', token };
}
export function loaderVerifyEmailToken(token: string): InviteResult {
  if (!/^[a-z0-9]+$/u.test(token)) return { kind: 'InvalidLink', reason: 'bad token' };
  return { kind: 'Success', token };
}

// within-file-structural-repetition: font config entries each use 'normal'
// style with a different weight; distinct objects, no shared constant.
export const fontConfig = [
  { name: 'Inter', weight: 400, style: 'normal' as const },
  { name: 'Inter', weight: 600, style: 'normal' as const },
  { name: 'Inter', weight: 700, style: 'normal' as const },
];

export function renderTitles(): readonly string[] {
  return [
    renderHeader(fontConfig[0]!.name, 'normal'),
    renderHeader(fontConfig[1]!.name, 'normal'),
    renderHeader(fontConfig[2]!.name, 'normal'),
  ];
}

// single-usage-false-trigger: the 'method-confirm' literal is local to this
// dialog file only; rule sees three within-file copies but no real duplication
// across the project.
export function useDisableDialog(): { step: string; advance: () => string; reset: () => string } {
  let step: 'method-confirm' | 'method-confirm-ack' | 'method-confirm-done' = 'method-confirm';
  return {
    step,
    advance: () => {
      if (step === 'method-confirm') {
        step = 'method-confirm-ack';
        return 'method-confirm';
      }
      return step;
    },
    reset: () => {
      step = 'method-confirm';
      return 'method-confirm';
    },
  };
}



// MDX components adapter — return type is intentionally `any` to satisfy
// the MDX types API surface, which uses an open intrinsic-component map.
// This is a docs-only adapter; no real type-safety hazard.
type MDXComponents = Record<string, unknown>;
declare const baseMdxComponents: MDXComponents;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMDXComponents(components?: MDXComponents): any {
  return {
    ...baseMdxComponents,
    ...components,
  };
}



// Array<T> with an intersection element type is NOT redundant — the element type
// is not a default, so the type argument must be retained. The
// redundant-type-argument rule must not flag these usages.
declare const recipientFields: Array<{ id: string; type: 'signature' } & { signature: { value: string } | null }>;
declare const auditedRows: Array<{ userId: string; ts: number } & { reason: string | null }>;

export function countSignedFields(): number {
  return recipientFields.filter((field) => field.signature !== null).length;
}

export function describeAuditRows(): string[] {
  return auditedRows.map((row) => `${row.userId}@${row.ts}:${row.reason ?? 'n/a'}`);
}




// Positive case for code-quality/deterministic/type-import-side-effects
// All specifiers are inline `type` with no value import — module is still loaded
// at runtime and may trigger side effects. Should be `import type { ... }`.
import { type ComponentType, type ReactNode } from 'react';

export type RenderProp = (node: ComponentType<unknown>) => ReactNode;



// =============================================================================
// Mode: generic-wrapper-threading
// T threads a caller-supplied type through a wrapper (Promise.race, polyfill,
// library response). Without T the result widens to unknown and the contract
// with callers is lost.
// =============================================================================

interface ClientResponse<T> {
  readonly ok: boolean;
  readonly data: T;
  readonly status: number;
}

// withTimeout<T> threads the inner Promise<T> through Promise.race so the
// caller's awaited value type is preserved. Without T the race result is
// typed as unknown.
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Polyfill for Promise.withResolvers<T> — callers pass T explicitly to get a
// typed resolve function matching the native signature.
export function promiseWithResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// handleError<T>(response: ClientResponse<T>) — T must match the response's
// generic; dropping it widens ClientResponse to ClientResponse<unknown>.
export async function handleError<T>(response: ClientResponse<T>): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.data;
}

// =============================================================================
// Mode: library-framework-contract
// Type parameters are required to satisfy an external library's generic
// interface (TanStack Table, react-hook-form). The library's types pin the
// arity; removing the generics breaks the contract at the call site.
// =============================================================================

interface ColumnDef<TData, TValue> {
  readonly accessorKey?: keyof TData;
  readonly header: string;
  readonly cell?: (info: { readonly getValue: () => TValue }) => unknown;
}

interface Table<TData> {
  readonly rows: ReadonlyArray<{ readonly original: TData }>;
  getPageCount(): number;
  setPageIndex(index: number): void;
}

interface ControllerProps<TFieldValues, TName extends string> {
  readonly name: TName;
  readonly control: { readonly _formValues: TFieldValues };
  readonly render: (field: { readonly value: unknown; readonly onChange: (v: unknown) => void }) => unknown;
}

declare const useReactTable: <TData>(opts: {
  data: readonly TData[];
  columns: ReadonlyArray<ColumnDef<TData, unknown>>;
}) => Table<TData>;

declare const Controller: <TFieldValues, TName extends string>(
  props: ControllerProps<TFieldValues, TName>,
) => unknown;

// DataTable<TData, TValue>: both generics are required by TanStack Table's
// ColumnDef<TData, TValue> — TS cannot infer them from the call signature.
export function DataTable<TData, TValue>(props: {
  readonly columns: ReadonlyArray<ColumnDef<TData, TValue>>;
  readonly data: readonly TData[];
}): { readonly table: Table<TData> } {
  const table = useReactTable<TData>({
    data: props.data,
    columns: props.columns as unknown as ReadonlyArray<ColumnDef<TData, unknown>>,
  });
  return { table };
}

// DataTablePagination<TData>: wraps TanStack Table's Table<TData>; TData is
// required to pass the typed table through. Inference fails at the component
// definition level.
export function DataTablePagination<TData>(props: { readonly table: Table<TData> }): number {
  props.table.setPageIndex(0);
  return props.table.getPageCount();
}

// FormField<TFieldValues, TName>: mirrors react-hook-form's Controller
// generic signature. Both parameters are required to type the field name
// and form values; neither is inferable from the JSX-style call.
export function FormField<TFieldValues, TName extends string>(
  props: ControllerProps<TFieldValues, TName>,
): unknown {
  return Controller<TFieldValues, TName>(props);
}

// =============================================================================
// Mode: abstract-interface-contract
// Type parameters appear on an abstract method whose concrete implementations
// declare the same shape. Removing the generics from the base method breaks
// the override contract for sibling subclasses.
// =============================================================================

interface JobDefinitionGeneric<N extends string, T> {
  readonly name: N;
  readonly handler: (payload: T) => Promise<void>;
}

export abstract class BaseJobClient {
  protected readonly _jobDefinitions = new Map<string, JobDefinitionGeneric<string, unknown>>();

  // Abstract base method — the generics N and T mirror the contract
  // implemented by BullMqJobClient and LocalJobClient below. Removing them
  // from the base signature would make the concrete overrides incompatible.
  defineJob<N extends string, T>(_def: JobDefinitionGeneric<N, T>): void {
    throw new Error('defineJob must be implemented by the concrete provider');
  }
}

export class BullMqJobClient extends BaseJobClient {
  // defineJob<N extends string, T> uses N to key the registry and T to
  // constrain the payload; both are essential to the contract.
  override defineJob<N extends string, T>(def: JobDefinitionGeneric<N, T>): void {
    this._jobDefinitions.set(def.name, def as JobDefinitionGeneric<string, unknown>);
  }
}

export class LocalJobClient extends BaseJobClient {
  override defineJob<N extends string, T>(def: JobDefinitionGeneric<N, T>): void {
    this._jobDefinitions.set(def.name, def as JobDefinitionGeneric<string, unknown>);
  }
}

// =============================================================================
// Mode: constrained-subtype-preservation
// T extends BaseType preserves the caller's precise subtype as the return,
// avoiding widening to the base shape.
// =============================================================================

interface EnvelopeWithRecipients {
  readonly id: string;
  readonly recipients: ReadonlyArray<{ readonly email: string; readonly token: string }>;
}

// findRecipientByEmail<T extends {email: string}> — callers get back their
// specific recipient subtype, not the base shape. Removing T loses the
// precise return type.
export function findRecipientByEmail<T extends { readonly email: string }>(
  recipients: readonly T[],
  email: string,
): T | undefined {
  return recipients.find((r) => r.email === email);
}

// maskRecipientTokens<T extends EnvelopeWithRecipients> preserves the
// caller's specific envelope subtype on the return path.
export function maskRecipientTokens<T extends EnvelopeWithRecipients>(envelope: T): T {
  const masked = {
    ...envelope,
    recipients: envelope.recipients.map((r) => ({ ...r, token: '****' })),
  };
  return masked as T;
}

// Default-type-parameter pattern (MultiSelectCombobox-style): T defaults to
// the base option-value type but callers can override with a more specific
// type. Removing T loses that flexibility.
type OptionValue = string | number;

export function multiSelectCombobox<T extends OptionValue = OptionValue>(props: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly selected: readonly T[];
  readonly onChange: (next: readonly T[]) => void;
}): readonly T[] {
  return props.selected;
}

// =============================================================================
// Mode: conditional-discriminated-extraction
// Multi-step or conditional generics narrow a discriminated union so callers
// receive the correctly-typed variant rather than the full union.
// =============================================================================

type SiteSettingSchema =
  | { readonly id: 'site.title'; readonly value: string }
  | { readonly id: 'site.maxUsers'; readonly value: number }
  | { readonly id: 'site.enabled'; readonly value: boolean };

type ExtractSetting<T extends SiteSettingSchema['id']> = Extract<SiteSettingSchema, { readonly id: T }>;

declare const siteSettingsTable: {
  findFirst<U extends SiteSettingSchema>(args: { readonly where: { readonly id: U['id'] } }): Promise<U | null>;
};

// getSiteSetting uses a multi-step conditional generic: T narrows the union
// on SiteSettingSchema['id'], and U = ExtractSetting<T> extracts the
// matching schema variant. Both params are essential — TS cannot infer U
// without T being explicit.
export async function getSiteSetting<
  T extends SiteSettingSchema['id'],
  U extends ExtractSetting<T> = ExtractSetting<T>,
>(id: T): Promise<U | null> {
  const row = await siteSettingsTable.findFirst<U>({ where: { id: id as U['id'] } });
  return row;
}

type DocumentAuditLog =
  | { readonly type: 'created'; readonly data: { readonly documentId: string } }
  | { readonly type: 'signed'; readonly data: { readonly documentId: string; readonly signerEmail: string } }
  | { readonly type: 'deleted'; readonly data: { readonly documentId: string; readonly reason: string } };

type ExtractAuditData<T extends DocumentAuditLog['type']> = Extract<DocumentAuditLog, { readonly type: T }>['data'];

// formatAuditLog<T extends DocumentAuditLog['type']>: T narrows the
// discriminated union so callers receive the correctly-typed data shape for
// the specific audit log variant. Removing T widens the return to the
// union of all data shapes.
export function formatAuditLog<T extends DocumentAuditLog['type']>(
  type: T,
  data: ExtractAuditData<T>,
): { readonly type: T; readonly data: ExtractAuditData<T> } {
  return { type, data };
}



// ---------------------------------------------------------------------------
// FP mode: prisma-json-namespace-augmentation
// Aliases inside `declare global { namespace PrismaJson { } }` are required by
// prisma-json-types-generator to bind JSON column types; they are not stylistic
// renames and must not be flagged as redundant.
// ---------------------------------------------------------------------------

declare const __recipientAuthOptionsShape: {
  accessAuth?: ReadonlyArray<'ACCOUNT' | 'PASSKEY' | 'TWO_FACTOR_AUTH'>;
  actionAuth?: ReadonlyArray<'ACCOUNT' | 'PASSKEY' | 'TWO_FACTOR_AUTH'>;
};

declare const __claimFlagsShape: {
  unlimitedDocuments?: boolean;
  allowCustomBranding?: boolean;
  hidePoweredBy?: boolean;
};

declare const __defaultRecipientShape: {
  name: string;
  email: string;
  role: 'SIGNER' | 'APPROVER' | 'CC' | 'VIEWER';
};

type RecipientAuthOptionsBase = typeof __recipientAuthOptionsShape;
type ClaimFlagsBase = typeof __claimFlagsShape;
type DefaultRecipientBase = typeof __defaultRecipientShape;

declare global {
  namespace PrismaJson {
    // These aliases bind Prisma JSON columns to typed shapes via the
    // prisma-json-types-generator package. Each line is required for the
    // generated client to type the corresponding @db.Json column.
    type RecipientAuthOptions = RecipientAuthOptionsBase;
    type ClaimFlags = ClaimFlagsBase;
    type DefaultRecipient = DefaultRecipientBase;
    type DocumentAuthOptions = RecipientAuthOptionsBase;
    type TeamGlobalSettingsBranding = ClaimFlagsBase;
  }
}

// ---------------------------------------------------------------------------
// FP mode: exported-stable-public-api-alias
// Exported aliases that rename an internal/library type to a stable public
// API name decouple consumers from the implementation type. Removing them
// breaks the public contract.
// ---------------------------------------------------------------------------

interface BrandingContextValue {
  brandingEnabled: boolean;
  brandingLogo: string;
  brandingUrl: string;
  brandingCompanyDetails: string;
  brandingHidePoweredBy: boolean;
}

// Public API alias — consumers import `BrandingSettings`, not the internal name.
export type BrandingSettings = BrandingContextValue;

interface DocumentSelfSignedTemplatePropsInternal {
  documentName: string;
  assetBaseUrl: string;
  recipientName: string;
}

// Public component prop type exposed under a component-scoped name.
export type DocumentSelfSignedTemplateProps = DocumentSelfSignedTemplatePropsInternal;

interface SelectPrimitivePropsLike {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

// Component-specific prop type aliasing a generic library prop type — stable
// public name for the component's external API.
export type TemplateTypeSelectProps = SelectPrimitivePropsLike;

// Ensure the exported aliases are referenced so they aren't tree-shaken.
declare const __brandingSettings: BrandingSettings;
declare const __documentSelfSignedTemplateProps: DocumentSelfSignedTemplateProps;
declare const __templateTypeSelectProps: TemplateTypeSelectProps;
export const __redundantTypeAliasFixtureRefs = {
  branding: __brandingSettings,
  selfSigned: __documentSelfSignedTemplateProps,
  templateType: __templateTypeSelectProps,
};



// ---------------------------------------------------------------------------
// FP shape-0945381ef50a: double cast `value as unknown as string` is required
// to widen an enum-typed value so Array.prototype.includes() (typed against the
// enum element type) accepts a plain string list. The double cast is not
// redundant — it intentionally erases the enum nominal type.
// Source: apps/remix/app/components/general/template/template-page-view-documents-table.tsx
// ---------------------------------------------------------------------------
enum DocumentStatusEnumFP1 {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

enum DocumentSourceFP1 {
  DOCUMENT = 'DOCUMENT',
  TEMPLATE = 'TEMPLATE',
  TEMPLATE_DIRECT_LINK = 'TEMPLATE_DIRECT_LINK',
}

declare const allowedStatusesFP1: string[];
declare const allowedSourcesFP1: string[];
declare const statusValueFP1: DocumentStatusEnumFP1;
declare const sourceValueFP1: DocumentSourceFP1;

export const statusIncludedFP1 = allowedStatusesFP1.includes(
  statusValueFP1 as unknown as string,
);

export const sourceIncludedFP1 = allowedSourcesFP1.includes(
  sourceValueFP1 as unknown as string,
);

// ---------------------------------------------------------------------------
// FP shape-4852106044dd: rendering an `unknown` value in JSX requires casting
// to string. `Object.entries()` on a `z.unknown().nullable()` field yields
// `[string, unknown][]`, so the `value as string` cast is necessary for JSX
// to accept it. The assertion is not redundant.
// Source: apps/remix/app/components/general/webhook-logs-sheet.tsx
// ---------------------------------------------------------------------------
declare const responseHeadersFP2: Record<string, unknown> | null;

export function renderWebhookHeadersFP2(): Array<{ key: string; value: string }> {
  if (!responseHeadersFP2) return [];
  return Object.entries(responseHeadersFP2).map(([key, value]) => ({
    key,
    value: value as string,
  }));
}
