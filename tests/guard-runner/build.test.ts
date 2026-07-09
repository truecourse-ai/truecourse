import { describe, it, expect } from 'vitest'
import os from 'node:os'
import { runBuild } from '@truecourse/guard-runner'
import { PLANTED_SECRETS, withPlantedSecrets } from './helpers'

describe('runBuild — minimal-env child construction', () => {
  it('runs the build with a hermetic env: host secrets are stripped, recipe env is present', async () => {
    await withPlantedSecrets(async () => {
      const result = await runBuild(
        os.tmpdir(),
        'node -e "console.log(JSON.stringify(process.env))"',
        { RECIPE_VAR: 'from-recipe' },
      )
      expect(result.ok).toBe(true)
      const childEnv = JSON.parse(result.output.trim()) as Record<string, string>

      // Planted host secrets must NOT reach the build child.
      for (const key of Object.keys(PLANTED_SECRETS)) {
        expect(childEnv[key], `${key} should be absent`).toBeUndefined()
      }
      // Declared recipe env reaches it.
      expect(childEnv.RECIPE_VAR).toBe('from-recipe')
      // Allowlisted host vars pass through so the build can actually run.
      expect(childEnv.PATH).toBe(process.env.PATH)
      expect(childEnv.HOME).toBe(process.env.HOME)
      // Colour forced off for clean captured logs.
      expect(childEnv.NO_COLOR).toBe('1')
    })
  })
})
