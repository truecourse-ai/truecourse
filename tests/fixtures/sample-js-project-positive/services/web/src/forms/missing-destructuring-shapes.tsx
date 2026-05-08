/**
 * missing-destructuring shape that should NOT fire:
 *
 * `const x = obj?.x` uses an optional chain. Destructuring
 * `{ x } = obj` requires `obj` to be non-null; the equivalent
 * `{ x } = obj ?? {}` is more verbose and loses the simple
 * "x is undefined when obj is null" semantics.
 */

interface FieldMeta {
  readonly defaultValue: string;
  readonly placeholder: string;
}

declare const parsedFieldMeta: FieldMeta | null;

export function describeField(): string {
  const defaultValue = parsedFieldMeta?.defaultValue;
  const placeholder = parsedFieldMeta?.placeholder;
  return `${defaultValue ?? ""}, ${placeholder ?? ""}`;
}
