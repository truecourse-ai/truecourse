import { describe, it, expect } from 'vitest'
import { newRunNonce, scenarioUnique } from '@truecourse/guard-runner'

describe('scenarioUnique — the per-scenario `${unique}` token', () => {
  it('is stable for the same nonce + scenario id (stable across a scenario\'s steps)', () => {
    const nonce = newRunNonce()
    expect(scenarioUnique(nonce, 'version.1')).toBe(scenarioUnique(nonce, 'version.1'))
  })

  it('is distinct per scenario within one run (different ids → different tokens)', () => {
    const nonce = newRunNonce()
    expect(scenarioUnique(nonce, 'version.1')).not.toBe(scenarioUnique(nonce, 'version.2'))
  })

  it('is distinct across runs (a fresh nonce moves every scenario\'s token)', () => {
    expect(scenarioUnique(newRunNonce(), 'version.1')).not.toBe(scenarioUnique(newRunNonce(), 'version.1'))
  })

  it('is a short, lowercase-alphanumeric, filesystem/URL-safe token (8–12 chars)', () => {
    const token = scenarioUnique(newRunNonce(), 'a/b c.1')
    expect(token).toMatch(/^[a-z0-9]{8,12}$/)
  })

  it('newRunNonce yields a fresh value each call', () => {
    expect(newRunNonce()).not.toBe(newRunNonce())
  })
})
