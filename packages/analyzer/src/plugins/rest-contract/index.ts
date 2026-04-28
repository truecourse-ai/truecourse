import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { z } from 'zod'
import type { Invariant, InvariantDraft, Violation } from '@truecourse/shared'
import type {
  Plugin,
  DiscoverContext,
  EnforceContext,
  EstimateContext,
  InvariantEnforceEstimate,
} from '../types.js'
import { TOKEN_ESTIMATE } from '../types.js'
import { RestContractDeclarationSchema, type RestContractDeclaration } from './schema.js'
import { buildDiscoveryPrompt, buildEnforcementPrompt } from './prompts.js'

const TYPE = 'rest-contract'
const VERSION = 1

// ---------------------------------------------------------------------------
// LLM I/O schemas
// ---------------------------------------------------------------------------
//
// Discovery uses a *structured-fields* response. The LLM does NOT emit a
// free-form `obligationKey` — instead it emits a closed-enum `kind` plus the
// fields that identify the obligation (method/path, statusCode, fieldName,
// headerName, etc.). The plugin builds the canonical obligationKey
// deterministically from those fields, eliminating run-to-run naming drift
// (`validation:<field>` vs `request-body:<field>`, etc.).
//
// Multi-anchor is also taken away from the LLM: each obligation has a `sites`
// list enumerating every implementation file. The plugin expands one row × N
// sites into N drafts (same key, different anchor) so we no longer rely on
// the LLM to multi-emit identical keyed claims.
// ---------------------------------------------------------------------------

const KindSchema = z.enum([
  'status-code',
  'request-body',
  'response-body',
  'request-header',
  'response-header',
  'query-param',
  'path-param',
  'auth',
  'pagination',
  'idempotency',
  'error-envelope',
  'content-type',
  'versioning',
  'field-schema',
])

const SiteSchema = z.object({
  filePath: z.string().min(1),
  symbol: z.string().optional(),
})

// Flat schema with all per-kind discriminators optional — the conditional
// shape (kind → required fields) is validated in `buildObligationKey` below.
// Anthropic's CLI tool input schema rejects discriminated unions at the top
// level, so a flat object with optional fields is the most reliable shape.
const ClaimSchema = z.object({
  kind: KindSchema,
  claim: z.string(),
  // Endpoint identity — required for every kind except field-schema.
  method: z.string().optional(),
  path: z.string().optional(),
  // Per-kind discriminators
  statusCode: z.number().int().optional(), // status-code, error-envelope
  fieldName: z.string().optional(),         // request-body (field-level), field-schema
  headerName: z.string().optional(),        // request-header, response-header
  paramName: z.string().optional(),         // query-param, path-param
  contentType: z.string().optional(),       // content-type
  entity: z.string().optional(),            // field-schema
  pathPrefix: z.string().optional(),        // versioning
  authScope: z.string().optional(),         // auth (when not per-endpoint)
  // Multi-anchor: every implementation file the obligation must hold at.
  // The plugin expands this into one draft per site, all sharing the
  // plugin-built obligationKey.
  sites: z.array(SiteSchema).min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
})

const DiscoveryResponseSchema = z.object({
  claims: z.array(ClaimSchema),
})

// Build the canonical obligationKey from the structured fields. Returns null
// when required fields are missing for the claim's kind — the caller logs
// and drops the claim.
function buildObligationKey(c: z.infer<typeof ClaimSchema>): string | null {
  const ep = (): string | null => {
    if (!c.method || !c.path) return null
    return `${c.method.toUpperCase()} ${c.path}`
  }
  switch (c.kind) {
    case 'status-code': {
      const e = ep()
      if (!e || c.statusCode == null) return null
      return `${e} status-${c.statusCode}`
    }
    case 'request-body': {
      const e = ep()
      if (!e) return null
      return c.fieldName ? `${e} request-body:${c.fieldName}` : `${e} request-body`
    }
    case 'response-body': {
      const e = ep()
      if (!e) return null
      return `${e} response-body`
    }
    case 'request-header': {
      const e = ep()
      if (!e || !c.headerName) return null
      return `${e} request-header:${c.headerName.toLowerCase()}`
    }
    case 'response-header': {
      const e = ep()
      if (!e || !c.headerName) return null
      return `${e} response-header:${c.headerName.toLowerCase()}`
    }
    case 'query-param': {
      const e = ep()
      if (!e || !c.paramName) return null
      return `${e} query-param:${c.paramName}`
    }
    case 'path-param': {
      const e = ep()
      if (!e || !c.paramName) return null
      return `${e} path-param:${c.paramName}`
    }
    case 'auth': {
      const e = ep()
      // auth can be per-endpoint or repo-wide via authScope
      if (e) return `${e} auth`
      if (c.authScope) return `${c.authScope} auth`
      return null
    }
    case 'pagination': {
      const e = ep()
      if (!e) return null
      return `${e} pagination`
    }
    case 'idempotency': {
      const e = ep()
      if (!e) return null
      return `${e} idempotency`
    }
    case 'error-envelope': {
      const e = ep()
      if (!e || c.statusCode == null) return null
      return `${e} error-envelope:${c.statusCode}`
    }
    case 'content-type': {
      const e = ep()
      if (!e || !c.contentType) return null
      return `${e} content-type:${c.contentType}`
    }
    case 'versioning': {
      if (!c.pathPrefix) return null
      return `${c.pathPrefix} versioning`
    }
    case 'field-schema': {
      if (!c.entity || !c.fieldName) return null
      return `${c.entity}.${c.fieldName}`
    }
  }
}

// Flat object schema (NOT z.union) — Anthropic's CLI rejects top-level `oneOf`
// because the resulting JSON schema lacks a top-level `type` field. We
// validate the conditional shape (lineStart/lineEnd/message required when
// !satisfied) in the handler instead.
const EnforcementResponseSchema = z.object({
  satisfied: z.boolean(),
  lineStart: z.number().int().nonnegative().optional(),
  lineEnd: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  fixSuggestion: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Discover — extract claims from each spec section
// ---------------------------------------------------------------------------

// Files relevant to rest-contract live near the API surface. A repo with
// hundreds of files (test fixtures, infra, shared utils) makes it hard for
// the LLM to pick a sensible anchor; narrowing to handler/controller/route/
// model/schema files dramatically improves anchor selection without losing
// signal — claims that need code outside this set are rare in practice.
const API_SURFACE_PATTERNS = [
  /\/(handlers?)\//,
  /\/(controllers?)\//,
  /\/(routes?)\//,
  /\/(api)\//,
  /\.handler\.[tj]sx?$/,
  /\.controller\.[tj]sx?$/,
  /\.routes?\.[tj]sx?$/,
  /\/(models?)\//,
  /\/(schemas?)\//,
  /\/(types?)\//,
  /\/prisma\//,
  /\.model\.[tj]sx?$/,
  /\.schema\.[tj]sx?$/,
]

function isApiSurfaceFile(relPath: string): boolean {
  if (/\.test\.[tj]sx?$/.test(relPath) || /\.spec\.[tj]sx?$/.test(relPath)) return false
  return API_SURFACE_PATTERNS.some((p) => p.test(relPath))
}

async function discover(ctx: DiscoverContext): Promise<InvariantDraft[]> {
  if (ctx.spec.empty) return []

  const allFiles = ctx.files.map((f) => path.relative(ctx.repoPath, f.filePath))
  const apiFiles = allFiles.filter(isApiSurfaceFile)
  // Fall back to the unfiltered list when the heuristic finds nothing — better
  // to risk noisy anchors than zero anchors on projects with unconventional
  // layouts.
  const codeFiles = apiFiles.length > 0 ? apiFiles : allFiles

  const sectionsToScan = ctx.mode === 'diff' && ctx.diff
    ? ctx.spec.sections.filter((s) => ctx.diff!.changedSpecSectionIds.includes(s.id))
    : ctx.spec.sections

  const drafts: InvariantDraft[] = []
  const total = sectionsToScan.length

  // Cross-section dedup: two claims with the same `(anchorPath,
  // obligationKey)` are treated as the same obligation. The plugin builds
  // `obligationKey` deterministically from the LLM's structured fields, so
  // run-to-run naming variance can no longer leak through. First occurrence
  // wins so the earliest-section provenance is preserved when an
  // Error-codes-style section recapitulates per-endpoint claims.
  const seenObligations = new Set<string>()

  for (let i = 0; i < sectionsToScan.length; i++) {
    const section = sectionsToScan[i]
    ctx.report?.({
      kind: 'plugin-progress',
      plugin: TYPE,
      current: i + 1,
      total,
      label: section.heading,
    })

    let response: z.infer<typeof DiscoveryResponseSchema>
    try {
      response = await ctx.llm.run({
        prompt: buildDiscoveryPrompt(section, codeFiles),
        schema: DiscoveryResponseSchema,
        label: `${TYPE}-discover`,
      })
    } catch (err) {
      // Strict response schema rejects malformed responses. When parse fails
      // we lose the whole section's claims this run — log enough detail to
      // spot whether it's an LLM regression or a prompt regression.
      console.warn(
        `[rest-contract] discover failed for section ${section.id} ` +
        `(${section.sourcePath}#${section.heading}): ${(err as Error).message}`,
      )
      continue
    }

    for (const claim of response.claims) {
      // Build the canonical obligationKey from structured fields. Drops
      // claims missing required-for-kind fields (e.g. status-code without
      // statusCode) with a warning — the LLM produced an unanchorable row.
      const obligationKey = buildObligationKey(claim)
      if (!obligationKey) {
        console.warn(
          `[rest-contract] dropping claim with insufficient fields for kind=${claim.kind} ` +
          `(section=${section.id}, claim="${claim.claim.slice(0, 80)}…")`,
        )
        continue
      }

      // Expand one claim × N sites into one draft per site. Each draft has
      // the same `obligationKey` and `claim` text but a distinct
      // `codeAnchor`. Empty-string filePaths are filtered defensively.
      for (const site of claim.sites) {
        const anchorPath = site.filePath.trim()
        if (anchorPath.length === 0) continue

        const dedupKey = `${anchorPath}::${obligationKey}`
        if (seenObligations.has(dedupKey)) continue
        seenObligations.add(dedupKey)

        const declaration: RestContractDeclaration = {
          kind: claim.kind,
          claim: claim.claim,
          obligationKey,
          sourceSection: section.id,
          codeAnchor: { filePath: anchorPath, symbol: site.symbol },
          enforcement: 'llm',
        }
        drafts.push({
          id: crypto.randomUUID(),
          type: TYPE,
          pluginVersion: VERSION,
          scope: section.id,
          declaration,
          provenance: {
            source: 'discovered',
            inputs: ['spec', 'code'],
            timestamp: new Date().toISOString(),
            signal: `extracted from ${section.sourcePath}`,
            specSection: section.id,
          },
          rationale: claim.rationale,
          confidence: claim.confidence,
        })
      }
    }
  }

  return drafts
}

// ---------------------------------------------------------------------------
// Enforce — for each invariant, compare claim against the anchored code
// ---------------------------------------------------------------------------

async function enforce(invariant: Invariant, ctx: EnforceContext): Promise<Violation[]> {
  if (!ctx.llm) {
    // No provider available — user opted out of LLM checks. Skip cleanly.
    return []
  }

  const declaration = invariant.declaration as RestContractDeclaration
  const anchorPath = declaration.codeAnchor.filePath
  if (!anchorPath) return [] // v1: skip claims without a code anchor

  const abs = path.isAbsolute(anchorPath) ? anchorPath : path.join(ctx.repoPath, anchorPath)
  if (!fs.existsSync(abs)) return [] // anchor missing — surfaced via checkAnchor, not enforcement

  const rawCodeContent = fs.readFileSync(abs, 'utf-8')
  // Strip test-only marker comments before sending to the enforcement LLM.
  // `// INVARIANT-DRIFT:` and `// VIOLATION:` comments document expected
  // contract violations for the test suite — feeding them to the LLM
  // confuses it (it interprets them as intent statements that legitimize
  // the drift, returning satisfied=true on actual bugs).
  // Build a stripped→raw line map so violations the LLM reports against the
  // stripped view can be translated back to raw-file coordinates (otherwise
  // both the dashboard and the test marker comparison point at the wrong
  // line).
  const rawLines = rawCodeContent.split('\n')
  const keptRawLines: string[] = []
  const strippedToRaw: number[] = [0] // 1-indexed; index 0 is a sentinel
  for (let i = 0; i < rawLines.length; i++) {
    if (/^\s*\/\/\s*(INVARIANT-DRIFT|VIOLATION):/i.test(rawLines[i])) continue
    keptRawLines.push(rawLines[i])
    strippedToRaw.push(i + 1) // raw line numbers are 1-indexed
  }
  const codeContent = keptRawLines.join('\n')
  const mapLine = (n: number): number => {
    if (n <= 0) return 0
    if (n >= strippedToRaw.length) return strippedToRaw[strippedToRaw.length - 1]
    return strippedToRaw[n]
  }

  let response: z.infer<typeof EnforcementResponseSchema>
  try {
    response = await ctx.llm.run({
      prompt: buildEnforcementPrompt({
        claim: declaration.claim,
        kind: declaration.kind,
        codeContent,
        filePath: anchorPath,
      }),
      schema: EnforcementResponseSchema,
      label: `${TYPE}-enforce`,
    })
  } catch {
    return []
  }

  if (response.satisfied) return []

  // Schema is permissive (single object with optional fields) so the LLM CLI
  // accepts a top-level type. Validate the conditional shape here: a violation
  // must have a message; lineStart/lineEnd default to 0 if the LLM omitted
  // them. Translate from stripped to raw coordinates before storing.
  const message = response.message ?? `Code drifts from spec claim: ${declaration.claim}`
  const rawStart = mapLine(response.lineStart ?? 0)
  const rawEnd = response.lineEnd != null ? mapLine(response.lineEnd) : rawStart
  const lineStart = rawStart
  const lineEnd = rawEnd

  return [
    {
      id: crypto.randomUUID(),
      type: 'invariant',
      title: `Spec drift: ${declaration.kind}`,
      content: message,
      severity: 'high',
      invariantId: invariant.id,
      enforcement: 'llm',
      fixPrompt: response.fixSuggestion,
      createdAt: new Date().toISOString(),
      filePath: anchorPath,
      lineStart,
      lineEnd,
    },
  ]
}

// ---------------------------------------------------------------------------
// Pre-flight cost — one LLM call per anchored claim. Token count scales with
// the anchored file's size + claim text + per-call overheads, mirroring the
// rule-LLM estimator's chars-per-token model so the two costs are
// comparable. No I/O when the caller pre-loaded file contents; otherwise a
// single fs.statSync per invariant (cheap).
// ---------------------------------------------------------------------------

function estimateEnforce(
  invariant: Invariant,
  ctx: EstimateContext,
): InvariantEnforceEstimate {
  const declaration = invariant.declaration as RestContractDeclaration
  const anchorPath = declaration.codeAnchor.filePath
  if (!anchorPath) return { llmCalls: 0, estimatedTokens: 0 }

  const abs = path.isAbsolute(anchorPath) ? anchorPath : path.join(ctx.repoPath, anchorPath)

  let codeChars = 0
  const cached = ctx.fileContents?.get(abs)
  if (cached !== undefined) {
    codeChars = cached.length
  } else {
    try {
      codeChars = fs.statSync(abs).size
    } catch {
      // anchor missing — surfaced via checkAnchor; enforce will return [].
      // Predict zero so we don't inflate the prompt with phantom cost.
      return { llmCalls: 0, estimatedTokens: 0 }
    }
  }

  const claimChars = declaration.claim.length
  const contentTokens = Math.ceil((codeChars + claimChars) / TOKEN_ESTIMATE.CHARS_PER_TOKEN)
  const tokens = contentTokens + TOKEN_ESTIMATE.PROMPT_OVERHEAD + TOKEN_ESTIMATE.RESPONSE_OVERHEAD
  return { llmCalls: 1, estimatedTokens: tokens, filePaths: [abs] }
}

// ---------------------------------------------------------------------------
// Anchor check — does the spec section + anchored file still exist?
// ---------------------------------------------------------------------------

function checkAnchor(invariant: Invariant, ctx: DiscoverContext): 'present' | 'missing' {
  const declaration = invariant.declaration as RestContractDeclaration
  const sectionExists = ctx.spec.sections.some((s) => s.id === declaration.sourceSection)
  if (!sectionExists) return 'missing'
  if (declaration.codeAnchor.filePath) {
    const abs = path.isAbsolute(declaration.codeAnchor.filePath)
      ? declaration.codeAnchor.filePath
      : path.join(ctx.repoPath, declaration.codeAnchor.filePath)
    if (!fs.existsSync(abs)) return 'missing'
  }
  return 'present'
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const restContractPlugin: Plugin = {
  type: TYPE,
  version: VERSION,
  metadata: {
    name: 'REST Contract',
    description:
      'Extracts REST API contract claims (status codes, request/response shapes, headers, query/path params, auth, pagination, error envelope, field schemas) from spec sections and verifies each claim against the anchored handler/controller/route/model. Flags divergence between what the spec says and what the code does.',
    enforcement: 'llm',
    defaultSeverity: 'high',
  },
  declarationSchema: RestContractDeclarationSchema,
  discover,
  enforce,
  estimateEnforce,
  checkAnchor,
}
