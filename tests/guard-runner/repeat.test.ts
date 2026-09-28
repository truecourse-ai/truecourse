import { describe, it, expect, afterEach } from 'vitest'
import {
  expandRepeat,
  loadScenarios,
  MAX_REPEAT_COUNT,
  repeatDefects,
  runGuard,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

/**
 * `${repeat:<count>:<text>}` — a long value written short, so a scenario can prove
 * a size limit without spelling thousands of characters out.
 */

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('expanding ${repeat}', () => {
  it('repeats the text the given number of times, beside other text', () => {
    expect(expandRepeat('${repeat:3:ab}')).toBe('ababab')
    expect(expandRepeat('x-${repeat:2:y}-${repeat:1:z}')).toBe('x-yy-z')
    expect(expandRepeat('${repeat:16001:a}')).toHaveLength(16001)
  })

  it('leaves a string without the token as it is', () => {
    expect(expandRepeat('user-${unique}')).toBe('user-${unique}')
  })
})

describe('what is wrong with a ${repeat}', () => {
  it('names a token that does not fit the grammar', () => {
    expect(repeatDefects({ steps: [{ run: '${repeat:a:16001}' }] })).toEqual([
      expect.stringContaining('is not a repeat token'),
    ])
    expect(repeatDefects({ body: '${repeat:0:a}' })).toHaveLength(1)
    expect(repeatDefects({ body: '${repeat:5:}' })).toHaveLength(1)
  })

  it('names a count over the ceiling', () => {
    expect(repeatDefects({ body: `\${repeat:${MAX_REPEAT_COUNT + 1}:a}` })).toEqual([
      expect.stringContaining(`the most is ${MAX_REPEAT_COUNT}`),
    ])
  })

  it('finds nothing in well-formed tokens', () => {
    expect(repeatDefects({ json: { notes: '${repeat:1001:a}' } })).toEqual([])
  })
})

describe('a scenario that writes ${repeat}', () => {
  it('is refused at load when the token is malformed', () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/bad-repeat.yaml',
      apiScenario({
        id: 'bad-repeat',
        binds: specBinds('cli/version'),
        steps: [
          { request: { method: 'POST', path: '/todos', json: { title: '${repeat:many:a}' } }, expect: { status: 201 } },
        ],
      }),
    )
    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toEqual([
      { file: expect.stringContaining('bad-repeat.yaml'), message: expect.stringContaining('is not a repeat token') },
    ])
  })

  it('sends the expanded value to the server', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeScenario(
      r,
      'api/long-title.yaml',
      apiScenario({
        id: 'long-title',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'POST', path: '/todos', json: { title: 'x-${repeat:2000:a}' } },
            expect: { status: 201, json: { title: { matches: '^x-a{2000}$' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios.find((s) => s.id === 'long-title')?.outcome).toBe('pass')
  })
})
