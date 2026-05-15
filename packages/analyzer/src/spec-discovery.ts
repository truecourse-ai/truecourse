import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { minimatch } from 'minimatch'
import ignore from 'ignore'
import { load as loadYaml } from 'js-yaml'
import {
  SPEC_COMPLIANCE_SPEC_MANIFEST_VERSION,
  SpecComplianceConfigSchema,
  createRequirementId,
  createSpecChunkId,
  type ExtractorMetadata,
  type Requirement,
  type RequirementKind,
  type RequirementModality,
  type SourceRange,
  type SpecChunk,
  type SpecComplianceConfig,
  type SpecExtractionManifest,
  type SpecFileManifest,
  type SpecSourceKind,
} from '@truecourse/shared'

export const SPEC_PROSE_EXTRACTOR: ExtractorMetadata = {
  name: 'spec-prose-parser',
  version: '1.0.0',
}

export const SPEC_STRUCTURED_EXTRACTOR: ExtractorMetadata = {
  name: 'spec-structured-parser',
  version: '1.0.0',
}

const SUPPORTED_SPEC_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.text', '.json', '.yaml', '.yml'])
const STRUCTURED_SPEC_EXTENSIONS = new Set(['.json', '.yaml', '.yml'])
const DEFAULT_TRAVERSAL_EXCLUDED_DIRS = new Set([
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

interface Heading {
  line: number
  level: number
  text: string
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function repoRelativePath(rootDir: string, filePath: string): string {
  return normalizePath(relative(rootDir, filePath))
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function kindForPath(filePath: string): SpecSourceKind {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.md') return 'markdown'
  if (ext === '.mdx') return 'mdx'
  if (ext === '.txt' || ext === '.text') return 'text'
  if (ext === '.json') return 'json'
  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  return 'unsupported'
}

function matchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = normalizePath(pattern)
    return minimatch(relPath, normalized, { dot: true })
      || (normalized.startsWith('**/') && minimatch(relPath, normalized.slice(3), { dot: true }))
  })
}

function shouldIncludeSpec(relPath: string, config: SpecComplianceConfig): boolean {
  const normalized = normalizePath(relPath)
  if (matchesAny(normalized, config.excludeGlobs)) return false
  if (!matchesAny(normalized, config.specGlobs)) return false
  return SUPPORTED_SPEC_EXTENSIONS.has(extname(normalized).toLowerCase())
}

function isInsideGitWorkTree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.toString('utf8').trim() === 'true'
  } catch {
    return false
  }
}

function discoverSpecFilesViaGit(rootDir: string, config: SpecComplianceConfig): string[] | null {
  if (!isInsideGitWorkTree(rootDir)) return null

  let stdout: Buffer
  try {
    stdout = execFileSync(
      'git',
      ['-C', rootDir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
      { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    ) as Buffer
  } catch {
    return null
  }

  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((relPath) => shouldIncludeSpec(relPath, config))
    .sort()
    .map((relPath) => join(rootDir, relPath))
}

function loadWalkerIgnore(rootDir: string): ReturnType<typeof ignore> {
  const ig = ignore()
  const gitignorePath = join(rootDir, '.gitignore')
  const truecourseignorePath = join(rootDir, '.truecourseignore')

  if (existsSync(gitignorePath)) ig.add(readFileSync(gitignorePath, 'utf8'))
  if (existsSync(truecourseignorePath)) ig.add(readFileSync(truecourseignorePath, 'utf8'))

  ig.add([...DEFAULT_TRAVERSAL_EXCLUDED_DIRS].map((dir) => `${dir}/`))
  return ig
}

function discoverSpecFilesViaWalker(rootDir: string, config: SpecComplianceConfig): string[] {
  const files: string[] = []
  const ig = loadWalkerIgnore(rootDir)

  function traverse(currentPath: string): void {
    let entries: string[]
    try {
      entries = readdirSync(currentPath).sort()
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry)
      const relPath = repoRelativePath(rootDir, fullPath)

      let stat
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      const ignorePath = stat.isDirectory() ? `${relPath}/` : relPath
      if (DEFAULT_TRAVERSAL_EXCLUDED_DIRS.has(entry) && stat.isDirectory()) continue
      if (ig.ignores(ignorePath)) continue

      if (stat.isDirectory()) {
        traverse(fullPath)
      } else if (stat.isFile() && shouldIncludeSpec(relPath, config)) {
        files.push(fullPath)
      }
    }
  }

  traverse(rootDir)
  return files.sort((a, b) => repoRelativePath(rootDir, a).localeCompare(repoRelativePath(rootDir, b)))
}

export function discoverSpecFiles(rootDir: string, configInput: Partial<SpecComplianceConfig> = {}): string[] {
  const resolvedRoot = resolve(rootDir)
  const config = SpecComplianceConfigSchema.parse(configInput)
  const viaGit = discoverSpecFilesViaGit(resolvedRoot, config)
  if (viaGit !== null) return viaGit
  return discoverSpecFilesViaWalker(resolvedRoot, config)
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function trimBlankRange(lines: string[], start: number, end: number): SourceRange | null {
  let first = start
  let last = end

  while (first <= last && lines[first - 1]?.trim() === '') first++
  while (last >= first && lines[last - 1]?.trim() === '') last--

  if (first > last) return null
  return { startLine: first, endLine: last }
}

function findMarkdownHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = []
  let inFence = false
  let fenceMarker = ''

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    const fenceMatch = trimmed.match(/^(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      return
    }

    if (inFence) return

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!headingMatch) return

    headings.push({
      line: index + 1,
      level: headingMatch[1]!.length,
      text: headingMatch[2]!.trim(),
    })
  })

  return headings
}

function headingPathFor(headingStack: Heading[], heading: Heading): string[] {
  while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= heading.level) {
    headingStack.pop()
  }
  headingStack.push(heading)
  return headingStack.map((item) => item.text)
}

function createChunk(sourceFile: string, lines: string[], range: SourceRange, headingPath: string[]): SpecChunk {
  const text = lines.slice(range.startLine - 1, range.endLine).join('\n').trim()
  const hash = sha256(text)

  return {
    id: createSpecChunkId({
      sourceFile,
      sourceRange: range,
      text,
      extractorVersion: SPEC_PROSE_EXTRACTOR.version,
    }),
    sourceFile,
    sourceRange: range,
    headingPath,
    text,
    hash,
    extractor: SPEC_PROSE_EXTRACTOR,
  }
}

export function parseMarkdownSpec(sourceFile: string, content: string): SpecChunk[] {
  const lines = splitLines(content)
  const headings = findMarkdownHeadings(lines)
  const chunks: SpecChunk[] = []

  if (headings.length === 0) {
    const range = trimBlankRange(lines, 1, lines.length)
    return range ? [createChunk(sourceFile, lines, range, [])] : []
  }

  const preambleEnd = headings[0]!.line - 1
  const preambleRange = trimBlankRange(lines, 1, preambleEnd)
  if (preambleRange) chunks.push(createChunk(sourceFile, lines, preambleRange, []))

  const stack: Heading[] = []
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index]!
    const nextSameOrHigher = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level)
    const endLine = nextSameOrHigher ? nextSameOrHigher.line - 1 : lines.length
    const range = trimBlankRange(lines, heading.line, endLine)
    if (!range) continue

    chunks.push(createChunk(sourceFile, lines, range, headingPathFor(stack, heading)))
  }

  return chunks
}

function isTextBoundary(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (/^[A-Z][A-Z0-9 ,'"()/&:-]{2,}$/.test(trimmed)) return true
  if (/^[A-Z][\w '"()/&:-]{2,}:$/.test(trimmed)) return true
  return false
}

export function parseTextSpec(sourceFile: string, content: string): SpecChunk[] {
  const lines = splitLines(content)
  const boundaries: number[] = []

  lines.forEach((line, index) => {
    if (isTextBoundary(line)) boundaries.push(index + 1)
  })

  if (boundaries.length === 0) {
    const chunks: SpecChunk[] = []
    let start: number | null = null

    for (let lineNumber = 1; lineNumber <= lines.length; lineNumber++) {
      const isBlank = lines[lineNumber - 1]?.trim() === ''
      if (!isBlank && start === null) start = lineNumber
      if ((isBlank || lineNumber === lines.length) && start !== null) {
        const end = isBlank ? lineNumber - 1 : lineNumber
        const range = trimBlankRange(lines, start, end)
        if (range) chunks.push(createChunk(sourceFile, lines, range, []))
        start = null
      }
    }

    return chunks
  }

  return boundaries.flatMap((startLine, index) => {
    const endLine = index + 1 < boundaries.length ? boundaries[index + 1]! - 1 : lines.length
    const range = trimBlankRange(lines, startLine, endLine)
    return range ? [createChunk(sourceFile, lines, range, [lines[startLine - 1]!.trim().replace(/:$/, '')])] : []
  })
}

export function parseSpecContent(sourceFile: string, content: string, kind = kindForPath(sourceFile)): SpecChunk[] {
  if (kind === 'markdown' || kind === 'mdx') return parseMarkdownSpec(sourceFile, content)
  if (kind === 'text') return parseTextSpec(sourceFile, content)
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStructuredContent(content: string, kind: SpecSourceKind): unknown {
  if (kind === 'json') return JSON.parse(content)
  if (kind === 'yaml') return loadYaml(content)
  return undefined
}

function firstLineContaining(lines: string[], needles: string[], fallback = 1): number {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (needles.every((needle) => line.includes(needle))) return index + 1
  }
  return fallback
}

function findOpenApiOperationRange(lines: string[], path: string, method: string): SourceRange {
  const quotedPath = JSON.stringify(path)
  const pathLine = firstLineContaining(lines, [path], firstLineContaining(lines, [quotedPath], 1))
  const methodLine = firstLineContaining(lines.slice(pathLine - 1), [method], 1) + pathLine - 1
  return { startLine: Math.max(1, methodLine), endLine: Math.max(1, methodLine) }
}

function schemaNameFromRef(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1] || ref
}

function refPath(ref: string): string[] {
  if (!ref.startsWith('#/')) return []
  return ref.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function resolveRef(root: Record<string, unknown>, ref: string): unknown {
  return refPath(ref).reduce<unknown>((current, segment) => isRecord(current) ? current[segment] : undefined, root)
}

function resolveSchema(root: Record<string, unknown>, schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema)) return null
  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(root, schema.$ref)
    return isRecord(resolved) ? resolved : schema
  }
  return schema
}

function schemaHint(schema: unknown): unknown {
  if (!isRecord(schema)) return schema
  const ref = schema.$ref
  if (typeof ref === 'string') return schemaNameFromRef(ref)
  const type = schema.type
  if (typeof type === 'string') return type
  return schema
}

function requestSchemaHints(operation: Record<string, unknown>): unknown[] {
  const requestBody = operation.requestBody
  if (!isRecord(requestBody)) return []
  const content = requestBody.content
  if (!isRecord(content)) return []

  return Object.entries(content)
    .flatMap(([mediaType, media]) => {
      if (!isRecord(media)) return []
      const schema = media.schema
      return schema === undefined ? [] : [{ mediaType, schema: schemaHint(schema) }]
    })
}

function schemaFieldHints(root: Record<string, unknown>, schema: unknown): Array<{ name: string; required: boolean; schema?: unknown }> {
  const resolved = resolveSchema(root, schema)
  if (!resolved) return []
  const required = new Set(Array.isArray(resolved.required) ? resolved.required.filter((item): item is string => typeof item === 'string') : [])
  const properties = isRecord(resolved.properties) ? resolved.properties : {}
  return Object.entries(properties)
    .filter(([name]) => name.trim().length > 0)
    .map(([name, property]) => ({ name, required: required.has(name), schema: schemaHint(property) }))
}

function requestFieldHints(root: Record<string, unknown>, operation: Record<string, unknown>): unknown[] {
  const requestBody = operation.requestBody
  if (!isRecord(requestBody)) return []
  const content = requestBody.content
  if (!isRecord(content)) return []

  return Object.entries(content).flatMap(([mediaType, media]) => {
    if (!isRecord(media)) return []
    return schemaFieldHints(root, media.schema).map((field) => ({ mediaType, ...field }))
  })
}

function responseSchemaHints(operation: Record<string, unknown>): unknown[] {
  const responses = operation.responses
  if (!isRecord(responses)) return []

  return Object.entries(responses)
    .flatMap(([status, response]) => {
      if (!isRecord(response)) return []
      const content = response.content
      if (!isRecord(content)) return []
      return Object.entries(content).flatMap(([mediaType, media]) => {
        if (!isRecord(media)) return []
        const schema = media.schema
        return schema === undefined ? [] : [{ status, mediaType, schema: schemaHint(schema) }]
      })
    })
}

function responseFieldHints(root: Record<string, unknown>, operation: Record<string, unknown>): unknown[] {
  const responses = operation.responses
  if (!isRecord(responses)) return []

  return Object.entries(responses).flatMap(([status, response]) => {
    if (!isRecord(response) || !isRecord(response.content)) return []
    return Object.entries(response.content).flatMap(([mediaType, media]) => {
      if (!isRecord(media)) return []
      return schemaFieldHints(root, media.schema).map((field) => ({ status, mediaType, ...field }))
    })
  })
}

function statusCodeHints(operation: Record<string, unknown>): string[] {
  return isRecord(operation.responses) ? Object.keys(operation.responses).sort() : []
}

function securitySchemeHints(root: Record<string, unknown>, security: unknown[]): unknown[] {
  const schemes = isRecord(root.components) && isRecord(root.components.securitySchemes)
    ? root.components.securitySchemes
    : {}
  return security.flatMap((entry) => {
    if (!isRecord(entry)) return []
    return Object.keys(entry).sort().map((name) => ({ name, scheme: schemes[name] ?? null }))
  })
}

function securityHints(root: Record<string, unknown>, operation: Record<string, unknown>): unknown[] {
  const security = operation.security ?? root.security
  if (!Array.isArray(security) || security.length === 0) return []
  return security
}

function createRequirement(input: {
  sourceFile: string
  sourceRange: SourceRange
  kind: RequirementKind
  modality?: RequirementModality
  subject: string
  action: string
  object?: string
  constraints?: Array<{ type: string; value: unknown }>
  acceptanceCriteria?: string[]
  evidenceText: string
  confidence?: number
}): Requirement {
  return {
    id: createRequirementId({
      sourceFile: input.sourceFile,
      sourceRange: input.sourceRange,
      evidenceText: input.evidenceText,
      extractorVersion: SPEC_STRUCTURED_EXTRACTOR.version,
    }),
    sourceFile: input.sourceFile,
    sourceRange: input.sourceRange,
    kind: input.kind,
    modality: input.modality ?? 'must',
    subject: input.subject,
    action: input.action,
    object: input.object,
    constraints: input.constraints ?? [],
    acceptanceCriteria: input.acceptanceCriteria,
    evidenceText: input.evidenceText,
    confidence: input.confidence ?? 1,
    extractor: SPEC_STRUCTURED_EXTRACTOR,
  }
}

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'])

function extractOpenApiRequirements(sourceFile: string, content: string, root: Record<string, unknown>): Requirement[] {
  if (!isRecord(root.paths)) return []
  const lines = splitLines(content)
  const requirements: Requirement[] = []

  for (const [path, pathItem] of Object.entries(root.paths).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isRecord(pathItem)) continue

    for (const [method, operation] of Object.entries(pathItem).sort(([a], [b]) => a.localeCompare(b))) {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(operation)) continue

      const upperMethod = method.toUpperCase()
      const route = `${upperMethod} ${path}`
      const constraints: Array<{ type: string; value: unknown }> = []
      const summary = typeof operation.summary === 'string' ? operation.summary : undefined
      const operationId = typeof operation.operationId === 'string' ? operation.operationId : undefined
      const requests = requestSchemaHints(operation)
      const responses = responseSchemaHints(operation)
      const requestFields = requestFieldHints(root, operation)
      const responseFields = responseFieldHints(root, operation)
      const statusCodes = statusCodeHints(operation)
      const security = securityHints(root, operation)

      if (operationId) constraints.push({ type: 'operationId', value: operationId })
      if (statusCodes.length > 0) constraints.push({ type: 'statusCode', value: statusCodes })
      if (requests.length > 0) constraints.push({ type: 'requestSchema', value: requests })
      if (requestFields.length > 0) constraints.push({ type: 'requestField', value: requestFields })
      if (responses.length > 0) constraints.push({ type: 'responseSchema', value: responses })
      if (responseFields.length > 0) constraints.push({ type: 'responseField', value: responseFields })
      if (security.length > 0) constraints.push({ type: 'auth', value: security })
      if (security.length > 0) constraints.push({ type: 'securityScheme', value: securitySchemeHints(root, security) })

      const subject = summary ?? operationId ?? 'OpenAPI operation'
      const evidenceText = `${sourceFile} requires ${route}${summary ? ` (${summary})` : ''}.`

      requirements.push(createRequirement({
        sourceFile,
        sourceRange: findOpenApiOperationRange(lines, path, method),
        kind: 'api',
        subject,
        action: 'expose',
        object: route,
        constraints,
        evidenceText,
      }))
    }
  }

  return requirements
}

function normalizeRequirementKind(value: unknown): RequirementKind {
  const allowed = new Set<RequirementKind>(['api', 'ui', 'ux', 'auth', 'data', 'infra', 'config', 'cli', 'workflow', 'test', 'quality', 'unknown'])
  return typeof value === 'string' && allowed.has(value as RequirementKind) ? value as RequirementKind : 'unknown'
}

function normalizeRequirementModality(value: unknown): RequirementModality {
  const allowed = new Set<RequirementModality>(['must', 'should', 'may', 'must_not'])
  return typeof value === 'string' && allowed.has(value as RequirementModality) ? value as RequirementModality : 'must'
}

function extractKnownRequirements(sourceFile: string, content: string, root: Record<string, unknown>): Requirement[] {
  if (!Array.isArray(root.requirements)) return []
  const lines = splitLines(content)

  return root.requirements.flatMap((item, index) => {
    if (typeof item === 'string') {
      const line = firstLineContaining(lines, [item], index + 1)
      return [createRequirement({
        sourceFile,
        sourceRange: { startLine: line, endLine: line },
        kind: 'unknown',
        subject: 'specified system',
        action: 'satisfy',
        evidenceText: item,
      })]
    }

    if (!isRecord(item)) return []
    const evidenceText = typeof item.evidenceText === 'string'
      ? item.evidenceText
      : typeof item.text === 'string'
        ? item.text
        : typeof item.requirement === 'string'
          ? item.requirement
          : undefined
    if (!evidenceText) return []
    const line = firstLineContaining(lines, [evidenceText], index + 1)

    const subject = typeof item.subject === 'string' && item.subject.trim() ? item.subject : 'specified system'
    const action = typeof item.action === 'string' && item.action.trim() ? item.action : 'satisfy'
    const object = typeof item.object === 'string' && item.object.trim() ? item.object : undefined
    const acceptanceCriteria = Array.isArray(item.acceptanceCriteria)
      ? item.acceptanceCriteria.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : undefined

    return [createRequirement({
      sourceFile,
      sourceRange: { startLine: line, endLine: line },
      kind: normalizeRequirementKind(item.kind),
      modality: normalizeRequirementModality(item.modality),
      subject,
      action,
      object,
      constraints: Array.isArray(item.constraints)
        ? item.constraints.filter((value): value is { type: string; value: unknown } => isRecord(value) && typeof value.type === 'string' && 'value' in value)
        : [],
      acceptanceCriteria,
      evidenceText,
      confidence: 1,
    })]
  })
}

function extractStructuredRequirements(sourceFile: string, content: string, kind: SpecSourceKind): Requirement[] | null {
  const parsed = parseStructuredContent(content, kind)
  if (!isRecord(parsed)) return null

  if (typeof parsed.openapi === 'string' || typeof parsed.swagger === 'string') {
    return extractOpenApiRequirements(sourceFile, content, parsed)
  }

  const knownRequirements = extractKnownRequirements(sourceFile, content, parsed)
  return knownRequirements.length > 0 ? knownRequirements : null
}

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
