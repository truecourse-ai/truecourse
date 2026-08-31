/**
 * The static refusal rules — the free stage-zero gate every proposal passes
 * through (`check_recipe` in the repair session, and stage `static` of
 * `verifyProposal`, so no arrival path skips them).
 *
 * The three rules added after the 2026-08-20 agent-loop bench, where sessions
 * gamed verification green on all three reference repos:
 *  - inline-eval argvs (documenso proposed `node -e "createServer…"` as the api)
 *  - eval one-liner install/build (strapi proposed `node -e "require('./package.json')"`)
 *  - entry-only despite a workspace shipping HTTP services (cal.diy proposed the
 *    app-store CLI while the inventory listed the Nest api and the Next web app)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, it, expect } from 'vitest'
import { staticProposalComplaints, type RecipeAppInventoryEntry } from '@truecourse/guard-generator'

/**
 * A repo whose compose files mirror the 2026-08-21 cal.diy/documenso layout:
 * a NAMESPACED test compose (top-level `name:`), the dev compose that pins
 * `container_name:` but no project name, and a namespaced reference compose.
 */
const dirs: string[] = []
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
function composeRepo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-static-compose-'))
  dirs.push(r)
  fs.mkdirSync(path.join(r, 'docker/testing'), { recursive: true })
  fs.mkdirSync(path.join(r, 'docker/development'), { recursive: true })
  fs.mkdirSync(path.join(r, 'reference/seed'), { recursive: true })
  fs.writeFileSync(path.join(r, 'docker/testing/compose.yml'), 'name: acme-testing\nservices:\n  database:\n    image: postgres\n')
  fs.writeFileSync(path.join(r, 'docker/development/compose.yml'), 'services:\n  database:\n    container_name: database\n    image: postgres\n')
  fs.writeFileSync(path.join(r, 'reference/seed/compose.yml'), 'name: tc-ref-acme\nservices:\n  database:\n    image: postgres\n')
  return r
}

const APPS: RecipeAppInventoryEntry[] = [
  { dir: 'apps/api/v2', pkg: '@calcom/api-v2', framework: 'nest', prefixes: ['/health', '/v2', '/v2/bookings'] },
  { dir: 'apps/web', pkg: '@calcom/web', framework: 'next', prefixes: ['/api', '/api/auth'] },
  { dir: 'packages/app-store', pkg: '@calcom/app-store', framework: 'other', prefixes: [] },
]

describe('staticProposalComplaints — inline-eval argvs', () => {
  it('refuses `node -e` as a server, however the code inside is spelled', () => {
    // The documenso payload verbatim: comma-operator style, written specifically
    // to slip past the shell-operator rule. The eval FLAG is the refusal, so the
    // spelling of the code no longer matters.
    const complaints = staticProposalComplaints({
      build: 'npm run build -w @documenso/docs',
      api: {
        serve: [
          'node',
          '-e',
          "require('http').createServer(function(req,res){res.writeHead(200,{'content-type':'text/plain'}),res.end('ok')}).listen(${PORT},'0.0.0.0')",
        ],
        healthPath: '/llms.txt',
      },
    })
    expect(complaints.some((c) => c.includes('api.serve') && c.includes('inline code'))).toBe(true)
  })

  it('refuses eval flags in entry, in named servers, and for other interpreters', () => {
    const entry = staticProposalComplaints({ build: 'true', entry: ['node', '-p', '1'] })
    expect(entry.some((c) => c.includes('entry') && c.includes('inline code'))).toBe(true)

    const named = staticProposalComplaints({
      build: 'true',
      api: { servers: { web: { serve: ['python3', '-c', 'serve()'] } }, defaultServer: 'web' },
    })
    expect(named.some((c) => c.includes('api.servers.web.serve') && c.includes('inline code'))).toBe(true)
  })

  it('accepts a real argv — a repo file is not inline code', () => {
    expect(staticProposalComplaints({ build: 'true', entry: ['node', 'dist/cli.js'] })).toEqual([])
    expect(
      staticProposalComplaints({ build: 'true', api: { serve: ['node', 'dist/server.js'], healthPath: '/health' } }),
    ).toEqual([])
  })
})

describe('staticProposalComplaints — eval one-liner install/build', () => {
  it('refuses a build that is nothing but an eval one-liner (the strapi no-op)', () => {
    const complaints = staticProposalComplaints({
      build: 'node -e "require(\'./package.json\')"',
      entry: ['node', 'examples/getstarted/config/api.js'],
    })
    expect(complaints.some((c) => c.includes('build') && c.includes('eval one-liner'))).toBe(true)
  })

  it('keeps `true` (the sanctioned no-build) and compound commands that start with an eval', () => {
    expect(staticProposalComplaints({ build: 'true', entry: ['node', 'bin.mjs'] })).toEqual([])
    // A compound command does MORE than the eval — the pure form alone is refused.
    expect(
      staticProposalComplaints({ build: 'node -e "prep()" && tsc -b', entry: ['node', 'bin.mjs'] }),
    ).toEqual([])
  })
})

describe('staticProposalComplaints — compose-in-build and host mutations', () => {
  it('refuses docker compose bring-up spelled as a build step (the documenso leak)', () => {
    const complaints = staticProposalComplaints(
      {
        build:
          'docker compose -f docker/testing/compose.yml up -d --wait database && npm run build',
        api: { serve: ['node', 'server.mjs'], healthPath: '/health' },
      },
      undefined,
      composeRepo(),
    )
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('api.services.up')
  })

  it('refuses host-mutating install/build commands, naming what they touch', () => {
    for (const [cmd, marker] of [
      ['corepack enable && yarn install --immutable', 'corepack enable'],
      ['sudo apt-get install -y libvips', 'sudo'],
      ['npm install -g turbo && npm ci', 'global'],
      ['yarn global add rimraf', 'yarn global'],
    ] as const) {
      const complaints = staticProposalComplaints({ install: cmd, build: 'true', entry: ['node', 'bin.mjs'] })
      expect(complaints.length, cmd).toBeGreaterThan(0)
      expect(complaints.join(' '), cmd).toContain(marker)
    }
    // `docker compose down`, plain installs, and workspace-scoped commands stay clean.
    expect(
      staticProposalComplaints({ install: 'npm ci', build: 'npm run build -w @acme/api', entry: ['node', 'bin.mjs'] }),
    ).toEqual([])
  })

  it('refuses sudo anywhere in an argv', () => {
    const complaints = staticProposalComplaints({
      build: 'true',
      api: { serve: ['sudo', 'node', 'server.mjs'] },
    })
    expect(complaints.some((c) => c.includes('sudo'))).toBe(true)
  })

  it('api.services IS the compose home — but the host-mutation rules hold there too', () => {
    const r = composeRepo()
    const clean = staticProposalComplaints(
      {
        build: 'npm run build',
        api: {
          serve: ['node', 'server.mjs'],
          healthPath: '/health',
          services: { up: 'docker compose -f docker/testing/compose.yml up -d --wait database', down: 'docker compose -f docker/testing/compose.yml stop', reset: 'docker compose -f docker/testing/compose.yml down -v' },
        },
      },
      undefined,
      r,
    )
    expect(clean).toEqual([])

    const escalating = staticProposalComplaints({
      build: 'true',
      api: { serve: ['node', 's.mjs'], services: { up: 'sudo docker compose up -d' } },
    })
    expect(escalating.some((c) => c.includes('api.services.up') && c.includes('sudo'))).toBe(true)

    // The documenso incident verbatim: `docker rm -f <global name>` to free a
    // container name — it removed the developer's running cal.diy database.
    const collisionHammer = staticProposalComplaints(
      {
        build: 'true',
        api: {
          serve: ['node', 's.mjs'],
          services: { up: 'docker rm -f database || true && docker compose -f docker/development/compose.yml up -d --wait database' },
        },
      },
      undefined,
      r,
    )
    expect(collisionHammer.some((c) => c.includes('api.services.up') && c.includes('docker rm'))).toBe(true)
  })
})

describe('staticProposalComplaints — the compose NAMESPACE rule (cal.diy 2026-08-21)', () => {
  const serve = { serve: ['node', 's.mjs'] as string[], healthPath: '/health' }

  it('refuses the incident verbatim: a bare `docker compose up/stop` against the default project', () => {
    // The verified-green services block that recreated the developer's live
    // redis on a new port and left it stopped.
    const complaints = staticProposalComplaints(
      {
        build: 'true',
        api: {
          ...serve,
          services: {
            up: 'docker compose -f reference/seed/compose.yml up -d --wait database && REDIS_PORT=6380 docker compose up -d --wait redis',
            down: 'docker compose -f reference/seed/compose.yml stop database && REDIS_PORT=6380 docker compose stop redis',
          },
        },
      },
      undefined,
      composeRepo(),
    )
    // The namespaced reference-compose halves stay legal; the bare halves are
    // refused in BOTH up and down.
    expect(complaints.filter((c) => c.includes('project namespace'))).toHaveLength(2)
    expect(complaints.some((c) => c.includes('api.services.up'))).toBe(true)
    expect(complaints.some((c) => c.includes('api.services.down'))).toBe(true)
  })

  it('accepts `-p <project>` — including the stdin `-f -` shape documenso used legitimately', () => {
    const complaints = staticProposalComplaints(
      {
        build: 'true',
        api: {
          ...serve,
          services: {
            up: "sed -e '/container_name: database/d' docker/development/compose.yml | docker compose -p acme-truecourse -f - up -d --wait database",
            down: "sed -e '/container_name: database/d' docker/development/compose.yml | docker compose -p acme-truecourse -f - stop database",
            reset: "sed -e '/container_name: database/d' docker/development/compose.yml | docker compose -p acme-truecourse -f - down -v",
          },
        },
      },
      undefined,
      composeRepo(),
    )
    expect(complaints).toEqual([])
  })

  it('refuses `-f -` (stdin) without `-p`, and an `-f` file that pins no top-level name:', () => {
    const r = composeRepo()
    const stdin = staticProposalComplaints(
      { build: 'true', api: { ...serve, services: { up: 'cat c.yml | docker compose -f - up -d' } } },
      undefined,
      r,
    )
    expect(stdin.some((c) => c.includes('project namespace'))).toBe(true)

    const devCompose = staticProposalComplaints(
      { build: 'true', api: { ...serve, services: { up: 'docker compose -f docker/development/compose.yml up -d --wait database' } } },
      undefined,
      r,
    )
    expect(devCompose.some((c) => c.includes('project namespace') && c.includes('docker/development/compose.yml'))).toBe(true)
  })

  it('without a repoRoot an `-f` file cannot be verified and counts as unpinned', () => {
    const complaints = staticProposalComplaints({
      build: 'true',
      api: { ...serve, services: { up: 'docker compose -f docker/testing/compose.yml up -d' } },
    })
    expect(complaints.some((c) => c.includes('project namespace'))).toBe(true)
  })
})

describe('staticProposalComplaints — the workspace inventory rule', () => {
  it('refuses an entry-only proposal when the inventory lists routed HTTP services', () => {
    const complaints = staticProposalComplaints(
      { build: 'yarn workspace @calcom/app-store-cli build', entry: ['node', 'packages/app-store-cli/dist/cli.js'] },
      APPS,
    )
    const apiComplaints = complaints.filter((c) => c.includes('no `api` block'))
    expect(apiComplaints).toHaveLength(1)
    expect(apiComplaints[0]).toContain('apps/api/v2')
    // The browser-app rule fires beside it: the inventory ships a next app too.
    expect(complaints.some((c) => c.includes('no `web` block'))).toBe(true)
  })

  it('never refuses partial coverage — declaring ONE of several routed apps is a valid recipe', () => {
    const complaints = staticProposalComplaints(
      { build: 'true', api: { serve: ['node', 'dist/main.js'], healthPath: '/health' } },
      APPS,
    )
    expect(complaints.filter((c) => c.includes('no `api` block'))).toEqual([])
  })

  it('says nothing for a genuinely CLI-only workspace (no routed apps) or without an inventory', () => {
    const cliOnly: RecipeAppInventoryEntry[] = [{ dir: 'packages/cli', framework: 'other', prefixes: [] }]
    expect(staticProposalComplaints({ build: 'true', entry: ['node', 'bin.mjs'] }, cliOnly)).toEqual([])
    expect(staticProposalComplaints({ build: 'true', entry: ['node', 'bin.mjs'] })).toEqual([])
  })
})
