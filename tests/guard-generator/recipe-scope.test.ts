/**
 * THE SCOPE OF A REPAIR — the fold that puts a returned proposal back onto the
 * recipe it repaired, the diff that holds a needs-driven one to the world the
 * app runs in, and the slice report a boot-driven one earns.
 */

import { describe, it, expect } from 'vitest'
import {
  foldRepairedRecipe,
  changedRecipeFields,
  needsScopeRefusal,
  movedFlowSlices,
  type RecipeProposal,
} from '@truecourse/guard-generator'
import type { Recipe } from '@truecourse/guard-runner'

/** A standing recipe with everything a repair must not lose. */
const STANDING: Recipe = {
  install: 'pnpm i --frozen-lockfile',
  build: 'pnpm build',
  api: {
    serve: ['node', 'dist/server.js'],
    healthPath: '/health',
    readyTimeoutMs: 45_000,
    env: { PORT: '${PORT}' },
    seed: { command: 'node seed.mjs', provides: { fixtures: { org: ['id'] } } },
    credentials: { owner: { header: 'Authorization', valueFromEnv: 'GUARD_CRED_OWNER' } },
    externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } },
  },
  web: { serve: ['node', 'dist/web.js'], healthPath: '/login' },
}

/** What a session returns when it restates the recipe as it stands. */
const RESTATED: RecipeProposal = {
  install: STANDING.install,
  build: STANDING.build,
  api: { serve: ['node', 'dist/server.js'], healthPath: '/health', env: { PORT: '${PORT}' } },
  web: { serve: ['node', 'dist/web.js'], healthPath: '/login' },
}

describe('foldRepairedRecipe', () => {
  it('carries over every block a proposal cannot express', () => {
    const folded = foldRepairedRecipe(STANDING, RESTATED)

    expect(folded.api?.seed).toEqual(STANDING.api?.seed)
    expect(folded.api?.credentials).toEqual(STANDING.api?.credentials)
    expect(folded.api?.externals).toEqual(STANDING.api?.externals)
    expect(folded.api?.readyTimeoutMs).toBe(45_000)
    expect(changedRecipeFields(STANDING, folded)).toEqual([])
  })

  it('keeps a named server\'s tuning across a repair that rewrites its serve', () => {
    const multi: Recipe = {
      build: 'true',
      api: {
        servers: {
          web: { serve: ['node', 'a.js'], readyTimeoutMs: 90_000, description: 'the storefront' },
        },
        defaultServer: 'web',
      },
    }
    const folded = foldRepairedRecipe(multi, {
      build: 'true',
      api: { servers: { web: { serve: ['node', 'b.js'] } }, defaultServer: 'web' },
    })

    expect(folded.api?.servers?.web).toMatchObject({
      serve: ['node', 'b.js'],
      readyTimeoutMs: 90_000,
      description: 'the storefront',
    })
  })
})

describe('needsScopeRefusal', () => {
  it('accepts a bring-up and the variable that points at it, and moves no flow slice', () => {
    const folded = foldRepairedRecipe(STANDING, {
      ...RESTATED,
      env: { REDIS_URL: 'redis://127.0.0.1:6379' },
      api: {
        ...RESTATED.api!,
        services: { up: 'docker compose -p p up -d', down: 'docker compose -p p stop', reset: 'docker compose -p p down -v' },
      },
    })

    expect(needsScopeRefusal(STANDING, folded)).toBeUndefined()
    expect(changedRecipeFields(STANDING, folded)).toEqual(['api.services', 'env'])
    expect(movedFlowSlices(STANDING, folded)).toEqual([])
  })

  it('refuses a health path, an entry and a served argv, naming each', () => {
    const folded = foldRepairedRecipe(STANDING, {
      ...RESTATED,
      entry: ['node', 'dist/cli.js'],
      api: { serve: ['node', 'dist/other.js'], healthPath: '/ready', env: { PORT: '${PORT}' } },
    })
    const refusal = needsScopeRefusal(STANDING, folded)

    expect(refusal).toBeDefined()
    expect(refusal).toContain('api.healthPath')
    expect(refusal).toContain('api.serve')
    expect(refusal).toContain('entry')
  })

  it('refuses a rebuilt build command', () => {
    const folded = foldRepairedRecipe(STANDING, { ...RESTATED, build: 'pnpm run compile' })
    expect(needsScopeRefusal(STANDING, folded)).toContain('build')
  })
})

describe('movedFlowSlices', () => {
  it('names the api surface when a boot repair moved the health path', () => {
    const folded = foldRepairedRecipe(STANDING, {
      ...RESTATED,
      api: { serve: ['node', 'dist/server.js'], healthPath: '/healthz', env: { PORT: '${PORT}' } },
    })

    expect(movedFlowSlices(STANDING, folded)).toEqual(['api'])
  })

  it('names the cli surface when a boot repair moved the entry', () => {
    const folded = foldRepairedRecipe(STANDING, { ...RESTATED, entry: ['node', 'dist/cli.js'] })
    expect(movedFlowSlices(STANDING, folded)).toEqual(['cli'])
  })

  it('names no surface when only the world moved', () => {
    const folded = foldRepairedRecipe(STANDING, { ...RESTATED, env: { DATABASE_URL: 'postgres://x/y' } })
    expect(movedFlowSlices(STANDING, folded)).toEqual([])
  })
})
