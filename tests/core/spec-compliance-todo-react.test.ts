import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../packages/shared/src/types/spec-compliance'
import { runSpecComplianceAnalysis } from '../../packages/core/src/services/spec-compliance.service'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtureRoot = join(repoRoot, 'tests/fixtures/spec-compliance-todo-react')

function normalizeTimings<T extends { metrics: { timingsMs: Record<string, number> } }>(artifact: T): T {
  return {
    ...artifact,
    metrics: {
      ...artifact.metrics,
      timingsMs: Object.fromEntries(
        Object.keys(artifact.metrics.timingsMs).map((key) => [key, 0]),
      ),
    },
  }
}

describe('todo React spec compliance fixture', () => {
  it('matches the todo app requirements against extracted React facts', async () => {
    const artifact = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['docs/**'],
      noLlm: true,
      showSatisfied: true,
    })

    expect(artifact.errors).toEqual([])
    expect(artifact.requirements).toHaveLength(7)
    expect(artifact.results).toHaveLength(7)
    expect(artifact.summary.byStatus).toEqual({
      satisfied: 7,
      missing: 0,
      partial: 0,
      conflicting: 0,
      ambiguous: 0,
      unverifiable: 0,
      unspecified: 0,
    })
    expect(artifact.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining([
      'ui.route',
      'ui.text',
      'ui.form_field',
      'ui.button',
      'package.script',
      'test.case',
    ]))
  })

  it('produces idempotent spec compliance artifacts across repeated runs', async () => {
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
    expect(second.errors).toEqual([])
    expect(first.summary).toEqual(second.summary)
    expect(canonicalJson(normalizeTimings(second))).toBe(canonicalJson(normalizeTimings(first)))
  })

  it('produces idempotent error results across repeated runs', async () => {
    const first = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['negative-specs/**'],
      noLlm: true,
      showSatisfied: true,
    })
    const second = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['negative-specs/**'],
      noLlm: true,
      showSatisfied: true,
    })

    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(first.summary).toMatchObject({
      requirements: 1,
      results: 1,
      findings: 2,
      byStatus: {
        satisfied: 0,
        missing: 1,
        partial: 0,
        conflicting: 0,
        ambiguous: 0,
        unverifiable: 0,
        unspecified: 1,
      },
      bySeverity: {
        info: 0,
        warning: 0,
        error: 1,
      },
    })
    expect(second.summary).toEqual(first.summary)
    expect(first.results).toHaveLength(1)
    expect(first.results[0]).toMatchObject({
      status: 'missing',
      severity: 'error',
      message: 'UI route "/archive" is missing.',
    })
    expect(canonicalJson(normalizeTimings(second))).toBe(canonicalJson(normalizeTimings(first)))
  })
})
