import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../packages/shared/src/types/spec-compliance'
import { runSpecComplianceAnalysis } from '../../packages/core/src/services/spec-compliance.service'
import type { ProseRequirementExtractionInput } from '../../packages/core/src/services/spec-requirement-extraction.service'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtureRoot = join(repoRoot, 'tests/fixtures/spec-compliance-prose-backend')

function clearGeneratedState(): void {
  rmSync(join(fixtureRoot, '.truecourse'), { recursive: true, force: true })
}

function normalizeVolatileMetrics<T extends {
  metrics: {
    timingsMs: Record<string, number>
    cache: Record<string, number>
  }
}>(artifact: T): T {
  return {
    ...artifact,
    metrics: {
      ...artifact.metrics,
      timingsMs: Object.fromEntries(
        Object.keys(artifact.metrics.timingsMs).map((key) => [key, 0]),
      ),
      cache: Object.fromEntries(
        Object.keys(artifact.metrics.cache).map((key) => [key, 0]),
      ),
    },
  }
}

function proseProvider() {
  const calls: ProseRequirementExtractionInput[] = []
  return {
    model: 'todo-prose-backend-test-provider',
    calls,
    async extractProseRequirements(input: ProseRequirementExtractionInput) {
      calls.push(input)
      return {
        requirements: [
          {
            kind: 'api',
            modality: 'must',
            subject: 'ping endpoint',
            action: 'expose',
            object: 'GET /ping',
            constraints: [{ type: 'statusCode', value: ['200'] }],
            evidenceText: 'The backend must expose a ping endpoint at GET /ping.',
            confidence: 0.97,
          },
          {
            kind: 'api',
            modality: 'must',
            subject: 'hello endpoint',
            action: 'expose',
            object: 'POST /hello',
            constraints: [{ type: 'requestField', value: [{ name: 'name', required: true }] }],
            evidenceText: 'The backend must expose a hello endpoint at POST /hello.',
            confidence: 0.97,
          },
        ],
      }
    },
  }
}

beforeEach(clearGeneratedState)
afterEach(clearGeneratedState)

describe('prose backend spec compliance fixture', () => {
  it('reports the missing hello endpoint idempotently across repeated prose-spec runs', async () => {
    const firstProvider = proseProvider()
    const secondProvider = proseProvider()
    const first = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['docs/api.md'],
      provider: firstProvider,
      showSatisfied: true,
    })
    const second = await runSpecComplianceAnalysis(fixtureRoot, {
      enabled: true,
      specs: ['docs/api.md'],
      provider: secondProvider,
      showSatisfied: true,
    })

    expect(firstProvider.calls).toHaveLength(1)
    expect(secondProvider.calls).toHaveLength(0)
    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(first.summary).toEqual({
      requirements: 2,
      facts: 5,
      results: 2,
      visibleResults: 2,
      findings: 2,
      byStatus: {
        satisfied: 1,
        missing: 1,
        partial: 0,
        conflicting: 0,
        ambiguous: 0,
        unverifiable: 0,
        unspecified: 0,
      },
      bySeverity: {
        info: 1,
        warning: 0,
        error: 1,
      },
    })
    expect(second.summary).toEqual(first.summary)
    expect(first.results.map((result) => ({
      object: result.evidence.requirement.object,
      status: result.status,
      severity: result.severity,
      message: result.message,
    }))).toEqual([
      {
        object: 'POST /hello',
        status: 'missing',
        severity: 'error',
        message: 'OpenAPI operation is missing for "hello endpoint": route, request fields unverifiable.',
      },
      {
        object: 'GET /ping',
        status: 'satisfied',
        severity: 'info',
        message: 'OpenAPI operation is satisfied for "ping endpoint".',
      },
    ])
    expect(canonicalJson(normalizeVolatileMetrics(second))).toBe(canonicalJson(normalizeVolatileMetrics(first)))
  })
})
