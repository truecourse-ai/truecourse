/**
 * Recipe discovery's ONE evidence retry: any verification failure — a dead
 * install, a broken build, a missing entry file, an entry that won't start — goes
 * back to the model as the engine's own report, verbatim, and the replacement
 * proposal is verified in full. One mechanism, asserted identically for all four
 * failure kinds; the engine never inspects WHICH kind it was.
 *
 * Plus the deterministic pre-pass: a repo whose own declarations decide the answer
 * gets a verified recipe with NO model call at all, and a deterministic proposal
 * that fails verification falls through to the model carrying its diagnostic —
 * never a deterministic retry, because the detectors are pure.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  discoverRecipe,
  type RecipeDiscoveryPhase,
  type RecipeProposal,
  type RecipeRunner,
} from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, FIXTURE_BIN, FIXTURE_API_SERVER, FIXTURE_API_SERVER_V2 } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function recipeFile(r: string): string {
  return path.join(r, '.truecourse', 'scenarios', 'recipe.json')
}

/** A proposal that verifies against the fixture CLI. */
const GOOD: RecipeProposal = { build: 'true', entry: ['node', FIXTURE_BIN] }

type RecipeCall = Parameters<RecipeRunner>[0]

/**
 * A runner answering with each scripted value in turn (an `Error` value throws),
 * recording every call it saw. A call past the script is itself a failure — the
 * retry budget is exactly one.
 */
function scripted(...answers: unknown[]): { runner: RecipeRunner; calls: RecipeCall[] } {
  const calls: RecipeCall[] = []
  const runner: RecipeRunner = async (input) => {
    calls.push(input)
    if (calls.length > answers.length) throw new Error(`unexpected recipe call #${calls.length}`)
    const answer = answers[calls.length - 1]
    if (answer instanceof Error) throw answer
    return answer
  }
  return { runner, calls }
}

/** A runner that must never be called (a cache hit, or a proposal already verified). */
const neverCalled: RecipeRunner = async () => {
  throw new Error('the recipe runner must not be called')
}

/** The four ways engine verification rejects a proposal — one row per kind. */
const KINDS: { name: string; bad: RecipeProposal; reason: RegExp }[] = [
  {
    name: 'install failed',
    bad: { install: 'false', build: 'true', entry: ['node', FIXTURE_BIN] },
    reason: /^install `false` failed/,
  },
  {
    name: 'build failed',
    bad: { build: 'false', entry: ['node', FIXTURE_BIN] },
    reason: /^build `false` failed/,
  },
  {
    name: 'entry file missing',
    bad: { build: 'true', entry: ['node', 'dist/cli.js'] },
    reason: /entry file not found: dist\/cli\.js/,
  },
  {
    name: 'entry preflight dead',
    bad: { build: 'true', entry: ['tc-guard-no-such-binary-xyz'] },
    reason: /did not answer to `--help`/,
  },
]

describe('discoverRecipe — the one evidence retry', () => {
  for (const kind of KINDS) {
    it(`re-asks ONCE with the verification report verbatim — ${kind.name}`, async () => {
      const r = repo()
      const { runner, calls } = scripted(kind.bad, kind.bad)

      const res = await discoverRecipe(r, runner)

      // A still-bad second proposal fails exactly as discovery failed before the
      // retry existed: verify-failed, the engine's diagnostic, no recipe written.
      expect(res.status).toBe('verify-failed')
      if (res.status !== 'verify-failed') return
      expect(res.reason).toMatch(kind.reason)
      expect(res.proposal).toEqual(kind.bad)
      expect(fs.existsSync(recipeFile(r))).toBe(false)

      // Exactly one retry, carrying the engine's OWN text — the same string the
      // caller surfaces, not a summary or a classification of it.
      expect(calls).toHaveLength(2)
      expect(calls[0].retry).toBeUndefined()
      expect(calls[1].retry?.failure).toBe(res.reason)
      expect(calls[1].retry?.proposal).toBe(JSON.stringify(kind.bad, null, 2))
    })
  }

  for (const kind of KINDS) {
    it(`a corrected proposal verifies and is written — after ${kind.name}`, async () => {
      const r = repo()
      const { runner, calls } = scripted(kind.bad, GOOD)

      const res = await discoverRecipe(r, runner)

      expect(res.status).toBe('discovered')
      expect(calls).toHaveLength(2)
      expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))).toEqual(GOOD)
    })
  }

  it('re-verifies the retried proposal in FULL — its install and build both run again', async () => {
    const r = repo()
    const { runner } = scripted(
      // Rejected on the entry-file check: the build produced nothing.
      { build: 'true', entry: ['node', 'dist/cli.js'] },
      {
        install: 'touch install-marker',
        // Only succeeds when the retried proposal's install ran first.
        build: `test -f install-marker && mkdir -p dist && cp ${JSON.stringify(FIXTURE_BIN)} dist/cli.mjs`,
        entry: ['node', 'dist/cli.mjs'],
      },
    )

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(fs.existsSync(path.join(r, 'install-marker'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'dist', 'cli.mjs'))).toBe(true)
  })

  it('the dogfood case: the proposal names dist/cli.js, the build produced dist/cli.mjs', async () => {
    const r = repo()
    const build = `mkdir -p dist && cp ${JSON.stringify(FIXTURE_BIN)} dist/cli.mjs`
    const { runner, calls } = scripted(
      { build, entry: ['node', 'dist/cli.js'] },
      { build, entry: ['node', 'dist/cli.mjs'] },
    )

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    // The retry sees the diagnostic the engine already produced — including the
    // listing of what the build DID write next to the missing path.
    const evidence = calls[1].retry!.failure
    expect(evidence).toContain('entry file not found: dist/cli.js')
    expect(evidence).toContain('dist/ contains: cli.mjs')
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8')).entry).toEqual(['node', 'dist/cli.mjs'])
  })

  it('a proposal that verifies is never re-asked', async () => {
    const r = repo()
    const { runner, calls } = scripted(GOOD)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(1)
  })

  it('a retry the transport cannot serve leaves the original diagnostic exactly as it was', async () => {
    const r = repo()
    const bad: RecipeProposal = { install: 'false', build: 'true', entry: ['node', FIXTURE_BIN] }
    const { runner, calls } = scripted(bad, new Error('no LLM transport configured'))

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toMatch(/^install `false` failed/)
    expect(res.proposal).toEqual(bad)
    expect(calls).toHaveLength(2)
    expect(fs.existsSync(recipeFile(r))).toBe(false)
  })

  it('a retry whose output never validates leaves the original diagnostic, evidence riding its re-ask', async () => {
    const r = repo()
    const bad: RecipeProposal = { build: 'false', entry: ['node', FIXTURE_BIN] }
    const { runner, calls } = scripted(bad, { nope: true }, { still: 'not a recipe' })

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toMatch(/^build `false` failed/)
    expect(res.proposal).toEqual(bad)
    // The retry keeps its own corrective re-ask (the house pattern), and the
    // verification evidence rides that re-ask too.
    expect(calls).toHaveLength(3)
    expect(calls[2].retry?.failure).toBe(res.reason)
    expect(calls[2].correction).toBeDefined()
  })

  it('a verified retry proposal replaces the cached one — the retry gets no key of its own', async () => {
    const r = repo()
    const { runner } = scripted({ build: 'true', entry: ['node', 'dist/cli.js'] }, GOOD)
    expect((await discoverRecipe(r, runner)).status).toBe('discovered')

    // Same inputs, no recipe.json: the cache must answer with what VERIFIED, so no
    // call is made and no second discovery re-pays the retry.
    fs.rmSync(recipeFile(r))
    const again = await discoverRecipe(r, neverCalled)

    expect(again.status).toBe('discovered')
    if (again.status !== 'discovered') return
    expect(again.recipe.entry).toEqual(GOOD.entry)
  })

  it('a cached proposal that verifies is untouched — no call, no retry', async () => {
    const r = repo()
    const { runner, calls } = scripted(GOOD)
    expect((await discoverRecipe(r, runner)).status).toBe('discovered')
    expect(calls).toHaveLength(1)

    fs.rmSync(recipeFile(r))
    expect((await discoverRecipe(r, neverCalled)).status).toBe('discovered')
  })
})

describe('discoverRecipe — api proposals', () => {
  /** An api-only proposal booting the fixture todos server. */
  const API_ONLY: RecipeProposal = {
    build: 'true',
    api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
  }

  /** A two-service proposal: both servers must boot for it to verify. */
  const TWO_SERVERS: RecipeProposal = {
    build: 'true',
    api: {
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health', app: 'apps/web' },
        'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health', app: 'apps/api/v2' },
      },
      defaultServer: 'web',
    },
  }

  it('verifies a two-server proposal by booting EVERY declared server', async () => {
    const r = repo()
    const { runner, calls } = scripted(TWO_SERVERS)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))).toEqual(TWO_SERVERS)
  })

  it('rejects a two-server proposal whose SECOND server never turns healthy, naming it', async () => {
    const r = repo()
    const broken: RecipeProposal = {
      build: 'true',
      api: {
        servers: {
          web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
          // The api-v2 fixture, told to die at startup — a deterministic boot failure.
          'api-v2': {
            serve: ['node', FIXTURE_API_SERVER_V2],
            healthPath: '/v2/health',
            env: { TC_V2_FAIL_BOOT: '1' },
          },
        },
        defaultServer: 'web',
      },
    }
    // Both the first call and its ONE evidence retry answer with the same proposal.
    const { runner } = scripted(broken, broken)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('server "api-v2"')
    expect(fs.existsSync(recipeFile(r))).toBe(false)
  })

  it('verifies an api-only proposal by BOOTING it, and writes the api block', async () => {
    const r = repo()
    const { runner, calls } = scripted(API_ONLY)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(1)
    // Written verbatim — no `entry` key invented for a repo that has no cli.
    const written = JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))
    expect(written).toEqual(API_ONLY)
    expect('entry' in written).toBe(false)
  })

  it('never probes an api-only proposal as an entrypoint — the server would hang the probe', async () => {
    const r = repo()
    const { runner } = scripted(API_ONLY)

    const started = Date.now()
    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    // `probeEntry` waits for the process to EXIT (30s per attempt, twice). A server
    // never exits, so anything near that budget means the probe ran.
    expect(Date.now() - started).toBeLessThan(20_000)
  })

  it('boots a serve argv carrying the ${PORT} placeholder', async () => {
    const r = repo()
    const proposal: RecipeProposal = {
      build: 'true',
      api: { serve: ['node', FIXTURE_API_SERVER, '--port', '${PORT}'], healthPath: '/health' },
    }
    const { runner } = scripted(proposal)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    // The TEMPLATE is what lands on disk — the resolved port belongs to one boot.
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8')).api.serve).toEqual([
      'node',
      FIXTURE_API_SERVER,
      '--port',
      '${PORT}',
    ])
  })

  it('verifies BOTH halves when the proposal prepares both drivers', async () => {
    const r = repo()
    const both: RecipeProposal = {
      build: 'true',
      entry: ['node', FIXTURE_BIN],
      api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
    }
    const { runner } = scripted(both)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))).toEqual(both)
  })

  it('a server that will not start is rejected with its startup output, and re-asked ONCE', async () => {
    const r = repo()
    const bad: RecipeProposal = { build: 'true', api: { serve: ['node', 'dist/server.js'], healthPath: '/health' } }
    const { runner, calls } = scripted(bad, API_ONLY)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(2)
    const evidence = calls[1].retry!.failure
    expect(evidence).toContain('api server `node dist/server.js` did not start')
    // The server's own stderr is the evidence — not just "it didn't answer".
    expect(evidence).toMatch(/Cannot find module/)
    expect(fs.existsSync(recipeFile(r))).toBe(true)
  })
})

describe('discoverRecipe — the deterministic pre-pass', () => {
  /**
   * A repo whose OWN declarations decide the recipe: a package.json whose `start`
   * script boots the fixture todos server, copied in so the argv is the repo's.
   */
  function apiRepo(startScript = 'node server.mjs'): string {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-det-'))
    repos.push(r)
    fs.writeFileSync(
      path.join(r, 'package.json'),
      JSON.stringify({ name: 'todos-api', version: '1.0.0', type: 'module', scripts: { start: startScript } }, null, 2),
    )
    fs.copyFileSync(FIXTURE_API_SERVER, path.join(r, 'server.mjs'))
    fs.copyFileSync(path.join(path.dirname(FIXTURE_API_SERVER), 'crash.mjs'), path.join(r, 'crash.mjs'))
    return r
  }

  /** The derived api surface the caller hands in — the health ranking's only input. */
  const surface = async () => [
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/todos' },
  ]

  it('writes a verified recipe with NO model call', async () => {
    const r = apiRepo()

    const res = await discoverRecipe(r, neverCalled, { routes: surface })

    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    expect(res.source).toBe('deterministic')
    // The recipe on disk is what the repo declares — install omitted (nothing to
    // fetch), the no-op build, the tokenized start argv, the ranked health path.
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))).toEqual({
      build: 'true',
      api: { serve: ['node', 'server.mjs'], healthPath: '/health' },
    })
  })

  it('reports the phases it RUNS — the build and the boot, with nothing proposing out loud', async () => {
    const r = apiRepo()
    const phases: RecipeDiscoveryPhase[] = []

    const res = await discoverRecipe(r, neverCalled, { routes: surface, onPhase: (p) => phases.push(p) })

    expect(res.status).toBe('discovered')
    // The deterministic proposer reads manifests and returns, so there is no
    // proposal phase to report; what a user waits on is the build and the boot.
    expect(phases).toEqual([
      { kind: 'verifying', stage: 'build', revision: false },
      { kind: 'verifying', stage: 'server boot', revision: false },
    ])
  })

  it('goes through the SAME verification — a boot that fails falls to the model, carrying its evidence', async () => {
    const r = apiRepo('node crash.mjs')
    const { runner, calls } = scripted({
      build: 'true',
      api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
    })

    const res = await discoverRecipe(r, runner, { routes: surface })

    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    expect(res.source).toBe('llm')
    // ONE model call: the deterministic proposal is never retried deterministically,
    // and its diagnostic is what the model opens on.
    expect(calls).toHaveLength(1)
    expect(calls[0].retry?.failure).toContain("derived from the repository's own js manifests")
    expect(calls[0].retry?.failure).toContain('fixture crash')
    expect(calls[0].retry?.proposal).toContain('crash.mjs')
  })

  // `revision` means "this proposal lineage has been verified before". The
  // deterministic proposer consumes the first round, so a global round counter would
  // render the model's OPENING attempt as `re-verifying: build` — a label claiming the
  // engine is retrying that proposer when it has never run one of its proposals.
  it("the model's FIRST verification is not a revision, even after the deterministic one failed", async () => {
    const r = apiRepo('node crash.mjs')
    const { runner } = scripted({
      build: 'true',
      api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
    })
    const phases: RecipeDiscoveryPhase[] = []

    const res = await discoverRecipe(r, runner, { routes: surface, onPhase: (p) => phases.push(p) })

    expect(res.status).toBe('discovered')
    expect(phases).toEqual([
      { kind: 'verifying', stage: 'build', revision: false },
      { kind: 'verifying', stage: 'server boot', revision: false },
      { kind: 'proposing', after: 'server boot' },
      { kind: 'verifying', stage: 'build', revision: false },
      { kind: 'verifying', stage: 'server boot', revision: false },
    ])
  })

  it('a repo the detectors cannot decide reaches the model with no evidence context', async () => {
    // The shared temp repo declares a `bin` whose file does not exist and no
    // server — nothing deterministic to propose.
    const r = repo()
    const { runner, calls } = scripted(GOOD)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    expect(res.source).toBe('llm')
    expect(res.todos).toEqual([])
    expect(calls[0].retry).toBeUndefined()
  })

  /**
   * The cheap loud abort: a repo declaring NO manifest guard can read has nothing
   * for either proposer to reason about, so asking the model would buy an invented
   * build command and entrypoint — which the engine would then install, build and
   * probe. It refuses instead, before a single call.
   */
  it('a repo with NO recognized manifest fails LOUDLY, spending no model call', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-bare-'))
    repos.push(bare)
    fs.writeFileSync(path.join(bare, 'README.md'), '# a repo of prose\n')
    fs.writeFileSync(path.join(bare, 'Makefile'), 'all:\n\techo hi\n')

    const res = await discoverRecipe(bare, neverCalled)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    // It names every manifest it looked for, and what the user must do instead.
    expect(res.reason).toContain('package.json')
    expect(res.reason).toContain('pyproject.toml')
    expect(res.reason).toContain('.csproj')
    expect(res.reason).toContain('recipe.json')
    // Nothing was written — the abort happens before any proposal exists.
    expect(fs.existsSync(recipeFile(bare))).toBe(false)
  })

  it('reports the credential TODOs the recipe could not fill in', async () => {
    const r = apiRepo()
    fs.writeFileSync(
      path.join(r, 'openapi.yaml'),
      [
        'openapi: 3.0.0',
        'info: { title: todos, version: "1" }',
        'paths: {}',
        'components:',
        '  securitySchemes:',
        '    bearerAuth: { type: http, scheme: bearer }',
      ].join('\n'),
    )
    fs.mkdirSync(path.join(r, '.truecourse', 'specs'), { recursive: true })
    fs.writeFileSync(
      path.join(r, '.truecourse', 'specs', 'corpus.json'),
      JSON.stringify({ version: 3, docs: [{ ref: 'openapi.yaml', areaTags: [] }] }),
    )

    const res = await discoverRecipe(r, neverCalled, { routes: surface })

    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    // The stub VERIFIES (a boot needs no auth) and the fill-in is reported, not
    // fabricated — the run is what stops on the unset env var.
    expect(res.recipe.api?.credentials?.bearerAuth.valueFromEnv).toBe('GUARD_CRED_BEARERAUTH')
    expect(res.todos).toHaveLength(1)
    expect(res.todos[0]).toContain('GUARD_CRED_BEARERAUTH')
  })
})

// ---------------------------------------------------------------------------
// The live phase stream — what a caller with a progress surface subscribes to.
// ---------------------------------------------------------------------------

describe('discoverRecipe — the live phase stream', () => {
  it('names every long phase, and the revision loop a failed build sends it into', async () => {
    const r = repo()
    const { runner } = scripted(
      { build: 'false', entry: ['node', FIXTURE_BIN] },
      { install: 'true', build: 'true', entry: ['node', FIXTURE_BIN] },
    )
    const phases: RecipeDiscoveryPhase[] = []

    const res = await discoverRecipe(r, runner, { onPhase: (p) => phases.push(p) })

    expect(res.status).toBe('discovered')
    // Every stage the engine RAN, in order, and each one attributable: the round-2
    // stages are marked as re-verification, and the proposal between them names the
    // stage that sent it back. A proposal with no `install` reports no install.
    expect(phases).toEqual([
      { kind: 'proposing' },
      { kind: 'verifying', stage: 'build', revision: false },
      { kind: 'proposing', after: 'build' },
      { kind: 'verifying', stage: 'install', revision: true },
      { kind: 'verifying', stage: 'build', revision: true },
      { kind: 'verifying', stage: 'entry probe', revision: true },
    ])
  })
})
