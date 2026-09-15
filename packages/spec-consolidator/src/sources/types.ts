/**
 * What a fetch of a documentation site reports back beside its pages: the links
 * it did NOT turn into a document, and why.
 *
 * Unknown fields are dropped on parse (zod's default).
 */

import { z } from 'zod';

/** Why a link in the llms.txt produced no document. */
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
