import { describe, it, expect } from 'vitest'
import { CookieJar, defaultCookiePath, cookiePathMatches } from '@truecourse/guard-runner'

describe('cookie jar — parsing and storage', () => {
  it('stores a name=value cookie and replays it', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc123; Path=/; HttpOnly; SameSite=Lax'], '/login')
    expect(jar.header('/me')).toBe('sid=abc123')
    expect(jar.size).toBe(1)
  })

  it('a later Set-Cookie for the same name+path replaces the earlier value', () => {
    const jar = new CookieJar()
    jar.store(['sid=one; Path=/'], '/login')
    jar.store(['sid=two; Path=/'], '/login')
    expect(jar.header('/me')).toBe('sid=two')
    expect(jar.size).toBe(1)
  })

  it('keeps multiple cookies and joins them on one header', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/', 'theme=dark; Path=/'], '/login')
    expect(jar.header('/me')).toBe('sid=abc; theme=dark')
  })

  it('ignores a Set-Cookie with no name=value pair', () => {
    const jar = new CookieJar()
    // No `=` at all, a nameless pair, and an empty line — none of them name a cookie.
    // (Per §5.2 the FIRST pair is always the cookie itself, attribute-looking or not.)
    jar.store(['HttpOnly', '=novalue', ''], '/login')
    expect(jar.size).toBe(0)
    expect(jar.header('/me')).toBeUndefined()
  })

  it('stores Secure and HttpOnly cookies normally (loopback http, no browser DOM)', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/; Secure; HttpOnly'], '/login')
    expect(jar.header('/me')).toBe('sid=abc')
  })
})

describe('cookie jar — path scoping', () => {
  it('defaults the path to the request default-path (RFC 6265 §5.1.4)', () => {
    expect(defaultCookiePath('/login')).toBe('/')
    expect(defaultCookiePath('/')).toBe('/')
    expect(defaultCookiePath('/api/v1/login')).toBe('/api/v1')
    expect(defaultCookiePath('/api/v1/login?next=/x')).toBe('/api/v1')
    expect(defaultCookiePath('relative')).toBe('/')
  })

  it('path-matches prefixes only on a segment boundary', () => {
    expect(cookiePathMatches('/', '/anything')).toBe(true)
    expect(cookiePathMatches('/api', '/api')).toBe(true)
    expect(cookiePathMatches('/api', '/api/v1')).toBe(true)
    expect(cookiePathMatches('/api', '/apiary')).toBe(false)
    expect(cookiePathMatches('/api/', '/api/v1')).toBe(true)
  })

  it('does not send a path-scoped cookie to an unrelated path', () => {
    const jar = new CookieJar()
    jar.store(['scoped=1; Path=/admin'], '/login')
    expect(jar.header('/me')).toBeUndefined()
    expect(jar.header('/admin/users')).toBe('scoped=1')
  })

  it('a cookie set without Path inherits the request default-path', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc'], '/api/v1/login')
    expect(jar.header('/api/v1/me')).toBe('sid=abc')
    expect(jar.header('/me')).toBeUndefined()
  })

  it('sends the longest path first (RFC 6265 §5.4)', () => {
    const jar = new CookieJar()
    jar.store(['broad=1; Path=/'], '/login')
    jar.store(['narrow=1; Path=/admin'], '/login')
    expect(jar.header('/admin/users')).toBe('narrow=1; broad=1')
  })

  it('a same-name cookie on a different path is a distinct cookie', () => {
    const jar = new CookieJar()
    jar.store(['sid=root; Path=/'], '/login')
    jar.store(['sid=admin; Path=/admin'], '/login')
    expect(jar.size).toBe(2)
    expect(jar.header('/admin/x')).toBe('sid=admin; sid=root')
  })
})

describe('cookie jar — expiry', () => {
  it('honors Max-Age', () => {
    const now = 1_000_000
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/; Max-Age=60'], '/login', now)
    expect(jar.header('/me', now + 59_000)).toBe('sid=abc')
    expect(jar.header('/me', now + 61_000)).toBeUndefined()
  })

  it('a non-positive Max-Age deletes the cookie (the logout idiom)', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/'], '/login')
    expect(jar.header('/me')).toBe('sid=abc')
    jar.store(['sid=; Path=/; Max-Age=0'], '/logout')
    expect(jar.size).toBe(0)
    expect(jar.header('/me')).toBeUndefined()
  })

  it('honors Expires', () => {
    const now = Date.parse('2026-07-28T12:00:00Z')
    const jar = new CookieJar()
    jar.store([`sid=abc; Path=/; Expires=${new Date(now + 60_000).toUTCString()}`], '/login', now)
    expect(jar.header('/me', now + 30_000)).toBe('sid=abc')
    expect(jar.header('/me', now + 90_000)).toBeUndefined()
  })

  it('a past Expires deletes the cookie', () => {
    const now = Date.parse('2026-07-28T12:00:00Z')
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/'], '/login', now)
    jar.store([`sid=; Path=/; Expires=${new Date(now - 1000).toUTCString()}`], '/logout', now)
    expect(jar.size).toBe(0)
  })

  it('Max-Age wins over Expires when both are present (§5.3)', () => {
    const now = Date.parse('2026-07-28T12:00:00Z')
    const jar = new CookieJar()
    // Expires says "already dead", Max-Age says "alive for a minute" — Max-Age wins.
    jar.store(
      [`sid=abc; Path=/; Expires=${new Date(now - 60_000).toUTCString()}; Max-Age=60`],
      '/login',
      now,
    )
    expect(jar.header('/me', now + 30_000)).toBe('sid=abc')
  })

  it('an unparseable Expires is ignored — the cookie survives as a session cookie', () => {
    const jar = new CookieJar()
    jar.store(['sid=abc; Path=/; Expires=not-a-date'], '/login')
    expect(jar.header('/me', Date.now() + 10 * 365 * 24 * 3600 * 1000)).toBe('sid=abc')
  })
})
