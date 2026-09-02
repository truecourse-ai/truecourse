/**
 * `runGuardSetup` — the whole stage over a copy of the `seed-draft` fixture.
 *
 * The engine no longer owns any LLM call: the recipe repair, the dependency
 * catalog, the seed and the
 * auth proof are all SEAMS the command adapter injects (plan 03 steps 8–14).
 * What this file pins is the engine's own contract:
 *
 *  - the §7.6 STEP SPINE — six rows, in order, each with its input fingerprint;
 *  - SKIP-WHEN-SETTLED — a step whose fingerprint matches a settled row is
 *    skipped whole, `--refresh` forces every one of them, and a step that WRITES
 *    records the tree it left behind so it matches itself next run;
 *  - the HARD GATE is still step 1 and only step 1 (catalog, seed
 *    and auth are soft and report their own outcome);
 *  - the seams are called with what they are promised, and their results land on
 *    the right row.
 *
 * Docker is never involved: the recipe declares no `api.services`. The live
 * endpoint probe is stubbed in every case but the one happy path that proves it
 * really boots the fixture server.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  recipePath,
  computeRecipeFingerprint,
  writeGuardSetup,
  readGuardSetup,
  dependenciesPath,
} from '@truecourse/guard-runner'
import {
  runGuardSetup,
  detectRoleColumns,
  ecosystemFingerprint,
  type GuardSetupAuthStep,
  type GuardSetupCatalogSession,
  type GuardSetupOptions,
  type GuardSetupSeedSession,
  type GuardSetupSeedSessionInput,
  type JourneyProvider,
  type SeedDraftDatabase,
  type RecipeRunner,
} from '@truecourse/guard-generator'
import {
  GuardSetupReportSchema,
  GuardSetupTaxonomyStepSchema,
  type DetectedExternalService,
  type GuardSetupServerProbe,
} from '@truecourse/shared'
import { rmrf } from '../guard-runner/helpers.js'
import { writeCorpus, apiJourney } from './helpers.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/orgs.md'

/** The fixture app, copied out, with a corpus (setup runs AFTER `spec scan`). */
function fixtureRepo(opts: { corpus?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-setup-'))
  repos.push(dir)
  fs.cpSync(FIXTURE, dir, { recursive: true })
  if (opts.corpus !== false) {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(dir, DOC), '## orgs\nAn org owner can list their orgs.\n')
    writeCorpus(dir, [{ ref: DOC }])
  }
  return dir
}

/** The recipe setup will find (so step 1 reuses it and never proposes). */
function writeRecipe(r: string, over: Record<string, unknown> = {}): void {
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
      ...over,
    },
  }
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
}

const DATABASE: SeedDraftDatabase = {
  type: 'sqlite',
  driver: 'prisma',
  tables: [
    {
      name: 'User',
      columns: [
        { name: 'id', type: 'Int', isPrimaryKey: true },
        { name: 'email', type: 'String', isUnique: true },
        { name: 'role', type: "enum('owner','member')" },
      ],
    },
    { name: 'Org', columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] },
  ],
  relations: [],
  appImports: ["src/db.js: import { PrismaClient } from '@prisma/client'"],
}

/** The journey/detection pass, stubbed at the seam the engine already has. */
function journeys(
  over: {
    externalServices?: DetectedExternalService[]
    database?: SeedDraftDatabase | null
  } = {},
): JourneyProvider {
  return async () => ({
    journeys: [apiJourney('GET', '/orgs')],
    externalServices: over.externalServices ?? [],
    database: over.database === undefined ? DATABASE : over.database,
    datastoreUrls: [],
  })
}

const neverCalled = (label: string): RecipeRunner =>
  async () => {
    throw new Error(`the ${label} runner must not be called`)
  }

/** A live-probe seam that answers 200 without booting anything, counting calls. */
function probeStub(over: Partial<GuardSetupServerProbe> = {}): {
  probe: NonNullable<GuardSetupOptions['probe']>
  calls: number
} {
  const state = { calls: 0 }
  const probe: NonNullable<GuardSetupOptions['probe']> = async () => {
    state.calls++
    return [{ server: 'default', path: '/health', status: 200, ok: true, ...over }]
  }
  return {
    probe,
    get calls() {
      return state.calls
    },
  }
}

/** A seed seam that reports a draft WITHOUT touching the tree. */
function seedSeam(
  result: Awaited<ReturnType<GuardSetupSeedSession>> = {
    status: 'ok',
    scriptPath: 'scripts/guard-seed.mjs',
    command: 'node scripts/guard-seed.mjs',
    fixtures: ['org'],
    credentials: ['owner'],
  },
): { seam: GuardSetupSeedSession; inputs: GuardSetupSeedSessionInput[] } {
  const inputs: GuardSetupSeedSessionInput[] = []
  return {
    inputs,
    seam: async (input) => {
      inputs.push(input)
      return result
    },
  }
}

/** A seed seam that really WRITES its artifacts — the post-write fingerprint case. */
function writingSeedSeam(): GuardSetupSeedSession {
  return async (input) => {
    const scriptPath = 'scripts/guard-seed.mjs'
    fs.mkdirSync(path.join(input.repoRoot, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(input.repoRoot, scriptPath), '// drafted\n')
    const file = recipePath(input.repoRoot)
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      api: Record<string, unknown>
    }
    doc.api.seed = {
      command: 'node scripts/guard-seed.mjs',
      script: scriptPath,
      provides: { fixtures: { org: ['id'] } },
    }
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
    return { status: 'ok', scriptPath, command: 'node scripts/guard-seed.mjs' }
  }
}

/** The options every case shares: no corpus surprises, no real boot, no model. */
function baseOpts(r: string, over: Partial<GuardSetupOptions> = {}): GuardSetupOptions {
  return {
    repoRoot: r,
    journeys: journeys(),
    recipeRunner: neverCalled('recipe'),
    probe: probeStub().probe,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

describe('runGuardSetup — the gates', () => {
  // Step 0.5. Setup is the SECOND link of a three-stage chain; half-completing would
  // leave a recipe no spec ever justified.
  it('refuses without a corpus and names `spec scan`', async () => {
    const r = fixtureRepo({ corpus: false })
    writeRecipe(r)

    const { report } = await runGuardSetup(baseOpts(r))

    expect(report.status).toBe('failed')
    expect(report.reason).toMatch(/truecourse spec scan/)
    expect(report.steps).toEqual([])
  })

  // Step 1 is the ONLY hard gate, and the spine carries ONLY the rows the run
  // reached — nothing downstream ran, so nothing downstream is reported.
  it('stops at the recipe gate when a declared server cannot be reached', async () => {
    const r = fixtureRepo()
    writeRecipe(r)

    const { report } = await runGuardSetup(
      baseOpts(r, {
        probe: async () => [
          { server: 'default', path: '/health', ok: false, error: 'connection refused' },
        ],
      }),
    )

    expect(report.status).toBe('failed')
    expect(report.recipe.status).toBe('failed')
    expect(report.reason).toMatch(/not reachable/)
    expect(report.steps.map((s) => [s.key, s.status])).toEqual([['recipe', 'failed']])
    expect(report.steps[0].inputFingerprint).toBe(ecosystemFingerprint(r))
    expect(report.seed).toBeUndefined()
    expect(report.externals).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Step 8 — the spine
// ---------------------------------------------------------------------------

describe('runGuardSetup — the step spine (plan 03 step 8)', () => {
  it('records six rows in taxonomy order, and the record round-trips the schema', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const seed = seedSeam()

    const { report } = await runGuardSetup(baseOpts(r, { seedSession: seed.seam }))

    expect(report.status).toBe('ok')
    expect(report.steps.map((s) => s.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'seed',
      'auth',
    ])
    // detect is free: it always runs, so it has no fingerprint to settle on.
    const byKey = Object.fromEntries(report.steps.map((s) => [s.key, s]))
    expect(byKey.detect).toEqual({ key: 'detect', status: 'ok', inputFingerprint: '' })
    for (const key of ['recipe', 'catalog', 'seed', 'auth']) {
      expect(byKey[key].inputFingerprint).toMatch(/^[0-9a-f]{64}$/)
    }
    // The unwired seam reports a placeholder row that NAMES what is missing.
    expect(byKey.auth).toMatchObject({ status: 'skipped' })
    expect(byKey.auth.reason).toMatch(/not wired into this run/)

    // The persisted record is what `guard status` and the externals view read.
    expect(GuardSetupReportSchema.safeParse(report).success).toBe(true)
    writeGuardSetup(r, report)
    expect(readGuardSetup(r)?.steps.map((s) => s.key)).toEqual([
      'recipe',
      'detect',
      'catalog',
      'seed',
      'auth',
    ])
  })

  // `blocked` is the auth step's alone — a supplied credential waiting on a user
  // registration. Every other step is ok/skipped/failed.
  it('the shared schema allows `blocked` on auth and refuses it anywhere else', () => {
    const row = { status: 'blocked' as const, inputFingerprint: 'x' }
    expect(GuardSetupTaxonomyStepSchema.safeParse({ key: 'auth', ...row }).success).toBe(true)
    const refused = GuardSetupTaxonomyStepSchema.safeParse({ key: 'seed', ...row })
    expect(refused.success).toBe(false)
    if (!refused.success) {
      expect(refused.error.issues[0].message).toMatch(/only the auth step may end `blocked`/)
    }
  })

  // A record written before the spine existed still reads — as an empty spine
  // (nothing settled), never as a parse failure that loses the detection snapshot.
  it('an old setup.json with no `steps` reads back as an empty spine', () => {
    const r = fixtureRepo()
    const file = path.join(r, '.truecourse', 'guard', 'setup.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        ranAt: '2026-01-01T00:00:00.000Z',
        status: 'ok',
        recipe: { status: 'ok', outcome: 'exists' },
      }),
    )

    expect(readGuardSetup(r)?.steps).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Step 8 — skip when settled
// ---------------------------------------------------------------------------

describe('runGuardSetup — skip when settled (plan 03 step 8)', () => {
  /** Run setup and persist the report, exactly as the command adapter does. */
  async function runAndPersist(
    r: string,
    over: Partial<GuardSetupOptions> = {},
  ): Promise<Awaited<ReturnType<typeof runGuardSetup>>['report']> {
    const result = await runGuardSetup(baseOpts(r, over))
    writeGuardSetup(r, result.report)
    return result.report
  }

  const statuses = (
    report: Awaited<ReturnType<typeof runGuardSetup>>['report'],
  ): Record<string, string> =>
    Object.fromEntries(report.steps.map((s) => [s.key, `${s.status}${s.reason ? `:${s.reason}` : ''}`]))

  it('skips a settled step on the second run, and stays settled on the third', async () => {
    const r = fixtureRepo()
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    const probe = probeStub()
    const seed = seedSeam()

    const first = await runAndPersist(r, { probe: probe.probe, seedSession: seed.seam })
    expect(statuses(first).recipe).toBe('ok')
    expect(probe.calls).toBe(1)

    const second = await runAndPersist(r, { probe: probe.probe, seedSession: seed.seam })
    expect(statuses(second)).toMatchObject({
      recipe: 'skipped:unchanged',
      catalog: 'skipped:unchanged',
      seed: 'skipped:unchanged',
    })
    // The whole point of skipping the recipe step: no server is booted again.
    expect(probe.calls).toBe(1)
    // The committed seed is still REPORTED on the legacy field, from the recipe.
    expect(second.seed).toMatchObject({ status: 'ok', outcome: 'exists', command: 'node mine.mjs' })

    // A `skipped/unchanged` row settles too, so run three does not bounce back.
    const third = await runAndPersist(r, { probe: probe.probe, seedSession: seed.seam })
    expect(statuses(third)).toMatchObject({
      recipe: 'skipped:unchanged',
      catalog: 'skipped:unchanged',
      seed: 'skipped:unchanged',
    })
    expect(probe.calls).toBe(1)
  })

  it('--refresh re-runs every step, re-deriving the recipe it already had', async () => {
    const r = fixtureRepo()
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    const probe = probeStub()
    let repairs = 0

    await runAndPersist(r, { probe: probe.probe })
    const refreshed = await runAndPersist(r, {
      probe: probe.probe,
      refresh: true,
      // A refresh RE-DERIVES: the dependency-free fixture declares no start script,
      // so the model fallback would be reached — the repair seam stands in for it.
      // That it is reached AT ALL is the proof discovery ran with `ignoreExisting`:
      // a discovery that saw the committed recipe would have returned `exists`.
      repair: async () => {
        repairs++
        return {
          proposal: {
            build: 'true',
            api: {
              serve: ['node', path.join(r, 'server.mjs')],
              healthPath: '/health',
              env: { SEED_STORE: path.join(r, 'store.json') },
            },
          },
        }
      },
      confirmSeedReplace: async () => false,
    })

    expect(repairs).toBe(1)
    expect(statuses(refreshed).recipe).toBe('ok')
    expect(refreshed.recipe.outcome).toBe('discovered')
    expect(statuses(refreshed).catalog).toBe('ok')
    // The probe ran again: the recipe step was really re-executed.
    expect(probe.calls).toBe(2)
  }, 120_000)

  // A refresh re-derives, and discovery knows nothing about the blocks it never
  // proposes. Losing them would be silent data loss — and it would defeat the seed
  // confirmation too (a wiped `api.seed` is not a seed anyone is asked about).
  it('--refresh restores the blocks discovery never proposes', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
      externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } },
      credentials: { owner: { header: 'Authorization', valueFromEnv: 'GUARD_CRED_OWNER' } },
    })
    // `ownHosts` is a top-level block, not an api one.
    const file = recipePath(r)
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
    doc.ownHosts = ['localhost']
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')

    const { report } = await runGuardSetup(
      baseOpts(r, {
        refresh: true,
        repair: async () => ({
          // The proposal carries NONE of the authored blocks — a re-derivation never does.
          proposal: {
            build: 'true',
            api: {
              serve: ['node', path.join(r, 'server.mjs')],
              healthPath: '/health',
              env: { SEED_STORE: path.join(r, 'store.json') },
            },
          },
        }),
        confirmSeedReplace: async () => false,
      }),
    )

    expect(report.recipe.outcome).toBe('discovered')
    const written = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(written.api.seed.command).toBe('node mine.mjs')
    expect(written.api.externals.stripe.baseUrlEnv).toBe('STRIPE_BASE_URL')
    expect(written.api.credentials.owner.valueFromEnv).toBe('GUARD_CRED_OWNER')
    expect(written.ownHosts).toEqual(['localhost'])
  }, 120_000)

  // The recipe step's subject is the ECOSYSTEM, never its own output: an edited
  // recipe.json re-runs nothing there, a moved package.json re-runs everything.
  it('a moved package.json re-runs the recipe step; a moved recipe.json does not', async () => {
    const r = fixtureRepo()
    writeRecipe(r, { seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } } })
    const probe = probeStub()

    await runAndPersist(r, { probe: probe.probe })
    expect(probe.calls).toBe(1)

    // Only the recipe moved: the recipe step still skips, but the steps whose
    // fingerprints fold `computeRecipeFingerprint` re-run.
    const pkg = path.join(r, 'package.json')
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
      readyTimeoutMs: 9000,
    })
    const afterRecipeEdit = await runAndPersist(r, { probe: probe.probe })
    expect(statuses(afterRecipeEdit).recipe).toBe('skipped:unchanged')
    expect(probe.calls).toBe(1)
    expect(statuses(afterRecipeEdit).catalog).toBe('ok')
    expect(statuses(afterRecipeEdit).seed).not.toBe('skipped:unchanged')

    // The subject moved: the recipe step re-runs (and re-probes).
    const manifest = JSON.parse(fs.readFileSync(pkg, 'utf-8')) as Record<string, unknown>
    manifest.version = '9.9.9'
    fs.writeFileSync(pkg, JSON.stringify(manifest, null, 2))
    const afterPkgEdit = await runAndPersist(r, { probe: probe.probe })
    expect(statuses(afterPkgEdit).recipe).toBe('ok')
    expect(probe.calls).toBe(2)
  })

  // The post-write fingerprint invariant: a step that WRITES records the tree as
  // it left it, or it would never match itself again.
  it('a seed step that wrote its artifacts matches itself on the next run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)

    const first = await runAndPersist(r, { seedSession: writingSeedSeam() })
    expect(statuses(first).seed).toBe('ok')
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true)

    const second = await runAndPersist(r, {
      seedSession: async () => {
        throw new Error('the seed seam must not be called on a settled re-run')
      },
    })
    expect(statuses(second).seed).toBe('skipped:unchanged')
  })
})

// ---------------------------------------------------------------------------
// The deterministic halves
// ---------------------------------------------------------------------------

describe('runGuardSetup — the happy path', () => {
  it('probes the LIVE server, declares the externals, and records the detection', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const before = computeRecipeFingerprint(r)
    const seed = seedSeam()

    // No `probe` seam here: this is the one case that really boots the fixture
    // server and calls a real route on it.
    const { report } = await runGuardSetup({
      repoRoot: r,
      recipeRunner: neverCalled('recipe'),
      seedSession: seed.seam,
      journeys: journeys({
        externalServices: [
          { service: 'stripe', category: 'payment', evidence: [], baseUrlEnv: 'STRIPE_BASE_URL' },
          // No base-URL variable ⇒ nothing honest to declare.
          { service: 'twilio', evidence: [] },
        ],
      }),
    })

    expect(report.status).toBe('ok')
    expect(report.recipe.outcome).toBe('exists')
    expect(report.recipe.probes).toEqual([
      { server: 'default', path: '/health', status: 200, ok: true },
    ])

    expect(report.detection?.externalServices.map((s) => s.service)).toEqual(['stripe', 'twilio'])
    expect(report.detection?.database).toEqual({ type: 'sqlite', driver: 'prisma', tables: 2 })

    // The externals SKELETON is the catalog step's deterministic half: the
    // declaration lands even with no account, and the undeclarable one is
    // reported rather than invented.
    expect(report.externals?.declared).toEqual(['stripe'])
    expect(report.externals?.undeclarable).toEqual(['twilio'])
    expect(report.externals?.unprovided).toEqual(['stripe'])
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.externals.stripe.baseUrlEnv).toBe('STRIPE_BASE_URL')
    expect(recipe.api.externals.stripe.baseUrl).toBeUndefined()

    // The declaration is what enters the fingerprint — which is why it must happen
    // HERE, before a single section has been authored against the old one.
    expect(computeRecipeFingerprint(r)).not.toBe(before)
  }, 120_000)

  // The grounding is what makes the ONE-artifact draft possible: the schema says
  // what is creatable, the routes say what must be reachable, the specs the roles.
  it('brief the seed seam with the schema, the routes, the roles and the specs', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const seed = seedSeam()

    await runGuardSetup(baseOpts(r, { seedSession: seed.seam }))

    const input = seed.inputs[0]
    expect(input.database.driver).toBe('prisma')
    expect(input.database.tables.map((t) => t.name)).toEqual(['User', 'Org'])
    expect(input.routes).toContainEqual({ method: 'GET', path: '/orgs' })
    expect(input.roles.map((role) => role.name).sort()).toEqual(['member', 'owner'])
    expect(input.specExcerpts[0]).toMatchObject({ doc: DOC })
    expect(input.specExcerpts[0].text).toMatch(/org owner/)
    expect(input.replaceExisting).toBe(false)
    // The cache key the seam is handed IS the step's own pre-run fingerprint.
    expect(input.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// The soft steps
// ---------------------------------------------------------------------------

describe('runGuardSetup — the soft steps', () => {
  // A catalog session that fails is a REPORTED row: the hard gate already held.
  it('a failed catalog session fails the ROW, never the run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const catalogSession: GuardSetupCatalogSession = async () => ({
      status: 'failed',
      reason: 'the draft left `stripe` unaccounted for',
      sessionRunId: 'run-cat',
    })

    const { report } = await runGuardSetup(baseOpts(r, { catalogSession }))

    expect(report.status).toBe('ok')
    const row = report.steps.find((s) => s.key === 'catalog')
    expect(row).toMatchObject({
      status: 'failed',
      reason: 'the draft left `stripe` unaccounted for',
      sessionRunId: 'run-cat',
    })
  })

  it('a catalog session that lands records its post-write fingerprint and its run id', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const seen: unknown[] = []
    const catalogSession: GuardSetupCatalogSession = async (input) => {
      seen.push(input)
      return { status: 'ok', added: ['stripe'], findings: [], sessionRunId: 'run-cat' }
    }

    const { report } = await runGuardSetup(
      baseOpts(r, {
        catalogSession,
        journeys: journeys({
          externalServices: [
            { service: 'stripe', category: 'payment', evidence: [], baseUrlEnv: 'STRIPE_BASE_URL' },
          ],
        }),
      }),
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      repoRoot: r,
      skeleton: { declared: ['stripe'], alreadyDeclared: [], undeclarable: [] },
    })
    expect(report.steps.find((s) => s.key === 'catalog')).toMatchObject({
      status: 'ok',
      sessionRunId: 'run-cat',
    })
  })

  // Steps 3–6 are SOFT by contract: a repo with no database still gets its recipe
  // proved and its externals declared.
  it('reports the seed gate refusal without failing the run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)

    const { report } = await runGuardSetup(
      baseOpts(r, {
        journeys: journeys({ database: null }),
        seedSession: async () => {
          throw new Error('the seed seam must not be reached past the gate')
        },
      }),
    )

    expect(report.status).toBe('ok')
    expect(report.seed?.status).toBe('skipped')
    expect(report.seed?.reason).toMatch(/no database was detected/)
    expect(report.externals?.status).toBe('ok')
  })

  it('a bare re-run over a prepared repo REPORTS and no-ops', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
    })
    const before = fs.readFileSync(recipePath(r), 'utf-8')

    const { report } = await runGuardSetup(
      baseOpts(r, {
        seedSession: async () => {
          throw new Error('an existing seed must not be re-drafted without a refresh')
        },
      }),
    )

    expect(report.status).toBe('ok')
    expect(report.recipe.outcome).toBe('exists')
    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'exists', command: 'node mine.mjs' })
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })

  // `--refresh` is not consent. A seed script is a committed, human-reviewed file,
  // and a non-TTY caller answers false — so a flag alone can never clobber it.
  it('--refresh does NOT reach the seed seam when the replacement is not confirmed', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
    })

    const { report } = await runGuardSetup(
      baseOpts(r, {
        refresh: true,
        repair: async () => ({
          proposal: {
            build: 'true',
            api: {
              serve: ['node', path.join(r, 'server.mjs')],
              healthPath: '/health',
              env: { SEED_STORE: path.join(r, 'store.json') },
            },
          },
        }),
        seedSession: async () => {
          throw new Error('the seed seam must not be called without a confirmation')
        },
        confirmSeedReplace: async () => false,
      }),
    )

    expect(report.seed?.status).toBe('skipped')
    expect(report.seed?.reason).toMatch(/not confirmed/)
  }, 120_000)

  it('--refresh briefs the seed seam with the script it is replacing, once confirmed', async () => {
    const r = fixtureRepo()
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), '// the hand-edited original\n')
    writeRecipe(r, {
      seed: {
        command: 'node scripts/guard-seed.mjs',
        script: 'scripts/guard-seed.mjs',
        provides: { fixtures: { org: ['id'] } },
      },
    })
    const seed = seedSeam()

    const { report } = await runGuardSetup(
      baseOpts(r, {
        refresh: true,
        repair: async () => ({
          proposal: {
            build: 'true',
            api: {
              serve: ['node', path.join(r, 'server.mjs')],
              healthPath: '/health',
              env: { SEED_STORE: path.join(r, 'store.json') },
            },
          },
        }),
        seedSession: seed.seam,
        confirmSeedReplace: async () => true,
      }),
    )

    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'drafted' })
    expect(seed.inputs[0].replaceExisting).toBe(true)
    expect(seed.inputs[0].existingScript?.scriptContent).toBe('// the hand-edited original\n')
  }, 120_000)

  it('a failed seed session fails the ROW, never the run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)

    const { report } = await runGuardSetup(
      baseOpts(r, {
        seedSession: async () => ({
          status: 'failed',
          reason: 'the fresh-world proof failed: unique constraint violated',
          sessionRunId: 'run-seed',
        }),
      }),
    )

    expect(report.status).toBe('ok')
    expect(report.seed?.status).toBe('failed')
    expect(report.steps.find((s) => s.key === 'seed')).toMatchObject({
      status: 'failed',
      sessionRunId: 'run-seed',
    })
  })

  it('an auth step may end `blocked` without demoting the run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const verifyAuth: GuardSetupAuthStep = async () => ({
      status: 'blocked',
      reason: 'anthropic is registered in scenarios/dependencies.local.json by nobody yet',
    })

    const { report } = await runGuardSetup(baseOpts(r, { verifyAuth }))

    expect(report.status).toBe('ok')
    expect(report.steps.find((s) => s.key === 'auth')).toMatchObject({ status: 'blocked' })
    expect(GuardSetupReportSchema.safeParse(report).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// detectRoleColumns — the deterministic grounding the seed briefing carries
// ---------------------------------------------------------------------------

describe('detectRoleColumns', () => {
  it('reads the enumerated values of a role column on a principal-shaped table', () => {
    expect(detectRoleColumns(DATABASE)).toEqual([
      { name: 'owner', source: 'User.role' },
      { name: 'member', source: 'User.role' },
    ])
  })

  // A schema with no role column yields one principal — the honest default, not a
  // degradation, and certainly not an invented hierarchy.
  it('reports none when no principal table carries a role column', () => {
    expect(
      detectRoleColumns({
        ...DATABASE,
        tables: [{ name: 'Org', columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] }],
      }),
    ).toEqual([])
  })

  it('ignores a role-shaped column on a table that is not a principal', () => {
    expect(
      detectRoleColumns({
        ...DATABASE,
        tables: [{ name: 'Widget', columns: [{ name: 'kind', type: "enum('a','b')" }] }],
      }),
    ).toEqual([])
  })

  it('falls back to a defaulted role column when the type is not enumerated', () => {
    expect(
      detectRoleColumns({
        ...DATABASE,
        tables: [
          {
            name: 'User',
            columns: [
              { name: 'email', type: 'String' },
              { name: 'role', type: 'String', defaultValue: "'member'" },
            ],
          },
        ],
      }),
    ).toEqual([{ name: 'member', source: 'User.role' }])
  })
})

// ---------------------------------------------------------------------------
// The catalog settle record — the COMMITTABLE session skip
// ---------------------------------------------------------------------------
// The legacy skip lives in gitignored guard/setup.json, so a fresh checkout
// re-ran the catalog session every time — and its LLM-nondeterministic
// additions grew the committed catalog, which moved the recipe fingerprint,
// which re-authored every flow. `scenarios/dependencies.settle.json` commits
// the "these inputs were already classified" verdict next to the catalog.

describe('runGuardSetup — the catalog settle record', () => {
  const settlePath = (r: string): string =>
    path.join(path.dirname(dependenciesPath(r)), 'dependencies.settle.json')

  const countingCatalogSession = () => {
    const state = { calls: 0 }
    const session: GuardSetupCatalogSession = async (input) => {
      state.calls++
      fs.mkdirSync(path.dirname(dependenciesPath(input.repoRoot)), { recursive: true })
      fs.writeFileSync(
        dependenciesPath(input.repoRoot),
        `${JSON.stringify({ version: 1, dependencies: [] }, null, 2)}\n`,
      )
      return { status: 'ok', added: ['postgres'], findings: [], sessionRunId: 'run-cat' }
    }
    return { state, session }
  }

  it('a session run settles; a fresh checkout (no setup.json) skips on the record alone', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const { state, session } = countingCatalogSession()

    const first = await runGuardSetup(baseOpts(r, { catalogSession: session }))
    expect(state.calls).toBe(1)
    expect(first.report.steps.find((s) => s.key === 'catalog')).toMatchObject({ status: 'ok' })
    expect(fs.existsSync(settlePath(r))).toBe(true)

    // guard/setup.json was never persisted — the fresh-checkout case. The
    // committable settle record must skip the session on its own, and the
    // committed catalog must stand byte-for-byte.
    const bytes = fs.readFileSync(dependenciesPath(r), 'utf-8')
    const second = await runGuardSetup(baseOpts(r, { catalogSession: session }))
    expect(state.calls).toBe(1)
    expect(second.report.steps.find((s) => s.key === 'catalog')).toMatchObject({
      status: 'skipped',
      reason: 'unchanged',
    })
    expect(fs.readFileSync(dependenciesPath(r), 'utf-8')).toBe(bytes)
  })

  it('a committed catalog with no settle record is adopted, never re-classified', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    fs.mkdirSync(path.dirname(dependenciesPath(r)), { recursive: true })
    fs.writeFileSync(
      dependenciesPath(r),
      `${JSON.stringify({ version: 1, dependencies: [] }, null, 2)}\n`,
    )
    const { state, session } = countingCatalogSession()

    const { report } = await runGuardSetup(baseOpts(r, { catalogSession: session }))
    expect(state.calls).toBe(0)
    expect(report.steps.find((s) => s.key === 'catalog')).toMatchObject({
      status: 'skipped',
      reason: 'unchanged',
    })
    // Adoption is recorded, so the next run skips by fingerprint match.
    expect(fs.existsSync(settlePath(r))).toBe(true)
  })

  it('a recipe edit re-runs the session and re-settles', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const { state, session } = countingCatalogSession()
    await runGuardSetup(baseOpts(r, { catalogSession: session }))
    expect(state.calls).toBe(1)
    const settled = fs.readFileSync(settlePath(r), 'utf-8')

    // Edit the recipe: the session inputs moved, so classification re-runs.
    const file = recipePath(r)
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8')) as { env?: Record<string, string> }
    doc.env = { ...(doc.env ?? {}), NEW_FLAG: '1' }
    fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)

    await runGuardSetup(baseOpts(r, { catalogSession: session }))
    expect(state.calls).toBe(2)
    expect(fs.readFileSync(settlePath(r), 'utf-8')).not.toBe(settled)
  })
})
