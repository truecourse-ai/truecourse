/**
 * Callback patterns that should NOT trigger any rules.
 *
 * Arrow functions in find and map that USE their parameter.
 * Shorthand properties in return statements.
 * Proper use of array methods with concise callbacks.
 */

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

interface PaginationOptions {
  limit: number;
  offset: number;
}

export function findUserById(users: readonly User[], id: string): User | undefined {
  return users.find((user) => user.id === id);
}

export function findActiveUser(users: readonly User[]): User | undefined {
  return users.find((user) => user.active && user.name.length >= 0);
}

export function getUserNames(users: readonly User[]): string[] {
  return users.map((user) => user.name);
}

export function getUserEmails(users: readonly User[]): string[] {
  return users.map((user) => user.email.toLowerCase());
}

export function getActiveUsers(users: readonly User[]): User[] {
  return users.filter((user) => user.active && user.id.length > 0);
}

export function hasActiveUsers(users: readonly User[]): boolean {
  return users.some((user) => user.active);
}

export function allUsersActive(users: readonly User[]): boolean {
  return users.every((item) => item.active);
}

export function createPagination(page: number, pageSize: number): PaginationOptions {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  return { limit, offset };
}

export function getActiveUserIds(users: readonly User[]): string[] {
  return users
    .filter((user) => user.active && user.name.length > 0)
    .map((user) => user.id);
}

export function groupByActive(users: readonly User[]): { active: User[]; inactive: User[] } {
  return users.reduce<{ active: User[]; inactive: User[] }>(
    (groups, user) => {
      if (user.active) {
        groups.active.push(user);
      } else {
        groups.inactive.push(user);
      }
      return groups;
    },
    { active: [], inactive: [] },
  );
}

export function sortByName(users: readonly User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}


// async callback in Promise.all(.map()) — side-effectful, result discarded.
// Implicit Promise<void> is intentional; no explicit return needed.
interface SeedField {
  readonly id: string;
  readonly type: string;
  readonly page: number;
}

declare const prismaField: {
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
};

export async function seedAlignmentFields(fields: readonly SeedField[]): Promise<void> {
  await Promise.all(
    fields.map(async (field) => {
      await prismaField.create({
        data: {
          id: field.id,
          type: field.type,
          page: field.page,
        },
      });
    }),
  );
}

// async callback in Promise.all(.map()) with an early `return;` guard.
// Main path performs a side effect; implicit Promise<void> on both paths is correct.
interface ReminderRecipient {
  readonly id: string;
  readonly email: string;
  readonly signed: boolean;
}

declare const mailer: {
  sendReminder: (recipientId: string, email: string) => Promise<void>;
};

export async function notifyPendingRecipients(recipients: readonly ReminderRecipient[]): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) => {
      if (recipient.signed) {
        return;
      }
      await mailer.sendReminder(recipient.id, recipient.email);
    }),
  );
}

// async callback in .map() fed to Promise.allSettled().
// async always produces a Promise, so allSettled receives valid promises
// regardless of whether the body explicitly returns a value.
interface WebhookRow {
  readonly id: string;
  readonly url: string;
}

declare const jobs: {
  triggerJob: (args: { name: string; payload: Record<string, unknown> }) => Promise<void>;
};

export async function dispatchWebhooks(webhooks: readonly WebhookRow[]): Promise<void> {
  await Promise.allSettled(
    webhooks.map(async (webhook) => {
      await jobs.triggerJob({
        name: 'internal.execute-webhook',
        payload: { webhookId: webhook.id, url: webhook.url },
      });
    }),
  );
}



// --- positive cases for bugs/deterministic/array-callback-return ---

declare const seedFields: ReadonlyArray<{ id: string; label: string }>;
declare const upsertField: (field: { id: string; label: string }) => Promise<void>;

export async function seedAllFields(): Promise<void> {
  await Promise.all(
    seedFields.map(async (field) => {
      await upsertField(field);
    }),
  );
}

interface ReminderRecipient {
  id: string;
  email: string;
  isCc: boolean;
  sentAt: Date | null;
}

declare const reminderRecipients: ReadonlyArray<ReminderRecipient>;
declare const sendReminderEmail: (recipient: ReminderRecipient) => Promise<void>;
declare const isValidEmail: (email: string) => boolean;

export async function resendReminders(): Promise<void> {
  await Promise.all(
    reminderRecipients.map(async (recipient) => {
      if (recipient.isCc) return;
      if (!isValidEmail(recipient.email)) return;
      await sendReminderEmail(recipient);
    }),
  );
}

declare const expiringRecipientIds: ReadonlyArray<string>;
declare const triggerExpireJob: (recipientId: string) => Promise<void>;

export async function fanOutExpireJobs(): Promise<void> {
  await Promise.allSettled(
    expiringRecipientIds.map(async (recipientId) => {
      await triggerExpireJob(recipientId);
    }),
  );
}



// FP: async event handler — try returns a promise-returning call, catch implicitly
// returns undefined. The return value is never consumed by React's onClick contract,
// so the mixed return is intentional.
declare const authClient: { signOut: () => Promise<void> };
declare const deleteAccount: () => Promise<void>;
declare const toast: (msg: string) => void;

export const useAccountDeleteHandler = () => {
  const onDeleteAccount = async () => {
    try {
      await deleteAccount();
      return authClient.signOut();
    } catch {
      toast('Failed to delete account');
    }
  };
  return onDeleteAccount;
};

// FP: Hono-style middleware idiom. `return next()` and `return c.redirect()` are
// control-flow early-exits; the trailing bare `return;` follows a side-effect after
// awaiting next(). The declared return type is Promise<void>, so no real value
// inconsistency exists — the rule fires on surface syntax rather than semantics.
interface HonoContext {
  req: { path: string; header: (name: string) => string | undefined };
  redirect: (url: string) => void;
  res: { headers: Headers };
}
declare const setCookie: (c: HonoContext, name: string, value: string) => void;

export const authMiddleware = async (
  c: HonoContext,
  next: () => Promise<void>,
): Promise<void> => {
  if (c.req.path.startsWith('/public')) {
    return next();
  }

  const token = c.req.header('authorization');
  if (!token) {
    return c.redirect('/login');
  }

  await next();
  setCookie(c, 'last-seen', new Date().toISOString());
  return;
};

// FP: nodemailer-style callback transport. `return callback(err)` is an idiomatic
// early-exit guard; the void-returning send method has no meaningful return value,
// so no caller observes the inconsistency.
interface MailEnvelope {
  from: string;
  to: string[];
}
interface MailMessageStream {
  pipe: (target: unknown) => void;
}
interface MailInfo {
  data: { envelope: MailEnvelope; message: MailMessageStream };
}
type SendCallback = (err: Error | null, info?: { messageId: string }) => void;

declare const streamToString: (s: MailMessageStream) => Promise<string>;
declare const httpPost: (
  url: string,
  body: string,
) => Promise<{ ok: boolean; messageId: string }>;

export const mailchannelsTransport = {
  name: 'MailChannels',
  version: '1.0.0',
  send(mail: MailInfo, callback: SendCallback): void {
    const { envelope, message } = mail.data;

    if (!envelope.to || envelope.to.length === 0) {
      return callback(new Error('No recipients'));
    }

    streamToString(message)
      .then((raw) => httpPost('https://api.mailchannels.net/tx/v1/send', raw))
      .then((res) => {
        if (!res.ok) {
          return callback(new Error('MailChannels rejected message'));
        }
        callback(null, { messageId: res.messageId });
      })
      .catch((err: Error) => callback(err));
  },
};



// --- unassigned-variable: closure variables shared across event handlers ---
// x1/y1/x2/y2 are declared without initializers so the mousedown/mousemove/mouseup
// handlers can read and write them via closure. mousedown always assigns before
// mousemove/mouseup read, and the readers guard with a visibility check.
interface SelectionRectangle {
  visible(): boolean;
  setAttrs(attrs: { x: number; y: number; width: number; height: number }): void;
}

declare const selectionRectangle: SelectionRectangle;
declare const stage: {
  on(event: 'mousedown' | 'mousemove' | 'mouseup', handler: (e: { evt: { button: number } }) => void): void;
  getPointerPosition(): { x: number; y: number } | null;
};

export function attachDragSelection(): void {
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;

  stage.on('mousedown', (e) => {
    if (e.evt.button !== 0) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    x1 = pos.x;
    y1 = pos.y;
    x2 = pos.x;
    y2 = pos.y;
    selectionRectangle.setAttrs({ x: x1, y: y1, width: 0, height: 0 });
  });

  stage.on('mousemove', () => {
    if (!selectionRectangle.visible()) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    x2 = pos.x;
    y2 = pos.y;
    selectionRectangle.setAttrs({
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    });
  });

  stage.on('mouseup', () => {
    if (!selectionRectangle.visible()) return;
    const bounds = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    void bounds;
  });
}

// --- unassigned-variable: definite-assignment-asserted resolve/reject (Promise.withResolvers polyfill) ---
// `let resolve!: ...` / `let reject!: ...` use TypeScript's definite-assignment
// assertion. They ARE assigned synchronously inside the Promise constructor
// before the function returns, so reads via the returned object are safe.
export interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- unassigned-variable: closure-backed getter/setter store (mock ServerResponse adapter) ---
// `let statusCode: number` is intentionally uninitialized; it backs a getter/setter
// pair on a mock response object. The setter runs before `end()` reads the value
// in the standard Node HTTP handler lifecycle.
interface MockServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): { status: number; body: string };
}

export function createMockResponse(): MockServerResponse {
  let statusCode: number;
  const headers: Record<string, string> = {};
  let body = '';

  return {
    get statusCode(): number {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    end(payload?: string): { status: number; body: string } {
      if (payload !== undefined) body = payload;
      return { status: statusCode, body };
    },
  };
}



// Top-level client entry idiom: an async main() is invoked at module scope as the
// standard browser bootstrap. The floating-promise lint is explicitly suppressed
// on the preceding line because there is no caller to propagate rejections to.
declare const hydrateRoot: (container: Element, children: unknown) => void;
declare const rootElement: Element;

async function bootstrapClient(): Promise<void> {
  hydrateRoot(rootElement, null);
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrapClient();

// Promise.withResolvers polyfill: `resolve = res` and `reject = rej` inside the
// executor are plain variable assignments (not promise expressions). The created
// promise is properly returned to the caller as part of the {promise, resolve,
// reject} triple, so nothing is left unhandled.
interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function promiseWithResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Autosave hook pattern: a single in-flight save promise is parked on a ref so
// that an external flush() can await the same promise. The ref assignment is
// immediately awaited on the next line inside try/finally, so the promise is
// always handled.
declare const pendingPromiseRef: { current: Promise<void> | null };
declare function saveFn(args: { id: string }): Promise<void>;

export async function runAutosave(args: { id: string }): Promise<void> {
  try {
    pendingPromiseRef.current = saveFn(args);
    await pendingPromiseRef.current;
  } finally {
    pendingPromiseRef.current = null;
  }
}



/**
 * Patterns that should NOT trigger deep-callback-nesting.
 *
 * - Nested map() callbacks that only build flat object literals (data adapter).
 * - ts-pattern match().with().otherwise() arms that read like callback nesting.
 * - Kysely query-builder DSL where().where(({or, eb}) => ...) nesting is API-mandated.
 * - Arrow functions as properties on a config object literal (Kysely dialect).
 * - API-mandated single-callback shapes (Zod .refine, Clipboard fetch().then,
 *   form.handleSubmit) wrapping otherwise-flat array transforms.
 */

interface RecipientField {
  id: string;
  page: number;
  pageNumber: number;
  type: string;
  label: string;
  customText: string;
}

interface Recipient {
  id: string;
  email: string;
  name: string;
  fields: readonly RecipientField[];
}

interface AvailableRecipient {
  email: string;
  id: string;
}

interface RecipientUpdateInput {
  email: string;
  name: string;
  fields: readonly RecipientField[];
}

// Mode: flat-array-transform-callbacks
// Two-level nested .map() where both callbacks return flat object literals
// and an availableRecipients.find() with a single-expression email predicate.
export function normalizeRecipients(
  recipients: readonly Recipient[],
  availableRecipients: readonly AvailableRecipient[],
): readonly RecipientUpdateInput[] {
  return recipients.map((recipient) => ({
    email: recipient.email,
    name: recipient.name,
    id: availableRecipients.find((available) => available.email === recipient.email)?.id,
    fields: (recipient.fields || []).map((field) => ({
      ...field,
      page: field.pageNumber,
      pageNumber: field.page,
      label: field.label,
    })),
  }));
}

// Mode: ts-pattern-match-arms
// match().with().with().otherwise() chain whose arms are flat single-expression
// returns. Arms are pattern-match branches, not callback nesting.
declare const match: <T>(value: T) => MatchChain<T, never>;
interface MatchChain<T, R> {
  with<P extends T, U>(pattern: P, handler: (value: P) => U): MatchChain<T, R | U>;
  otherwise<U>(handler: (value: T) => U): R | U;
}

interface FieldMetaResult {
  type: string;
  data: string;
}

export function parseFieldMeta(
  type: 'DROPDOWN' | 'RADIO' | 'CHECKBOX' | 'TEXT',
  field: RecipientField,
): FieldMetaResult {
  return match(type)
    .with('DROPDOWN', () => ({ type: 'DROPDOWN', data: field.label }))
    .with('RADIO', () => ({ type: 'RADIO', data: field.label }))
    .with('CHECKBOX', () => ({ type: 'CHECKBOX', data: field.label }))
    .otherwise((selector) => ({ type: selector, data: field.customText }));
}

// Mode: query-builder-dsl-nesting
// Kysely-style .where(({or, eb}) => ...).where(({or: innerOr, eb: innerEb}) => ...)
// where the inner callback shape is mandated by the API design.
interface KyselyExpressionBuilder {
  or(conditions: readonly KyselyExpression[]): KyselyExpression;
  and(conditions: readonly KyselyExpression[]): KyselyExpression;
  eb<C extends string>(column: C, op: string, value: string): KyselyExpression;
}
interface KyselyExpression {
  readonly __brand: 'kysely-expr';
}
interface KyselyQuery {
  where(cb: (eb: KyselyExpressionBuilder) => KyselyExpression): KyselyQuery;
  execute(): Promise<readonly Recipient[]>;
}

declare const documentQuery: KyselyQuery;

export function searchDocuments(searchPattern: string): Promise<readonly Recipient[]> {
  return documentQuery
    .where(({ or, eb }) =>
      or([
        eb('Document.title', 'ilike', searchPattern),
        eb('Document.externalId', 'ilike', searchPattern),
      ]),
    )
    .where(({ or: innerOr, eb: innerEb }) =>
      innerOr([
        innerEb('Recipient.email', 'ilike', searchPattern),
        innerEb('Recipient.name', 'ilike', searchPattern),
      ]),
    )
    .execute();
}

// Mode: object-literal-config-arrow-properties
// Kysely dialect config: arrow functions assigned as object-literal properties.
class PostgresAdapter {}
class PostgresIntrospector {
  constructor(public db: KyselyDatabase) {}
}
class PostgresQueryCompiler {}
interface KyselyDatabase {
  readonly __brand: 'kysely-db';
}
interface KyselyDriver {
  init(): Promise<void>;
}

declare const driver: KyselyDriver;

export const kyselyDialectConfig = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => driver,
  createIntrospector: (db: KyselyDatabase) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
};

// Mode: api-mandated-async-protocol-nesting
// Zod .refine() single-callback predicate + Clipboard API ClipboardItem value
// shape (fetch().then(async (res) => ...)) + form.handleSubmit wrapping a
// .map().filter() chain. All API-mandated single-callback shapes.
interface ZodString {
  refine(predicate: (value: string) => boolean, message: string): ZodString;
}
declare const zEmail: () => { safeParse: (value: string) => { success: boolean } };
declare const zString: () => ZodString;
declare const isTemplateRecipientEmailPlaceholder: (email: string) => boolean;

export const recipientEmailSchema = zString().refine(
  (email) => isTemplateRecipientEmailPlaceholder(email) || zEmail().safeParse(email).success,
  'Email must be valid or a template placeholder',
);

interface ClipboardItemInit {
  [mimeType: string]: Promise<string> | string;
}
declare class ClipboardItemCtor {
  constructor(items: ClipboardItemInit);
}
interface NavigatorClipboard {
  write(items: readonly ClipboardItemCtor[]): Promise<void>;
}
declare const navigatorClipboard: NavigatorClipboard;
declare const cache: Map<string, string>;

export async function copyMarkdownToClipboard(markdownUrl: string): Promise<void> {
  await navigatorClipboard.write([
    new ClipboardItemCtor({
      'text/plain': fetch(markdownUrl).then(async (res) => {
        const content = await res.text();
        cache.set(markdownUrl, content);
        return content;
      }),
    }),
  ]);
}

interface CheckboxFormValues {
  values: readonly { checked: boolean; label: string }[];
}
interface FormHandler {
  handleSubmit(
    onValid: (data: CheckboxFormValues) => void,
  ): (event: SubmitEvent) => void;
}
interface CallApi {
  end(value: readonly number[]): void;
}

declare const form: FormHandler;
declare const call: CallApi;

export const submitCheckboxField = form.handleSubmit((data) =>
  call.end(
    data.values
      .map((value, i) => (value.checked ? i : null))
      .filter((value): value is number => value !== null),
  ),
);



// Positive: shape-9253a560f199 — parameter actively used in the function body
// (compared, passed to a method call, and assigned to an outer variable).
// Mirrors documenso's attachResizeObserver where `$page` is used three times.
declare const resizeObserverFpUfp: { observe(el: HTMLElement): void };
let observedElementFpUfp: HTMLElement | null = null;
export function setupPageObserverFpUfp(): (el: HTMLElement) => void {
  const attachResizeObserverFpUfp = ($page: HTMLElement) => {
    if ($page === observedElementFpUfp) {
      return;
    }
    resizeObserverFpUfp.observe($page);
    observedElementFpUfp = $page;
  };
  return attachResizeObserverFpUfp;
}


// Mode: rxjs-pipe-combineLatest-nesting
// Innermost arrow `(x) => x.id` sits four call_expression `arguments` ancestors deep
// (map → of → combineLatest → switchMap), which the deep-callback-nesting rule
// counts as depth >= 4. The body of each lambda is trivial — a single property
// access or array transform — so this is the canonical RxJS pipeline FP.
interface RxObservable<T> {
  pipe<R>(op: RxOperator<T, R>): RxObservable<R>;
}
interface RxOperator<T, R> {
  readonly __input: T;
  readonly __output: R;
}

declare function of<T>(value: T): RxObservable<T>;
declare function combineLatest<T>(sources: readonly RxObservable<T>[]): RxObservable<readonly T[]>;
declare function switchMap<T, R>(project: (value: T) => RxObservable<R>): RxOperator<T, R>;
declare function mapOp<T, R>(project: (value: T) => R): RxOperator<T, R>;

interface RecipientRow { id: string; email: string; }
declare const recipientStream: RxObservable<readonly RecipientRow[]>;

export const recipientIds$ = recipientStream.pipe(
  switchMap((values) =>
    combineLatest(
      values.map((value) =>
        of(value).pipe(
          mapOp((entry) => entry.id),
        ),
      ),
    ),
  ),
);

