/**
 * Positive fixture for code-quality/deterministic/unnecessary-type-assertion.
 *
 * `value as unknown as T` is the standard "launder through unknown"
 * pattern. The intermediate `as unknown` step is required by TypeScript
 * when the source type and the final target type are not assignable to
 * each other — a direct `value as T` would be rejected by the compiler.
 *
 * Even when TypeScript infers the inner expression's type to be `unknown`
 * (e.g. a callback whose parameter is typed `unknown`), the explicit
 * `as unknown` step is not redundant — it is the only legal way to set
 * up the subsequent assertion to a concrete type.
 */

const knownStatuses: readonly string[] = ['draft', 'sent', 'completed'];

type ValueGuard = (value: unknown) => boolean;

export const isKnownStatus: ValueGuard = (value) =>
  knownStatuses.includes(value as unknown as string);
