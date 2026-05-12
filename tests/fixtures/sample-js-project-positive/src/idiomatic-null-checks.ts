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


// `indexOf(...) >= 0` is the idiomatic presence check on arrays/strings.
// Array.prototype.indexOf returns -1 when the element is absent and a
// non-negative index when found, so `>= 0` is exactly equivalent to
// `!== -1`. This detector must not flag these realistic membership tests.

declare const allowedFieldTypes: ReadonlyArray<string>;
declare const currentFieldType: string;

export function isAllowedFieldType(): boolean {
  return allowedFieldTypes.indexOf(currentFieldType) >= 0;
}

declare const recipientEmails: ReadonlyArray<string>;
declare const inviteEmail: string;

export function hasRecipient(): boolean {
  if (recipientEmails.indexOf(inviteEmail.toLowerCase()) >= 0) {
    return true;
  }
  return false;
}

declare const userAgent: string;

export function isWebkitBrowser(): boolean {
  return userAgent.indexOf('WebKit') >= 0 && userAgent.indexOf('Chrome') >= 0;
}


// Truthiness on optional string parameters used as IDs/tokens/paths — empty string is domain-invalid.
export function findFolder(folderId?: string): string {
  if (folderId) {
    return `folder:${folderId}`;
  }
  return 'root';
}

// Truthiness on string|null from Headers.get / URLSearchParams.get — idiomatic null-guard.
declare const request: { headers: Headers };
export function resolveClientIp(): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return '127.0.0.1';
}

// Truthiness on number|undefined where 0 is never a valid DB primary key.
export function loadRecipient(directRecipientId?: number): string {
  if (directRecipientId) {
    return `update:${directRecipientId}`;
  }
  return 'create';
}

// Truthiness on a typed boolean / boolean|undefined — semantically identical to === true.
interface TableProps {
  enableSelection?: boolean;
}
export function renderTable(props: TableProps): string {
  if (props.enableSelection) {
    return 'selectable';
  }
  return 'readonly';
}

// Truthiness on object|undefined / array|undefined — presence check on reference type.
declare const definition: { trigger: { schema?: { parse: (input: unknown) => unknown } } };
export function validatePayload(payload: unknown): unknown {
  if (definition.trigger.schema) {
    return definition.trigger.schema.parse(payload);
  }
  return payload;
}



/**
 * Nested-if patterns that look mechanically collapsible but encode
 * intentional two-step logic the author deliberately separated.
 *
 * Shape-39f4fca56b7f: the outer `if` is a TYPE GUARD that narrows a
 * union (number | null) down to `number`; the inner `if` then validates
 * the numeric value. Collapsing into a single `&&` chain destroys the
 * narrowing-vs-validation distinction.
 *
 * Shape-30b246cbead4: the outer `if` is one branch of a keyboard event
 * dispatcher whose parent block holds additional sibling branches
 * (a separate Escape handler). Even though the outer body is a single
 * inner `if`, collapsing it would re-flow the dispatcher table and
 * change how a reader scans the file for the Delete/Backspace case.
 */

declare const AppErrorCode: { INVALID_BODY: string; UNAUTHORIZED: string };
declare class AppError extends Error {
  constructor(code: string, meta?: { message: string });
}

export function resolveTeamId(rawTeamId: string | null): number | null {
  const parsedTeamId: number | null =
    rawTeamId == null ? null : Number.parseInt(rawTeamId, 10);

  // Shape-39f4fca56b7f: type-guard narrowing followed by value validation.
  // The outer `typeof` narrows `number | null` to `number`; the inner `if`
  // is a domain-level sanity check on the narrowed value.
  if (typeof parsedTeamId === 'number') {
    if (Number.isNaN(parsedTeamId) || parsedTeamId <= 0) {
      throw new AppError(AppErrorCode.INVALID_BODY, {
        message: 'teamId must be a positive integer',
      });
    }
    return parsedTeamId;
  }

  return null;
}

interface SelectOption {
  value: string;
  label: string;
}

interface MultiselectKeyEvent {
  key: string;
  preventDefault(): void;
}

interface MultiselectInputState {
  value: string;
  blur(): void;
}

export function handleMultiselectKeyDown(
  e: MultiselectKeyEvent,
  input: MultiselectInputState,
  selected: SelectOption[],
  onRemove: (option: SelectOption) => void,
  onClose: () => void,
): void {
  // Shape-30b246cbead4: keyboard dispatcher with multiple sibling branches.
  // The outer Delete/Backspace branch's body is a single inner `if`, but
  // it sits alongside an independent Escape branch below. Collapsing the
  // outer + inner into one condition fragments the dispatcher visually
  // and is a refactor that changes review semantics, not just shape.
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (input.value === '' && selected.length > 0) {
      const lastSelectOption = selected[selected.length - 1];
      if (lastSelectOption !== undefined) {
        onRemove(lastSelectOption);
      }
    }
  }

  if (e.key === 'Escape') {
    input.blur();
    onClose();
  }
}



// ---------------------------------------------------------------------------
// Typed-initialization anchor for dead-store rule (shape b65fa4543e06).
//
// `let foo: T | null = null` is an idiomatic TypeScript pattern: the null
// initializer is intentionally never read, it only anchors the type so the
// conditional assignment that follows widens to `T | null` instead of `T`.
// The function throws on parse failure, otherwise `foo` is overwritten with
// the parse result before being used. The rule must not flag the null init.
// ---------------------------------------------------------------------------

interface StripeOrganisationCreateMetadata {
  readonly userId: string;
  readonly organisationName: string;
  readonly priceId: string;
}

interface ParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface ParseFailure {
  readonly success: false;
  readonly error: { readonly message: string };
}

type ParseResult<T> = ParseSuccess<T> | ParseFailure;

declare const organisationCreateMetadataSchema: {
  safeParse(raw: unknown): ParseResult<StripeOrganisationCreateMetadata>;
};

export function onSubscriptionCreated(rawMetadata: unknown): {
  userId: string;
  organisationName: string;
} {
  let organisationCreateFlowData: StripeOrganisationCreateMetadata | null = null;

  const parseResult = organisationCreateMetadataSchema.safeParse(rawMetadata);

  if (!parseResult.success) {
    throw new Error(
      `Invalid organisation create metadata: ${parseResult.error.message}`,
    );
  }

  organisationCreateFlowData = parseResult.data;

  return {
    userId: organisationCreateFlowData.userId,
    organisationName: organisationCreateFlowData.organisationName,
  };
}



// FP fixtures for code-quality/deterministic/negated-condition
// Each block mirrors a real documenso shape where the negated branch is
// intentionally the primary/longer path with a shorter fallback in else.

declare const isEmbedded: boolean;
declare const isChecked: boolean;
declare const leading: boolean;
declare const item: { id: string; value: string };
declare const checkedValues: string[];
declare const envelope: { id: string; recipients: unknown[]; fields: unknown[] };
declare const setRecipientsMutation: { mutateAsync: (args: unknown) => Promise<{ recipients: unknown[] }> };
declare const setFieldsMutation: { mutateAsync: (args: unknown) => Promise<{ fields: unknown[] }> };
declare const setEnvelope: (updater: (prev: typeof envelope) => typeof envelope) => void;
declare const onCheckedChange: (values: string[]) => void;
declare function unstable_batchedUpdates(fn: () => void): void;

// Shape 5fd00699e607: primary server path under !isEmbedded, embedded fallback in else.
export async function persistRecipients(): Promise<void> {
  if (!isEmbedded) {
    const response = await setRecipientsMutation.mutateAsync({
      envelopeId: envelope.id,
      recipients: envelope.recipients,
    });
    setEnvelope((prev) => ({ ...prev, recipients: response.recipients }));
  } else {
    setEnvelope((prev) => ({ ...prev, recipients: envelope.recipients }));
  }
}

export async function persistFields(): Promise<void> {
  if (!isEmbedded) {
    const response = await setFieldsMutation.mutateAsync({
      envelopeId: envelope.id,
      fields: envelope.fields,
    });
    setEnvelope((prev) => ({ ...prev, fields: response.fields }));
  } else {
    setEnvelope((prev) => ({ ...prev, fields: envelope.fields }));
  }
}

// Shape 64c5799d2417: toggle add/remove using `if (!isChecked)`; idiomatic toggle.
export function toggleCheckboxItem(): void {
  let updatedValues: string[];
  if (!isChecked) {
    updatedValues = [...checkedValues, item.value.length > 0 ? item.value : `empty-value-${item.id}`];
  } else {
    updatedValues = checkedValues.filter((v) => v !== item.value && v !== `empty-value-${item.id}`);
  }
  onCheckedChange(updatedValues);
}

// Shape f1f513cab1c3: throttle guard where the primary/larger branch is the
// not-yet-throttling path and the else accumulates args.
const $isThrottling: { current: boolean } = { current: false };
const $pendingArgs: { current: unknown[] | null } = { current: null };

function $setIsThrottling(value: boolean): void {
  $isThrottling.current = value;
}

export function throttledInvoke(...args: unknown[]): void {
  if (!$isThrottling.current) {
    $setIsThrottling(true);
    if (leading) {
      unstable_batchedUpdates(() => {
        $pendingArgs.current = args;
      });
    } else {
      $pendingArgs.current = args;
    }
  } else {
    $pendingArgs.current = args;
  }
}



// --- non-null-assertion FP fixtures ---
// Every `!` below is logically safe at runtime due to surrounding control flow,
// guard predicates, or invariant data structures. TypeScript cannot narrow
// through these boundaries so the assertion is the idiomatic escape hatch.
// The rule must NOT flag any of these as unsafe non-null assertions.

// Mode: conditional-branch-invariant
// `file.envelopeItemId` is constructed only when `isEmbedded` is true, so
// inside the same `if (isEmbedded)` branch every element of the array has a
// non-null `envelopeItemId` and `data`. TypeScript types both as optional.
interface UploadingFile {
  envelopeItemId?: string;
  data?: Uint8Array;
  name: string;
}
declare const isEmbedded: boolean;
declare const newUploadingFiles: UploadingFile[];
declare function uploadEnvelopeItem(id: string, payload: Uint8Array): Promise<void>;
export async function startEmbeddedUploads(): Promise<void> {
  if (isEmbedded) {
    for (const file of newUploadingFiles) {
      // Branch invariant: every file in this branch was built with a non-null
      // envelopeItemId (PRESIGNED_PREFIX + nanoid) and a non-null data buffer.
      await uploadEnvelopeItem(file.envelopeItemId!, file.data!);
    }
  }
}

// Mode: closure-boundary-guard
// React Query's `enabled: !!templateId` guarantees the query never fires when
// `templateId` is undefined, so the trpc input's `!` is safe inside the closure.
declare const templateId: string | undefined;
declare const trpc: {
  template: {
    getDefaultRecipients: {
      useQuery(
        input: { templateId: string },
        opts: { enabled: boolean },
      ): { data: Array<{ id: string; email: string }> | undefined };
    };
  };
};
export function useDefaultRecipients(): Array<{ id: string; email: string }> | undefined {
  const { data } = trpc.template.getDefaultRecipients.useQuery(
    { templateId: templateId! },
    { enabled: !!templateId },
  );
  return data;
}

// Closure-boundary variant: explicit early-return guard before an async callback.
interface DocumentConfig {
  documentData: { id: string; type: string } | null;
  recipients: Array<{ email: string }>;
}
declare const configuration: DocumentConfig;
declare function createDocumentAsync(opts: { documentDataId: string; recipients: string[] }): Promise<void>;
export function handleConfigureSubmit(): () => Promise<void> {
  if (!configuration.documentData) {
    return async (): Promise<void> => {
      /* no-op */
    };
  }
  return async (): Promise<void> => {
    // Closure can't see the outer narrowing on `configuration.documentData`.
    await createDocumentAsync({
      documentDataId: configuration.documentData!.id,
      recipients: configuration.recipients.map((r) => r.email),
    });
  };
}

// Mode: collection-has-get-or-length-check
// Map.has + set ensures the subsequent get() returns a defined array.
declare const envelopeItemIds: string[];
declare const whiteoutsForItem: (id: string) => Array<{ pageX: number; pageY: number }>;
export function groupWhiteouts(): Map<string, Array<{ pageX: number; pageY: number }>> {
  const placeholderWhiteouts = new Map<string, Array<{ pageX: number; pageY: number }>>();
  for (const envelopeItemId of envelopeItemIds) {
    if (!placeholderWhiteouts.has(envelopeItemId)) {
      placeholderWhiteouts.set(envelopeItemId, []);
    }
    // `get` is guaranteed non-undefined: same key was set on the line above
    // (or in a prior iteration). TypeScript types Map.get as T | undefined.
    placeholderWhiteouts.get(envelopeItemId)!.push(...whiteoutsForItem(envelopeItemId));
  }
  return placeholderWhiteouts;
}

// Array.pop() inside a `length > perPage` branch is guaranteed defined
// because the query asked for `perPage + 1` rows.
interface AuditLogRow {
  id: string;
  createdAt: number;
}
export function paginateLogs(
  parsedData: AuditLogRow[],
  perPage: number,
): { rows: AuditLogRow[]; nextCursor: string | null } {
  let nextCursor: string | null = null;
  if (parsedData.length > perPage) {
    const nextItem = parsedData.pop();
    // `length > perPage` plus the take=perPage+1 contract makes pop()
    // provably defined. TypeScript still types it as T | undefined.
    nextCursor = nextItem!.id;
  }
  return { rows: parsedData, nextCursor };
}

// Mode: early-throw-or-sequential-assignment
// An earlier explicit throw guarantees `sourceOrg.subscription` is non-null.
interface Subscription {
  id: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
}
interface OrganisationWithSubscription {
  id: string;
  subscription: Subscription | null;
}
declare const sourceOrg: OrganisationWithSubscription;
export function swapSubscription(): string {
  if (!sourceOrg.subscription) {
    throw new Error('Source organisation has no subscription');
  }
  if (sourceOrg.subscription.status !== 'ACTIVE' && sourceOrg.subscription.status !== 'PAST_DUE') {
    throw new Error('Source subscription is not active');
  }
  // ... unrelated work happens here so TypeScript drops the narrowing ...
  const tag = `org-${sourceOrg.id}`;
  if (tag.length === 0) {
    throw new Error('tag missing');
  }
  // After the early throws above, subscription is guaranteed non-null at runtime.
  return sourceOrg.subscription!.id;
}

// Sequential reassignment: every code path assigns `result` before use.
export function loadPdfBytes(data: string | Uint8Array): Uint8Array {
  let result: Uint8Array | null = null;
  if (typeof data === 'string') {
    // Initialise to null only on this branch...
    result = new Uint8Array([1, 2, 3]);
  } else {
    result = data;
  }
  // Both branches assigned `result`; runtime value is always a Uint8Array.
  return result!;
}

// Mode: filter-predicate-or-downstream-null-check
// .filter() guarantees `signedValue` is truthy for every element of the chain.
interface SignedField {
  id: string;
  signedValue: string | null;
  type: 'TEXT' | 'SIGNATURE';
}
declare const fields: SignedField[];
export function collectSignedValues(): string[] {
  return fields
    .filter((field) => field.signedValue && field.type === 'TEXT')
    .map((field) => field.signedValue!);
}

// Downstream null-check: result is reassigned via `!` then immediately
// guarded with `if (allowed)` before any dereference.
declare const req: { headers: { get(name: string): string | null } };
export function resolveAllowedHeaders(): string | null {
  let allowed: string | string[] | null | undefined;
  allowed = req.headers.get('Access-Control-Request-Headers')!;
  if (allowed) {
    return Array.isArray(allowed) ? allowed.join(', ') : allowed;
  }
  return null;
}



// Positive: unchecked-array-access - enum-exhaustive-record-lookup.
// MAP is declared `satisfies Record<keyof typeof RecipientRole, ...>` so every
// possible key is statically known to be present, and `role` is typed as
// `RecipientRole`, so the bracket lookup is exhaustive and cannot be missing.
declare const RecipientRole: {
  readonly SIGNER: 'SIGNER';
  readonly APPROVER: 'APPROVER';
  readonly VIEWER: 'VIEWER';
};
type RecipientRole = (typeof RecipientRole)[keyof typeof RecipientRole];
const RECIPIENT_ROLES_DESCRIPTION = {
  SIGNER: { roleName: 'Signer' },
  APPROVER: { roleName: 'Approver' },
  VIEWER: { roleName: 'Viewer' },
} satisfies Record<keyof typeof RecipientRole, { roleName: string }>;
export function describeRecipientRole(role: RecipientRole): string {
  return RECIPIENT_ROLES_DESCRIPTION[role].roleName;
}

// Positive: unchecked-array-access - map-callback-index-bounded.
// `index` is the `.map()` callback parameter and the bracket access targets
// the same `localFields` array we are iterating. The index is structurally
// bounded by the array's length at the point of access.
interface FormField {
  readonly id: string;
  readonly label: string;
}
declare const localFields: ReadonlyArray<FormField>;
export function renderFieldLabels(): string[] {
  return localFields.map((field, index) => {
    const sibling = localFields[index];
    return `${field.label}:${sibling.id}`;
  });
}

// Positive: unchecked-array-access - findindex-not-negative-one-guard.
// `fieldIndex` comes from Array.prototype.findIndex(); the bracket access is
// dominated by an `if (fieldIndex !== -1)` guard, so the index is provably
// within bounds of `fields`.
declare const fields: ReadonlyArray<FormField>;
declare const targetId: string;
export function findFieldLabel(): string | null {
  const fieldIndex = fields.findIndex((f) => f.id === targetId);
  if (fieldIndex !== -1) {
    return fields[fieldIndex].label;
  }
  return null;
}

// Positive: unchecked-array-access - arithmetic-loop-bounds-guaranteed.
// Loop runs `for (let i = 1, max = points.length - 1; i < max; i++)` so
// `i + 1 <= points.length - 1`, the last valid index. Both `points[i]` and
// `points[i + 1]` are within bounds by arithmetic on `points.length`.
interface Point {
  readonly x: number;
  readonly y: number;
}
export function averageSegmentMidpoints(points: ReadonlyArray<Point>): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1, max = points.length - 1; i < max; i++) {
    const a = points[i];
    const b = points[i + 1];
    total += (a.x + b.x + a.y + b.y) / 4;
  }
  return total;
}

// Positive: unchecked-array-access - guarded-or-preinitialized-object-access.
// `rowSelection[id]` is keyed only by ids returned from `Object.keys(rowSelection)`,
// so every key is guaranteed to exist on the object. There is no possible
// missing-key access.
declare const rowSelection: Record<string, boolean>;
export function collectSelectedRowIds(): string[] {
  const selected: string[] = [];
  for (const id of Object.keys(rowSelection)) {
    if (rowSelection[id]) {
      selected.push(id);
    }
  }
  return selected;
}
