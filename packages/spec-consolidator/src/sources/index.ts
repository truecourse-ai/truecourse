/**
 * Web spec sources — the llms.txt half of the doc universe.
 *
 * A registered docs site is fetched once (`addSource`) into a committable
 * markdown snapshot under `.truecourse/specs/sources/<id>/`, and reconciled with
 * the site on demand (`refreshSource`). Nothing here is prompt-aware and nothing
 * caches an LLM call: `spec scan` stays offline and deterministic because the
 * network is touched only by these entry points.
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
  addSource,
  refreshSource,
  removeSource,
  listSources,
  readSourcesFile,
  writeSourcesFile,
  sourcesFilePath,
  sourcesDirPath,
  sourceDirPath,
  sourceDocRef,
  sourceIdFromUrl,
  slugifyId,
  urlToSnapshotPath,
  mapUrlsToPaths,
  hashContent,
  SOURCES_REF_PREFIX,
} from './store.js';
export type { AddSourceOptions, AddSourceResult, RefreshSourceResult } from './store.js';

export {
  SourceSkipReasonSchema,
  SourceSkipSchema,
  SourceDocSchema,
  SpecSourceSchema,
  SourcesFileSchema,
} from './types.js';
export type { SourceSkipReason, SourceSkip, SourceDoc, SpecSource, SourcesFile } from './types.js';

export {
  InvalidSourceUrlError,
  LlmsTxtFetchError,
  SourceExistsError,
  SourceNotFoundError,
  SourcesFileError,
  SourcePathError,
} from './errors.js';
