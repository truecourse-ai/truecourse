/**
 * Item 8 — the invariant-scenario schema: the optional `inputs` corpus binding and
 * the two property-expect step forms (`stableOnRerun`, `stdinFromStep`). A round-trip
 * proves every new field is OPTIONAL (existing corpora keep parsing), the refines
 * reject the illegal combinations, the pack manifest validates, and the `describe`
 * story helper renders an inputs-bearing scenario as "for every file in pack X: …".
 */

import { describe, it, expect } from 'vitest'
import {
  GuardScenarioSchema,
  GuardStepSchema,
  GuardPackManifestSchema,
  DEFAULT_INPUT_NAME,
  describeScenario,
  describeInputs,
  type GuardScenario,
} from '@truecourse/shared'

const BINDS = { doc: 'docs/fmt.md', section: 'fmt/idempotent', fingerprint: 'sha256:abc' }

function base(overrides: Partial<GuardScenario> = {}): unknown {
  return {
    guard: 1,
    id: 'idempotent.1',
    title: 'formatting is idempotent',
    binds: BINDS,
    driver: 'cli',
    steps: [{ run: ['fmt', 'input'], expect: { exit: 0 } }],
    ...overrides,
  }
}

describe('guard scenario — inputs + property expect forms (item 8)', () => {
  it('round-trips an invariant scenario with inputs + both property forms', () => {
    const parsed = GuardScenarioSchema.parse(
      base({
        inputs: { pack: 'inv-fmt-abc12345', as: 'input.json' },
        steps: [
          { run: ['fmt', 'input.json'], expect: { exit: 0 }, stableOnRerun: true },
          { run: ['parse'], stdinFromStep: 1, expect: { exit: 0 } },
        ],
      }),
    )
    expect(parsed.inputs).toEqual({ pack: 'inv-fmt-abc12345', as: 'input.json' })
    expect(parsed.steps[0].stableOnRerun).toBe(true)
    expect(parsed.steps[1].stdinFromStep).toBe(1)
  })

  it('keeps every new field optional — a v1 scenario with none still parses', () => {
    const parsed = GuardScenarioSchema.parse(base())
    expect(parsed.inputs).toBeUndefined()
    expect(parsed.steps[0].stableOnRerun).toBeUndefined()
    expect(parsed.steps[0].stdinFromStep).toBeUndefined()
  })

  it('makes inputs.as optional; describeInputs resolves the default staged name', () => {
    const parsed = GuardScenarioSchema.parse(base({ inputs: { pack: 'p1' } }))
    expect(parsed.inputs).toEqual({ pack: 'p1' })
    expect(describeInputs(parsed.inputs)).toEqual({ pack: 'p1', as: DEFAULT_INPUT_NAME })
  })

  it('rejects a step declaring both stdin and stdinFromStep', () => {
    const r = GuardStepSchema.safeParse({ run: ['parse'], stdin: 'x', stdinFromStep: 1, expect: { exit: 0 } })
    expect(r.success).toBe(false)
  })

  it('rejects a step declaring both repeat and stableOnRerun', () => {
    const r = GuardStepSchema.safeParse({ run: ['tick'], repeat: 2, stableOnRerun: true, expect: { exit: 0 } })
    expect(r.success).toBe(false)
  })

  it('rejects an empty inputs.pack', () => {
    expect(GuardScenarioSchema.safeParse(base({ inputs: { pack: '' } })).success).toBe(false)
  })

  it('round-trips a pack manifest with per-file provenance', () => {
    const manifest = GuardPackManifestSchema.parse({
      pack: 'inv-fmt-abc12345',
      provenance: 'seeded from docs/fmt.md#fmt/idempotent example blocks',
      files: [
        { name: 'sample-01', source: 'seed', note: 'canonical config' },
        { name: 'repro-77.json', source: 'user' },
      ],
    })
    expect(manifest.files).toHaveLength(2)
    expect(manifest.files[1].source).toBe('user')
  })

  it('describeScenario renders the inputs binding and the property sentences', () => {
    const scenario = GuardScenarioSchema.parse(
      base({
        claim: 'formatting never changes already-formatted input',
        inputs: { pack: 'inv-fmt-abc12345', as: 'input.json' },
        steps: [
          { run: ['fmt', 'input.json'], expect: { exit: 0 }, stableOnRerun: true },
          { run: ['parse'], stdinFromStep: 1, expect: { exit: 0 } },
        ],
      }),
    )
    const story = describeScenario(scenario)
    expect(story.inputs).toEqual({ pack: 'inv-fmt-abc12345', as: 'input.json' })
    // stableOnRerun folds into the step's expectation sentences.
    expect(story.steps[0].expectations.some((e) => /identical output/.test(e))).toBe(true)
    // stdinFromStep surfaces as a run-wiring note.
    expect(story.steps[1].stdinFromStep).toBe(1)
  })
})
