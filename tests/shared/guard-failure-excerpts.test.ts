import { describe, it, expect } from 'vitest'
import {
  GuardFailureDetailSchema,
  GuardScenarioResultSchema,
  GuardBirthFindingSchema,
} from '../../packages/shared/src/guard/index'

// Fix 1 (PR 1): the mismatch/failure objects gained optional raw program-output
// excerpts (`stdout`/`stderr`). Optional so pre-change snapshots and fidelity
// findings (no program run) keep parsing — NO format-version bump.

describe('GuardFailureDetailSchema — program-output excerpts', () => {
  it('parses a failure carrying stdout/stderr excerpts', () => {
    const parsed = GuardFailureDetailSchema.parse({
      step: 1,
      expected: 'exit 3',
      actual: 'exit 2',
      stdout: 'usage: expense add --amount <n>\n',
      stderr: 'error: missing --amount\n',
    })
    expect(parsed.stdout).toContain('usage: expense add')
    expect(parsed.stderr).toContain('missing --amount')
  })

  it('parses an OLD failure with no excerpts (fields stay absent)', () => {
    const parsed = GuardFailureDetailSchema.parse({ step: 1, expected: 'exit 3', actual: 'exit 2' })
    expect(parsed.stdout).toBeUndefined()
    expect(parsed.stderr).toBeUndefined()
  })

  it('rides on a full scenario result', () => {
    const parsed = GuardScenarioResultSchema.parse({
      id: 's1',
      title: 't',
      binds: { doc: 'd.md', section: 'a', fingerprint: 'sha256:x' },
      outcome: 'fail',
      durationMs: 5,
      failure: { step: 2, expected: 'exit 0', actual: 'exit 7', stderr: 'boom\n' },
    })
    expect(parsed.failure?.stderr).toBe('boom\n')
    expect(parsed.failure?.stdout).toBeUndefined()
  })
})

describe('GuardBirthFindingSchema — program-output excerpts', () => {
  it('parses a birth finding carrying excerpts', () => {
    const parsed = GuardBirthFindingSchema.parse({
      doc: 'docs/cli.md',
      anchor: 'add',
      title: 'add records an expense',
      step: 1,
      expected: 'exit 3',
      actual: 'exit 2',
      stdout: 'ok',
      stderr: 'usage: add --amount\n',
    })
    expect(parsed.stdout).toBe('ok')
    expect(parsed.stderr).toContain('usage: add')
  })

  it('parses a fidelity finding with no excerpts (no program run)', () => {
    const parsed = GuardBirthFindingSchema.parse({
      doc: 'docs/cli.md',
      anchor: 'add',
      kind: 'fidelity',
      title: 'add records an expense',
      step: 1,
      expected: 'a scenario that verifies the claim',
      actual: 'the scenario asserts nothing',
    })
    expect(parsed.stdout).toBeUndefined()
    expect(parsed.stderr).toBeUndefined()
  })
})
