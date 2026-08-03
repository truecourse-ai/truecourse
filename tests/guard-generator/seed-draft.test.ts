/**
 * Seed drafting — the gate, the engine's own verification, the
 * ONE evidence retry, and the two artifacts.
 *
 * The model is always stubbed; the ENGINE half is real: the drafted script is
 * written to the tree, spawned with `GUARD_SEED_OUT` set, its manifest validated
 * against the drafted `provides` by the runner's own resolver, and the fixture
 * server booted against the state it left behind. Docker is never involved — the
 * `api.services.up`-absent path is the tested one, and the "datastore" is a JSON
 * file whose absolute path rides `api.env` exactly as a `DATABASE_URL` would.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  draftSeed,
  seedDraftGate,
  type SeedDraftDatabase,
  type SeedProposal,
  type SeedRunner,
} from '@truecourse/guard-generator'
import { computeRecipeFingerprint, loadRecipe, recipePath } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from './helpers.js'

const FIXTURE_SERVER = fileURLToPath(new URL('../fixtures/seed-draft/server.mjs', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** The parsed schema a real analyzer pass hands the stage. */
const DATABASE: SeedDraftDatabase = {
  type: 'sqlite',
  driver: 'prisma',
  tables: [
    {
      name: 'Org',
      columns: [
        { name: 'id', type: 'Int', isPrimaryKey: true, isNullable: false },
        { name: 'slug', type: 'String', isUnique: true, isNullable: false },
      ],
    },
    {
      name: 'Booking',
      columns: [
        { name: 'id', type: 'Int', isPrimaryKey: true, isNullable: false },
        { name: 'orgId', type: 'Int', isNullable: false, isForeignKey: true, referencesTable: 'Org', referencesColumn: 'id' },
      ],
    },
  ],
  relations: [{ sourceTable: 'Booking', targetTable: 'Org', foreignKeyColumn: 'orgId' }],
  appImports: ["src/db.js: import { PrismaClient } from '@prisma/client'"],
}

const BLOCKED = [{ flow: 'cancel a booking', needs: ['missing-data', 'an already-cancelled booking'] }]

/** Write the api recipe the stage patches, with the store path the fixture reads. */
function writeApiRecipe(r: string, extra: Record<string, unknown> = {}): string {
  const store = path.join(r, 'store.json')
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', FIXTURE_SERVER],
      healthPath: '/health',
      env: { SEED_STORE: store },
      ...extra,
    },
  }
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
  return store
}

function recipeOf(r: string) {
  return loadRecipe(r, recipePath(r))!.recipe
}

/** A seed script that writes the fixture's store AND the declared manifest. */
function goodScript(): string {
  return [
    '// Idempotent: the store is a single JSON document, rewritten wholesale, so a',
    '// second run leaves exactly the same rows (no duplicate org).',
    "import fs from 'node:fs'",
    'const org = { id: 42, slug: "acme" }',
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
    '',
  ].join('\n')
}

function proposal(scriptContent: string, over: Partial<SeedProposal> = {}): SeedProposal {
  return {
    scriptPath: 'scripts/guard-seed.mjs',
    scriptContent,
    seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: ['id', 'slug'] } } },
    ...over,
  }
}

type SeedCall = Parameters<SeedRunner>[0]

/** A runner answering with each scripted value in turn, recording every call. */
function scripted(...answers: unknown[]): { runner: SeedRunner; calls: SeedCall[] } {
  const calls: SeedCall[] = []
  const runner: SeedRunner = async (input) => {
    calls.push(input)
    if (calls.length > answers.length) throw new Error(`unexpected seed call #${calls.length}`)
    const answer = answers[calls.length - 1]
    if (answer instanceof Error) throw answer
    return answer
  }
  return { runner, calls }
}

const neverCalled: SeedRunner = async () => {
  throw new Error('the seed runner must not be called')
}

describe('seedDraftGate — the conditions', () => {
  // The "some flow is blocked on missing data" condition was dropped: it was an
  // AUTHORING output, and `guard setup` drafts BEFORE authoring has ever run.
  it('does NOT require a blocked flow — setup drafts before authoring exists', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(seedDraftGate({ recipe: recipeOf(r), database: DATABASE })).toEqual({ ok: true })
  })

  it('skips when the recipe has no api block', () => {
    const gate = seedDraftGate({ recipe: { build: 'true', entry: ['node', 'x.js'] }, database: DATABASE })
    expect(gate).toEqual({ ok: false, reason: expect.stringContaining('no `api` block') })
  })

  it('skips when a seed already exists — an existing seed is never overwritten', () => {
    const r = repo()
    writeApiRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    const gate = seedDraftGate({ recipe: recipeOf(r), database: DATABASE })
    expect(gate).toEqual({ ok: false, reason: expect.stringContaining('already declares `api.seed`') })
  })

  it('skips when no database was detected, and when its schema could not be parsed', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(seedDraftGate({ recipe: recipeOf(r), database: null })).toEqual({
      ok: false,
      reason: expect.stringContaining('no database was detected'),
    })
    expect(
      seedDraftGate({ recipe: recipeOf(r), database: { ...DATABASE, tables: [] } }),
    ).toEqual({ ok: false, reason: expect.stringContaining('no schema could be parsed') })
  })

  it('holds when all four conditions do — and defers (b) when detection has not run', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(seedDraftGate({ recipe: recipeOf(r), database: DATABASE })).toEqual({ ok: true })
    expect(seedDraftGate({ recipe: recipeOf(r) })).toEqual({ ok: true })
  })
})

describe('draftSeed — gating writes nothing', () => {
  it('an existing seed is never overwritten and the recipe is byte-identical', async () => {
    const r = repo()
    writeApiRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    const before = fs.readFileSync(recipePath(r), 'utf-8')

    const res = await draftSeed({
      repoRoot: r,
      recipe: recipeOf(r),
      blocked: BLOCKED,
      database: DATABASE,
      runner: neverCalled,
    })

    expect(res.status).toBe('skipped')
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })
})

describe('draftSeed — the happy path', () => {
  it('runs the script, validates the manifest, boots the server, and writes both artifacts', async () => {
    const r = repo()
    const store = writeApiRecipe(r)
    const before = computeRecipeFingerprint(r)
    const { runner, calls } = scripted(proposal(goodScript()))

    const res = await draftSeed({
      repoRoot: r,
      recipe: recipeOf(r),
      blocked: BLOCKED,
      database: DATABASE,
      runner,
      probePaths: ['/orgs'],
    })

    expect(res.status).toBe('drafted')
    if (res.status !== 'drafted') return
    // ONE call: a draft that verifies buys no retry.
    expect(calls).toHaveLength(1)
    expect(calls[0].retry).toBeUndefined()
    // The draft is GROUNDED: schema, ORM, the app's own import line, the claims.
    expect(calls[0].driver).toBe('prisma')
    expect(calls[0].tables.map((t) => t.name)).toEqual(['Org', 'Booking'])
    expect(calls[0].appImports[0]).toContain('@prisma/client')
    expect(calls[0].blocked[0].needs).toContain('missing-data')

    // Artifact 1 — the script, byte-identical to what the model returned.
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe(goodScript())
    // Artifact 2 — the recipe's api.seed, carrying the explicit `script` field.
    const patched = recipeOf(r)
    expect(patched.api?.seed).toEqual({
      command: 'node scripts/guard-seed.mjs',
      script: 'scripts/guard-seed.mjs',
      provides: { fixtures: { org: ['id', 'slug'] } },
    })
    // Unrelated recipe content survives untouched, in the file's own 2-space format.
    const raw = fs.readFileSync(recipePath(r), 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw).api.serve).toEqual(['node', FIXTURE_SERVER])
    expect(JSON.parse(raw).build).toBe('true')
    // The verification really ran the script: the store carries the seeded row.
    expect(JSON.parse(fs.readFileSync(store, 'utf-8')).orgs).toEqual([{ id: 42, slug: 'acme' }])
    // …and the seed block moved the fingerprint, which is what re-authors.
    expect(res.fingerprint).not.toBe(before)
    expect(res.fingerprint).toBe(computeRecipeFingerprint(r))
  })
})

describe('draftSeed — verification rejects, one retry, then a gap', () => {
  /** A script that emits a manifest MISSING the declared `slug` field. */
  const shortManifest = [
    "import fs from 'node:fs'",
    'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [] }))',
    'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org: { id: 1 } } }))',
    '',
  ].join('\n')
  /** A script that fails loudly, as the prompt demands of a real failure. */
  const exitsNonZero = ["console.error('could not connect to the datastore')", 'process.exit(3)', ''].join('\n')

  const KINDS: { name: string; bad: string; reason: RegExp }[] = [
    { name: 'manifest does not match provides', bad: shortManifest, reason: /missing declared field "slug"/ },
    { name: 'the script exits non-zero', bad: exitsNonZero, reason: /exited 3/ },
  ]

  for (const kind of KINDS) {
    it(`re-asks ONCE with the engine's report verbatim — ${kind.name}`, async () => {
      const r = repo()
      writeApiRecipe(r)
      const { runner, calls } = scripted(proposal(kind.bad), proposal(kind.bad))

      const res = await draftSeed({
        repoRoot: r,
        recipe: recipeOf(r),
        blocked: BLOCKED,
        database: DATABASE,
        runner,
      })

      expect(res.status).toBe('failed')
      if (res.status !== 'failed') return
      expect(res.reason).toMatch(kind.reason)
      // Exactly one retry, carrying the engine's OWN text and the draft it ran.
      expect(calls).toHaveLength(2)
      expect(calls[0].retry).toBeUndefined()
      expect(calls[1].retry?.failure).toBe(res.reason)
      expect(calls[1].retry?.proposal).toContain('scripts/guard-seed.mjs')
      // Nothing written: no script, no `api.seed`, and the tree is as it was.
      expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
      expect(recipeOf(r).api?.seed).toBeUndefined()
    })

    it(`a corrected draft verifies and is written — after ${kind.name}`, async () => {
      const r = repo()
      writeApiRecipe(r)
      const { runner, calls } = scripted(proposal(kind.bad), proposal(goodScript()))

      const res = await draftSeed({
        repoRoot: r,
        recipe: recipeOf(r),
        blocked: BLOCKED,
        database: DATABASE,
        runner,
      })

      expect(res.status).toBe('drafted')
      expect(calls).toHaveLength(2)
      expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true)
      expect(recipeOf(r).api?.seed?.command).toBe('node scripts/guard-seed.mjs')
    })
  }

  it('refuses a scriptPath that already exists rather than overwriting a file', async () => {
    const r = repo()
    writeApiRecipe(r)
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'mine\n')
    const { runner } = scripted(proposal(goodScript()), proposal(goodScript()))

    const res = await draftSeed({
      repoRoot: r,
      recipe: recipeOf(r),
      blocked: BLOCKED,
      database: DATABASE,
      runner,
    })

    expect(res.status).toBe('failed')
    if (res.status !== 'failed') return
    expect(res.reason).toMatch(/already exists/)
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe('mine\n')
  })

  it('an invalid reply is re-asked once, then reported without a call to verification', async () => {
    const r = repo()
    writeApiRecipe(r)
    const { runner, calls } = scripted({ nonsense: true }, { still: 'wrong' })

    const res = await draftSeed({
      repoRoot: r,
      recipe: recipeOf(r),
      blocked: BLOCKED,
      database: DATABASE,
      runner,
    })

    expect(res.status).toBe('failed')
    if (res.status !== 'failed') return
    expect(res.reason).toMatch(/invalid after re-ask/)
    expect(calls).toHaveLength(2)
    expect(calls[1].correction).toBeDefined()
  })
})

describe('draftSeed — the cache', () => {
  it('a re-run over unchanged inputs re-verifies without calling the model again', async () => {
    const r = repo()
    writeApiRecipe(r)
    const { runner } = scripted(proposal(goodScript()))
    expect((await draftSeed({ repoRoot: r, recipe: recipeOf(r), blocked: BLOCKED, database: DATABASE, runner })).status).toBe(
      'drafted',
    )

    // Undo the WRITE (not the cache): the gate re-opens, and the drafting call is
    // the only thing that must not be paid for twice.
    fs.rmSync(path.join(r, 'scripts/guard-seed.mjs'))
    writeApiRecipe(r)

    const again = await draftSeed({
      repoRoot: r,
      recipe: recipeOf(r),
      blocked: BLOCKED,
      database: DATABASE,
      runner: neverCalled,
    })

    expect(again.status).toBe('drafted')
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true)
  })
})
