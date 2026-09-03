/**
 * THE BROWSER PREFLIGHT (plan item 139): a missing Chromium is judged ONCE,
 * before any worker session or web build is paid for — not discovered inside
 * every web worker (documenso 2026-08-27: 130 web sessions each probed their
 * way to the same missing binary and retired 117 flows). The affected flows
 * stay unsettled, so the generate after the install re-attempts them.
 *
 * Deliberately browser-free: the preflight is injected through its test seam,
 * and the re-attempt run ends `blocked`, which executes nothing.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readManifest } from '@truecourse/guard-runner'
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

/** A web interface over the fixture app's home screen — the mapper-derived shape. */
function webInterface(): Interface {
  const shape = {
    type: 'web' as const,
    entry: { command: ['/'] },
    steps: [{ kind: 'navigate' as const, route: '/' }],
  }
  return { id: 'web/home', title: 'Home', ...shape, fingerprint: interfaceFingerprint(shape) }
}

function seed(webOverrides: { build?: string } = {}): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r, { web: { serve: ['node', FIXTURE_WEB_SERVER], healthPath: '/health', ...webOverrides } })
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

describe('generateGuards — the web browser preflight', () => {
  it('skips every web worker on a missing browser — one loud error, flows left unsettled, no web build', async () => {
    const r = seed({ build: `node -e "require('fs').writeFileSync('web-built.txt','yes')"` })
    const sessionsSeen: string[] = []

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, webInterface()),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        sessionsSeen.push(task.workItem)
        return undefined
      }),
      browserPreflight: async () => ({ ok: false, reason: 'no chromium (test)' }),
    })

    // No session was spent discovering a machine fact, and nothing was written.
    expect(sessionsSeen).toEqual([])
    expect(res.written).toEqual([])
    // ONE loud error carrying the remedy — never one copy per flow.
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0].message).toMatch(/web surface cannot be driven/)
    expect(res.errors[0].message).toMatch(/no chromium \(test\)/)
    // The flow records no inputs hash, so the next generate re-attempts it.
    expect(res.flows.unsettled).toBe(1)
    const manifest = readManifest(r)
    expect(manifest?.flows).toHaveLength(1)
    expect(manifest?.flows[0]?.generationInputsHash).toBeNull()
    // The client compile was not paid for either.
    expect(fs.existsSync(path.join(r, 'web-built.txt'))).toBe(false)
  }, 60_000)

  it('the next generate re-attempts the skipped flows once the browser exists', async () => {
    const r = seed()
    await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, webInterface()),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async () => undefined),
      browserPreflight: async () => ({ ok: false, reason: 'no chromium (test)' }),
    })

    // Nothing in the repo moved — only the browser appeared. The null inputs
    // hash is what makes the flow count as changed again.
    const sessionsSeen: string[] = []
    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, webInterface()),
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        sessionsSeen.push(task.workItem)
        return {
          kind: 'outcome',
          outcome: { kind: 'blocked', perMilestone: [{ order: 1, capability: 'credentials' }] },
        }
      }),
      browserPreflight: async () => ({ ok: true }),
    })

    expect(sessionsSeen.some((w) => w.endsWith(':web'))).toBe(true)
    expect(res.errors).toEqual([])
  }, 60_000)
})
