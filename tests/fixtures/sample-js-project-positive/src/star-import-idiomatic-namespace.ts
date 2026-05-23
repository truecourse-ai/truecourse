/**
 * Positive fixture for code-quality/deterministic/star-import.
 *
 * Some libraries' APIs are explicitly designed around a namespace alias
 * (zod's `z.` schema builders are the canonical case) or expose so many
 * top-level helpers that a `*-as-alias` import is dramatically clearer
 * than dragging in twenty named imports.
 *
 * The rule should skip these:
 *   - well-known idiomatic-namespace packages (`zod`, `@react-email/*`,
 *     `fumadocs-*`), regardless of use count.
 *   - any other module where the namespace alias is referenced ≥ 5
 *     times in the file — the alias is load-bearing.
 */

import * as z from 'zod';
import * as ReactEmail from '@react-email/render';
import * as bigmath from 'big-math-toolkit-fake';

// `z.*` — canonical zod schema builder, namespace-aliased by design.
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  age: z.number().int().nonnegative(),
});

export type User = z.infer<typeof UserSchema>;

// `ReactEmail.*` — @react-email/render's API is namespace-shaped.
export function renderTemplate(node: unknown): Promise<string> {
  return ReactEmail.render(node);
}

// `bigmath` is a fake library, so it's not on the whitelist — instead it
// passes via the ≥ 5-references threshold. Six member accesses below.
export function summarise(values: ReadonlyArray<number>): number {
  const sum = bigmath.sum(values);
  const mean = bigmath.mean(values);
  const median = bigmath.median(values);
  const stdev = bigmath.stdev(values);
  const min = bigmath.min(values);
  const max = bigmath.max(values);
  return sum + mean + median + stdev + min + max;
}
