/**
 * The INCLUSION half of a document's row, in words.
 *
 * Coverage says what has been proven about a document the corpus holds;
 * inclusion says whether it holds it at all. The two never mix: a document in
 * the corpus wears its coverage word, one the corpus does not hold wears its
 * inclusion word, and the five coverage words gain no members.
 *
 * A decision changes nothing by itself. The next Document scan applies it, so a
 * row whose decision the corpus has not caught up with says exactly that.
 */

import {
  CONTEXT_DOCUMENT_STATUS_ORDER,
  CONTEXT_DOCUMENT_STATUS_WORD,
  CONTEXT_INCLUSION_WORD,
  contextDecisionPending,
  type ContextDocumentRow,
} from '@truecourse/shared';
import {
  CONTEXT_DOC_TONE,
  CONTEXT_INCLUSION_TONE,
  type StatusTone,
} from '@/preview/ui/status-word';

/** Every word a document's row can wear, worst first, the two neutral ones last. */
export const CONTEXT_ROW_WORD_ORDER = [
  ...CONTEXT_DOCUMENT_STATUS_ORDER,
  'not-included',
  'excluded',
] as const;

export type ContextRowWordKey = (typeof CONTEXT_ROW_WORD_ORDER)[number];

/** The one word a row wears: its coverage, or its standing when there is none. */
export function contextRowWordKey(row: ContextDocumentRow): ContextRowWordKey {
  if (row.status) return row.status;
  return row.inclusion === 'excluded' ? 'excluded' : 'not-included';
}

export function contextRowWord(key: ContextRowWordKey): { word: string; tone: StatusTone } {
  return key === 'not-included' || key === 'excluded'
    ? { word: CONTEXT_INCLUSION_WORD[key], tone: CONTEXT_INCLUSION_TONE[key] }
    : { word: CONTEXT_DOCUMENT_STATUS_WORD[key], tone: CONTEXT_DOC_TONE[key] };
}

/** What the next scan will do, for a decision the corpus has not applied yet. */
export function contextPendingLine(row: ContextDocumentRow): string | null {
  if (!contextDecisionPending(row)) return null;
  return row.decision === 'include' ? 'Included at the next scan' : 'Excluded at the next scan';
}

/**
 * The row's FACT: what the next scan will do when a decision is waiting for
 * one, else the scan's own words for leaving the document out.
 */
export function contextRowFact(row: ContextDocumentRow): string | null {
  return contextPendingLine(row) ?? (row.inCorpus ? null : row.skipReason);
}
