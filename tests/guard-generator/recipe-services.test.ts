/**
 * Recipe verification's datastore half:
 * a proposal carrying `api.services` has them brought UP before the boot check and
 * taken DOWN after it — success or failure — exactly as `run.ts` runs them (the
 * repo's own command, through the runner's `runBuild`, in the repo root, with the
 * recipe env). Each step names itself, so `services` failing never reads like the
 * server failing.
 *
 * Plus the honest failure story for the repo that has no compose file to propose
 * services FROM: when the analyzer saw a database dependency and the boot died
 * anyway, the diagnostic leads with the dependency and the three real remedies,
 * with the boot excerpt underneath.
 *
 * No docker anywhere: `services.up` here provisions a FILE the fixture server
 * refuses to boot without — the same causal shape as a datastore, offline.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverRecipe,
  verifyProposal,
  type DatabaseDependencyHint,
  type RecipeProposal,
  type RecipeRunner,
  type VerifiableProposal,
} from '@truecourse/guard-generator'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** A repo with a server that boots ONLY when `TC_FAKE_DB` names an existing file
 *  — the offline stand-in for "the datastore has to be up first". */
function dbRepo(): { root: string; dbFile: string; downMarker: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-svc-'))
  dirs.push(root)
  // A manifest, because every real JS repo has one — and discovery refuses, before
  // any spend, on a repo that declares none. It names no bin and no start script,
  // so the deterministic proposer still bails and the model is still the proposer
  // under test here.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'svc-fixture', version: '0.0.0' }))
  fs.writeFileSync(
    path.join(root, 'server.mjs'),
    [
      "import http from 'node:http'",
      "import fs from 'node:fs'",
      'const store = process.env.TC_FAKE_DB',
      'if (!store || !fs.existsSync(store)) {',
      '  console.error(`Database error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" (${store})`)',
      '  process.exit(1)',
      '}',
      "http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{\"ok\":true}') })",
      '  .listen(Number(process.env.PORT))',
    ].join('\n'),
  )
  return {
    root,
    dbFile: path.join(root, 'datastore.provisioned'),
    downMarker: path.join(root, 'services.went.down'),
  }
}

/** The proposal shape the deterministic proposer emits for such a repo. */
function proposalFor(
  repo: { root: string; dbFile: string; downMarker: string },
  overrides: { up?: string; down?: string | null; serve?: string[] } = {},
): VerifiableProposal {
  return {
    build: 'true',
    env: { TC_FAKE_DB: repo.dbFile },
    api: {
      serve: overrides.serve ?? ['node', 'server.mjs'],
      healthPath: '/',
      services: {
        up: overrides.up ?? `touch "$TC_FAKE_DB"`,
        ...(overrides.down === null ? {} : { down: overrides.down ?? `touch "${repo.downMarker}"` }),
      },
    },
  }
}

describe('verifyProposal — api.services', () => {
  it('brings services UP before the boot check, and DOWN after it', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(repo.root, proposalFor(repo))

    // The server could only have answered because `services.up` ran first.
    expect(verdict).toEqual({ ok: true })
    expect(fs.existsSync(repo.dbFile)).toBe(true)
    expect(fs.existsSync(repo.downMarker)).toBe(true)
  })

  it('without the bring-up the SAME proposal fails — the services step is what verifies it', async () => {
    const repo = dbRepo()
    const serviceless: VerifiableProposal = {
      build: 'true',
      env: { TC_FAKE_DB: repo.dbFile },
      api: { serve: ['node', 'server.mjs'], healthPath: '/' },
    }

    const verdict = await verifyProposal(repo.root, serviceless)

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('did not start')
    expect(fs.existsSync(repo.dbFile)).toBe(false)
  })

  it('a services.up that fails is its OWN diagnostic — never reported as a boot failure', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(
      repo.root,
      proposalFor(repo, { up: 'echo "cannot connect to the Docker daemon" >&2; exit 1' }),
    )

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    // Names the STEP that died, and passes the command's own stderr through.
    expect(verdict.reason).toMatch(/^services `echo "cannot connect to the Docker daemon" >&2; exit 1` failed/)
    expect(verdict.reason).toContain('cannot connect to the Docker daemon')
    expect(verdict.reason).not.toContain('did not start')
    // The boot never ran, and neither did teardown — nothing was brought up.
    expect(fs.existsSync(repo.downMarker)).toBe(false)
  })

  it('an unavailable docker binary IS a services failure, carrying the shell\'s own message', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(repo.root, proposalFor(repo, { up: 'tc-no-such-docker compose up -d' }))

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('services `tc-no-such-docker compose up -d` failed')
    expect(verdict.reason).toMatch(/not found|No such file/i)
  })

  it('tears services down even when the boot FAILS', async () => {
    const repo = dbRepo()
    // `up` runs and succeeds, but the server is a crasher — teardown still owes.
    fs.writeFileSync(path.join(repo.root, 'crash.mjs'), 'console.error("fixture crash"); process.exit(1)')

    const verdict = await verifyProposal(repo.root, proposalFor(repo, { serve: ['node', 'crash.mjs'] }))

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('api server `node crash.mjs` did not start')
    expect(fs.existsSync(repo.downMarker)).toBe(true)
  })

  it('a teardown that fails WARNS — it never rejects a recipe that booted', async () => {
    const repo = dbRepo()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const verdict = await verifyProposal(repo.root, proposalFor(repo, { down: 'exit 1' }))

    expect(verdict).toEqual({ ok: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('exit 1')
  })

  it('no `down` declared: the bring-up still runs and the verdict stands', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(repo.root, proposalFor(repo, { down: null }))

    expect(verdict).toEqual({ ok: true })
    expect(fs.existsSync(repo.downMarker)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The no-compose database story (gap 2): the analyzer detected the dependency,
// the repo has nothing to propose `services` from, and the boot died anyway.
// ---------------------------------------------------------------------------

const DRIZZLE: DatabaseDependencyHint = { type: 'postgres', driver: 'drizzle-orm' }

describe('verifyProposal — the detected-database boot failure', () => {
  /** A proposal with NO services whose server always refuses to boot. */
  function servicelessCrasher(root: string): VerifiableProposal {
    fs.writeFileSync(
      path.join(root, 'crash.mjs'),
      'console.error(`Database error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`); process.exit(1)',
    )
    return { build: 'true', api: { serve: ['node', 'crash.mjs'], healthPath: '/' } }
  }

  it('leads with the dependency and the remedies, then the boot excerpt', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(repo.root, servicelessCrasher(repo.root), {
      database: async () => DRIZZLE,
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    const lines = verdict.reason.split('\n')
    expect(lines[0]).toContain('the app depends on a database (drizzle-orm/postgres detected)')
    expect(verdict.reason).toContain('start your database')
    expect(verdict.reason).toContain('docker-compose')
    expect(verdict.reason).toContain('api.services')
    expect(verdict.reason).toContain('DATABASE_URL')
    // The engine's own boot report is still there — underneath, not instead.
    const bootIndex = verdict.reason.indexOf('api server `node crash.mjs` did not start')
    expect(bootIndex).toBeGreaterThan(0)
    expect(verdict.reason.indexOf('the app depends on a database')).toBeLessThan(bootIndex)
    expect(verdict.reason).toContain('CREATE SCHEMA IF NOT EXISTS')
  })

  it('says nothing about databases when none was detected', async () => {
    const repo = dbRepo()

    const verdict = await verifyProposal(repo.root, servicelessCrasher(repo.root), { database: async () => null })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/^api server `node crash\.mjs` did not start/)
    expect(verdict.reason).not.toContain('depends on a database')
  })

  it('never consults the detector when the boot SUCCEEDS — no noise on a healthy repo', async () => {
    const repo = dbRepo()
    const database = vi.fn(async () => DRIZZLE)

    const verdict = await verifyProposal(repo.root, proposalFor(repo), { database })

    expect(verdict).toEqual({ ok: true })
    expect(database).not.toHaveBeenCalled()
  })

  it('stays a plain boot failure when the proposal DID declare services', async () => {
    const repo = dbRepo()
    const database = vi.fn(async () => DRIZZLE)
    fs.writeFileSync(path.join(repo.root, 'crash.mjs'), 'console.error("fixture crash"); process.exit(1)')

    const verdict = await verifyProposal(repo.root, proposalFor(repo, { serve: ['node', 'crash.mjs'] }), { database })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    // The datastore WAS brought up, so "start your database" would be a lie.
    expect(verdict.reason).not.toContain('depends on a database')
    expect(database).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// End to end through discovery: the guidance reaches the caller AND the model.
// ---------------------------------------------------------------------------

describe('discoverRecipe — the database hint', () => {
  /** A runner answering with each scripted value in turn, recording its calls. */
  function scripted(...answers: unknown[]): { runner: RecipeRunner; calls: Parameters<RecipeRunner>[0][] } {
    const calls: Parameters<RecipeRunner>[0][] = []
    const runner: RecipeRunner = async (input) => {
      calls.push(input)
      if (calls.length > answers.length) throw new Error(`unexpected recipe call #${calls.length}`)
      return answers[calls.length - 1]
    }
    return { runner, calls }
  }

  /** A repo the deterministic proposer refuses (no manifest scripts, no bin). */
  function bareRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-dbhint-'))
    dirs.push(root)
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
    fs.writeFileSync(path.join(root, 'crash.mjs'), 'console.error("Database error: connect ECONNREFUSED"); process.exit(1)')
    return root
  }

  const CRASHER: RecipeProposal = { build: 'true', api: { serve: ['node', 'crash.mjs'], healthPath: '/' } }

  it('verify-failed carries the guided reason, and the model opens on it verbatim', async () => {
    const root = bareRepo()
    const { runner, calls } = scripted(CRASHER, CRASHER)

    const res = await discoverRecipe(root, runner, { database: async () => DRIZZLE })

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('the app depends on a database (drizzle-orm/postgres detected)')
    expect(res.reason).toContain('connect ECONNREFUSED')
    // The one evidence retry quotes the engine's report — guidance included.
    expect(calls).toHaveLength(2)
    expect(calls[1].retry?.failure).toBe(res.reason)
  })

  it('resolves the detector at most ONCE across the retry', async () => {
    const root = bareRepo()
    const database = vi.fn(async () => DRIZZLE)
    const { runner } = scripted(CRASHER, CRASHER)

    await discoverRecipe(root, runner, { database })

    // Two boots failed; one analysis answer served both.
    expect(database).toHaveBeenCalledTimes(1)
  })

  it('a serviceless LLM proposal is unaffected — it verifies and is written as proposed', async () => {
    const repo = dbRepo()
    // Provision the "datastore" by hand: the app is happy, the recipe carries no
    // `services`, and nothing in verification tried to run one.
    fs.writeFileSync(repo.dbFile, '')
    const proposal: RecipeProposal = {
      build: 'true',
      env: { TC_FAKE_DB: repo.dbFile },
      api: { serve: ['node', 'server.mjs'], healthPath: '/' },
    }
    const { runner, calls } = scripted(proposal)

    const res = await discoverRecipe(repo.root, runner, { database: async () => DRIZZLE })

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(1)
    const written = JSON.parse(fs.readFileSync(path.join(repo.root, '.truecourse', 'scenarios', 'recipe.json'), 'utf-8'))
    expect(written).toEqual(proposal)
    expect(written.api.services).toBeUndefined()
    expect(fs.existsSync(repo.downMarker)).toBe(false)
  })
})
