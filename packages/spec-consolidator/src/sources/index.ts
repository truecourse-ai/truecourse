/**
 * Web spec sources — the llms.txt half of the doc universe.
 *
 * A documentation site is read through its llms.txt: the index is parsed, every
 * link on the site's own origin is fetched as markdown, and each page comes
 * back with the path and content hash its caller stores it under. Nothing here
 * is prompt-aware and nothing caches an LLM call: the scan stays offline and
 * deterministic because the network is touched only by these entry points.
 */

export { parseLlmsTxt, flattenLinks, normalizeSourceUrl } from './llms-txt.js';
export type { LlmsTxtDoc, LlmsTxtSection, LlmsTxtLink } from './llms-txt.js';

export {
  assertLlmsTxtUrl,
  fetchLlmsTxt,
  fetchPages,
  partitionByOrigin,
  previewSource,
  USER_AGENT,
} from './fetcher.js';
export type { FetchOptions, FetchProgress, FetchPagesResult, FetchedPage, SourcePreview } from './fetcher.js';

export {
  urlToSnapshotPath,
  mapUrlsToPaths,
  hashContent,
  sourceIdFromUrl,
  slugifyId,
} from './paths.js';

export { SourceSkipReasonSchema, SourceSkipSchema } from './types.js';
export type { SourceSkipReason, SourceSkip } from './types.js';

export { InvalidSourceUrlError, LlmsTxtFetchError, SourcePathError } from './errors.js';

export { fetchPublicSource, SourceNetworkPolicyError } from './public-fetch.js';
