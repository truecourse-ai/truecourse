/**
 * THE WEB BRIEFING CARRIES THE SEED CATALOG (plan item 140): a web worker can
 * only reach a signed-in world through the login principal the seed minted, and
 * it can only know that principal exists if the briefing says so. The first
 * documenso web run proved the inverse — the fixture catalog was api-gated, the
 * web system prompt said "no credentials", and 114 of 119 web flows blocked on
 * exactly that word while the seeded user sat in the database.
 *
 * Browser-free: the scripted worker reads its briefing and ends `blocked`,
 * which executes nothing.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { interfaceFingerprint, type Interface } from '@truecourse/shared'
import {
  FIXTURE_WEB_SERVER,
  extractSessionBy,
  flowWorkerSessionOf,
  interfacesOf,
  makeTempRepo,
  rmrf,
  runGenerate,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/app.md'
const DOC_CONTENT = ['## home', 'The home page shows the heading "Guard Web Fixture".'].join('\n')

function webInterface(): Interface {
  const shape = {
    type: 'web' as const,
    entry: { command: ['/'] },
    steps: [{ kind: 'navigate' as const, route: '/' }],
  }
  return { id: 'web/home', title: 'Home', ...shape, fingerprint: interfaceFingerprint(shape) }
}

describe('generateGuards — the web briefing advertises the seed fixtures', () => {
  it('a web worker is told the seeded login fixture exists', async () => {
    const r = makeTempRepo()
    repos.push(r)
    writeRecipe(r, {
      web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health' },
      api: {
        serve: ['node', FIXTURE_WEB_SERVER],
        seed: {
          command: 'node guard-seed.mjs',
          provides: { fixtures: { org: ['id', 'slug'], webUser: ['email', 'password'] } },
        },
      },
    })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const briefings: string[] = []
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, webInterface()),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        briefings.push(await task.prepare())
        return {
          kind: 'outcome',
          outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'credentials' }] },
        }
      }),
      browserPreflight: async () => ({ ok: true }),
    })

    expect(briefings.length).toBeGreaterThan(0)
    const briefing = briefings[0]
    expect(briefing).toContain('FIXTURES AVAILABLE')
    expect(briefing).toContain('- webUser: fields `email`, `password`')
    expect(briefing).toMatch(/SIGNED-IN world/)
  }, 60_000)
})
