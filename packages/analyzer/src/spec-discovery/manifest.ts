import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import {
  SPEC_COMPLIANCE_SPEC_MANIFEST_VERSION,
  type SpecComplianceConfig,
  type SpecExtractionManifest,
  type SpecFileManifest,
} from '@truecourse/shared'
import { SPEC_PROSE_EXTRACTOR, SPEC_STRUCTURED_EXTRACTOR, STRUCTURED_SPEC_EXTENSIONS } from './constants.js'
import { discoverSpecFiles } from './discovery.js'
import { parseSpecContent } from './prose.js'
import { extractStructuredRequirements } from './structured.js'
import { kindForPath, repoRelativePath, sha256 } from './utils.js'

export function createSpecExtractionManifest(
  rootDir: string,
  configInput: Partial<SpecComplianceConfig> = {},
): SpecExtractionManifest {
  const resolvedRoot = resolve(rootDir)
  const files = discoverSpecFiles(resolvedRoot, configInput)
  const manifests: SpecFileManifest[] = []

  for (const filePath of files) {
    const sourceFile = repoRelativePath(resolvedRoot, filePath)
    const kind = kindForPath(filePath)
    const isStructured = STRUCTURED_SPEC_EXTENSIONS.has(extname(filePath).toLowerCase())

    try {
      const content = readFileSync(filePath, 'utf8')
      const structuredRequirements = isStructured ? extractStructuredRequirements(sourceFile, content, kind) : []
      manifests.push({
        path: sourceFile,
        kind,
        hash: sha256(content),
        chunks: parseSpecContent(sourceFile, content, kind),
        requirements: structuredRequirements ?? [],
        status: kind === 'unsupported'
          || (isStructured && structuredRequirements === null)
          ? 'unsupported'
          : 'parsed',
        extractor: isStructured ? SPEC_STRUCTURED_EXTRACTOR : SPEC_PROSE_EXTRACTOR,
      })
    } catch (error) {
      let hash = ''
      try {
        hash = sha256(readFileSync(filePath, 'utf8'))
      } catch {
        hash = sha256('')
      }
      manifests.push({
        path: sourceFile,
        kind,
        hash,
        chunks: [],
        requirements: [],
        status: 'malformed',
        error: error instanceof Error ? error.message : 'Failed to parse spec file',
        extractor: isStructured ? SPEC_STRUCTURED_EXTRACTOR : SPEC_PROSE_EXTRACTOR,
      })
    }
  }

  return {
    schemaVersion: SPEC_COMPLIANCE_SPEC_MANIFEST_VERSION,
    extractor: SPEC_PROSE_EXTRACTOR,
    files: manifests,
  }
}
