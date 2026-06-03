/**
 * Positive fixture for code-quality/deterministic/complex-type-alias.
 *
 * Two FP shapes:
 *
 *   1. Simple union of string literals declared with a leading `|`
 *      separator and trailing per-member comments. The count of `|`
 *      tokens at top level overshoots the real member count by one and
 *      tips the rule's `>= 6` threshold even though there are five
 *      literals. The shape is the standard "label set" alias.
 *
 *   2. The idiomatic utility-type chain
 *      `NonNullable<Awaited<ReturnType<typeof method>>>` — the canonical
 *      way to extract the result type of an async function or method
 *      that may return `null`/`undefined`. The bracket-depth heuristic
 *      flags it as "deeply nested," but readers recognise the chain at
 *      a glance.
 */

declare function fetchRecord(): Promise<{ id: string; payload: string } | null>;

export type CompletionLabel =
  | 'identifier' // bare reference
  | 'literal' // quoted value
  | 'operator' // comparison or join token
  | 'punctuation' // structural punctuation
  | 'keyword'; // reserved word

export type FetchedRecord = NonNullable<Awaited<ReturnType<typeof fetchRecord>>>;
