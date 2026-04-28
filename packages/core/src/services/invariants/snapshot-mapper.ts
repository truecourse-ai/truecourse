import crypto from 'node:crypto'
import type { Violation } from '@truecourse/shared'
import type { ResolvedViolationRef, ViolationRecord } from '../../types/snapshot.js'

// ---------------------------------------------------------------------------
// Map invariant violations into the analyze pipeline's snapshot shape.
//
// Mirrors what `runViolationPipeline` does for rule findings: split current
// detections into added / unchanged / resolved by matching against the
// previous active set. Match key: `(invariantId, filePath, lineStart, title)`
// — stable enough that the same drift on the same site at the same severity
// is recognized as `unchanged` across analyze runs.
// ---------------------------------------------------------------------------

function comparisonKey(args: {
  invariantId: string
  filePath: string | null
  lineStart: number | null
  title: string
}): string {
  return `invariant::${args.invariantId}::${args.filePath ?? ''}::${args.lineStart ?? ''}::${args.title}`
}

function stableViolationId(args: {
  analysisId: string
  invariantId: string
  filePath: string | null
  lineStart: number | null
  title: string
}): string {
  // The persisted id is stable across runs as long as the comparison key is
  // stable — keeps `previousViolationId` chains intact under the same drift.
  return crypto
    .createHash('sha256')
    .update(comparisonKey(args))
    .digest('hex')
    .slice(0, 32)
}

export interface InvariantPipelineSplit {
  added: ViolationRecord[]
  unchanged: ViolationRecord[]
  resolved: ViolationRecord[]
  resolvedRefs: ResolvedViolationRef[]
}

export function mapInvariantViolations(opts: {
  current: Violation[]
  previousActive: ViolationRecord[]
  analysisId: string
  now: string
}): InvariantPipelineSplit {
  const { current, previousActive, analysisId, now } = opts

  const previousById = new Map<string, ViolationRecord>()
  for (const p of previousActive) {
    if (p.type !== 'invariant') continue
    const key = comparisonKey({
      invariantId: extractInvariantId(p),
      filePath: p.filePath,
      lineStart: p.lineStart,
      title: p.title,
    })
    previousById.set(key, p)
  }

  const added: ViolationRecord[] = []
  const unchanged: ViolationRecord[] = []
  const seenKeys = new Set<string>()

  for (const v of current) {
    if (!v.invariantId) continue // defensive — enforce.ts always sets this
    const key = comparisonKey({
      invariantId: v.invariantId,
      filePath: v.filePath ?? null,
      lineStart: v.lineStart ?? null,
      title: v.title,
    })
    seenKeys.add(key)

    const prev = previousById.get(key)
    const stableId = stableViolationId({
      analysisId,
      invariantId: v.invariantId,
      filePath: v.filePath ?? null,
      lineStart: v.lineStart ?? null,
      title: v.title,
    })

    if (prev) {
      // Carry forward firstSeen* + previousViolationId chain.
      unchanged.push({
        ...prev,
        // Re-stamp content + severity in case the LLM message changed slightly,
        // but keep lifecycle fields and the stable id.
        content: v.content,
        severity: v.severity,
        fixPrompt: v.fixPrompt ?? null,
        status: 'unchanged',
      })
    } else {
      // ruleKey shape: `invariants/<enforcement>/<invariantId>`. Mirrors the
      // static-rule key convention `<domain>/<type>/<rule>` so the violations
      // panel's existing `getDomain` + `getDetectionType` helpers work for
      // invariants without special cases. `enforcement` is set by the plugin
      // (`deterministic` | `llm` | `mixed`); default to `llm` for plugins
      // that didn't set it (today's rest-contract always sets).
      const enforcementSegment =
        v.enforcement === 'deterministic' ? 'deterministic' : 'llm'
      added.push({
        id: stableId,
        type: 'invariant',
        title: v.title,
        content: v.content,
        severity: v.severity,
        status: 'new',
        targetServiceId: null,
        targetDatabaseId: null,
        targetModuleId: null,
        targetMethodId: null,
        targetTable: null,
        relatedServiceId: null,
        relatedModuleId: null,
        fixPrompt: v.fixPrompt ?? null,
        ruleKey: `invariants/${enforcementSegment}/${v.invariantId}`,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
        previousViolationId: null,
        resolvedAt: null,
        filePath: v.filePath ?? null,
        lineStart: v.lineStart ?? null,
        lineEnd: v.lineEnd ?? null,
        columnStart: null,
        columnEnd: null,
        snippet: null,
        createdAt: now,
      })
    }
  }

  const resolved: ViolationRecord[] = []
  const resolvedRefs: ResolvedViolationRef[] = []
  for (const [key, prev] of previousById) {
    if (seenKeys.has(key)) continue
    resolved.push({
      ...prev,
      status: 'resolved',
      resolvedAt: now,
    })
    resolvedRefs.push({
      id: prev.id,
      resolvedAt: now,
    })
  }

  return { added, unchanged, resolved, resolvedRefs }
}

function extractInvariantId(rec: ViolationRecord): string {
  // Persisted form: `invariants/<enforcement>/<invariantId>`. Take the last
  // path segment as the id.
  if (rec.ruleKey.startsWith('invariants/')) {
    const idx = rec.ruleKey.lastIndexOf('/')
    return idx >= 0 ? rec.ruleKey.slice(idx + 1) : ''
  }
  return ''
}
