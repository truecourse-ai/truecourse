import { load as loadYaml } from 'js-yaml'
import {
  createRequirementId,
  type Requirement,
  type RequirementKind,
  type RequirementModality,
  type SourceRange,
  type SpecSourceKind,
} from '@truecourse/shared'
import { SPEC_STRUCTURED_EXTRACTOR } from './constants.js'
import { firstLineContaining, isRecord, splitLines } from './utils.js'

function parseStructuredContent(content: string, kind: SpecSourceKind): unknown {
  if (kind === 'json') return JSON.parse(content)
  if (kind === 'yaml') return loadYaml(content)
  return undefined
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
      kind: input.kind,
      modality: input.modality ?? 'must',
      subject: input.subject,
      action: input.action,
      object: input.object,
      constraints: input.constraints ?? [],
      acceptanceCriteria: input.acceptanceCriteria,
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

export function extractStructuredRequirements(sourceFile: string, content: string, kind: SpecSourceKind): Requirement[] | null {
  const parsed = parseStructuredContent(content, kind)
  if (!isRecord(parsed)) return null

  if (typeof parsed.openapi === 'string' || typeof parsed.swagger === 'string') {
    return extractOpenApiRequirements(sourceFile, content, parsed)
  }

  const knownRequirements = extractKnownRequirements(sourceFile, content, parsed)
  return knownRequirements.length > 0 ? knownRequirements : null
}
