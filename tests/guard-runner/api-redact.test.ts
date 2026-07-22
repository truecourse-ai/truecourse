import { describe, it, expect } from 'vitest'
import { buildCredentialRedactor } from '@truecourse/guard-runner'

describe('buildCredentialRedactor', () => {
  it('is the identity function when no credentials are resolved', () => {
    const redact = buildCredentialRedactor(new Map())
    const text = 'Authorization: sekret-token'
    expect(redact(text)).toBe(text)
  })

  it('masks a resolved credential value as «cred:name»', () => {
    const redact = buildCredentialRedactor(new Map([['api-key', 'sekret-token']]))
    expect(redact('got header Authorization=sekret-token in the log')).toBe(
      'got header Authorization=«cred:api-key» in the log',
    )
  })

  it('masks every occurrence, across lines', () => {
    const redact = buildCredentialRedactor(new Map([['api-key', 'ST']]))
    expect(redact('ST\nprefix-ST-suffix')).toBe('«cred:api-key»\nprefix-«cred:api-key»-suffix')
  })

  it('masks multiple credentials, longest value first (no partial leak)', () => {
    const redact = buildCredentialRedactor(
      new Map([
        ['short', 'abc'],
        ['long', 'abcdef'],
      ]),
    )
    // The longer secret must win where it appears, not leak its `abc` prefix.
    expect(redact('value=abcdef and value=abc')).toBe('value=«cred:long» and value=«cred:short»')
  })

  it('ignores empty credential values (nothing to mask)', () => {
    const redact = buildCredentialRedactor(new Map([['empty', '']]))
    expect(redact('unchanged')).toBe('unchanged')
  })

  it('masks the JSON-escaped form of a value with a quote (invocation.json leak path)', () => {
    const secret = 'ab"cd'
    const redact = buildCredentialRedactor(new Map([['api-key', secret]]))
    // As it appears inside a JSON string body: the `"` is backslash-escaped.
    const jsonBody = JSON.stringify({ authorization: secret }) // {"authorization":"ab\"cd"}
    const out = redact(jsonBody)
    expect(out).not.toContain('ab\\"cd')
    expect(out).toContain('«cred:api-key»')
  })

  it('masks the JSON-escaped form of a control-char value (\\uXXXX leak path)', () => {
    // A secret carrying U+0001; JSON.stringify renders it as the six chars .
    const secret = `tok${String.fromCharCode(1)}en`
    const redact = buildCredentialRedactor(new Map([['api-key', secret]]))
    const escaped = JSON.stringify(secret).slice(1, -1) // token (backslash-u form)
    expect(escaped).not.toBe(secret)
    const out = redact(`body=${escaped}`)
    expect(out).not.toContain(escaped)
    expect(out).toContain('«cred:api-key»')
    // The raw form is still masked too.
    expect(redact(`raw=${secret}`)).toContain('«cred:api-key»')
  })
})
