export function setVariable(): number { return 43; }
export function callFn(): number { return 42; }
export function getNumber(value: string): number { return Number(value); }
export function checkValue(x: number): string { if (x > 0) return 'truthy'; return 'falsy'; }
export function hasOwn(obj: Record<string, unknown>, key: string): boolean { return Object.hasOwn(obj, key); }
export function separateStatements(x: number): number { if (x > 0) return x; return -x; }
export function directFetch(): Promise<Response> { return fetch('/api'); }
export function compareStrings(a: string, b: string): number { return a.localeCompare(b); }
export function defaultLast(b: number, a: number = 0): number { return a + b; }
export function findFirst(arr: readonly number[]): number | undefined { return arr.find((x) => x > 0); }
export function startsWithCheck(str: string): boolean { return str.startsWith('prefix'); }
export function buildPayload(name: string, email: string, age: number): Record<string, unknown> {
  const verified = true;
  return { name, email, age, verified, createdAt: new Date() };
}
export function explicitUndefined(): undefined {
  return undefined;
}
export function toBool(val: unknown): boolean {
  return !!val;
}
export function mapItems(items: readonly string[]): string[] {
  const results: string[] = [];
  for (const item of items) {
    results.push(item.toUpperCase());
  }
  return results;
}

// positive: ts-declaration-style — interface with extends clause should NOT trigger
interface BaseConfig { timeout: number; }
export interface ExtendedConfig extends BaseConfig { retries: number; }

// positive: insecure-random — Math.random() for non-security array index should NOT trigger
export function getRandomElement<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Positive: unused-constructor-result — new URL for validation
export function validateUrl(input: string): boolean { try { new URL(input); return true; } catch { return false; } }

// Positive: complex-type-alias — simple string literal union
export type Status = 'active' | 'inactive' | 'pending' | 'archived' | 'deleted';

// Positive: indexed-loop-over-for-of — partial range loop (needs index arithmetic)
export function pairwise(items: readonly number[]): number { let sum = 0; for (let i = 0; i < items.length - 1; i++) { sum += items[i] + items[i + 1]; } return sum; }

// Positive: unused-collection — collection reassigned and returned
export function buildList(): string[] { let items: string[] = ['a']; items = [...items, 'b']; return items; }

// Positive: json-parse-in-loop — parsing different strings each iteration (not same string)
export function parseAll(items: readonly string[]): unknown[] {
  const results: unknown[] = [];
  for (const item of items) {
    try {
      results.push(JSON.parse(item));
    } catch {
      // skip invalid JSON
    }
  }
  return results;
}

// Positive: prototype-pollution — Object.entries iteration (safe, not bracket assignment from user input)
export function applyMapping(target: Record<string, string>, source: Record<string, string>): void {
  for (const [key, val] of Object.entries(source)) {
    target[key] = val;
  }
}

// Positive: missing-react-memo — TS generics with comparison operators must NOT be flagged as JSX.
// Pre-fix the rule used `text.includes('<') && text.includes('>')` and matched generics.
export function compareGeneric<T extends number>(a: T, b: T): number {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

// Positive: missing-react-memo — nested generics in return type, no JSX
export function pairBuilder<K, V>(key: K, value: V): Map<K, V> {
  const map = new Map<K, V>();
  map.set(key, value);
  return map;
}

// Positive: floating-promise — sync functions whose names match old ASYNC_PREFIXES.
// Pre-fix these were flagged because the rule used a name heuristic.
// Phase 4 (TypeQueryService) verifies via real type info that these return non-Promise.
const DEFAULT_SIZE = 1024;
export function createBufferSync(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}
export function loadConfigSync(): { ready: boolean } {
  return { ready: true };
}
export function callSyncCreate(): ArrayBuffer {
  // Bare call of a sync function whose name starts with "create" — pre-fix the
  // ASYNC_PREFIXES heuristic flagged this. Type info now correctly skips it.
  return createBufferSync(DEFAULT_SIZE);
}

// ---------------------------------------------------------------------------
// Phase 3: framework overfit fixes
// ---------------------------------------------------------------------------

// Positive: state-update-in-loop — bare setX() identifier call in a loop in a
// non-React file. Pre-fix the rule fired on any /^set[A-Z]/ call in a loop;
// now gated by React import (this file does not import React).
declare const setStringValue: (s: string) => void;
export function applyTitles(items: readonly string[]): void {
  for (const item of items) {
    setStringValue(item);
  }
}

// Positive: static-method-candidate — Vue lifecycle method on a class extending
// a Vue base. Pre-fix the hardcoded React-only contractMethods list missed
// Vue/Angular/Svelte lifecycle methods. Now: classes that extend ANY base are
// skipped via the existing heritage check.
declare const VueBase: { new(): { mounted(): void } };
class MyVueComponent extends VueBase {
  mounted(): void {
    console.warn('mounted');
  }
}
export const vueComponent = new MyVueComponent();



// Positive: complex-type-alias — single-line foundational JSON primitive union (borrowed from Trigger.dev SDK style).
// Not complex — flat primitive union used to build a recursive Json type.
export type JsonPrimitive = string | number | boolean | null | undefined | Date | symbol;

// Positive: complex-type-alias — documented semantic grouping of named meta types for a shared renderer.
// Deliberate domain modeling, not accidental complexity.
declare const __initialsFieldMeta: { type: 'initials'; fontSize?: number };
declare const __nameFieldMeta: { type: 'name'; fontSize?: number };
declare const __emailFieldMeta: { type: 'email'; fontSize?: number };
declare const __dateFieldMeta: { type: 'date'; format?: string };
declare const __textFieldMeta: { type: 'text'; maxLength?: number };
declare const __numberFieldMeta: { type: 'number'; min?: number };
type TInitialsFieldMeta = typeof __initialsFieldMeta;
type TNameFieldMeta = typeof __nameFieldMeta;
type TEmailFieldMeta = typeof __emailFieldMeta;
type TDateFieldMeta = typeof __dateFieldMeta;
type TTextFieldMeta = typeof __textFieldMeta;
type TNumberFieldMeta = typeof __numberFieldMeta;
export type GenericTextFieldTypeMetas =
  | TInitialsFieldMeta
  | TNameFieldMeta
  | TEmailFieldMeta
  | TDateFieldMeta
  | TTextFieldMeta
  | TNumberFieldMeta;

// Positive: complex-type-alias — string-literal union constraining generateDatabaseId input.
// Standard discriminated string enum pattern, not a complexity smell.
type DatabaseIdPrefix =
  | 'document'
  | 'template'
  | 'recipient'
  | 'field'
  | 'webhook'
  | 'apitoken'
  | 'subscription'
  | 'team';
declare const prefixedId: (prefix: DatabaseIdPrefix, len: number) => string;
export const generateDatabaseIdPositive = (prefix: DatabaseIdPrefix): string => prefixedId(prefix, 16);



// Positive: indexed-loop-over-for-of (shape-e814e7c7327d) — range loop over a numeric count (TOTP window), not an array. `for...of` is not applicable; `i` is unused in body but the bound is a count, not `arr.length`.
declare const computeTotpAt: (counter: number) => string;
export function verifyTotpToken(token: string, period: number, window: number, now: number): boolean {
  for (let i = 0; i < window; i++) {
    const counter = Math.floor(now / period);
    const candidate = computeTotpAt(counter);
    if (candidate === token) return true;
  }
  return false;
}



// positive: readonly-parameter-types — `...args: any[]` in a function type alias is a type-level
// signature, not a real parameter declaration; `any` already bypasses readonly anyway.
export type SuperDataFunction = (...args: any[]) => unknown; // matches any function
declare const superLoader: SuperDataFunction;
export const superResult: unknown = superLoader('id', 1, { nested: true });

// positive: readonly-parameter-types — `(...args: any[]) => infer Output` inside a conditional
// type is a type-level inference pattern; the rest argument is part of the pattern, not a real param.
export type SuperFunctionReturn<T> = T extends (...args: any[]) => infer Output
  ? Output extends Promise<infer P>
    ? P
    : Output
  : T;
declare const superLoaderFn: () => Promise<{ id: string; rows: number[] }>;
export type SuperLoaderData = SuperFunctionReturn<typeof superLoaderFn>;

// positive: readonly-parameter-types — `T extends (...args: unknown[]) => unknown` is a generic
// constraint describing "any callable"; requiring `readonly unknown[]` here would break callers
// that pass ordinary mutable rest-arg functions.
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  fn: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let last = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}
declare const sendEvent: (name: string, payload: Record<string, unknown>) => void;
export const throttledSendEvent = useThrottledCallback(sendEvent, 200);



// positive: unnecessary-type-conversion (shape-5e4ec8363f5a) — Number()
// coercion on a prop typed `string | number` (LucideIcon-style). Callers can
// pass numeric strings (e.g. size='32'), so Number() is required before
// arithmetic — without it `*` would coerce ad-hoc and `+` would concatenate.
interface LucideIconLikeProps {
  size?: string | number;
  strokeWidth?: string | number;
  color?: string;
}
declare const SVG_BASE: number;
export function SignatureIconLike(props: LucideIconLikeProps): number {
  const { size = 24, strokeWidth = 1.33 } = props;
  const numericSize = Number(size);
  const numericStroke = Number(strokeWidth);
  return (numericStroke * SVG_BASE) / numericSize;
}

// positive: unnecessary-type-conversion (shape-5e53fc00803d) — Boolean()
// coerces a `boolean | Team | undefined` expression produced by `||` into a
// real boolean for a prop typed `boolean`. Without Boolean() the value could
// be an object reference, which the consumer cannot use as a flag.
interface TeamLike {
  id: number;
  name: string;
}
declare const isOwnerFlag: boolean;
declare const currentTeamDoc: TeamLike | undefined;
declare const renderDropdownPageView: (args: { canManage: boolean }) => void;
export function pageViewDropdown(): void {
  const canManage: boolean = Boolean(isOwnerFlag || currentTeamDoc);
  renderDropdownPageView({ canManage });
}

// positive: unnecessary-type-conversion (shape-526c4af183b0) — same Boolean()
// shape in a sibling component path. `||` short-circuit returns the first
// truthy operand (a Team object) rather than `true`, so Boolean() is the
// genuine coercion to satisfy a boolean-typed sink.
declare const isDocumentOwner: boolean;
declare const currentTeamForRow: TeamLike | undefined;
declare const renderActionDropdown: (args: { allowAction: boolean }) => void;
export function documentsTableActionDropdown(): void {
  const allowAction: boolean = Boolean(isDocumentOwner || currentTeamForRow);
  renderActionDropdown({ allowAction });
}



// Positive: unused-constructor-result — new Intl.Locale for BCP-47 validation side-effect (shape a2cbaf14918d)
export function isValidBcp47(language: string): boolean { try { new Intl.Locale(language); return true; } catch { return false; } }



// Positive: useless-constructor — private constructor in singleton pattern. The `super()` call is
// required (class extends BaseJobProvider) and `private` is required to prevent external `new`.
// Removing the constructor would break the singleton — it is NOT useless.
declare class BaseJobProvider { submitJob(payload: unknown): Promise<void>; }
export class LocalJobProviderSingleton extends BaseJobProvider {
  private static _instance: LocalJobProviderSingleton | undefined;
  private constructor() {
    super();
  }
  static getInstance(): LocalJobProviderSingleton {
    if (!LocalJobProviderSingleton._instance) {
      LocalJobProviderSingleton._instance = new LocalJobProviderSingleton();
    }
    return LocalJobProviderSingleton._instance;
  }
  async run(payload: unknown): Promise<void> { await this.submitJob(payload); }
}



/**
 * Positive: json-parse-in-loop — LLM-driven iterative refinement.
 *
 * Replicates the documenso `detect-recipients` shape (ae8e2bc70cb5):
 * `allRecipients` is intentionally mutated each iteration via a merge
 * helper, so the JSON.stringify result is *different every loop* and
 * cannot be hoisted. Each iteration also awaits a Gemini-style LLM call
 * (network round-trip in the hundreds of ms), so the stringify cost is
 * dwarfed by the API latency — flagging it as a performance issue is
 * misleading. The serialized snapshot is fed back as conversational
 * context for the next iteration, which is the whole point of the loop.
 */
interface RecipientCandidate {
  readonly name: string;
  readonly email: string;
  readonly role: 'SIGNER' | 'VIEWER' | 'APPROVER';
}

interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

interface LlmDetectionResponse {
  readonly partial: readonly RecipientCandidate[];
  readonly done: boolean;
}

declare const generateObject: (args: {
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly schema: unknown;
}) => Promise<{ readonly object: LlmDetectionResponse }>;

declare const geminiSchema: unknown;

function mergeRecipients(
  existing: readonly RecipientCandidate[],
  incoming: readonly RecipientCandidate[],
): readonly RecipientCandidate[] {
  const byEmail = new Map<string, RecipientCandidate>();
  for (const r of existing) byEmail.set(r.email.toLowerCase(), r);
  for (const r of incoming) byEmail.set(r.email.toLowerCase(), r);
  return Array.from(byEmail.values());
}

export async function detectRecipientsFromEnvelope(
  envelopeText: string,
  maxPasses: number,
): Promise<readonly RecipientCandidate[]> {
  let allRecipients: readonly RecipientCandidate[] = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const messages: readonly LlmMessage[] = [
      {
        role: 'system',
        content: 'Extract every recipient mentioned in the envelope text.',
      },
      {
        role: 'user',
        content: `Envelope:\n${envelopeText}`,
      },
      {
        role: 'assistant',
        // FP target: JSON.stringify on a let-binding that is reassigned
        // each iteration via mergeRecipients(). The value is intentionally
        // different every loop — it is the running accumulator the LLM
        // needs to see to avoid re-emitting already-found recipients.
        content: `Detected recipients: ${JSON.stringify(allRecipients)}`,
      },
    ];
    const result = await generateObject({
      model: 'gemini-2.0-flash',
      messages,
      schema: geminiSchema,
    });
    allRecipients = mergeRecipients(allRecipients, result.object.partial);
    if (result.object.done) break;
  }
  return allRecipients;
}



// positive: insecure-random (shape c8f0b2a3f686) — seed script test token (Math.random().toString(36).slice(2, 9)) is acceptable for non-production fixtures
export function seedRecipientToken_c8f0b2a3f686(): { token: string } {
  return {
    token: Math.random().toString(36).slice(2, 9),
  };
}

// positive: insecure-random (shape 27e31220945f) — seed script default template token (override ?? Math.random().toString()) is acceptable for test data
declare const directTemplateToken_27e31220945f: string | undefined;
export function seedTemplateToken_27e31220945f(): { token: string } {
  return {
    token: directTemplateToken_27e31220945f ?? Math.random().toString(),
  };
}

// positive: insecure-random (shape c7fc7b05ca24) — seed script template token (Math.random().toString().slice(2, 7)) is acceptable for non-production fixtures
export function seedShortTemplateToken_c7fc7b05ca24(): { token: string } {
  return {
    token: Math.random().toString().slice(2, 7),
  };
}



// ---------------------------------------------------------------------------
// Positive: code-quality/deterministic/unused-expression
// ---------------------------------------------------------------------------

// Positive: unused-expression (shape-3fddcf6b2775) — short-circuit guard
// pattern `value && field.onChange(value)`. This is the idiomatic React-Hook-Form
// pattern: only invoke the onChange callback when `value` is truthy. The
// short-circuit IS the control flow; the RHS is the intended side effect.
// The expression statement has a top-level binary_expression (&&), not a
// call_expression — pre-fix this tripped the unused-expression rule.
declare const formField: { onChange: (v: string | null) => void };
export function onPickerChange(value: string | null): void {
  value && formField.onChange(value);
}

// Positive: unused-expression (shape-aff4b44afbe9) — ternary expression
// statement whose branches are both await-of-side-effect calls. The expression
// is a deliberate side-effect-only dispatch: pick one of two async writers and
// await it so the surrounding try/catch sees rejections. The return value is
// intentionally discarded. Pre-fix the rule flagged any ternary_expression
// statement that wasn't a call/await/assignment at its outermost node.
declare const isClipboardApiSupported: boolean;
declare function handleClipboardApiCopy(text: string, blobType: string): Promise<void>;
declare function handleWriteTextCopy(text: string): Promise<void>;
export async function copyTextToClipboard(text: string, blobType: string): Promise<void> {
  try {
    isClipboardApiSupported ? await handleClipboardApiCopy(text, blobType) : await handleWriteTextCopy(text);
  } catch {
    // surfaced to caller via try/catch upstream
  }
}

// Positive: unused-expression (shape-f6a129bb94ab) — TypeScript declaration
// merging inside a `declare module` block. The inner `namespace` is a purely
// structural type-only construct (no runtime expression). Some tree-sitter
// parses or rule patterns mis-classify the namespace block as an
// expression_statement; it must NOT be flagged because it has no runtime
// effect to discard — it's a type augmentation.
declare global {
  namespace StripeAug {
    interface Product {
      features?: Array<{ name: string }>;
      metadata?: Record<string, string>;
    }
    interface Customer {
      id: string;
      email: string;
    }
  }
}
