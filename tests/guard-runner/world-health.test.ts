/**
 * WORLD HEALTH and the browser's PRINCIPAL CHANNEL, the browser-free halves:
 * the result predicate the generator's world-health latch reads, and the
 * Cookie-header parsing a `credential` step installs cookies from.
 */

import { describe, it, expect } from 'vitest'
import {
  API_SERVER_BOOT_EXPECTED,
  STEP_TO_RUN_EXPECTED,
  WEB_SURFACE_DOWN_PREFIX,
  isWorldBootFailure,
  parseCookieHeader,
} from '@truecourse/guard-runner'

describe('isWorldBootFailure — the world-is-gone signal', () => {
  it('reads an api server that could not boot, on either lifecycle path', () => {
    expect(
      isWorldBootFailure({
        outcome: 'error',
        failure: { step: 1, expected: API_SERVER_BOOT_EXPECTED, actual: 'api server exited before becoming healthy' },
      }),
    ).toBe(true)
  })

  it('reads a sandbox whose served web surface never came up', () => {
    expect(
      isWorldBootFailure({
        outcome: 'error',
        failure: {
          step: 1,
          expected: STEP_TO_RUN_EXPECTED,
          actual: `${WEB_SURFACE_DOWN_PREFIX}api server exited before becoming healthy`,
        },
      }),
    ).toBe(true)
  })

  it('is not any other error, and never a fail or a pass', () => {
    expect(
      isWorldBootFailure({
        outcome: 'error',
        failure: { step: 1, expected: STEP_TO_RUN_EXPECTED, actual: 'the browser failed to launch: boom' },
      }),
    ).toBe(false)
    expect(
      isWorldBootFailure({
        outcome: 'fail',
        failure: { step: 1, expected: 'status 200', actual: 'status 500' },
      }),
    ).toBe(false)
    expect(isWorldBootFailure({ outcome: 'pass' })).toBe(false)
  })
})

describe('parseCookieHeader', () => {
  it('splits a Cookie header into its pairs, keeping values byte-for-byte', () => {
    expect(parseCookieHeader('sid=abc.def%3D; theme=dark;')).toEqual([
      { name: 'sid', value: 'abc.def%3D' },
      { name: 'theme', value: 'dark' },
    ])
  })

  it('keeps an `=` inside a value, and drops segments that are not cookies', () => {
    expect(parseCookieHeader('token=a=b=c; junk; =nameless')).toEqual([{ name: 'token', value: 'a=b=c' }])
    expect(parseCookieHeader('   ')).toEqual([])
  })
})
