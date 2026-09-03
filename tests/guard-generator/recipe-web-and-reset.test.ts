/**
 * The hands-off recipe rules (documenso 2026-08-30: a from-scratch setup
 * produced an api-only recipe — no `web` block, no `services.reset` — because
 * the web block was the one piece setup never authored and the repair doctrine
 * never taught reset):
 *  - a proposal with no `web` block for a repo that ships a browser app is
 *    refused statically;
 *  - a compose-managed `services.up` without `reset` is refused statically;
 *  - `verifyProposal` boots a declared web surface and polls its healthPath.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, it, expect } from 'vitest'
import {
  browserAppEvidence,
  discoverRecipe,
  staticProposalComplaints,
  verifyProposal,
  type RecipeAppInventoryEntry,
  type RecipeProposal,
  type RecipeRepairFn,
} from '@truecourse/guard-generator'
import { FIXTURE_API_SERVER, FIXTURE_WEB_SERVER } from './helpers.js'

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})
function tempRepo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-web-reset-'))
  dirs.push(r)
  return r
}

const BROWSER_APPS: RecipeAppInventoryEntry[] = [
  { dir: 'apps/remix', pkg: '@acme/remix', framework: 'remix', prefixes: ['/api'] },
  { dir: 'apps/openpage-api', framework: 'other', prefixes: ['/health'] },
]
const API_ONLY_APPS: RecipeAppInventoryEntry[] = [
  { dir: 'apps/api', framework: 'nest', prefixes: ['/v2'] },
]

const API_BLOCK = { serve: ['node', 'dist/server.js'], healthPath: '/health' }

describe('the browser-app rule', () => {
  it('refuses a webless proposal when the inventory ships a next/remix app', () => {
    const complaints = staticProposalComplaints({ build: 'true', api: API_BLOCK }, BROWSER_APPS)
    expect(complaints.some((c) => c.includes('no `web` block') && c.includes('apps/remix — remix'))).toBe(true)
  })

  it('a declared web block satisfies it', () => {
    const complaints = staticProposalComplaints(
      { build: 'true', api: API_BLOCK, web: { serve: ['node', 'dist/server.js'], healthPath: '/signin' } },
      BROWSER_APPS,
    )
    expect(complaints.filter((c) => c.includes('no `web` block'))).toEqual([])
  })

  it('stays quiet for an api-only workspace', () => {
    const complaints = staticProposalComplaints({ build: 'true', api: API_BLOCK }, API_ONLY_APPS)
    expect(complaints.filter((c) => c.includes('no `web` block'))).toEqual([])
  })

  it('a single-package repo is judged by its root package.json dependencies', () => {
    const r = tempRepo()
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }))
    expect(browserAppEvidence(undefined, r)).toEqual(['root package.json depends on next'])
    const complaints = staticProposalComplaints({ build: 'true', api: API_BLOCK }, undefined, r)
    expect(complaints.some((c) => c.includes('no `web` block'))).toBe(true)

    const plain = tempRepo()
    fs.writeFileSync(path.join(plain, 'package.json'), JSON.stringify({ dependencies: { express: '4.0.0' } }))
    expect(browserAppEvidence(undefined, plain)).toEqual([])
  })
})

describe('the services.reset rule', () => {
  // A namespaced test compose, so the compose-namespace rule stays quiet and the
  // reset rule's complaint is the one under test.
  function composeRepo(): string {
    const r = tempRepo()
    fs.mkdirSync(path.join(r, 'docker/testing'), { recursive: true })
    fs.writeFileSync(
      path.join(r, 'docker/testing/compose.yml'),
      'name: acme-testing\nservices:\n  database:\n    image: postgres\n',
    )
    return r
  }

  it('refuses a compose-managed up without reset, naming the exact wipe command', () => {
    const r = composeRepo()
    const complaints = staticProposalComplaints(
      {
        build: 'true',
        api: { ...API_BLOCK, services: { up: 'docker compose -f docker/testing/compose.yml up -d --wait database' } },
      },
      undefined,
      r,
    )
    const hit = complaints.find((c) => c.includes('declares no `reset`'))
    expect(hit).toBeTruthy()
    expect(hit).toContain('docker compose -f docker/testing/compose.yml down -v')
  })

  it('a declared reset satisfies it, and a non-compose up never fires it', () => {
    const r = composeRepo()
    const withReset = staticProposalComplaints(
      {
        build: 'true',
        api: {
          ...API_BLOCK,
          services: {
            up: 'docker compose -f docker/testing/compose.yml up -d --wait database',
            reset: 'docker compose -f docker/testing/compose.yml down -v',
          },
        },
      },
      undefined,
      r,
    )
    expect(withReset.filter((c) => c.includes('declares no `reset`'))).toEqual([])

    const script = staticProposalComplaints(
      { build: 'true', api: { ...API_BLOCK, services: { up: './scripts/start-db.sh' } } },
      undefined,
      r,
    )
    expect(script.filter((c) => c.includes('declares no `reset`'))).toEqual([])
  })
})

describe('verifyProposal — the web boot stage', () => {
  it('boots a declared web surface and passes on a rendering healthPath', async () => {
    const r = tempRepo()
    const proposal: RecipeProposal = {
      build: 'true',
      api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
      web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/' },
    }
    const verdict = await verifyProposal(r, proposal)
    expect(verdict.ok).toBe(true)
  }, 60_000)

  it('a repaired proposal keeps its web block all the way into recipe.json', async () => {
    // The documenso 2026-08-30 regression: the session's verified outcome
    // carried `web`, and the field-by-field recipe construction dropped it on
    // the write — an api-only recipe.json from a proposal that declared web.
    const r = tempRepo()
    fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'webby', version: '1.0.0' }))
    const proposal: RecipeProposal = {
      build: 'true',
      api: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
      web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/' },
    }
    const repair: RecipeRepairFn = async () => ({ proposal })
    const res = await discoverRecipe(r, async () => {
      throw new Error('the one-shot runner must not be called')
    }, { repair })
    expect(res.status).toBe('discovered')
    const written = JSON.parse(fs.readFileSync(path.join(r, '.truecourse', 'scenarios', 'recipe.json'), 'utf-8'))
    expect(written.web).toEqual({ serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/' })
  }, 120_000)

  it('fails at the web boot stage when the healthPath never answers', async () => {
    const r = tempRepo()
    const proposal: RecipeProposal = {
      build: 'true',
      // Web-only: the stage must run even with no api block.
      web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/definitely-not-a-page', readyTimeoutMs: 4000 },
    }
    const verdict = await verifyProposal(r, proposal)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.stage).toBe('web boot')
      expect(verdict.reason).toContain('/definitely-not-a-page')
    }
  }, 60_000)
})
