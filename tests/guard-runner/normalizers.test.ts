import { describe, it, expect } from 'vitest'
import { normalize } from '@truecourse/guard-runner'

const ctx = { sandboxRoot: '/tmp/tc-guard-abc', repoRoot: '/home/dev/project' }

describe('normalizers', () => {
  it('timestamps → <TIMESTAMP>', () => {
    expect(normalize('ran at 2026-07-04T02:18:05.957Z done', ['timestamps'], ctx)).toBe(
      'ran at <TIMESTAMP> done',
    )
    expect(normalize('at 2026-07-04 02:18:05 local', ['timestamps'], ctx)).toBe(
      'at <TIMESTAMP> local',
    )
  })

  it('abs-paths → <SANDBOX> / <REPO>', () => {
    const out = normalize(
      'out=/tmp/tc-guard-abc/work/x.js src=/home/dev/project/src/a.ts',
      ['abs-paths'],
      ctx,
    )
    expect(out).toBe('out=<SANDBOX>/work/x.js src=<REPO>/src/a.ts')
  })

  it('replaces the longer root first so a nested repo is not shadowed', () => {
    const nested = { sandboxRoot: '/tmp/s', repoRoot: '/tmp/s/repo' }
    expect(normalize('/tmp/s/repo/file and /tmp/s/other', ['abs-paths'], nested)).toBe(
      '<REPO>/file and <SANDBOX>/other',
    )
  })

  it('versions → <VERSION>', () => {
    expect(normalize('relkit v2.4.1 built', ['versions'], ctx)).toBe('relkit v<VERSION> built')
    expect(normalize('1.0.0-rc.2+build.9', ['versions'], ctx)).toBe('<VERSION>')
  })

  it('durations → <DURATION>', () => {
    expect(normalize('in 0ms', ['durations'], ctx)).toBe('in <DURATION>')
    expect(normalize('took 1.5s and 2h', ['durations'], ctx)).toBe('took <DURATION> and <DURATION>')
  })

  it('applies the canonical order regardless of listing order, only the requested set', () => {
    const input =
      'Built v2.4.1 at 2026-07-04T02:18:05.957Z in 12ms -> /tmp/tc-guard-abc/work/dist/bundle.js'
    const out = normalize(input, ['durations', 'versions', 'timestamps', 'abs-paths'], ctx)
    expect(out).toBe(
      'Built v<VERSION> at <TIMESTAMP> in <DURATION> -> <SANDBOX>/work/dist/bundle.js',
    )
  })

  it('leaves text untouched when no normalizers are requested', () => {
    const input = 'v2.4.1 at 2026-07-04T02:18:05.957Z'
    expect(normalize(input, [], ctx)).toBe(input)
  })
})
