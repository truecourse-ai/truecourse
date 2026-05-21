/**
 * Positive fixture for reliability/deterministic/unsafe-json-parse.
 *
 * `JSON.parse(JSON.stringify(value))` is the canonical structured-clone
 * idiom — the input is guaranteed to be valid JSON because it was just
 * produced by JSON.stringify of an in-memory value, so the parse cannot
 * throw and no try/catch is necessary.
 */

export function cloneAny(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export function cloneAndDescribe(value: unknown, label: string): unknown {
  return [label, JSON.parse(JSON.stringify(value))];
}
