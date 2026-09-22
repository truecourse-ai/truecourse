/**
 * One test per recipe slice: the change it is meant to follow moves it, and
 * every change it is meant to ignore does not. These are the guarantees the
 * warm-cache promise rests on, so each `toBe` here is a bill a customer does
 * not pay.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  RecipeSchema,
  recipePath,
  dependenciesPath,
  recipeContractFingerprint,
  flowRecipeSliceFingerprint,
  seedRosterFingerprint,
  flowRosterFingerprint,
  flowPreparationFingerprint,
  preparationsFingerprint,
  dependencyCatalogIdentity,
  type Recipe,
} from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function write(r: string, rel: string, content: string): void {
  const target = path.join(r, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** Write `recipe.json` verbatim and return it parsed. */
function putRecipe(r: string, raw: Record<string, unknown>): Recipe {
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(raw, null, 2))
  return RecipeSchema.parse(raw)
}

const BASE = {
  build: 'pnpm build',
  entry: ['node', 'dist/cli.js'],
  env: { LOG_LEVEL: 'info' },
  api: {
    serve: ['node', 'dist/server.js'],
    healthPath: '/health',
    services: { up: 'docker compose up -d' },
    credentials: { 'api-key': { header: 'Authorization', valueFromEnv: 'API_KEY' } },
    externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } },
    seed: {
      command: 'node scripts/seed.mjs',
      script: 'scripts/seed.mjs',
      provides: {
        fixtures: { org: ['id', 'slug'] },
        credentials: { owner: { header: 'Authorization', description: 'the org owner' } },
      },
    },
  },
  web: { serve: ['node', 'dist/web.js'], healthPath: '/', env: { WEB_FLAG: '1' } },
} satisfies Record<string, unknown>

/** A repo carrying the base recipe, its seed script and a dependency catalog. */
function seeded(): { r: string; recipe: Recipe } {
  const r = repo()
  write(r, 'scripts/seed.mjs', 'export const seed = 1\n')
  write(
    r,
    path.relative(r, dependenciesPath(r)),
    JSON.stringify({
      dependencies: [
        { name: 'stripe-account', class: 'supplied', summary: 'a Stripe sandbox account', registration: { kind: 'credential', envs: ['STRIPE_KEY'] } },
      ],
    }),
  )
  return { r, recipe: putRecipe(r, structuredClone(BASE)) }
}

function scenario(over: Partial<GuardScenario>): GuardScenario {
  return { id: 's1', title: 't', binds: [], steps: [], ...over } as unknown as GuardScenario
}

describe('recipe contract fingerprint', () => {
  it('is stable across reads and follows the recipe and its preparation scripts', () => {
    const { r } = seeded()
    const before = recipeContractFingerprint(r)
    expect(recipeContractFingerprint(r)).toBe(before)

    // A dependency bump, a catalog edit and a seed rewrite are not the contract.
    write(r, 'package.json', JSON.stringify({ name: 'x', dependencies: { left: '2.0.0' } }))
    write(r, path.relative(r, dependenciesPath(r)), JSON.stringify({ dependencies: [] }))
    write(r, 'scripts/seed.mjs', 'export const seed = 2\n')
    expect(recipeContractFingerprint(r)).toBe(before)

    // The recipe itself is.
    putRecipe(r, { ...structuredClone(BASE), build: 'pnpm compile' })
    expect(recipeContractFingerprint(r)).not.toBe(before)
  })

  it('read before a recipe-writing step, leaves out what that step and its successors write', () => {
    const { r } = seeded()
    const whole = recipeContractFingerprint(r)
    const beforeSeed = recipeContractFingerprint(r, 'seed')
    const beforePreparations = recipeContractFingerprint(r, 'preparations')
    // The base recipe declares a seed and no preparations: the contract read
    // before the seed step leaves the seed out, the one read before the
    // preparations step has nothing to leave out yet.
    expect(beforeSeed).not.toBe(whole)
    expect(beforePreparations).toBe(whole)

    // The seed step writes `api.seed`: only the whole contract and the one read
    // before the preparations step (which still holds the seed) follow it.
    const { api, ...rest } = structuredClone(BASE)
    putRecipe(r, { ...rest, api: { ...api, seed: { ...api.seed, command: 'node scripts/seed.mjs --fast' } } })
    expect(recipeContractFingerprint(r)).not.toBe(whole)
    expect(recipeContractFingerprint(r, 'preparations')).not.toBe(beforePreparations)
    expect(recipeContractFingerprint(r, 'seed')).toBe(beforeSeed)

    // The preparations step writes `preparations` and its scripts: neither
    // contract read before it follows.
    write(r, 'scripts/prep-seed.mjs', 'one')
    write(r, 'scripts/prep-verify.mjs', 'one')
    putRecipe(r, {
      ...structuredClone(BASE),
      preparations: {
        pg: {
          baseline: 'empty',
          scope: 'instance',
          env: { DB_NS: '${namespace}' },
          seed: { script: 'scripts/prep-seed.mjs', provides: {} },
          verify: { script: 'scripts/prep-verify.mjs' },
        },
      },
    })
    expect(recipeContractFingerprint(r)).not.toBe(whole)
    expect(recipeContractFingerprint(r, 'preparations')).toBe(beforePreparations)
    expect(recipeContractFingerprint(r, 'seed')).toBe(beforeSeed)
    write(r, 'scripts/prep-seed.mjs', 'two')
    expect(recipeContractFingerprint(r, 'preparations')).toBe(beforePreparations)
    expect(recipeContractFingerprint(r, 'seed')).toBe(beforeSeed)
  })

  it('ignores a rotated inline secret and follows a preparation script edit', () => {
    const r = repo()
    write(r, 'scripts/prep-seed.mjs', 'one')
    write(r, 'scripts/prep-verify.mjs', 'one')
    const withSecret = (value: string): Record<string, unknown> => ({
      build: 'true',
      entry: ['node', 'cli.js'],
      api: { serve: ['node', 's.js'], credentials: { k: { header: 'X-Key', value } } },
      preparations: {
        pg: {
          baseline: 'empty',
          scope: 'instance',
          env: { DB_NS: '${namespace}' },
          seed: { script: 'scripts/prep-seed.mjs', provides: {} },
          verify: { script: 'scripts/prep-verify.mjs' },
        },
      },
    })
    putRecipe(r, withSecret('secret-one'))
    const before = recipeContractFingerprint(r)
    putRecipe(r, withSecret('secret-two'))
    expect(recipeContractFingerprint(r)).toBe(before)

    write(r, 'scripts/prep-verify.mjs', 'two')
    expect(recipeContractFingerprint(r)).not.toBe(before)
  })
})

describe('flow recipe slice', () => {
  it('an api flow follows the servers and credential capabilities, nothing else', () => {
    const { recipe } = seeded()
    const before = flowRecipeSliceFingerprint(recipe, 'api')

    const envMoved = RecipeSchema.parse({ ...structuredClone(BASE), env: { LOG_LEVEL: 'debug' } })
    expect(flowRecipeSliceFingerprint(envMoved, 'api')).toBe(before)

    const servicesMoved = structuredClone(BASE)
    servicesMoved.api.services.up = 'docker compose -f other.yml up -d'
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(servicesMoved), 'api')).toBe(before)

    const externalsMoved = structuredClone(BASE)
    externalsMoved.api.externals = { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', baseUrl: 'https://sandbox.stripe.test' } }
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(externalsMoved), 'api')).toBe(before)

    const healthMoved = structuredClone(BASE)
    healthMoved.api.healthPath = '/ready'
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(healthMoved), 'api')).not.toBe(before)

    const credMoved = structuredClone(BASE)
    credMoved.api.credentials = { 'api-key': { header: 'X-Api-Key', valueFromEnv: 'API_KEY' } }
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(credMoved), 'api')).not.toBe(before)
  })

  it('a cli flow follows the entry alone, and an api edit never moves it', () => {
    const { recipe } = seeded()
    const before = flowRecipeSliceFingerprint(recipe, 'cli')

    const apiMoved = structuredClone(BASE)
    apiMoved.api.healthPath = '/ready'
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(apiMoved), 'cli')).toBe(before)

    const entryMoved = structuredClone(BASE)
    entryMoved.entry = ['node', 'dist/cli2.js']
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(entryMoved), 'cli')).not.toBe(before)
  })

  it('a web flow follows the web block but not the env the app reads', () => {
    const { recipe } = seeded()
    const before = flowRecipeSliceFingerprint(recipe, 'web')

    const envMoved = structuredClone(BASE)
    envMoved.web.env = { WEB_FLAG: '0' }
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(envMoved), 'web')).toBe(before)

    const serveMoved = structuredClone(BASE)
    serveMoved.web.serve = ['node', 'dist/web2.js']
    expect(flowRecipeSliceFingerprint(RecipeSchema.parse(serveMoved), 'web')).not.toBe(before)
  })
})

describe('the roster', () => {
  it('follows fixture and credential declarations, never the role prose', () => {
    const { recipe } = seeded()
    const before = seedRosterFingerprint(recipe)

    const prose = structuredClone(BASE)
    prose.api.seed.provides.credentials = { owner: { header: 'Authorization', description: 'the account owner' } }
    expect(seedRosterFingerprint(RecipeSchema.parse(prose))).toBe(before)

    const scriptMoved = structuredClone(BASE)
    scriptMoved.api.seed.command = 'node scripts/seed2.mjs'
    scriptMoved.api.seed.script = 'scripts/seed2.mjs'
    expect(seedRosterFingerprint(RecipeSchema.parse(scriptMoved))).toBe(before)

    const renamed = structuredClone(BASE)
    renamed.api.seed.provides.fixtures = { organization: ['id', 'slug'] }
    expect(seedRosterFingerprint(RecipeSchema.parse(renamed))).not.toBe(before)
  })

  it('per flow, a renamed fixture moves only the flows that name it', () => {
    const { recipe } = seeded()
    const user = [scenario({ steps: [{ kind: 'run', args: ['show', '{{fixture:org.id}}'] }] as never })]
    const bystander = [scenario({ steps: [{ kind: 'run', args: ['version'] }] as never })]
    const userBefore = flowRosterFingerprint(recipe, user)
    const bystanderBefore = flowRosterFingerprint(recipe, bystander)

    const renamed = structuredClone(BASE)
    renamed.api.seed.provides.fixtures = { organization: ['id', 'slug'] }
    const moved = RecipeSchema.parse(renamed)
    expect(flowRosterFingerprint(moved, user)).not.toBe(userBefore)
    expect(flowRosterFingerprint(moved, bystander)).toBe(bystanderBefore)
  })

  it('per flow, a seed rewrite that keeps the roster moves nothing', () => {
    const { recipe } = seeded()
    const scenarios = [scenario({ steps: [{ kind: 'run', args: ['show', '{{fixture:org.slug}}'] }] as never })]
    const before = flowRosterFingerprint(recipe, scenarios)
    const rewritten = structuredClone(BASE)
    rewritten.api.seed.command = 'node scripts/seed-v2.mjs'
    rewritten.api.seed.script = 'scripts/seed-v2.mjs'
    expect(flowRosterFingerprint(RecipeSchema.parse(rewritten), scenarios)).toBe(before)
  })
})

describe('preparations', () => {
  const withPreparation = (script: string): Record<string, unknown> => ({
    build: 'true',
    entry: ['node', 'cli.js'],
    preparations: {
      pg: {
        baseline: 'empty',
        scope: 'instance',
        env: { DB_NS: '${namespace}' },
        seed: { script, provides: {} },
        verify: { script: 'scripts/verify.mjs' },
      },
      other: {
        baseline: 'empty',
        scope: 'instance',
        env: { OTHER_NS: '${namespace}' },
        seed: { script: 'scripts/other-seed.mjs', provides: {} },
        verify: { script: 'scripts/verify.mjs' },
      },
    },
  })

  function preparedRepo(): { r: string; recipe: Recipe } {
    const r = repo()
    for (const rel of ['scripts/seed.mjs', 'scripts/verify.mjs', 'scripts/other-seed.mjs']) write(r, rel, 'one')
    return { r, recipe: putRecipe(r, withPreparation('scripts/seed.mjs')) }
  }

  it('per flow, only the profile the scenario names', () => {
    const { r, recipe } = preparedRepo()
    const prepared = [scenario({ setup: { preparation: 'pg' } as never })]
    const plain = [scenario({})]
    const preparedBefore = flowPreparationFingerprint(r, recipe, prepared)
    const plainBefore = flowPreparationFingerprint(r, recipe, plain)

    write(r, 'scripts/other-seed.mjs', 'two')
    expect(flowPreparationFingerprint(r, recipe, prepared)).toBe(preparedBefore)

    write(r, 'scripts/seed.mjs', 'two')
    expect(flowPreparationFingerprint(r, recipe, prepared)).not.toBe(preparedBefore)
    expect(flowPreparationFingerprint(r, recipe, plain)).toBe(plainBefore)
  })

  it('whole, every declared profile and its script bytes', () => {
    const { r, recipe } = preparedRepo()
    const before = preparationsFingerprint(r, recipe)
    write(r, 'package.json', JSON.stringify({ name: 'x', dependencies: { left: '2.0.0' } }))
    expect(preparationsFingerprint(r, recipe)).toBe(before)
    write(r, 'scripts/other-seed.mjs', 'two')
    expect(preparationsFingerprint(r, recipe)).not.toBe(before)
  })
})

describe('catalog identity', () => {
  it('follows the names and classes, never the summaries', () => {
    const { r } = seeded()
    const before = dependencyCatalogIdentity(r)
    const rel = path.relative(r, dependenciesPath(r))

    write(
      r,
      rel,
      JSON.stringify({
        dependencies: [
          { name: 'stripe-account', class: 'supplied', summary: 'a Stripe account you own', registration: { kind: 'credential', envs: ['STRIPE_KEY'] } },
        ],
      }),
    )
    expect(dependencyCatalogIdentity(r)).toBe(before)

    write(
      r,
      rel,
      JSON.stringify({
        dependencies: [
          { name: 'stripe-account', class: 'supplied', summary: 'a Stripe sandbox account', registration: { kind: 'credential', envs: ['STRIPE_KEY'] } },
          { name: 'mailbox', class: 'seedable', summary: 'a mailbox' },
        ],
      }),
    )
    expect(dependencyCatalogIdentity(r)).not.toBe(before)
  })

  it('a repository with no catalog folds the empty list', () => {
    const r = repo()
    expect(dependencyCatalogIdentity(r)).toBe(dependencyCatalogIdentity(repo()))
  })
})
