/**
 * THE GENERATED DATASTORE (item 68) — through discovery.
 *
 * The proposal carries a compose file that does not exist yet, so discovery has to
 * WRITE it before verification (the `services.up` command names it by path) and put
 * the tree back exactly as it found it when the proposal is rejected — item 66's
 * write-then-restore rule, applied to the second artifact.
 *
 * No real docker: a stub `docker` on PATH stands in for the daemon. It asserts what
 * matters anyway — that the compose file is ON DISK when `up` runs — and lets the
 * failing-daemon case be scripted instead of simulated.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverRecipe, GUARD_COMPOSE_FILE, type RecipeRunner } from '@truecourse/guard-generator'
import type { DatastoreUrlRef } from '@truecourse/shared'

const dirs: string[] = []
const originalPath = process.env.PATH
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
  process.env.PATH = originalPath
})

/** The connection URL the fixture app declares — the speced-api shape. */
const DATASTORE: DatastoreUrlRef[] = [
  {
    url: 'postgres://localhost:5432/weather',
    scheme: 'postgres',
    envVar: 'DATABASE_URL',
    location: { filePath: '/repo/src/config.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: 10 },
  },
]

/** The model must never be reached in these cases. */
const neverCalled: RecipeRunner = async () => {
  throw new Error('the model proposer must not be called')
}

/**
 * A repo whose server boots only when BOTH are true: the datastore was brought up
 * (a marker file the stub `docker` writes) and `DATABASE_URL` names the explicit,
 * generated-container URL. The causal shape of a real datastore repo, offline.
 */
function datastoreRepo(): { root: string; marker: string; log: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gends-'))
  dirs.push(root)
  const marker = path.join(root, 'datastore.up')
  const log = path.join(root, 'docker.log')
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'app', version: '1.0.0', scripts: { start: 'node server.mjs' } }),
  )
  fs.writeFileSync(
    path.join(root, 'server.mjs'),
    [
      "import http from 'node:http'",
      "import fs from 'node:fs'",
      `if (!fs.existsSync(${JSON.stringify(marker)})) {`,
      "  console.error('Database error: connect ECONNREFUSED 127.0.0.1:5432')",
      '  process.exit(1)',
      '}',
      "if (process.env.DATABASE_URL !== 'postgres://guard@localhost:5432/weather') {",
      "  console.error(`Database error: role does not exist (${process.env.DATABASE_URL})`)",
      '  process.exit(1)',
      '}',
      "http.createServer((_q, r) => { r.writeHead(200); r.end('ok') }).listen(Number(process.env.PORT))",
    ].join('\n'),
  )
  return { root, marker, log }
}

/**
 * A stub `docker` first on PATH. It records its argv, REFUSES unless the compose
 * file it was pointed at exists, and creates/removes the bring-up marker.
 * `daemon: 'down'` makes every invocation fail the way a missing daemon does.
 */
function stubDocker(repo: { root: string; marker: string; log: string }, daemon: 'up' | 'down' = 'up'): void {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-bin-'))
  dirs.push(bin)
  const script = [
    '#!/bin/sh',
    `echo "$@" >> ${JSON.stringify(repo.log)}`,
    ...(daemon === 'down'
      ? ['echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." >&2', 'exit 1']
      : [
          // `-f <file>` must name a file that EXISTS by now.
          'file=""',
          'prev=""',
          'for a in "$@"; do if [ "$prev" = "-f" ]; then file="$a"; fi; prev="$a"; done',
          'if [ -n "$file" ] && [ ! -f "$file" ]; then echo "no configuration file provided: $file" >&2; exit 1; fi',
          `for a in "$@"; do case "$a" in up) touch ${JSON.stringify(repo.marker)} ;; down) rm -f ${JSON.stringify(repo.marker)} ;; esac; done`,
          'exit 0',
        ]),
  ].join('\n')
  fs.writeFileSync(path.join(bin, 'docker'), script, { mode: 0o755 })
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`
}

describe('discoverRecipe — the generated datastore', () => {
  it('writes the compose file, verifies the whole chain against it, and keeps BOTH artifacts', async () => {
    const repo = datastoreRepo()
    stubDocker(repo)

    const res = await discoverRecipe(repo.root, neverCalled, { datastores: async () => DATASTORE })

    expect(res.status).toBe('discovered')
    if (res.status !== 'discovered') return
    expect(res.source).toBe('deterministic')
    expect(res.composePath).toBe(GUARD_COMPOSE_FILE)
    // The compose file stays: the recipe's `services.up` names it.
    const compose = fs.readFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), 'utf-8')
    expect(compose).toContain('postgres:16-alpine')
    expect(res.recipe.api?.services?.up).toBe(`docker compose -f ${GUARD_COMPOSE_FILE} up -d --wait`)
    expect(res.recipe.api?.env).toEqual({ DATABASE_URL: 'postgres://guard@localhost:5432/weather' })
    // The server only answered because `up` ran FIRST and the file was already there.
    const invocations = fs.readFileSync(repo.log, 'utf-8').trim().split('\n')
    expect(invocations[0]).toContain('up -d --wait')
    expect(invocations[1]).toContain('down')
    expect(fs.existsSync(repo.marker)).toBe(false)
  })

  it('a rejected proposal leaves NO compose file behind', async () => {
    const repo = datastoreRepo()
    // The daemon is down: `services.up` fails, so the whole proposal is rejected.
    stubDocker(repo, 'down')

    const res = await discoverRecipe(repo.root, neverCalled, { datastores: async () => DATASTORE })

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('services `docker compose')
    expect(res.reason).toContain('Cannot connect to the Docker daemon')
    // Byte-identical tree: the file guard wrote for the attempt is gone.
    expect(fs.existsSync(path.join(repo.root, GUARD_COMPOSE_FILE))).toBe(false)
    expect(fs.existsSync(path.join(repo.root, '.truecourse', 'scenarios', 'recipe.json'))).toBe(false)
  })

  it('an ORPHANED guard compose file is restored byte-for-byte when the proposal fails', async () => {
    const repo = datastoreRepo()
    const orphan = '# left by an earlier refused run\nservices: {}\n'
    fs.writeFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), orphan)
    stubDocker(repo, 'down')

    await discoverRecipe(repo.root, neverCalled, { datastores: async () => DATASTORE })

    expect(fs.readFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), 'utf-8')).toBe(orphan)
  })

  it('the guided no-compose message says guard already TRIED to generate one', async () => {
    const repo = datastoreRepo()
    stubDocker(repo, 'down')
    // The model fallback proposes a serviceless recipe, whose boot dies on the
    // datastore — the case item 67's guidance speaks to.
    const proposals: RecipeRunner = async () => ({ build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/' } })

    const res = await discoverRecipe(repo.root, proposals, {
      datastores: async () => DATASTORE,
      database: async () => ({ type: 'postgres', driver: 'drizzle-orm' }),
    })

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('the app depends on a database (drizzle-orm/postgres detected)')
    // Not the pre-item-68 advice: guard took it already.
    expect(res.reason).not.toContain('add a docker-compose file with the datastore')
    expect(res.reason).toContain(`fix what stopped the ${GUARD_COMPOSE_FILE} guard generated`)
  })

  it('keeps item 67’s message unchanged when nothing was generatable', async () => {
    const repo = datastoreRepo()
    const proposals: RecipeRunner = async () => ({ build: 'true', api: { serve: ['node', 'server.mjs'], healthPath: '/' } })

    // No datastore URL in the source ⇒ no generation attempt at all.
    const res = await discoverRecipe(repo.root, proposals, {
      database: async () => ({ type: 'postgres', driver: 'drizzle-orm' }),
    })

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toContain('add a docker-compose file with the datastore')
    expect(fs.existsSync(path.join(repo.root, GUARD_COMPOSE_FILE))).toBe(false)
  })

  it('`--refresh` re-derives the services but never rewrites a compose file the recipe runs', async () => {
    const repo = datastoreRepo()
    stubDocker(repo)
    const first = await discoverRecipe(repo.root, neverCalled, { datastores: async () => DATASTORE })
    expect(first.status).toBe('discovered')
    // The user reviewed and edited their copy.
    const edited = `${fs.readFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), 'utf-8')}# reviewed by a human\n`
    fs.writeFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), edited)

    const refreshed = await discoverRecipe(repo.root, neverCalled, {
      datastores: async () => DATASTORE,
      ignoreExisting: true,
    })

    expect(refreshed.status).toBe('discovered')
    if (refreshed.status !== 'discovered') return
    expect(refreshed.composePath).toBeUndefined()
    expect(refreshed.recipe.api?.services?.up).toContain(GUARD_COMPOSE_FILE)
    expect(fs.readFileSync(path.join(repo.root, GUARD_COMPOSE_FILE), 'utf-8')).toBe(edited)
  })
})
