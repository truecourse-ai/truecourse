import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runSeed, SeedError } from '@truecourse/guard-runner'
import type { RecipeApiSeed } from '@truecourse/guard-runner'
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

/** Write a `seed.mjs` into the repo that emits `manifest` (a literal or an expression). */
function writeSeedScript(r: string, body: string): void {
  fs.writeFileSync(path.join(r, 'seed.mjs'), body)
}

/** A seed script that writes the given JSON object verbatim to GUARD_SEED_OUT. */
function emit(manifest: unknown): string {
  return `import fs from 'node:fs'\nfs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify(${JSON.stringify(manifest)}))\n`
}

const SEED: RecipeApiSeed = {
  command: 'node seed.mjs',
  provides: {
    credentials: { 'api-key': { header: 'Authorization', description: 'pro user' } },
    fixtures: { user: ['id', 'username'], eventType: ['id'] },
  },
}

describe('runSeed', () => {
  it('runs the command, resolves declared credentials (header from provides, value from manifest) and stringifies fixtures', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer cal_abc' } },
        fixtures: { user: { id: 4, username: 'pro' }, eventType: { id: 3 } },
      }),
    )
    const out = await runSeed({ repoRoot: r, seed: SEED })
    expect(out.credentials.get('api-key')).toEqual({ header: 'Authorization', value: 'Bearer cal_abc' })
    // Numbers become decimal strings; the map carries only DECLARED fields.
    expect(out.fixtures.get('user')).toEqual({ id: '4', username: 'pro' })
    expect(out.fixtures.get('eventType')).toEqual({ id: '3' })
  })

  it('ignores emitted keys the recipe did not declare (extra creds/fixtures/fields)', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer x' }, 'admin-key': { value: 'Bearer y' } },
        fixtures: { user: { id: 4, username: 'pro', email: 'p@x.io' }, eventType: { id: 3 }, booking: { id: 9 } },
      }),
    )
    const out = await runSeed({ repoRoot: r, seed: SEED })
    expect(out.credentials.has('admin-key')).toBe(false)
    expect(out.fixtures.has('booking')).toBe(false)
    expect(out.fixtures.get('user')).toEqual({ id: '4', username: 'pro' }) // email dropped
  })

  it('hard-stops when the seed command exits non-zero, naming the exit code and stderr tail', async () => {
    const r = repo()
    writeSeedScript(r, `console.error('boom: db unreachable')\nprocess.exit(3)\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toBeInstanceOf(SeedError)
    try {
      await runSeed({ repoRoot: r, seed: SEED })
    } catch (e) {
      expect((e as Error).message).toContain('3')
      expect((e as Error).message).toContain('boom: db unreachable')
    }
  })

  it('hard-stops when the seed writes no manifest file', async () => {
    const r = repo()
    writeSeedScript(r, `// exits 0 but writes nothing\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when the manifest is not valid JSON', async () => {
    const r = repo()
    writeSeedScript(r, `import fs from 'node:fs'\nfs.writeFileSync(process.env.GUARD_SEED_OUT, 'not json')\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when a declared credential is missing from the manifest, naming it', async () => {
    const r = repo()
    writeSeedScript(r, emit({ fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } } }))
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('api-key')
    }
  })

  it('hard-stops when a declared credential value is blank (would run un-authenticated)', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: '   ' } },
        fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
      }),
    )
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when a declared fixture field is missing, naming the fixture and field', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer x' } },
        fixtures: { user: { id: 1 }, eventType: { id: 2 } }, // user.username missing
      }),
    )
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('user')
      expect((e as Error).message).toContain('username')
    }
  })

  it('supports a fixtures-only seed (no credentials declared)', async () => {
    const r = repo()
    const fixturesOnly: RecipeApiSeed = { command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } } }
    writeSeedScript(r, emit({ fixtures: { user: { id: 7 } } }))
    const out = await runSeed({ repoRoot: r, seed: fixturesOnly })
    expect(out.credentials.size).toBe(0)
    expect(out.fixtures.get('user')).toEqual({ id: '7' })
  })

  it('drains stdout: a seed that writes >64KB to stdout still completes (no pipe-buffer hang)', async () => {
    const r = repo()
    // 256KB to stdout would fill the OS pipe buffer (~64KB) and block the seed's
    // write() forever if stdout is never drained — the run would die at the timeout.
    writeSeedScript(
      r,
      `import fs from 'node:fs'\nprocess.stdout.write('x'.repeat(256 * 1024))\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, ${JSON.stringify(
          JSON.stringify({
            credentials: { 'api-key': { value: 'Bearer z' } },
            fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
          }),
        )})\n`,
    )
    // A short budget: if stdout were undrained this times out; drained it finishes in ms.
    const out = await runSeed({ repoRoot: r, seed: SEED, timeoutMs: 8_000 })
    expect(out.credentials.get('api-key')?.value).toBe('Bearer z')
  })

  it('carries stdout in the failure tail (a seed that logs its error to stdout then exits 1)', async () => {
    const r = repo()
    writeSeedScript(r, `console.log('fatal: migration 0007 not applied')\nprocess.exit(1)\n`)
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('fatal: migration 0007 not applied')
    }
  })

  it('masks a recipe-known credential value the seed echoed before failing', async () => {
    const r = repo()
    const SECRET = 'sk-recipe-known-secret'
    writeSeedScript(r, `console.error('used token ${SECRET}')\nprocess.exit(2)\n`)
    try {
      await runSeed({ repoRoot: r, seed: SEED, knownCredentials: new Map([['session', SECRET]]) })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('«cred:session»')
      expect((e as Error).message).not.toContain(SECRET)
    }
  })

  it('masks a manifest-minted credential value the seed echoed before exiting non-zero', async () => {
    const r = repo()
    const MINTED = 'Bearer minted-then-leaked'
    // The seed writes a manifest carrying the minted value, echoes it to stderr, then
    // fails — the tail must be masked using values harvested from the (partial) manifest.
    writeSeedScript(
      r,
      `import fs from 'node:fs'\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, ${JSON.stringify(
          JSON.stringify({ credentials: { 'api-key': { value: MINTED } } }),
        )})\n` +
        `console.error('minted ${MINTED}')\nprocess.exit(1)\n`,
    )
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('«cred:api-key»')
      expect((e as Error).message).not.toContain(MINTED)
    }
  })

  it('uses hasOwnProperty for fixture fields: a declared field named toString is genuinely required', async () => {
    const r = repo()
    const seed: RecipeApiSeed = { command: 'node seed.mjs', provides: { fixtures: { user: ['toString'] } } }
    // The manifest emits `id`, NOT `toString` — a prototype-chain `in` check would
    // spuriously find `toString` and stringify the FUNCTION into requests.
    writeSeedScript(r, emit({ fixtures: { user: { id: 1 } } }))
    try {
      await runSeed({ repoRoot: r, seed })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('toString')
    }
  })
})
