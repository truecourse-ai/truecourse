/**
 * What a rejected — or a green-but-fragile — verification actually TELLS the
 * reader:
 *  - an install/build failure carries a real tail AND the tail of every log file
 *    the package manager pointed at instead of printing the error (yarn berry
 *    writes a failing package's build log to a temp path, npm writes the run log);
 *  - the empty-schema caveat recognizes a migration step by every spelling a
 *    package script gives it, not just the word "migrate";
 *  - a compose file whose datastore binds a host directory INSIDE the checkout
 *    is a caveat on an otherwise green verdict.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, it, expect } from 'vitest'
import { verifyProposal, type VerifiableProposal } from '@truecourse/guard-generator'
import { FIXTURE_API_SERVER } from './helpers.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})
function tempRepo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-verify-report-'))
  dirs.push(r)
  return r
}

describe('verifyProposal — the install/build failure report', () => {
  it('carries a long tail, not five lines joined with slashes', async () => {
    const r = tempRepo()
    const lines = Array.from({ length: 30 }, (_, i) => `step ${i + 1}`)
    const verdict = await verifyProposal(r, {
      install: `${lines.map((l) => `echo "${l}"`).join('; ')}; exit 1`,
      build: 'true',
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.stage).toBe('install')
    // The error a five-line tail used to bury, and the newline shape that keeps
    // a multi-line compiler diagnostic readable.
    expect(verdict.reason).toContain('step 10')
    expect(verdict.reason).toContain('step 30')
    expect(verdict.reason).not.toContain('step 1 / step 2')
  }, 60_000)

  it("appends the tail of yarn's per-package build log, which is where the error is", async () => {
    const r = tempRepo()
    const log = path.join(r, 'build.log')
    fs.writeFileSync(log, ['> node-gyp rebuild', 'gyp ERR! stack Error: not found: make', 'gyp ERR! not ok'].join('\n'))
    const yarnLine = `➤ YN0009: │ bcrypt@npm:5.1.1 couldn't be built successfully (exit code 1, logs can be found here: ${log})`

    const verdict = await verifyProposal(r, {
      install: `echo "${yarnLine}"; exit 1`,
      build: 'true',
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain(`--- ${log} (tail) ---`)
    expect(verdict.reason).toContain('gyp ERR! stack Error: not found: make')
  }, 60_000)

  it("appends the tail of npm's run log, and ignores a pointer to a file that is gone", async () => {
    const r = tempRepo()
    const log = path.join(r, 'npm-debug.log')
    fs.writeFileSync(log, ['12 verbose stack Error: command failed', '13 error code ELIFECYCLE'].join('\n'))

    const verdict = await verifyProposal(r, {
      build:
        `echo "A complete log of this run can be found in: ${log}"; ` +
        `echo "A complete log of this run can be found in: ${path.join(r, 'gone.log')}"; exit 1`,
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.stage).toBe('build')
    expect(verdict.reason).toContain('13 error code ELIFECYCLE')
    expect(verdict.reason).not.toContain('gone.log (tail)')
  }, 60_000)

  // The pointer is whatever the install printed, and the install is the
  // repository's own code: a path outside the checkout and the temp dir, or a
  // thing that is not a regular file, is not read — a FIFO would otherwise
  // block the process for good.
  it('follows a pointer only to a regular file under the checkout or the temp dir', async () => {
    const r = tempRepo()
    const fifo = path.join(r, 'never-written.fifo')
    execFileSync('mkfifo', [fifo])
    const outside = path.join(os.homedir(), '.some-secret-file')

    const verdict = await verifyProposal(r, {
      build:
        `echo "A complete log of this run can be found in: ${fifo}"; ` +
        `echo "A complete log of this run can be found in: ${outside}"; ` +
        `echo "A complete log of this run can be found in: /etc/hosts"; exit 1`,
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).not.toContain('(tail)')
  }, 60_000)

  it('reads only the tail of a huge log', async () => {
    const r = tempRepo()
    const log = path.join(r, 'huge.log')
    fs.writeFileSync(log, `${'x'.repeat(200)}\n`.repeat(5_000) + 'the last line\n')

    const verdict = await verifyProposal(r, {
      build: `echo "A complete log of this run can be found in: ${log}"; exit 1`,
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toContain('the last line')
    expect(verdict.reason.length).toBeLessThan(13_000)
  }, 60_000)
})

// ---------------------------------------------------------------------------
// The empty-schema caveat's migration detector.
// ---------------------------------------------------------------------------

const DB_URL = 'postgresql://postgres:@localhost:5450/app'

/** A green api proposal whose services command is the one under test. */
function servicedProposal(up: string): VerifiableProposal {
  return {
    build: 'true',
    api: {
      serve: ['node', FIXTURE_API_SERVER],
      healthPath: '/health',
      env: { DATABASE_URL: DB_URL },
      services: { up, down: 'echo stop', reset: 'echo wipe' },
    },
  }
}

describe('the empty-schema caveat — how a migration step is spelled', () => {
  // `echo` in front of each, so the SPELLING is what is under test and no
  // package manager has to exist for the verification to go green.
  const migrations = [
    'echo yarn prisma:deploy',
    'echo yarn workspace @acme/prisma deploy',
    'echo prisma deploy',
    'echo npm run deploy',
    'echo pnpm db:deploy',
    'echo prisma migrate deploy',
  ]
  for (const up of migrations) {
    it(`recognizes \`${up}\` as the schema step`, async () => {
      const verdict = await verifyProposal(tempRepo(), servicedProposal(up))
      expect(verdict).toEqual({ ok: true })
    }, 60_000)
  }

  it('still caveats a bring-up that only starts containers', async () => {
    const verdict = await verifyProposal(tempRepo(), servicedProposal('echo docker compose -p acme up -d'))
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.warnings ?? []).toHaveLength(1)
    expect(verdict.warnings![0]).toContain('schema/migration')
  }, 60_000)

  // `deploy` as a directory name or a hosting CLI's verb runs no migration.
  const notMigrations = [
    'echo docker compose -p acme -f deploy/docker-compose.yml up -d',
    'echo pnpm deploy --filter api',
    'echo vercel deploy',
  ]
  for (const up of notMigrations) {
    it(`does not mistake \`${up}\` for the schema step`, async () => {
      const verdict = await verifyProposal(tempRepo(), servicedProposal(up))
      expect(verdict.ok).toBe(true)
      if (!verdict.ok) return
      expect(verdict.warnings ?? []).toHaveLength(1)
    }, 60_000)
  }
})

// ---------------------------------------------------------------------------
// The bind-mount caveat.
// ---------------------------------------------------------------------------

describe('the host bind-mount caveat', () => {
  /** A repo whose compose file is named by `-f`, or — with `file` omitted — sits
   *  at one of the default compose paths the daemon picks up. */
  function composeRepo(body: string, file = 'compose.yml'): string {
    const r = tempRepo()
    fs.writeFileSync(path.join(r, file), body)
    return r
  }

  const BIND = ['name: acme', 'services:', '  database:', '    image: postgres', '    volumes:', '      - ./pgdata:/var/lib/postgresql/data', ''].join('\n')
  const NAMED = ['name: acme', 'volumes:', '  pgdata:', 'services:', '  database:', '    image: postgres', '    volumes:', '      - pgdata:/var/lib/postgresql/data', ''].join('\n')

  /** The services block spelling `echo` in front of compose so the caveat is
   *  read off the FILE, with no docker daemon anywhere near the test. */
  function proposal(up: string): VerifiableProposal {
    return {
      build: 'true',
      api: {
        serve: ['node', FIXTURE_API_SERVER],
        healthPath: '/health',
        services: { up, down: `echo ${up} down`, reset: `echo ${up} down -v` },
      },
    }
  }

  it('warns about a relative host path in the compose file `-f` names', async () => {
    const r = composeRepo(BIND)
    const verdict = await verifyProposal(r, proposal('echo docker compose -f compose.yml up -d'))

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    const hit = (verdict.warnings ?? []).find((w) => /bind mounts/i.test(w))
    expect(hit).toBeTruthy()
    expect(hit).toContain('./pgdata:/var/lib/postgresql/data')
    expect(hit).toContain('named volume')
  }, 60_000)

  it('reads the default compose file when the command names none', async () => {
    const r = composeRepo(BIND, 'docker-compose.yml')
    const verdict = await verifyProposal(r, proposal('echo docker compose -p acme up -d'))

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect((verdict.warnings ?? []).some((w) => /bind mounts/i.test(w))).toBe(true)
  }, 60_000)

  it('stays quiet for a named volume', async () => {
    const r = composeRepo(NAMED)
    const verdict = await verifyProposal(r, proposal('echo docker compose -f compose.yml up -d'))

    expect(verdict).toEqual({ ok: true })
  }, 60_000)
})
