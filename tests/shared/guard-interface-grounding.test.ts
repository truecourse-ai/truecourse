/**
 * The schema half of the interface catalog's arrival: what a committed scenario
 * says about the SURFACE it was authored against (`interface`, and the supplied
 * dependencies it binds), and the setup record's `interfaces` step row.
 *
 * Both are ADDITIVE — the format version does not move, and a scenario written
 * before either field still parses.
 */

import { describe, it, expect } from 'vitest'
import {
  GUARD_FORMAT_VERSION,
  GuardCliScenarioSchema,
  GuardSetupTaxonomyKeySchema,
  GuardSetupTaxonomyStepSchema,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/a.md', section: 'a/b', fingerprint: 'sha256:x' }]

function scenario(over: Record<string, unknown> = {}): unknown {
  return {
    guard: GUARD_FORMAT_VERSION,
    id: 's.cli.1',
    title: 't',
    binds,
    driver: 'cli',
    steps: [{ run: ['version'], expect: { exit: 0 } }],
    normalize: [],
    ...over,
  }
}

describe('the scenario envelope — surface grounding', () => {
  it('parses without either field: a hand-written scenario is grounded on nothing', () => {
    const parsed = GuardCliScenarioSchema.parse(scenario())
    expect(parsed.interface).toBeUndefined()
    expect(parsed.needs).toBeUndefined()
  })

  it('carries the interface path it was authored against, with a fingerprint each', () => {
    const ref = { path: ['cli/version'], fingerprints: ['sha256:surface'] }
    expect(GuardCliScenarioSchema.parse(scenario({ interface: ref })).interface).toEqual(ref)
    // A ref with no ids at all states nothing and is refused.
    expect(
      GuardCliScenarioSchema.safeParse(scenario({ interface: { path: [], fingerprints: [] } })).success,
    ).toBe(false)
  })

  it('still reads the pre-interface spelling of the same ref', () => {
    const ref = { path: ['cli/version'], fingerprints: ['sha256:surface'] }
    expect(GuardCliScenarioSchema.parse(scenario({ journey: ref })).journey).toEqual(ref)
  })

  it('declares the supplied dependencies it binds, by catalog entry name', () => {
    expect(GuardCliScenarioSchema.parse(scenario({ needs: ['analysis-target'] })).needs).toEqual([
      'analysis-target',
    ])
    expect(GuardCliScenarioSchema.safeParse(scenario({ needs: [''] })).success).toBe(false)
  })
})

describe('the setup record — the interfaces step row', () => {
  it('is a step of the taxonomy, in run order after the catalog', () => {
    const keys = GuardSetupTaxonomyKeySchema.options
    expect(keys).toContain('interfaces')
    expect(keys.indexOf('interfaces')).toBeGreaterThan(keys.indexOf('catalog'))
  })

  it('records what the derivations disagreed about and how the session settled it', () => {
    const row = GuardSetupTaxonomyStepSchema.parse({
      key: 'interfaces',
      status: 'ok',
      inputFingerprint: 'sha256:inputs',
      diagnostics: [
        { surface: 'cli', kind: 'tree-missing-command', subject: 'relkit ship', detail: 'help lists it' },
      ],
      resolutions: [{ subject: 'relkit ship', resolution: 'probe-right', evidence: 'ran it, exit 0' }],
      changes: ['added cli/ship'],
    })
    expect(row.resolutions?.[0]?.resolution).toBe('probe-right')
  })

  it('refuses a resolution outside the four verdicts, and one with no evidence', () => {
    const base = { key: 'interfaces', status: 'ok', inputFingerprint: 'sha256:inputs' }
    expect(
      GuardSetupTaxonomyStepSchema.safeParse({
        ...base,
        resolutions: [{ subject: 'x', resolution: 'probably', evidence: 'e' }],
      }).success,
    ).toBe(false)
    expect(
      GuardSetupTaxonomyStepSchema.safeParse({
        ...base,
        resolutions: [{ subject: 'x', resolution: 'both', evidence: '' }],
      }).success,
    ).toBe(false)
  })
})
