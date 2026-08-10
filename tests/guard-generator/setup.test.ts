/**
 * `runGuardSetup` — the whole stage, over a copy of the `seed-draft`
 * fixture, with only the MODEL stubbed. The recipe is really derived and really
 * verified (install → build → boot), the endpoint probe really calls the booted
 * server, the drafted seed script is really spawned and its manifest really
 * validated. Docker is never involved: the recipe declares no `api.services`.
 *
 * What the tests are about, in order of importance:
 *  - the HARD GATE is step 1 and only step 1 (externals and the seed are soft),
 *  - the externals SKELETON lands in recipe.json even with no account,
 *  - the seed is ONE artifact covering rows AND principals,
 *  - a bare re-run NO-OPS, and a `--refresh` never clobbers a seed unconfirmed.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recipePath, computeRecipeFingerprint } from '@truecourse/guard-runner'
import {
  runGuardSetup,
  detectRoleColumns,
  type JourneyProvider,
  type SeedDraftDatabase,
  type SeedProposal,
  type SeedRunner,
  type RecipeRunner,
} from '@truecourse/guard-generator'
import type { DetectedExternalService } from '@truecourse/shared'
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

/** The recipe setup will find (so step 1 reuses it and never calls the model). */
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

const SCRIPT = [
  '// Idempotent: the store is rewritten wholesale.',
  "import fs from 'node:fs'",
  'const org = { id: 42, slug: "acme" }',
  'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
  'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
  '  fixtures: { org },',
  '  credentials: { owner: { value: "Bearer owner-token" } },',
  '}))',
  '',
].join('\n')

const PROPOSAL: SeedProposal = {
  scriptPath: 'scripts/guard-seed.mjs',
  scriptContent: SCRIPT,
  seed: {
    command: 'node scripts/guard-seed.mjs',
    provides: {
      fixtures: { org: ['id', 'slug'] },
      credentials: { owner: { header: 'Authorization', description: 'org owner' } },
    },
  },
}

/** The journey/detection pass, stubbed at the seam the engine already has. */
function journeys(over: {
  externalServices?: DetectedExternalService[]
  database?: SeedDraftDatabase | null
} = {}): JourneyProvider {
  return async () => ({
    journeys: [apiJourney('GET', '/orgs')],
    externalServices: over.externalServices ?? [],
    database: over.database === undefined ? DATABASE : over.database,
    datastoreUrls: [],
  })
}

const neverCalled = (label: string) =>
  (async () => {
    throw new Error(`the ${label} runner must not be called`)
  }) as RecipeRunner & SeedRunner

/**
 * A model proposal for the fixture app. `--refresh` RE-DERIVES the recipe (that is
 * what a refresh is), and the dependency-free fixture declares no build/start script
 * the deterministic proposer can read — so the refresh tests supply the fallback the
 * model would have given, and the engine still verifies it by really building and
 * really booting.
 */
const recipeRunnerFor = (r: string): RecipeRunner =>
  async () => ({
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
    },
  })

function seedRunnerOf(...answers: unknown[]): { runner: SeedRunner; inputs: Parameters<SeedRunner>[0][] } {
  const inputs: Parameters<SeedRunner>[0][] = []
  return {
    inputs,
    runner: async (input) => {
      inputs.push(input)
      const answer = answers[inputs.length - 1]
      if (answer === undefined) throw new Error(`unexpected seed call #${inputs.length}`)
      return answer
    },
  }
}

describe('runGuardSetup — the gates', () => {
  // Step 0.5. Setup is the SECOND link of a three-stage chain; half-completing would
  // leave a recipe no spec ever justified.
  it('refuses without a corpus and names `spec scan`', async () => {
    const r = fixtureRepo({ corpus: false })
    writeRecipe(r)

    const { report } = await runGuardSetup({
      repoRoot: r,
      recipeRunner: neverCalled('recipe'),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('failed')
    expect(report.reason).toMatch(/truecourse spec scan/)
  })

  // Step 1 is the ONLY hard gate: nothing downstream runs when the declared server
  // is unreachable, because preparing a world nothing can run in is worse than stopping.
  it('stops when a declared server cannot be reached', async () => {
    const r = fixtureRepo()
    writeRecipe(r, { serve: ['node', path.join(r, 'missing.mjs')], readyTimeoutMs: 4000 })

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('failed')
    expect(report.recipe.status).toBe('failed')
    expect(report.reason).toMatch(/not reachable/)
    expect(report.seed).toBeUndefined()
    expect(report.externals).toBeUndefined()
  }, 60_000)
})

describe('runGuardSetup — a compose-backed repo', () => {
  /** A server that refuses to boot until the "datastore" marker exists — the
   *  dependency-free stand-in for a repo whose app needs `api.services` up. */
  function gatedRepo(r: string): string {
    const marker = path.join(r, 'datastore-up')
    fs.writeFileSync(
      path.join(r, 'services-up.mjs'),
      `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(marker)}, 'up')\n`,
    )
    fs.writeFileSync(
      path.join(r, 'services-down.mjs'),
      `import fs from 'node:fs'\nfs.rmSync(${JSON.stringify(marker)}, { force: true })\n`,
    )
    fs.writeFileSync(
      path.join(r, 'gated-server.mjs'),
      [
        "import http from 'node:http'",
        "import fs from 'node:fs'",
        `if (!fs.existsSync(${JSON.stringify(marker)})) {`,
        "  console.error('the datastore is not up')",
        '  process.exit(1)',
        '}',
        'http.createServer((_req, res) => {',
        "  res.writeHead(200, { 'content-type': 'application/json' })",
        '  res.end(\'{"ok":true}\')',
        '}).listen(Number(process.env.PORT))',
        '',
      ].join('\n'),
    )
    return marker
  }

  // The live probe boots the SAME server verification boots, so it needs the SAME
  // world: `api.services` up. Without the bring-up the probe's boot can never reach
  // a healthy state and the hard gate fails a recipe that is perfectly good.
  it('brings the datastore up for the live probe, then tears it down', async () => {
    const r = fixtureRepo()
    const marker = gatedRepo(r)
    writeRecipe(r, {
      serve: ['node', path.join(r, 'gated-server.mjs')],
      services: { up: 'node services-up.mjs', down: 'node services-down.mjs' },
      readyTimeoutMs: 8000,
    })

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys({ database: null }),
      recipeRunner: neverCalled('recipe'),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('ok')
    expect(report.recipe.probes).toEqual([{ server: 'default', path: '/health', status: 200, ok: true }])
    // Setup leaves nothing running behind it.
    expect(fs.existsSync(marker)).toBe(false)
  }, 120_000)
})

describe('runGuardSetup — the happy path', () => {
  it('probes the live server, declares the externals, and drafts the one seed', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const before = computeRecipeFingerprint(r)
    const seed = seedRunnerOf(PROPOSAL)

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys({
        externalServices: [
          { service: 'stripe', category: 'payment', evidence: [], baseUrlEnv: 'STRIPE_BASE_URL' },
          // No base-URL variable ⇒ nothing honest to declare.
          { service: 'twilio', evidence: [] },
        ],
      }),
      recipeRunner: neverCalled('recipe'),
      seedRunner: seed.runner,
    })

    expect(report.status).toBe('ok')

    // Step 1 — the recipe was reused, and a REAL request reached the booted server.
    expect(report.recipe.outcome).toBe('exists')
    expect(report.recipe.probes).toEqual([
      { server: 'default', path: '/health', status: 200, ok: true },
    ])

    // Step 2 — detection is recorded, so the externals view works before any generate.
    expect(report.detection?.externalServices.map((s) => s.service)).toEqual(['stripe', 'twilio'])
    expect(report.detection?.database).toEqual({ type: 'sqlite', driver: 'prisma', tables: 2 })

    // Step 3 — the declaration lands even with NO account, and the undeclarable one
    // is reported rather than invented.
    expect(report.externals?.declared).toEqual(['stripe'])
    expect(report.externals?.undeclarable).toEqual(['twilio'])
    expect(report.externals?.unprovided).toEqual(['stripe'])
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.externals.stripe.baseUrlEnv).toBe('STRIPE_BASE_URL')
    expect(recipe.api.externals.stripe.baseUrl).toBeUndefined()

    // Step 4 — ONE artifact covering rows AND principals.
    expect(report.seed).toMatchObject({
      status: 'ok',
      outcome: 'drafted',
      scriptPath: 'scripts/guard-seed.mjs',
      fixtures: ['org'],
      credentials: ['owner'],
    })
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true)
    expect(recipe.api.seed.provides.credentials.owner.header).toBe('Authorization')

    // The declaration is what enters the fingerprint — which is why it must happen
    // HERE, before a single section has been authored against the old one.
    expect(computeRecipeFingerprint(r)).not.toBe(before)
  }, 120_000)

  // The grounding is what makes the ONE-artifact draft possible: the schema says what
  // is creatable, the routes say what must be reachable, the specs supply the roles.
  it('grounds the draft in the schema, the routes, the roles and the specs', async () => {
    const r = fixtureRepo()
    writeRecipe(r)
    const seed = seedRunnerOf(PROPOSAL)

    await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: seed.runner,
    })

    const input = seed.inputs[0]
    expect(input.driver).toBe('prisma')
    expect(input.tables.map((t) => t.name)).toEqual(['User', 'Org'])
    expect(input.routes).toContainEqual({ method: 'GET', path: '/orgs' })
    expect(input.roles?.map((role) => role.name).sort()).toEqual(['member', 'owner'])
    expect(input.specExcerpts?.[0]).toMatchObject({ doc: DOC })
    expect(input.specExcerpts?.[0].text).toMatch(/org owner/)
    // No blocked flows on a first setup — authoring has never run, and the draft
    // does not need it to.
    expect(input.blocked).toEqual([])
  }, 120_000)
})

// ---------------------------------------------------------------------------
// The proposer's credential STUB vs the seed that mints the same principal
// ---------------------------------------------------------------------------

describe('runGuardSetup — a drafted seed over a credential stub', () => {
  /** The stub the deterministic proposer mints for a bearer scheme, verbatim. */
  const STUB = {
    header: 'Authorization',
    valueFromEnv: 'GUARD_CRED_MEMBERTOKEN',
    satisfies: 'memberToken',
    description: 'TODO: fill in — bearer token for the "memberToken" security scheme (include the "Bearer " prefix)',
  }

  /** A seed that mints a principal under the SAME name as the scheme stub. */
  const SEEDS_MEMBER_TOKEN: SeedProposal = {
    scriptPath: 'scripts/guard-seed.mjs',
    scriptContent: [
      "import fs from 'node:fs'",
      'const org = { id: 42, slug: "acme" }',
      'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
      'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
      '  fixtures: { org },',
      '  credentials: { memberToken: { value: "Bearer minted" } },',
      '}))',
      '',
    ].join('\n'),
    seed: {
      command: 'node scripts/guard-seed.mjs',
      provides: {
        fixtures: { org: ['id', 'slug'] },
        credentials: { memberToken: { header: 'Authorization', satisfies: 'memberToken', description: 'a member' } },
      },
    },
  }

  // The stub was honest when it was written (no seed existed yet), and the seed that
  // arrives minutes later ANSWERS the same scheme. Refusing the draft over the name
  // collision means a fresh setup can never seed such a repo at all.
  it('supersedes the unfilled stub instead of refusing the draft', async () => {
    const r = fixtureRepo()
    writeRecipe(r, { credentials: { memberToken: STUB } })

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: seedRunnerOf(SEEDS_MEMBER_TOKEN).runner,
    })

    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'drafted', credentials: ['memberToken'] })
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.credentials).toBeUndefined()
    expect(recipe.api.seed.provides.credentials.memberToken.header).toBe('Authorization')
  }, 120_000)

  // The other half of the rule: only the proposer's OWN unfilled stub is superseded.
  // A credential a human filled in is a second source for the same name, and the
  // load-time refusal is exactly right there — nothing of theirs is ever removed.
  it('still refuses when the colliding credential is one a human filled in', async () => {
    const r = fixtureRepo()
    const filled = { header: 'Authorization', value: 'Bearer mine', satisfies: 'memberToken' }
    writeRecipe(r, { credentials: { memberToken: filled } })

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: seedRunnerOf(SEEDS_MEMBER_TOKEN, SEEDS_MEMBER_TOKEN).runner,
    })

    expect(report.status).toBe('ok') // the seed is SOFT — it never fails the run
    expect(report.seed?.status).toBe('failed')
    expect(report.seed?.reason).toMatch(/a name has exactly one source/)
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.credentials.memberToken).toEqual(filled)
    expect(recipe.api.seed).toBeUndefined()
  }, 120_000)
})

// The live repro: a repo with NO recipe.json at all. Discovery derives one from the
// repo's own manifests — including the credential stub the corpus's OpenAPI scheme
// implies, and the "set GUARD_CRED_*" TODO that goes with it — and the seed drafted
// four steps later mints exactly that principal.
describe('runGuardSetup — a fresh setup whose seed answers the derived stub', () => {
  it('drafts the seed, drops the superseded stub, and stops asking for its env var', async () => {
    const r = fixtureRepo()
    // A dependency-free server the DETERMINISTIC proposer can derive and verify.
    fs.writeFileSync(
      path.join(r, 'plain.mjs'),
      [
        "import http from 'node:http'",
        'http.createServer((_req, res) => {',
        "  res.writeHead(200, { 'content-type': 'application/json' })",
        '  res.end(\'{"ok":true}\')',
        '}).listen(Number(process.env.PORT))',
        '',
      ].join('\n'),
    )
    fs.writeFileSync(
      path.join(r, 'package.json'),
      JSON.stringify({ name: 'fresh-fixture', private: true, type: 'module', scripts: { start: 'node plain.mjs' } }, null, 2),
    )
    fs.writeFileSync(
      path.join(r, 'openapi.yaml'),
      [
        'openapi: 3.0.0',
        'info: { title: svc, version: "1" }',
        'paths: {}',
        'components:',
        '  securitySchemes:',
        '    memberToken:',
        '      type: http',
        '      scheme: bearer',
      ].join('\n'),
    )
    writeCorpus(r, [{ ref: DOC }, { ref: 'openapi.yaml' }])
    const seed: SeedProposal = {
      scriptPath: 'scripts/guard-seed.mjs',
      scriptContent: [
        "import fs from 'node:fs'",
        'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({',
        '  credentials: { memberToken: { value: "Bearer minted" } },',
        '}))',
        '',
      ].join('\n'),
      seed: {
        command: 'node scripts/guard-seed.mjs',
        provides: {
          credentials: { memberToken: { header: 'Authorization', satisfies: 'memberToken', description: 'a member' } },
        },
      },
    }

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: seedRunnerOf(seed).runner,
    })

    // Step 1 derived the recipe deterministically, stub and TODO included…
    expect(report.recipe.outcome).toBe('discovered')
    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'drafted', credentials: ['memberToken'] })
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.credentials).toBeUndefined()
    // …and the TODO row does not survive the seed that answered it.
    expect(report.recipe.todos ?? []).not.toContainEqual(expect.stringContaining('GUARD_CRED_MEMBERTOKEN'))
  }, 120_000)
})

describe('runGuardSetup — re-run semantics', () => {
  it('a bare re-run over a prepared repo REPORTS and no-ops', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
    })
    const before = fs.readFileSync(recipePath(r), 'utf-8')

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys(),
      recipeRunner: neverCalled('recipe'),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('ok')
    expect(report.recipe.outcome).toBe('exists')
    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'exists', command: 'node mine.mjs' })
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  }, 60_000)

  // `--refresh` is not consent. A seed script is a committed, human-reviewed file,
  // and a non-TTY caller answers false — so a flag alone can never clobber it.
  it('--refresh does NOT replace the seed when the replacement is not confirmed', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      seed: { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } },
    })
    const before = fs.readFileSync(recipePath(r), 'utf-8')

    const { report } = await runGuardSetup({
      repoRoot: r,
      refresh: true,
      journeys: journeys(),
      recipeRunner: recipeRunnerFor(r),
      seedRunner: neverCalled('seed'),
      confirmSeedReplace: async () => false,
    })

    expect(report.seed?.status).toBe('skipped')
    expect(report.seed?.reason).toMatch(/not confirmed/)
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  }, 120_000)

  it('--refresh REPLACES the seed once confirmed, quoting the old script to the model', async () => {
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
    const seed = seedRunnerOf(PROPOSAL)

    const { report } = await runGuardSetup({
      repoRoot: r,
      refresh: true,
      journeys: journeys(),
      recipeRunner: recipeRunnerFor(r),
      seedRunner: seed.runner,
      confirmSeedReplace: async () => true,
    })

    expect(report.seed).toMatchObject({ status: 'ok', outcome: 'drafted' })
    expect(seed.inputs[0].replacing?.scriptContent).toBe('// the hand-edited original\n')
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe(SCRIPT)
  }, 120_000)

  // A rejected replacement must leave the tree BYTE-IDENTICAL — the seed drafter's
  // write-then-restore rule, extended to the overwrite case.
  it('restores the previous script byte-for-byte when a replacement fails to verify', async () => {
    const r = fixtureRepo()
    const original = '// the hand-edited original\n'
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), original)
    writeRecipe(r, {
      seed: {
        command: 'node scripts/guard-seed.mjs',
        script: 'scripts/guard-seed.mjs',
        provides: { fixtures: { org: ['id'] } },
      },
    })
    const before = fs.readFileSync(recipePath(r), 'utf-8')
    const bad: SeedProposal = { ...PROPOSAL, scriptContent: 'process.exit(9)\n' }
    const seed = seedRunnerOf(bad, bad)

    const { report } = await runGuardSetup({
      repoRoot: r,
      refresh: true,
      journeys: journeys(),
      recipeRunner: recipeRunnerFor(r),
      seedRunner: seed.runner,
      confirmSeedReplace: async () => true,
    })

    expect(report.status).toBe('ok') // the SEED is soft — it never fails the run
    expect(report.seed?.status).toBe('failed')
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe(original)
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  }, 120_000)

  // A refresh RE-DERIVES the recipe, and the re-derivation knows nothing about the
  // env a human wrote into `api.env` (a connection string, a feature flag, a
  // credential value) — losing it is silent data loss, exactly as it would be for
  // `api.seed` / `api.externals` / `api.credentials`.
  it('--refresh preserves hand-authored `api.env` and credentials', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      env: { SEED_STORE: path.join(r, 'store.json'), MY_FLAG: 'hand-authored' },
      credentials: { owner: { header: 'Authorization', value: 'Bearer mine', satisfies: 'bearerAuth' } },
    })

    const { report } = await runGuardSetup({
      repoRoot: r,
      refresh: true,
      journeys: journeys({ database: null }),
      // The re-derivation proposes only SEED_STORE — the authored key is not its to know.
      recipeRunner: recipeRunnerFor(r),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('ok')
    const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
    expect(recipe.api.env.MY_FLAG).toBe('hand-authored')
    // The re-derived keys still land — preservation is a merge, not a rollback.
    expect(recipe.api.env.SEED_STORE).toBe(path.join(r, 'store.json'))
    expect(recipe.api.credentials.owner.value).toBe('Bearer mine')
  }, 120_000)

  // Steps 3 and 4 are SOFT by contract: a repo with no database still gets its
  // recipe proved and its externals declared.
  it('reports the seed skip reason without failing the run', async () => {
    const r = fixtureRepo()
    writeRecipe(r)

    const { report } = await runGuardSetup({
      repoRoot: r,
      journeys: journeys({ database: null }),
      recipeRunner: neverCalled('recipe'),
      seedRunner: neverCalled('seed'),
    })

    expect(report.status).toBe('ok')
    expect(report.seed?.status).toBe('skipped')
    expect(report.seed?.reason).toMatch(/no database was detected/)
    expect(report.externals?.status).toBe('ok')
  }, 60_000)
})

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
