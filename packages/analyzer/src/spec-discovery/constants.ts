import type { ExtractorMetadata } from '@truecourse/shared'

export const SPEC_PROSE_EXTRACTOR: ExtractorMetadata = {
  name: 'spec-prose-parser',
  version: '1.0.0',
}

export const SPEC_STRUCTURED_EXTRACTOR: ExtractorMetadata = {
  name: 'spec-structured-parser',
  version: '1.0.0',
}

export const SUPPORTED_SPEC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.text', '.json', '.yaml', '.yml'])
export const STRUCTURED_SPEC_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])
export const DEFAULT_TRAVERSAL_EXCLUDED_DIRS = new Set([
  '.git',
  '.truecourse',
  'node_modules',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'out',
])
