import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runInstall } from '@truecourse/guard-runner'
import { PLANTED_SECRETS, withPlantedSecrets } from './helpers'

describe('runInstall — minimal-env child construction', () => {
  it('runs the install with a hermetic env: host secrets are stripped, recipe env is present', async () => {
    await withPlantedSecrets(async () => {
      const result = await runInstall(
        os.tmpdir(),
        'node -e "console.log(JSON.stringify(process.env))"',
        { RECIPE_VAR: 'from-recipe' },
      )
      expect(result.ok).toBe(true)
      const childEnv = JSON.parse(result.output.trim()) as Record<string, string>

      // Planted host secrets (incl. NODE_ENV / npm_config_* / CI) must NOT reach the child.
      for (const key of Object.keys(PLANTED_SECRETS)) {
        expect(childEnv[key], `${key} should be absent`).toBeUndefined()
      }
      // Declared recipe env reaches it.
      expect(childEnv.RECIPE_VAR).toBe('from-recipe')
      // Allowlisted host vars pass through so the install can actually run.
      expect(childEnv.PATH).toBe(process.env.PATH)
      expect(childEnv.HOME).toBe(process.env.HOME)
      // Colour forced off for clean captured logs.
      expect(childEnv.NO_COLOR).toBe('1')
    })
  })

  it('a failing install command reports ok:false with the command echoed', async () => {
    const result = await runInstall(os.tmpdir(), 'false')
    expect(result.ok).toBe(false)
    expect(result.command).toBe('false')
    expect(result.timedOut).toBe(false)
  })
})

describe('runInstall — abort signal', () => {
  it('an external abort SIGKILLs a hanging install child (not reported as a timeout)', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const start = Date.now()
    const result = await runInstall(
      os.tmpdir(),
      'node -e "setInterval(() => {}, 1000)"',
      undefined,
      60_000,
      ac.signal,
    )
    // The abort — not the 60s timer — ended the install, well before the timeout.
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(null)
  })

  it('a pre-aborted signal short-circuits without running the command', async () => {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-install-abort-')), 'ran.txt')
    const ac = new AbortController()
    ac.abort()
    const result = await runInstall(
      os.tmpdir(),
      `node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran')"`,
      undefined,
      60_000,
      ac.signal,
    )
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(fs.existsSync(marker)).toBe(false)
  })
})
