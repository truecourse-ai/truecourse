/**
 * Contracts for the web-sources registry — `.truecourse/specs/sources.json`
 * plus the markdown snapshot it indexes under `.truecourse/specs/sources/<id>/`.
 *
 * Both are committable (the `corpus.json` convention): the content is fetched
 * over the network and is not reproducible offline, so a fresh clone inherits a
 * working corpus without refetching. The registry is the OWNER of the snapshot
 * tree — a refresh only ever deletes files it names here.
 *
 * Unknown fields are dropped on parse (zod's default), so a registry written by
 * a later version still reads; the fields below are re-written on every update.
 */

import { z } from 'zod';

/** Why a link in the llms.txt produced no snapshot file. */
export const SourceSkipReasonSchema = z.enum([
  /** Not on the llms.txt's own origin — never fetched. */
  'external-origin',
  /** Fetched, but the page is not markdown (HTML-only pages are never converted). */
  'not-markdown',
  /** Unreachable after the bounded retries (status or transport error in `detail`). */
  'fetch-failed',
]);
export type SourceSkipReason = z.infer<typeof SourceSkipReasonSchema>;

export const SourceSkipSchema = z.object({
  url: z.string(),
  reason: SourceSkipReasonSchema,
  /** Status line or transport message — shown next to the reason, never parsed. */
  detail: z.string().optional(),
});
export type SourceSkip = z.infer<typeof SourceSkipSchema>;

export const SourceDocSchema = z.object({
  /**
   * The link URL from the llms.txt, normalized (no fragment, no query, no
   * trailing slash). This is the doc's IDENTITY across refreshes — the URL
   * actually fetched may differ (a `<url>.md` probe) but is derived from it.
   */
  url: z.string(),
  /** Snapshot path relative to `sources/<id>/`, forward slashes. */
  path: z.string(),
  /** The llms.txt link title (falls back to the last URL segment). */
  title: z.string(),
  /** sha256 hex of the snapshot content — the refresh diff key. */
  contentHash: z.string(),
});
export type SourceDoc = z.infer<typeof SourceDocSchema>;

export const SpecSourceSchema = z.object({
  /** Slug derived from the llms.txt host (+ path when it isn't at the origin root). */
  id: z.string().min(1),
  /** The llms.txt URL as registered — refetched verbatim on refresh. */
  llmsTxtUrl: z.string(),
  /** The llms.txt H1 (falls back to the host). */
  title: z.string(),
  fetchedAt: z.string(),
  docs: z.array(SourceDocSchema).default([]),
  skipped: z.array(SourceSkipSchema).default([]),
});
export type SpecSource = z.infer<typeof SpecSourceSchema>;

export const SourcesFileSchema = z.object({
  version: z.literal(1),
  sources: z.array(SpecSourceSchema).default([]),
});
export type SourcesFile = z.infer<typeof SourcesFileSchema>;
