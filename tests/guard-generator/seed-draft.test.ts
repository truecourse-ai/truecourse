/**
 * SEED GROUNDING + WRITE PATH — what `seed-draft.ts` still owns now that the
 * DRAFTING itself is an agent session (`guard-setup.seed`, plan 03 step 13, in
 * `@truecourse/core`): the cheap gate, the deterministic grounding readers, and
 * the two-artifact write the session's fold calls.
 *
 * Nothing here calls a model — there is no model left in this module. The
 * session's own behavior (scratch discipline, the fresh-world proof, redaction,
 * the cache) is covered in `tests/core/guard-setup-seed-session.test.ts`; what
 * is under test here is the half both the engine and that session share, and
 * the file-format promises the write path makes to a human reviewer.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  connectionEnvVars,
  readExistingSeedScript,
  resolveScriptPath,
  seedDraftGate,
  suggestedScriptPath,
  toRecipeSeed,
  writeSeedArtifacts,
  SEED_CACHE_NAME,
  type SeedDraftDatabase,
  type SeedProposal,
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

/** The parsed schema a real analyzer pass hands the step. */
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

/** Write the api recipe the write path patches, with the store the fixture reads. */
function writeApiRecipe(r: string, extra: Record<string, unknown> = {}): string {
  const store = path.join(r, 'store.json')
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', FIXTURE_SERVER],
      healthPath: '/health',
      env: { SEED_STORE: store, DATABASE_URL: 'file:./dev.db' },
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

const SCRIPT = [
  '// Idempotent: the store is a single JSON document, rewritten wholesale.',
  "import fs from 'node:fs'",
  'const org = { id: 42, slug: "acme" }',
  'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
  'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
  '',
].join('\n')

function proposal(over: Partial<SeedProposal> = {}): SeedProposal {
  return {
    scriptPath: 'scripts/guard-seed.mjs',
    scriptContent: SCRIPT,
    seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: ['id', 'slug'] } } },
    ...over,
  }
}

describe('seedDraftGate — the conditions', () => {
  // The "some flow is blocked on missing data" condition was dropped: it was an
  // AUTHORING output, and `guard setup` prepares BEFORE authoring has ever run.
  it('does NOT require a blocked flow — setup drafts before authoring exists', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(seedDraftGate({ recipe: recipeOf(r), database: DATABASE })).toEqual({ ok: true })
  })

  it('skips when there is no recipe at all', () => {
    expect(seedDraftGate({ recipe: null, database: DATABASE })).toEqual({
      ok: false,
      reason: expect.stringContaining('no recipe.json'),
    })
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

  it('opens for a confirmed replacement of an existing seed', () => {
    const r = repo()
    writeApiRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    expect(
      seedDraftGate({ recipe: recipeOf(r), database: DATABASE, replaceExisting: true }),
    ).toEqual({ ok: true })
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

  it('defers the schema conditions when detection has not run yet', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(seedDraftGate({ recipe: recipeOf(r) })).toEqual({ ok: true })
  })
})

describe('writeSeedArtifacts — the two reviewable artifacts', () => {
  it('writes the script and patches api.seed, leaving the rest of the recipe alone', () => {
    const r = repo()
    writeApiRecipe(r)
    const before = computeRecipeFingerprint(r)

    const result = writeSeedArtifacts(r, proposal(), new Set())

    expect(result.status).toBe('drafted')
    if (result.status !== 'drafted') return
    // Artifact 1 — the script, byte-identical to what the session produced.
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe(SCRIPT)
    // Artifact 2 — the api.seed block, carrying the explicit `script` field.
    expect(recipeOf(r).api?.seed).toEqual({
      command: 'node scripts/guard-seed.mjs',
      script: 'scripts/guard-seed.mjs',
      provides: { fixtures: { org: ['id', 'slug'] } },
    })
    // The file keeps its own format, so the diff a reviewer reads is the seed block.
    const raw = fs.readFileSync(recipePath(r), 'utf-8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw).api.serve).toEqual(['node', FIXTURE_SERVER])
    expect(JSON.parse(raw).build).toBe('true')
    // The seed block moved the fingerprint, which is what re-authors.
    expect(result.fingerprint).not.toBe(before)
    expect(result.fingerprint).toBe(computeRecipeFingerprint(r))
    expect(result.recipePath).toBe(path.join('.truecourse', 'scenarios', 'recipe.json'))
  })

  it('refuses a script path that escapes the repository, writing nothing', () => {
    const r = repo()
    writeApiRecipe(r)

    const result = writeSeedArtifacts(r, proposal({ scriptPath: '../evil.mjs' }), new Set())

    expect(result).toMatchObject({ status: 'failed', reason: expect.stringContaining('escapes the repository') })
    expect(recipeOf(r).api?.seed).toBeUndefined()
  })

  it('refuses a recipe with no api block rather than inventing one', () => {
    const r = repo()
    const target = recipePath(r)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify({ build: 'true', entry: ['node', 'x.js'] }, null, 2))

    expect(writeSeedArtifacts(r, proposal(), new Set())).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('no `api` block'),
    })
  })

  it('refuses a patch that would make the whole recipe invalid', () => {
    const r = repo()
    writeApiRecipe(r)

    const result = writeSeedArtifacts(
      r,
      proposal({ seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: [] } } } as never }),
      new Set(),
    )

    expect(result).toMatchObject({ status: 'failed', reason: expect.stringContaining('would be invalid') })
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
  })

  it('drops a `satisfies` naming a scheme the corpus never declared', () => {
    const r = repo()
    writeApiRecipe(r)
    const credentials = {
      owner: { header: 'Authorization', description: 'org owner', satisfies: 'invented' },
      member: { header: 'Authorization', description: 'member', satisfies: 'bearerAuth' },
    }

    writeSeedArtifacts(
      r,
      proposal({ seed: { command: 'node scripts/guard-seed.mjs', provides: { credentials } } }),
      new Set(['bearerAuth']),
    )

    expect(recipeOf(r).api?.seed?.provides.credentials).toEqual({
      owner: { header: 'Authorization', description: 'org owner' },
      member: { header: 'Authorization', description: 'member', satisfies: 'bearerAuth' },
    })
  })
})

describe('toRecipeSeed', () => {
  it('keeps the script path as the recipe’s `script` field and prunes empty provides', () => {
    const seed = toRecipeSeed(proposal(), new Set())
    expect(seed).toEqual({
      command: 'node scripts/guard-seed.mjs',
      script: 'scripts/guard-seed.mjs',
      provides: { fixtures: { org: ['id', 'slug'] } },
    })
  })
})

describe('resolveScriptPath', () => {
  it('accepts a repo-relative path and refuses an absolute or escaping one', () => {
    const r = repo()
    expect(resolveScriptPath(r, 'scripts/x.mjs')).toEqual({ abs: path.join(r, 'scripts/x.mjs') })
    expect(resolveScriptPath(r, path.join(r, 'x.mjs'))).toEqual({
      reason: expect.stringContaining('repo-relative'),
    })
    expect(resolveScriptPath(r, '../x.mjs')).toEqual({
      reason: expect.stringContaining('escapes the repository'),
    })
  })
})

describe('the grounding readers', () => {
  it('quotes the seed script being replaced, and reads nothing when there is none', () => {
    const r = repo()
    writeApiRecipe(r, {
      seed: { command: 'node mine.mjs', script: 'mine.mjs', provides: { fixtures: { org: ['id'] } } },
    })
    fs.writeFileSync(path.join(r, 'mine.mjs'), '// hand written\n')

    expect(readExistingSeedScript(r, recipeOf(r))).toEqual({
      scriptPath: 'mine.mjs',
      scriptContent: '// hand written\n',
    })

    writeApiRecipe(r)
    expect(readExistingSeedScript(r, recipeOf(r))).toBeNull()
  })

  it('reads nothing when the declared script file is gone', () => {
    const r = repo()
    writeApiRecipe(r, {
      seed: { command: 'node gone.mjs', script: 'gone.mjs', provides: { fixtures: { org: ['id'] } } },
    })
    expect(readExistingSeedScript(r, recipeOf(r))).toBeNull()
  })

  it('names the connection variables the app itself reads, sorted', () => {
    const r = repo()
    writeApiRecipe(r)
    expect(connectionEnvVars(recipeOf(r))).toEqual(['DATABASE_URL'])
  })

  it('suggests the ecosystem’s own script convention', () => {
    expect(suggestedScriptPath('node')).toBe('scripts/guard-seed.mjs')
    expect(suggestedScriptPath('python')).toBe('scripts/guard_seed.py')
    expect(suggestedScriptPath('dotnet')).toBe('scripts/guard-seed.csx')
  })

  // The session's outcome cache kept the one-shot stage's directory name, so a
  // repo that drafted before the move does not re-pay for the same inputs.
  it('keeps the legacy cache name', () => {
    expect(SEED_CACHE_NAME).toBe('guard/seed')
  })
})
