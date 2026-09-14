/**
 * The reconciliation every driver hands back: what the origin yields NOW,
 * against the ledger rows the workspace already holds. One definition, so a
 * site and a repository can never disagree about what "changed" means.
 */

import type { ContextDriverDocument, ContextLedgerEntry } from './types.js';

export interface ContextDiff {
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: string[];
}

export function diffAgainstLedger(
  documents: readonly ContextDriverDocument[],
  ledger: readonly ContextLedgerEntry[],
): ContextDiff {
  const stored = new Map(ledger.map((entry) => [entry.docId, entry.contentHash]));
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const doc of documents) {
    const prior = stored.get(doc.docId);
    if (prior === undefined) added.push(doc.docId);
    else if (prior !== doc.contentHash) changed.push(doc.docId);
    else unchanged.push(doc.docId);
  }
  const present = new Set(documents.map((doc) => doc.docId));
  const removed = ledger.map((entry) => entry.docId).filter((docId) => !present.has(docId));
  return { added, changed, removed, unchanged };
}
