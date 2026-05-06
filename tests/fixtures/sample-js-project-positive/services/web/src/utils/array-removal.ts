/**
 * Array methods like `splice`, `pop`, `shift` ARE useful — they return
 * the removed element(s). Common idioms must not be flagged by the
 * void-return-value-used rule.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/general/envelope-editor/envelope-editor-recipient-form.tsx:402
 *     `const [reorderedSigner] = items.splice(result.source.index, 1);`
 *   packages/lib/constants/auth.ts:116
 *     `const emailDomain = email.toLowerCase().split('@').pop();`
 *   packages/lib/server-only/document/find-document-audit-logs.ts:107
 *     `const nextItem = parsedData.pop();`
 */

import type { Signer } from '../../../user-service/src/models/signing.model';

export function reorderSigners(signers: readonly Signer[], from: number, to: number): Signer[] {
  // Canonical splice idiom: remove one element, get it, insert elsewhere.
  const items = [...signers];
  const [reorderedSigner] = items.splice(from, 1);
  if (reorderedSigner !== undefined) {
    items.splice(to, 0, reorderedSigner);
  }
  return items;
}

export function getEmailDomain(email: string): string | undefined {
  // Canonical chained idiom — split returns an array, pop returns its
  // last element.
  return email.toLowerCase().split('@').pop();
}

export function takeFirst<T>(queue: readonly T[]): T | undefined {
  // shift would mutate; use slicing instead but keep pop in chain to test.
  const copy = [...queue];
  return copy.shift();
}

export function deleteFromSet<T>(set: Set<T>, key: T): boolean {
  // `Set.prototype.delete` returns boolean indicating presence.
  return set.delete(key);
}
