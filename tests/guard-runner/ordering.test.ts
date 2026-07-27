import { describe, it, expect } from 'vitest'
import { orderReadBeforeWrite } from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'

const binds = [{ doc: 'd.md', section: 's', fingerprint: 'sha256:x' }]

function cli(id: string): GuardScenario {
  return { guard: 2, id, title: id, binds, driver: 'cli', steps: [{ run: ['x'], expect: { exit: 0 } }], normalize: [] }
}
function api(id: string, methods: string[]): GuardScenario {
  return {
    guard: 2,
    id,
    title: id,
    binds,
    driver: 'api',
    steps: methods.map((m) => ({ request: { method: m as 'GET', path: '/x' }, expect: { status: 200 } })),
    normalize: [],
  }
}

describe('orderReadBeforeWrite — read-only api scenarios first', () => {
  it('moves every-step-GET/HEAD api scenarios ahead, preserving all other relative order', () => {
    const items = [
      { scenario: cli('c1') },
      { scenario: api('post', ['POST']) },
      { scenario: api('get', ['GET']) },
      { scenario: cli('c2') },
      { scenario: api('head', ['HEAD']) },
      { scenario: api('getpost', ['GET', 'POST']) },
    ]
    const ordered = orderReadBeforeWrite(items).map((i) => i.scenario.id)
    // Reads (get, head) first in their original relative order; then the rest
    // (c1, post, c2, getpost) in their original relative order.
    expect(ordered).toEqual(['get', 'head', 'c1', 'post', 'c2', 'getpost'])
  })

  it('is a no-op when there are no read-only api scenarios', () => {
    const items = [{ scenario: cli('c1') }, { scenario: api('post', ['POST']) }]
    expect(orderReadBeforeWrite(items).map((i) => i.scenario.id)).toEqual(['c1', 'post'])
  })

  it('is stable/deterministic (same input → same output, no randomness)', () => {
    const items = [{ scenario: api('a', ['GET']) }, { scenario: api('b', ['GET']) }, { scenario: cli('c') }]
    const once = orderReadBeforeWrite(items).map((i) => i.scenario.id)
    const twice = orderReadBeforeWrite(items).map((i) => i.scenario.id)
    expect(once).toEqual(twice)
    expect(once).toEqual(['a', 'b', 'c'])
  })
})
