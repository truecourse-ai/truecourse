import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runSpecComplianceAnalysis } from '../../packages/core/src/services/spec-compliance.service'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtureRoot = join(repoRoot, 'tests/fixtures/spec-compliance-cli')

describe('CLI spec compliance fixture', () => {
  it('matches Commander commands and package bin metadata against CLI requirements', async () => {
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
      satisfied: 5,
      missing: 1,
      partial: 0,
      conflicting: 1,
      ambiguous: 0,
      unverifiable: 0,
      unspecified: 0,
    })
    expect(artifact.facts.map((fact) => fact.kind)).toEqual(expect.arrayContaining([
      'cli.binary',
      'cli.command',
      'cli.option',
      'cli.argument',
    ]))
  })
})
