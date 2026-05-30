import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJson, type ComplianceSeverity, type ComplianceStatus } from '../../packages/shared/src/types/spec-compliance'
import { runSpecComplianceAnalysis, type SpecComplianceArtifact } from '../../packages/core/src/services/spec-compliance.service'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtureRoot = join(repoRoot, 'tests/fixtures/spec-compliance-mixed-domain')

type FindingStatus = ComplianceStatus | 'unspecified'

function normalizeArtifact(artifact: SpecComplianceArtifact): SpecComplianceArtifact {
  return {
    ...artifact,
    metrics: {
      ...artifact.metrics,
      timingsMs: Object.fromEntries(
        Object.keys(artifact.metrics.timingsMs).map((key) => [key, 0]),
      ) as SpecComplianceArtifact['metrics']['timingsMs'],
    },
  }
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {} as Record<T, number>)
}

describe('mixed-domain spec compliance fixture', () => {
  it('evaluates OpenAPI, UI, auth, schema, infra/config, test, metrics, and cache facts together', async () => {
    const first = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['docs/**'],
      noLlm: true,
      showSatisfied: true,
    })
    const second = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['docs/**'],
      noLlm: true,
      showSatisfied: true,
    })

    expect(first.errors).toEqual([])
    expect(first.requirements).toHaveLength(16)
    expect(first.results).toHaveLength(16)
    expect(first.visibleResults).toHaveLength(16)
    expect(first.findings).toHaveLength(16)
    expect(first.summary).toMatchObject({
      requirements: 16,
      results: 16,
      visibleResults: 16,
      findings: 16,
    })

    expect(countBy(first.results.map((result) => result.status as FindingStatus))).toEqual({
      satisfied: 12,
      partial: 1,
      missing: 1,
      conflicting: 1,
      unverifiable: 1,
    })
    expect(first.summary.byStatus).toEqual({
      satisfied: 12,
      missing: 1,
      partial: 1,
      conflicting: 1,
      ambiguous: 0,
      unverifiable: 1,
      unspecified: 0,
    })
    expect(countBy(first.results.map((result) => result.severity as ComplianceSeverity))).toEqual({
      info: 12,
      error: 3,
      warning: 1,
    })
    expect(first.summary.bySeverity).toEqual({
      info: 12,
      warning: 1,
      error: 3,
    })

    expect(first.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining([
      'api.route',
      'api.response.status',
      'api.request.field',
      'auth.signal',
      'config.env',
      'ui.route',
      'ui.text',
      'ui.form_field',
      'data.table',
      'data.field',
      'data.index',
      'data.relation',
      'infra.compose.service',
      'infra.ci.job',
      'package.script',
      'test.case',
    ]))
    expect(Object.keys(first.metrics.timingsMs)).toEqual([
      'specDiscovery',
      'requirementExtraction',
      'factExtraction',
      'matching',
      'findingConversion',
      'total',
    ])
    expect(first.metrics.cache).toMatchObject({
      requirementCacheHits: 0,
      requirementCacheMisses: 0,
      skippedProseChunks: 0,
      llmCallCount: 0,
    })

    expect(canonicalJson(normalizeArtifact(second))).toBe(canonicalJson(normalizeArtifact(first)))
  })
})
