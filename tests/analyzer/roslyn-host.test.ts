import { describe, it, expect } from 'vitest'
import {
  runRoslynHost,
  resolveRoslynHostBinary,
  RoslynHostUnavailableError,
} from '../../packages/analyzer/src/roslyn-host-client'

// These exercise the real .NET host. They run only when it's been built
// (`dotnet build -c Release tools/csharp-roslyn-host`); otherwise they skip.
const hostBuilt = resolveRoslynHostBinary() !== null

describe.skipIf(!hostBuilt)('Roslyn host client (semantic C#)', () => {
  it('flags ReferenceEquals on a value type — impossible without the type model', async () => {
    const violations = await runRoslynHost([
      {
        path: 'Pos.cs',
        text: 'class C { void M() { int a = 1; int b = 2; var x = object.ReferenceEquals(a, b); } }',
      },
    ])
    expect(violations.map((v) => v.ruleKey)).toContain('bugs/deterministic/referenceequals-on-value-type')
    expect(violations[0].path).toBe('Pos.cs')
    expect(violations[0].line).toBeGreaterThan(0)
  })

  it('does not flag ReferenceEquals on reference types', async () => {
    const violations = await runRoslynHost([
      {
        path: 'Neg.cs',
        text: 'class C { void M() { var a = new object(); var b = new object(); var x = object.ReferenceEquals(a, b); } }',
      },
    ])
    expect(violations).toEqual([])
  })

  it('respects the rule allow-list', async () => {
    const violations = await runRoslynHost(
      [{ path: 'Pos.cs', text: 'class C { void M() { int a = 1; var x = object.ReferenceEquals(a, a); } }' }],
      ['some/other/rule'],
    )
    expect(violations).toEqual([])
  })
})

describe('Roslyn host client — fail-hard when unavailable', () => {
  it('rejects with a clear error when the host binary is missing (no fallback)', async () => {
    const prev = process.env.TRUECOURSE_ROSLYN_HOST
    process.env.TRUECOURSE_ROSLYN_HOST = '/nonexistent/roslyn-host'
    try {
      await expect(runRoslynHost([{ path: 'A.cs', text: 'class C {}' }])).rejects.toBeInstanceOf(
        RoslynHostUnavailableError,
      )
    } finally {
      if (prev === undefined) delete process.env.TRUECOURSE_ROSLYN_HOST
      else process.env.TRUECOURSE_ROSLYN_HOST = prev
    }
  })
})
