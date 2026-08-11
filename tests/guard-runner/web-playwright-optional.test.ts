/**
 * `playwright-core` is OPT-IN — an optional peerDependency of the runner, not a
 * dependency — so the web driver has to survive its absence, and survive it as a
 * STEP-LEVEL failure carrying the remedy rather than as a crash at module load.
 *
 * Absence is simulated for real, not mocked: a child Node process registers a
 * resolve hook that makes the specifier `playwright-core` unresolvable, exactly as
 * an install without it would. That also proves the second half of the contract —
 * that merely IMPORTING the runner does not touch playwright, since the probe
 * imports the whole package before it ever asks for a browser.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BROWSER_MISSING_MESSAGE, PLAYWRIGHT_MISSING_MESSAGE } from '@truecourse/guard-runner'
import { rmrf } from './helpers.js'

/** The built runner the probe imports by absolute path (no bare specifier of ours). */
const RUNNER_DIST = fileURLToPath(new URL('../../packages/guard-runner/dist/index.js', import.meta.url))

/** What the probe prints on stdout. */
interface Probe {
  imported: boolean
  installed: boolean
  ok: boolean
  reason: string
}

/** A resolve hook that removes one package from this process's universe. */
const HIDE_HOOK = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'playwright-core') {
    const err = new Error("Cannot find package 'playwright-core'")
    err.code = 'ERR_MODULE_NOT_FOUND'
    throw err
  }
  return nextResolve(specifier, context)
}
`

const REGISTER = `
import { register } from 'node:module'
register('./hide.mjs', import.meta.url)
`

/**
 * Import the runner, ask whether a browser is available, then try to launch one —
 * and report all three outcomes as JSON. Nothing here may throw: a throw is the
 * crash this whole file exists to rule out.
 */
const PROBE = `
import fs from 'node:fs'
const runner = await import(process.argv[2])
const out = { imported: true, installed: null, ok: null, reason: '' }
out.installed = await runner.isBrowserInstalled()
const launched = await runner.launchWebBrowser({ videoDir: process.argv[3] })
out.ok = launched.ok
out.reason = launched.ok ? '' : launched.reason
if (launched.ok) await launched.browser.close()
console.log(JSON.stringify(out))
`

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-pw-'))
  fs.writeFileSync(path.join(dir, 'hide.mjs'), HIDE_HOOK)
  fs.writeFileSync(path.join(dir, 'register.mjs'), REGISTER)
  fs.writeFileSync(path.join(dir, 'probe.mjs'), PROBE)
})

afterAll(() => {
  rmrf(dir)
})

/** Run the probe, optionally with playwright-core hidden and/or an env overlay. */
function probe(opts: { hide: boolean; env?: NodeJS.ProcessEnv }): Probe {
  const args = [
    ...(opts.hide ? ['--import', path.join(dir, 'register.mjs')] : []),
    path.join(dir, 'probe.mjs'),
    RUNNER_DIST,
    path.join(dir, 'video'),
  ]
  const stdout = execFileSync(process.execPath, args, {
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
  })
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as Probe
}

describe('the web driver without playwright-core', () => {
  it('imports the runner without it — the load is lazy', () => {
    // The probe imported the whole package before asking for anything; reaching a
    // printed result at all is the assertion.
    expect(probe({ hide: true }).imported).toBe(true)
  })

  it('reports no browser instead of throwing', () => {
    expect(probe({ hide: true }).installed).toBe(false)
  })

  it('fails the launch with both install commands, in order', () => {
    const { ok, reason } = probe({ hide: true })
    expect(ok).toBe(false)
    expect(reason).toBe(PLAYWRIGHT_MISSING_MESSAGE)
    expect(reason).toContain('add playwright-core')
    expect(reason).toContain('playwright-core install chromium')
    expect(reason.indexOf('add playwright-core')).toBeLessThan(
      reason.indexOf('playwright-core install chromium'),
    )
  })
})

describe('the web driver with playwright-core but no browser binary', () => {
  it('names the browser install, not the package install', () => {
    // A browsers path with nothing in it is what an install that skipped
    // `playwright-core install chromium` looks like.
    const empty = path.join(dir, 'no-browsers')
    fs.mkdirSync(empty, { recursive: true })
    const { ok, reason } = probe({ hide: false, env: { PLAYWRIGHT_BROWSERS_PATH: empty } })
    expect(ok).toBe(false)
    expect(reason).toBe(BROWSER_MISSING_MESSAGE)
  })
})
