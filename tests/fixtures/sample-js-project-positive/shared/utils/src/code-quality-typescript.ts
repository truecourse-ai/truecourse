export function safeNonNull(x: string | null): number { if (x === null) return 0; return x.length; }
export interface OptionalField { name?: string; }
export type StringOrNumber = string | number;
export function wrapString(x: string): string { return x; }
export const CONFIG_VALUE = 42;
export type SimpleMap = Map<string, boolean>;
export function returnsUnknown(data: unknown): unknown { return data; }
export function objectParam(val: Record<string, unknown>): Record<string, unknown> { return val; }
export function isString(x: unknown): x is string { return typeof x === 'string'; }
export function processValue(input: unknown): boolean {
  if (typeof input === 'undefined') { return false; }
  if (typeof input === 'object') { return input !== null; }
  const result = String(input);
  const trimmed = result.trim();
  return trimmed.length > 0;
}
export function lookupKey(obj: Record<string, unknown>, key: string): unknown { return obj[key as keyof typeof obj]; }



// String-backed enum members whose values are intentional wire/DB keys for
// serialization, API payloads, and Prisma persistence. The string values match
// the lowercase member name and are pattern-matched in tRPC/REST adapters.
export enum RecipientType {
  WAITING = 'waiting',
  SIGNED = 'signed',
  REJECTED = 'rejected',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

export enum AppErrorCode {
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  NOT_FOUND = 'NOT_FOUND',
  ENVELOPE_LEGACY = 'ENVELOPE_LEGACY',
  UNAUTHORIZED = 'UNAUTHORIZED',
}

// String-backed enum members whose values are human-readable display labels
// rendered directly in validation UI; the string value IS the label.
export enum CheckboxValidationRules {
  SELECT_EXACTLY = 'Select exactly',
  SELECT_AT_LEAST = 'Select at least',
  SELECT_AT_MOST = 'Select at most',
}



// FP fixture: idiomatic modern TS `export {}` block mixing value exports with inline `type` modifiers.
// Per TS 4.5+, inline `type` markers within a single export block are the recommended style and should
// not be flagged as a mixed-type-export violation.
declare const ToastProvider: (props: { children: unknown }) => unknown;
declare const ToastViewport: (props: { className?: string }) => unknown;
declare const ToastRoot: (props: { open?: boolean }) => unknown;
declare const ToastAction: (props: { altText: string }) => unknown;
declare const ToastClose: () => unknown;
declare const ToastTitle: (props: { children: unknown }) => unknown;
declare const ToastDescription: (props: { children: unknown }) => unknown;

type ToastInternalProps = { open?: boolean; duration?: number };
type ToastInternalActionElement = { altText: string };

export {
  type ToastInternalProps as ToastProps,
  type ToastInternalActionElement as ToastActionElement,
  ToastProvider,
  ToastViewport,
  ToastRoot as Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};



/**
 * Intentional `any` usages that should NOT trigger
 * `code-quality/deterministic/no-explicit-any`. Each site has an
 * `// eslint-disable-next-line @typescript-eslint/no-explicit-any` directive
 * confirming the suppression is deliberate, and `unknown` is not a viable
 * substitute at the documented boundary.
 */

// Mode shape-ab1928f1c3ef: MDX components getter returns `any`.
//
// In Next.js + Fumadocs/MDX setups, `getMDXComponents` merges the host's
// shared components with a heterogeneous, theme-specific component map
// supplied by the docs framework. The merged shape is intentionally open
// — components include framework-injected `Tabs`, `Tab`, `Callout`, and
// arbitrary HTML element overrides whose prop signatures differ. Returning
// `MDXComponents` would force every consumer through a structural cast at
// every call site; the author has already chosen `any` as the documented
// boundary type and suppressed the lint.
interface MDXComponents {
  readonly [key: string]: (props: Record<string, unknown>) => unknown;
}

declare const sharedComponents: MDXComponents;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMDXComponents(components?: MDXComponents): any {
  return {
    ...sharedComponents,
    ...components,
  };
}

// Mode shape-2df20bb9f9cb: error-boundary parser accepts `any`.
//
// `parseError` is the universal entry point for normalizing thrown values
// at error boundaries (`try { ... } catch (error) { AppError.parseError(error) }`).
// JavaScript permits `throw` on any value — strings, numbers, plain objects,
// `Error` subclasses, `Response` instances, `AbortError`, native `DOMException`,
// trpc/Zod errors. Switching to `unknown` would still require the exact same
// narrowing inside the function body, so it adds no safety; the author has
// codified that with an eslint-disable directive and the project's documented
// error-handling contract.
interface AppErrorShape {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
}

export class AppError implements AppErrorShape {
  constructor(
    readonly code: string,
    readonly message: string,
    readonly statusCode: number,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static parseError(error: any): AppError {
    if (error instanceof AppError) {
      return error;
    }
    if (error instanceof Error) {
      return new AppError('UNKNOWN_ERROR', error.message, 500);
    }
    if (typeof error === 'string') {
      return new AppError('UNKNOWN_ERROR', error, 500);
    }
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = (error as { message: unknown }).message;
      return new AppError(
        'UNKNOWN_ERROR',
        typeof message === 'string' ? message : 'Unknown error',
        500,
      );
    }
    return new AppError('UNKNOWN_ERROR', 'Unknown error', 500);
  }
}

// Mode shape-4f5a91902fc9: SSR-only deferred dynamic-import binding.
//
// `SkiaImage` is the Node-only `Image` constructor from `skia-canvas`,
// imported lazily inside a `typeof window === 'undefined'` guard so the
// browser bundle never pulls in the native addon. There is no static type
// available at the declaration site — `skia-canvas` is not in the
// dependency graph at type-check time on the client build. `any` is the
// documented universal-module idiom and is suppressed with eslint-disable.
declare const window: { document: unknown } | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SkiaImage: any;

if (typeof window === 'undefined') {
  void (async (): Promise<void> => {
    const mod = await import('node:fs');
    SkiaImage = mod;
  })();
}

export async function renderSignatureFieldImage(payload: string): Promise<string> {
  if (SkiaImage === undefined) {
    return payload;
  }
  return `${payload}:rendered`;
}


/**
 * Optional-property patterns that should NOT trigger
 * `code-quality/deterministic/redundant-optional`.
 *
 * Mode 1 (function-return-type-undefined): the `?` is on the property,
 * but `| undefined` appears inside the FUNCTION RETURN TYPE of the
 * property's value, not on the property's own type. Returning
 * `string | undefined` is a meaningful contract ("no identifier ->
 * fall back to IP"), not a redundant optional marker.
 *
 * Mode 2 (record-value-type-undefined): the `?` is on the property,
 * but `| undefined` is in the VALUE position of `Record<string, ...>`,
 * not on the property's own type. Env-style maps legitimately have
 * `string | undefined` values for missing keys.
 *
 * Mode 3 (discriminated-union-exclude-arm): `field?: undefined` in one
 * arm of a discriminated union is the idiomatic way to forbid the field
 * in that variant so TypeScript can narrow on the discriminant. The
 * `| undefined` here is the entire (and required) annotation, not a
 * redundant addition next to another type.
 */

declare const FP_RO_HonoContext: { req: { raw: unknown } };
type FP_RO_HonoContextT = typeof FP_RO_HonoContext;

// Mode 1: optional callback whose RETURN TYPE is `string | undefined`.
// The `?` belongs to `identifierFn`; the `| undefined` belongs to the
// inner function's return type and is part of its contract.
export interface FP_RO_RateLimitOptions {
  identifierFn?: (c: FP_RO_HonoContextT) => string | undefined;
  resolveUserId?: (c: FP_RO_HonoContextT) => Promise<string | undefined>;
}

export const fp_ro_makeRateLimitOptions = (
  options?: { identifierFn?: (c: FP_RO_HonoContextT) => string | undefined },
): FP_RO_RateLimitOptions => ({
  identifierFn: options?.identifierFn,
});

// Mode 2: optional property whose type is `Record<string, string | undefined>`.
// The `| undefined` is in the Record's value slot, modelling env-var
// lookups that return undefined for missing keys.
declare global {
  interface Window {
    __FP_RO_ENV__?: Record<string, string | undefined>;
  }
}

export interface FP_RO_BrowserEnvCarrier {
  __ENV__?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
}

export const fp_ro_readEnvCarrier = (carrier: FP_RO_BrowserEnvCarrier, key: string): string | undefined =>
  carrier.__ENV__?.[key] ?? carrier.headers?.[key];

// Mode 3: discriminated-union arm using `presignToken?: undefined` to
// exclude the field from the `download` variant. The annotation is
// `undefined` on its own (not `T | undefined`), and is required for
// narrowing on the `type` discriminant.
export type FP_RO_EnvelopeItemPdfUrlOptions =
  | {
      type: 'download';
      envelopeItemId: string;
      token: string | undefined;
      version: 'original' | 'signed' | 'pending';
      presignToken?: undefined;
    }
  | {
      type: 'view';
      envelopeItemId: string;
      token: string | undefined;
      presignToken?: string | undefined;
    };

export const fp_ro_getEnvelopeItemPdfUrl = (options: FP_RO_EnvelopeItemPdfUrlOptions): string => {
  if (options.type === 'download') {
    // `presignToken` is narrowed to `undefined` here thanks to the
    // discriminated-union arm above.
    return `/api/files/${options.envelopeItemId}/download/${options.version}`;
  }
  return options.presignToken
    ? `/api/files/${options.envelopeItemId}?presignToken=${options.presignToken}`
    : `/api/files/${options.envelopeItemId}`;
};



// MODE shape-63900452a95a: HTTP status code union — distinct valid HTTP statuses, not refactorable
export type HttpErrorStatus = 400 | 401 | 403 | 404 | 500 | 501;
declare const httpStatus: HttpErrorStatus;
export function describeHttpStatus(s: HttpErrorStatus): string {
  switch (s) {
    case 400: return 'bad request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not found';
    case 500: return 'server error';
    case 501: return 'not implemented';
  }
}

// MODE shape-d2b6c67ad949: JsonPrimitive utility type — standard JSON primitive union
export type JsonPrimitive = string | number | boolean | null | undefined | Date | symbol;
declare const jsonValue: JsonPrimitive;
export function isJsonPrimitive(v: unknown): v is JsonPrimitive {
  return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v instanceof Date || typeof v === 'symbol';
}

// MODE shape-770dbde0ebae: Event type union for cross-environment pointer handling — not reducible
declare type ReactMouseEvent = { clientX: number; clientY: number; type: 'mouse' };
declare type ReactPointerEvent = { clientX: number; clientY: number; pointerId: number };
declare type ReactTouchEvent = { touches: ReadonlyArray<{ clientX: number; clientY: number }> };
declare type DomMouseEvent = { clientX: number; clientY: number };
declare type DomPointerEvent = { clientX: number; clientY: number; pointerType: string };
declare type DomTouchEvent = { touches: ReadonlyArray<{ clientX: number; clientY: number }> };
export type AnyPointerEvent =
  | ReactMouseEvent
  | ReactPointerEvent
  | ReactTouchEvent
  | DomMouseEvent
  | DomPointerEvent
  | DomTouchEvent;
declare const pointerEvt: AnyPointerEvent;
export function extractPoint(evt: AnyPointerEvent): { x: number; y: number } {
  if ('touches' in evt) {
    const t = evt.touches[0];
    return { x: t.clientX, y: t.clientY };
  }
  return { x: evt.clientX, y: evt.clientY };
}
