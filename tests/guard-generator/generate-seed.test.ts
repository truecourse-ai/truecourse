/**
 * The seed-drafting stage's WIRING into `guard generate` (item 66): it fires at the
 * END of a run, on the missing-data gaps AUTHORING produced, and its verdict rides
 * the result (and therefore the persisted report). A drafted seed unblocks the NEXT
 * generate — the two-pass reality this test pins down.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recipePath, computeRecipeFingerprint } from '@truecourse/guard-runner'
import type { SeedDraftDatabase, SeedProposal, SeedRunner } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  runGenerate,
  journeysOf,
  apiJourney,
  withDatabase,
} from './helpers.js'

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

const DOC = 'docs/orgs.md'
const DOC_CONTENT = ['## cancel', 'A cancelled booking can be listed by its org.'].join('\n')

const DATABASE: SeedDraftDatabase = {
  type: 'sqlite',
  driver: 'prisma',
  tables: [{ name: 'Org', columns: [{ name: 'id', type: 'Int', isPrimaryKey: true }] }],
  relations: [],
  appImports: ["src/db.js: import { PrismaClient } from '@prisma/client'"],
}

const SCRIPT = [
  "import fs from 'node:fs'",
  'const org = { id: 42, slug: "acme" }',
  'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
  'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
  '',
].join('\n')

const PROPOSAL: SeedProposal = {
  scriptPath: 'scripts/guard-seed.mjs',
  scriptContent: SCRIPT,
  seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: ['id', 'slug'] } } },
}

/** The api recipe the stage patches; `SEED_STORE` is this repo's own store file. */
function writeSeedableRecipe(r: string): void {
  const recipe = {
    build: 'true',
    api: { serve: ['node', FIXTURE_SERVER], healthPath: '/health', env: { SEED_STORE: path.join(r, 'store.json') } },
  }
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
}

/** A repo whose one api claim authoring refuses for want of rows. */
function blockedRepo(): string {
  const r = repo()
  writeSeedableRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const blockedExtract = extractBy({
  cancel: [{ driver: 'api', claim: 'a cancelled booking is listed by its org', reason: 'HTTP status + body' }],
})

const seedRunnerOf = (...answers: unknown[]): { runner: SeedRunner; calls: number } => {
  const state = { runner: null as unknown as SeedRunner, calls: 0 }
  state.runner = async () => {
    const answer = answers[state.calls++]
    if (answer === undefined) throw new Error('unexpected seed call')
    return answer
  }
  return state as { runner: SeedRunner; calls: number }
}

describe('generateGuards — the seed-drafting stage', () => {
  it('drafts a seed for the flows it just left blocked on missing data', async () => {
    const r = blockedRepo()
    const before = computeRecipeFingerprint(r)
    const seed = seedRunnerOf(PROPOSAL)

    const res = await runGenerate({
      repoRoot: r,
      journeys: withDatabase(journeysOf(r, apiJourney('GET', '/orgs')), DATABASE),
      extractRunner: blockedExtract,
      generateRunner: authorBy({ cancel: { blockedOn: ['missing-data', 'an already-cancelled booking'] } }),
      seedRunner: seed.runner,
    })

    expect(res.status).toBe('ok')
    expect(res.seedDraft).toEqual({
      status: 'drafted',
      scriptPath: 'scripts/guard-seed.mjs',
      command: 'node scripts/guard-seed.mjs',
      fixtures: ['org'],
      blockedFlows: 1,
    })
    expect(seed.calls).toBe(1)
    // BOTH artifacts landed, and the recipe moved — which is what re-authors the
    // blocked section on the NEXT generate.
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8')).api.seed.script).toBe('scripts/guard-seed.mjs')
    expect(computeRecipeFingerprint(r)).not.toBe(before)
    // The flow is still blocked THIS run — the draft unblocks the next one.
    expect(res.coverageGaps.some((g) => g.kind === 'blocked-on' && /missing-data/.test(g.reason))).toBe(true)
  })

  it('never fires when the blockers are not missing data', async () => {
    const r = blockedRepo()
    const res = await runGenerate({
      repoRoot: r,
      journeys: withDatabase(journeysOf(r, apiJourney('GET', '/orgs')), DATABASE),
      extractRunner: blockedExtract,
      generateRunner: authorBy({ cancel: { blockedOn: ['stripe'] } }),
      seedRunner: async () => {
        throw new Error('the seed runner must not be called')
      },
    })

    expect(res.seedDraft).toBeUndefined()
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
  })

  it('reports the skip REASON when there is no database to seed', async () => {
    const r = blockedRepo()
    const res = await runGenerate({
      repoRoot: r,
      journeys: withDatabase(journeysOf(r, apiJourney('GET', '/orgs')), null),
      extractRunner: blockedExtract,
      generateRunner: authorBy({ cancel: { blockedOn: ['missing-data', 'an org'] } }),
      seedRunner: async () => {
        throw new Error('the seed runner must not be called')
      },
    })

    expect(res.seedDraft?.status).toBe('skipped')
    expect(res.seedDraft?.reason).toMatch(/no database was detected/)
    expect(res.seedDraft?.blockedFlows).toBe(1)
  })

  it('records the diagnostic — and writes nothing — when two drafts fail to verify', async () => {
    const r = blockedRepo()
    const bad: SeedProposal = { ...PROPOSAL, scriptContent: 'process.exit(9)\n' }
    const seed = seedRunnerOf(bad, bad)

    const res = await runGenerate({
      repoRoot: r,
      journeys: withDatabase(journeysOf(r, apiJourney('GET', '/orgs')), DATABASE),
      extractRunner: blockedExtract,
      generateRunner: authorBy({ cancel: { blockedOn: ['missing-data', 'an org'] } }),
      seedRunner: seed.runner,
    })

    expect(res.seedDraft?.status).toBe('failed')
    expect(res.seedDraft?.reason).toMatch(/exited 9/)
    expect(seed.calls).toBe(2)
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
    expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8')).api.seed).toBeUndefined()
  })
})
