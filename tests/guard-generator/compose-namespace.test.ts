/**
 * THE COMPOSE PROJECT: the namespace every compose command a recipe runs is
 * bound to.
 *
 * The project is the world's identity. `down -v` wipes a project's volumes, and
 * two runs that share a project share a datastore. So it must be unique per
 * (workspace, repository) pair on one host, since two workspaces connected to
 * the same repository run their jobs side by side and a hosted clone's directory
 * name is different every time. And it must be stable across runs of that pair,
 * because the stored recipe pins it in its `-p` and the setup bundle carries it
 * forward.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  composeProjectName,
  proposeRecipe,
  recipeCacheKey,
  staticProposalComplaints,
  GUARD_COMPOSE_FILE,
} from '@truecourse/guard-generator'
import type { DatastoreUrlRef } from '@truecourse/shared'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A synthetic repository: a file map (relative path → content) on disk. */
function repoOf(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-compose-ns-'))
  dirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  return dir
}

/** The minimal JS server repo the deterministic proposer accepts. */
const SERVER_FILES = {
  'package.json': JSON.stringify({ name: 'svc', version: '1.0.0', scripts: { start: 'node server.js' } }),
  'server.js': '',
}

/** The proposal's `api.services`, asserting there was a proposal at all. */
function services(repo: string, composeKey?: string, datastores?: readonly DatastoreUrlRef[]) {
  const outcome = proposeRecipe(repo, {
    securitySchemes: {},
    ...(composeKey ? { composeKey } : {}),
    ...(datastores ? { datastores } : {}),
  })
  if (!outcome.ok) throw new Error(`expected a proposal, got a bail: ${outcome.reason}`)
  return { services: outcome.recipe.api?.services, compose: outcome.compose }
}

/** One harvested connection URL. */
function ref(url: string, envVar: string): DatastoreUrlRef {
  return {
    url,
    scheme: url.slice(0, url.indexOf(':')),
    envVar,
    location: { filePath: '/repo/src/config.ts', startLine: 1, endLine: 1, startColumn: 0, endColumn: url.length },
  }
}

describe('composeProjectName', () => {
  it('is one stable name per identity', () => {
    expect(composeProjectName('org_123/acme/widgets')).toBe('truecourse-org-123-acme-widgets-ace2710c15')
    expect(composeProjectName('org_123/acme/widgets')).toBe(composeProjectName('org_123/ACME/Widgets'))
  })

  it('separates two workspaces connected to the SAME repository', () => {
    expect(composeProjectName('org_123/acme/widgets')).not.toBe(composeProjectName('org_456/acme/widgets'))
  })

  it('is docker-safe and bounded whatever the identity is', () => {
    const name = composeProjectName('org_01JQ9ZK4YWXV2N8T/VeryLongOwner.Name/a-very-long-repository-name-indeed')
    expect(name).toMatch(/^[a-z0-9][a-z0-9_-]*$/)
    expect(name.length).toBeLessThanOrEqual(64)
    // Still readable: the identity's own words lead, the digest only disambiguates.
    expect(name.startsWith('truecourse-org-01jq9zk4ywxv2n8t')).toBe(true)
  })
})

describe("the repository's own compose file", () => {
  it('runs under the project the identity names', () => {
    const repo = repoOf({ ...SERVER_FILES, 'compose.yaml': 'services:\n  db:\n    image: postgres:16\n' })
    const project = composeProjectName('org_123/acme/widgets')

    expect(services(repo, 'org_123/acme/widgets').services).toEqual({
      up: `docker compose -p ${project} -f compose.yaml up -d --wait`,
      down: `docker compose -p ${project} -f compose.yaml down`,
      reset: `docker compose -p ${project} -f compose.yaml down -v`,
    })
  })

  it('gives two workspaces of one repository two projects', () => {
    const repo = repoOf({ ...SERVER_FILES, 'compose.yaml': 'services:\n  db:\n    image: postgres:16\n' })

    expect(services(repo, 'org_123/acme/widgets').services?.up).not.toBe(
      services(repo, 'org_456/acme/widgets').services?.up,
    )
  })
})

describe('the generated datastore', () => {
  const DB = [ref('postgres://localhost:5432/app', 'DATABASE_URL')]

  it('names its project after the identity, in the commands AND in the file', () => {
    const repo = repoOf(SERVER_FILES)
    const project = composeProjectName('org_123/acme/widgets')

    const out = services(repo, 'org_123/acme/widgets', DB)
    expect(out.services).toEqual({
      up: `docker compose -p ${project} -f ${GUARD_COMPOSE_FILE} up -d --wait`,
      down: `docker compose -p ${project} -f ${GUARD_COMPOSE_FILE} down`,
      reset: `docker compose -p ${project} -f ${GUARD_COMPOSE_FILE} down -v`,
    })
    expect(yaml.load(out.compose?.content ?? '')).toMatchObject({ name: project })
  })

  // Two repositories whose apps both default to `postgres://localhost/app`
  // derive the same file. What keeps one repo's reset off the other's datastore
  // is the project, so it can never be read off the app's own literals.
  it('never names its project after the database', () => {
    const one = services(repoOf(SERVER_FILES), 'org_123/acme/widgets', DB)
    const two = services(repoOf(SERVER_FILES), 'org_123/acme/gadgets', DB)
    const nameOf = (content: string | undefined) => (yaml.load(content ?? '') as { name?: string }).name

    expect(one.services?.reset).not.toBe(two.services?.reset)
    expect(nameOf(one.compose?.content)).not.toBe(nameOf(two.compose?.content))
  })
})

describe('which services the bring-up starts', () => {
  // linkwarden's meilisearch, documenso's inbucket: infrastructure the compose
  // file declares beside the datastore with no `depends_on` edge to it. Dropping
  // it boots an app whose search or mail backend is not running, and every
  // scenario that fails for it reads as a product bug.
  it('starts an image-only service nothing depends on', () => {
    const repo = repoOf({
      ...SERVER_FILES,
      'docker-compose.yml': [
        'services:',
        '  db:',
        '    image: postgres:16',
        '  mail:',
        '    image: axllent/mailpit',
        '',
      ].join('\n'),
    })

    // Everything the file declares is wanted, so the bring-up needs no service
    // list at all: a dropped `mail` would show up as `up -d --wait db`.
    const project = composeProjectName('org_123/acme/widgets')
    expect(services(repo, 'org_123/acme/widgets').services?.up).toBe(
      `docker compose -p ${project} -f docker-compose.yml up -d --wait`,
    )
  })

  it('still leaves out the service BUILT from this repository', () => {
    const repo = repoOf({
      ...SERVER_FILES,
      'docker-compose.yml': [
        'services:',
        '  app:',
        '    build: .',
        '  db:',
        '    image: postgres:16',
        '  mail:',
        '    image: axllent/mailpit',
        '',
      ].join('\n'),
    })

    expect(services(repo, 'org_123/acme/widgets').services?.up).toContain('up -d --wait db mail')
  })
})

describe('the recipe cache key', () => {
  // A cached proposal carries the `-p` it was authored with, so an entry keyed
  // without the project would hand this run another workspace's world.
  it('separates two runs that differ by compose project alone', () => {
    const fingerprint = 'sha256:same-inputs'
    const one = composeProjectName('org_123/acme/widgets')
    const two = composeProjectName('org_456/acme/widgets')

    expect(recipeCacheKey(fingerprint, one)).not.toBe(recipeCacheKey(fingerprint, two))
    expect(recipeCacheKey(fingerprint, one)).not.toBe(recipeCacheKey(fingerprint))
    expect(recipeCacheKey(fingerprint, one)).toBe(recipeCacheKey(fingerprint, one))
  })
})

describe('the namespace rule', () => {
  const serve = { serve: ['node', 's.mjs'], healthPath: '/health' }

  // A file's own `name:` is the DEVELOPER's project (they run that same file
  // themselves) and verification executes `reset`, so a bring-up that inherits
  // it wipes their stack. Only `-p` names a project that is ours.
  it('refuses an `-f` file that pins a top-level `name:` but no `-p`', () => {
    const repo = repoOf({ 'compose.test.yml': 'name: acme-testing\nservices:\n  db:\n    image: postgres\n' })

    const complaints = staticProposalComplaints(
      { build: 'true', api: { ...serve, services: { up: 'docker compose -f compose.test.yml up -d --wait' } } },
      undefined,
      repo,
    )

    expect(complaints.some((c) => c.includes('project namespace'))).toBe(true)
  })

  // A session that picks its own project picks a world nothing else addresses,
  // and two workspaces on one repository can pick the same one. When the caller
  // named the world, the derived project is the only one that passes.
  it('refuses a project that is not the derived one, and names the one required', () => {
    const project = composeProjectName('org_123/acme/widgets')
    const complaints = staticProposalComplaints(
      {
        build: 'true',
        api: {
          ...serve,
          services: {
            up: 'docker compose -p acme-guard -f compose.yml up -d --wait',
            down: `docker compose -p ${project} -f compose.yml down`,
            reset: `docker compose -p ${project} -f compose.yml down -v`,
          },
        },
      },
      undefined,
      undefined,
      project,
    )

    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('api.services.up')
    expect(complaints[0]).toContain(`-p ${project}`)
    expect(complaints[0]).toContain('acme-guard')
  })

  it('accepts the derived project, and still accepts any project when none is required', () => {
    const project = composeProjectName('org_123/acme/widgets')
    const services = (up: string) => ({
      build: 'true',
      api: { ...serve, services: { up, down: `${up} down`, reset: `${up} down -v` } },
    })

    expect(staticProposalComplaints(services(`docker compose -p ${project} up -d`), undefined, undefined, project)).toEqual([])
    expect(staticProposalComplaints(services('docker compose -p acme-guard up -d'))).toEqual([])
  })
})
