import { describe, it, expect } from 'vitest'
import { constructChildEnv, BUILD_PASSTHROUGH } from '@truecourse/guard-runner'
import { PLANTED_SECRETS, withPlantedSecrets } from './helpers'

describe('constructChildEnv — sandbox path', () => {
  const sandbox = { home: '/sb/home', tmp: '/sb/tmp' }

  it('excludes host secrets and platform config', async () => {
    await withPlantedSecrets(() => {
      const env = constructChildEnv({ sandbox })
      for (const key of Object.keys(PLANTED_SECRETS)) {
        expect(key in env, `${key} should be absent`).toBe(false)
      }
    })
  })

  it('reproduces the createSandbox allowlist: PATH, redirected HOME/TMP/XDG, determinism pins', () => {
    const env = constructChildEnv({ sandbox })
    expect(env.PATH).toBe(process.env.PATH ?? '')
    expect(env.HOME).toBe('/sb/home')
    expect(env.USERPROFILE).toBe('/sb/home')
    expect(env.TMPDIR).toBe('/sb/tmp')
    expect(env.XDG_CONFIG_HOME).toBe('/sb/home/.config')
    expect(env.XDG_CACHE_HOME).toBe('/sb/home/.cache')
    expect(env.XDG_DATA_HOME).toBe('/sb/home/.local/share')
    expect(env.XDG_STATE_HOME).toBe('/sb/home/.local/state')
    expect(env.XDG_RUNTIME_DIR).toBe('/sb/home/run')
    expect(env.TZ).toBe('UTC')
    expect(env.LANG).toBe('C')
    expect(env.NO_COLOR).toBe('1')
    expect(env.COLUMNS).toBe('80')
  })

  it("shares the HOST's corepack cache — a redirected HOME must not re-download yarn per boot", () => {
    const env = constructChildEnv({ sandbox })
    // Host COREPACK_HOME wins; else the corepack default under the REAL home. Never
    // under the sandbox home — that is what forced a download on every server boot.
    const expected =
      process.env.COREPACK_HOME ??
      (process.env.HOME ? `${process.env.HOME}/.cache/node/corepack` : undefined)
    expect(env.COREPACK_HOME).toBe(expected)
    expect(env.COREPACK_HOME?.startsWith('/sb/home')).toBe(false)
  })

  it('layers recipeEnv then scenarioEnv on top (scenario wins)', () => {
    const env = constructChildEnv({
      sandbox,
      recipeEnv: { APP: 'recipe', SHARED: 'r' },
      scenarioEnv: { SHARED: 's' },
    })
    expect(env.APP).toBe('recipe')
    expect(env.SHARED).toBe('s')
  })
})

describe('constructChildEnv — passthrough path', () => {
  it('excludes host secrets and platform config even when passed through by allowlist', async () => {
    await withPlantedSecrets(() => {
      const env = constructChildEnv({ passthrough: BUILD_PASSTHROUGH })
      for (const key of Object.keys(PLANTED_SECRETS)) {
        expect(key in env, `${key} should be absent`).toBe(false)
      }
    })
  })

  it('passes allowlisted host vars (PATH, real HOME) through by value', () => {
    const env = constructChildEnv({ passthrough: BUILD_PASSTHROUGH })
    expect(env.PATH).toBe(process.env.PATH)
    expect(env.PATH).toBeTruthy()
    expect(env.HOME).toBe(process.env.HOME)
  })

  it('omits unset passthrough names entirely (absent, not empty string)', () => {
    const saved = process.env.VOLTA_HOME
    delete process.env.VOLTA_HOME
    try {
      const env = constructChildEnv({ passthrough: BUILD_PASSTHROUGH })
      expect('VOLTA_HOME' in env).toBe(false)
      expect(env.VOLTA_HOME).toBeUndefined()
    } finally {
      if (saved !== undefined) process.env.VOLTA_HOME = saved
    }
  })

  it('forces colour off (NO_COLOR=1, FORCE_COLOR=0)', () => {
    const env = constructChildEnv({ passthrough: BUILD_PASSTHROUGH })
    expect(env.NO_COLOR).toBe('1')
    expect(env.FORCE_COLOR).toBe('0')
  })

  // A bare `pip`/`python` resolves through the pyenv shims only when a version is
  // selected, so PYENV_ROOT alone leaves a pyenv-managed build running the system
  // interpreter (or nothing at all).
  it('passes the pyenv-selected interpreter version through to the build', () => {
    const saved = process.env.PYENV_VERSION
    process.env.PYENV_VERSION = '3.12.4'
    try {
      expect(constructChildEnv({ passthrough: BUILD_PASSTHROUGH }).PYENV_VERSION).toBe('3.12.4')
    } finally {
      if (saved === undefined) delete process.env.PYENV_VERSION
      else process.env.PYENV_VERSION = saved
    }
  })

  it('layers recipeEnv then scenarioEnv on top of the passthrough base (scenario wins)', () => {
    const env = constructChildEnv({
      passthrough: BUILD_PASSTHROUGH,
      recipeEnv: { APP: 'recipe', SHARED: 'r' },
      scenarioEnv: { SHARED: 's' },
    })
    expect(env.APP).toBe('recipe')
    expect(env.SHARED).toBe('s')
  })
})
