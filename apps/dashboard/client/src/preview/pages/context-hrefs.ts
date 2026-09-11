/**
 * Where the things of Context live, as addresses. One module, so a link from
 * the repository console, from a table row and from inside the coverage pane
 * all spell the same place the same way — and so no page has to import another
 * page to link to it.
 */

import { PREVIEW_BASE } from '@/preview/shell/base';

/** Context itself: the SOURCES, which is where the section lands. */
export const CONTEXT_BASE = `${PREVIEW_BASE}/context`;
export const DOCUMENTS_BASE = `${CONTEXT_BASE}/documents`;
export const CONFLICTS_BASE = `${CONTEXT_BASE}/conflicts`;

/** ONE source: its scope, the repositories that read it, and how it has synced. */
export function sourceHref(sourceId: string): string {
  return `${CONTEXT_BASE}/sources/${encodeURIComponent(sourceId)}`;
}

/** The documents, narrowed as asked — every dimension of the filter row is a parameter. */
export function documentsHref(narrow: {
  area?: string;
  status?: string;
  source?: string;
  repo?: string;
}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(narrow)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `${DOCUMENTS_BASE}?${query}` : DOCUMENTS_BASE;
}

/** One document, by its corpus ref; `repo` picks which repository it is read through. */
export function docHref(ref: string, repoId?: string): string {
  const query = repoId ? `?repo=${encodeURIComponent(repoId)}` : '';
  return `${CONTEXT_BASE}/doc/${encodeURIComponent(ref)}${query}`;
}

/** One conflict of the workspace corpus, with its resolver. */
export function conflictHref(conflictId: string): string {
  return `${CONFLICTS_BASE}/${encodeURIComponent(conflictId)}`;
}
