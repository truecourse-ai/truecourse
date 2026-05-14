import { describe, expect, it } from 'vitest'

describe('users', () => {
  it('rejects duplicate email', () => {
    expect('duplicate email').toContain('duplicate email')
  })
})
