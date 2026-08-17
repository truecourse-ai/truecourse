/**
 * THE RUN — interface authoring as agent sessions, end to end, with a SCRIPTED
 * driver in place of a model. What is under test is everything around the model:
 * the work list, the per-place session, the tools it reaches the repository
 * with, the validation gate, the fold into the committed authored file, and what
 * a failing session costs (its own place, and nothing else).
 *
 * The driver script calls the session's real tools — the shell hands the driver
 * the wrapped tool set — so `check_draft` and `read_file` are exercised through
 * the loop exactly as a model would reach them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
  TurnUsage,
} from '../../packages/agent-loop/src/index'
import { authorWebInterfaces, planWorkItems } from '../../packages/interface-author/src/author'
import type { AuthoredFragment } from '../../packages/interface-author/src/draft'
import { InterfacesFileSchema, type InterfacesFile } from '../../packages/shared/src/index'
import {
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
  mergeInterfaceCatalogs,
  readAuthoredInterfaceCatalog,
} from '@truecourse/guard-runner'

// ---------------------------------------------------------------------------
// a repository with two screens and one page module
// ---------------------------------------------------------------------------

let repo: string

const DERIVED: InterfacesFile = {
  version: 2,
  generatedAt: '2026-08-17T00:00:00.000Z',
  recipeFingerprint: 'sha256:recipe',
  interfaces: [
    {
      id: 'api/post-api-repos',
      type: 'api',
      title: 'register a repository',
      entry: { method: 'POST', path: '/api/repos' },
      steps: [{ kind: 'request', method: 'POST', path: '/api/repos' }],
      fingerprint: 'sha256:api-post-repos',
    },
  ],
  resources: {
    web: [
      { id: 'root', kind: 'screen', title: '/', address: '/' },
      { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}' },
    ],
  },
  source: { api: 'tree', web: 'tree' },
}

const HOME_TASK = {
  id: 'web/add-repository-by-path',
  type: 'web' as const,
  title: 'Register a repository from its path',
  group: 'home',
  entry: { method: 'GET', path: '/' },
  steps: [
    { kind: 'input' as const, target: 'textbox "Repository path"' },
    { kind: 'activate' as const, target: 'button "Add Repository"' },
  ],
  at: 'root',
  endState: 'repository-registered',
  apiEffects: ['api/post-api-repos'],
}

const HOME_FRAGMENT: AuthoredFragment = {
  interfaces: [HOME_TASK],
  states: [
    { id: 'repository-registered', description: 'The repository is registered and on the home grid.' },
  ],
  unresolved: ['the icon-only settings control has no accessible name'],
}

const REPORT_FRAGMENT: AuthoredFragment = {
  interfaces: [
    {
      id: 'web/open-rules-panel',
      type: 'web',
      title: 'Open the rules panel from the repository report',
      group: 'repos',
      entry: { method: 'GET', path: '/repos/{repoId}' },
      steps: [{ kind: 'activate', target: 'button "Browse Rules"' }],
      at: 'repos-repoid',
      to: 'rules-dialog',
    },
  ],
  resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid' }],
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iface-author-'))
  fs.mkdirSync(path.dirname(guardInterfacesPath(repo)), { recursive: true })
  fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(DERIVED))
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(repo, 'src', 'Home.tsx'),
    `export function Home() {
  return (
    <form onSubmit={() => api.addRepo(path)}>
      <input aria-label="Repository path" value={path} />
      <button type="submit">Add Repository</button>
    </form>
  )
}\n`,
  )
})

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// the scripted driver + an in-memory transcript store
// ---------------------------------------------------------------------------

const usage = (): TurnUsage => ({
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0,
  costSource: 'unpriced',
})

/** What one work item's session does. `workItem` is `web:<placeId>`. */
type Script = (workItem: string, input: SessionRunInput) => Promise<DriverResult>

function scriptedDriver(script: Script): { driver: SessionDriver; seen: SessionRunInput[] } {
  const seen: SessionRunInput[] = []
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    runSession(input) {
      seen.push(input)
      const done = (async () => {
        await new Promise((r) => setTimeout(r, 0))
        return script(placeOf(input), input)
      })()
      return {
        done,
        status: () => 'running' as const,
        steer: () => {},
        interrupt: async () => {},
      }
    },
  }
  return { driver, seen }
}

/** The place the briefing names — the driver's stand-in for the model reading it. */
function placeOf(input: SessionRunInput): string {
  const match = /place\s+(\S+)/.exec(input.initialMessages.join('\n'))
  return match ? match[1] : ''
}

/** Call a session tool the way a driver does, recording the turn + result. */
async function callTool(
  input: SessionRunInput,
  name: string,
  args: unknown,
): Promise<string> {
  const tool = input.def.tools.find((t) => t.name === name)!
  input.onEvent({ type: 'assistant-turn', toolCall: { name, args }, usage: usage() })
  const result = await tool.execute(args, {
    workItem: '',
    signal: input.signal,
    dispatchChild: () => {
      throw new Error('not used')
    },
  })
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError })
  return result.content
}

function memoryPersistence(): {
  persistence: SessionPersistence
  events: Map<string, SessionEvent[]>
  index: Map<string, SessionIndexEntry>
} {
  const events = new Map<string, SessionEvent[]>()
  const index = new Map<string, SessionIndexEntry>()
  return {
    events,
    index,
    persistence: {
      appendEvent(sessionId, event) {
        events.set(sessionId, [...(events.get(sessionId) ?? []), event])
      },
      updateIndex(entry) {
        index.set(entry.sessionId, entry)
      },
      readEvents: (sessionId) => events.get(sessionId) ?? [],
    },
  }
}

function readAuthoredFile(): InterfacesFile {
  return JSON.parse(fs.readFileSync(guardAuthoredInterfacesPath(repo), 'utf-8'))
}

// ---------------------------------------------------------------------------

describe('the work list', () => {
  it('is every derived screen, with the tasks already authored on it', () => {
    const authored: InterfacesFile = {
      ...DERIVED,
      interfaces: [{ ...HOME_TASK, fingerprint: 'sha256:home' }],
      resources: undefined,
      source: undefined,
      states: { web: [{ id: 'repository-registered', description: 'registered' }] },
    }
    expect(planWorkItems(DERIVED, authored).map((item) => [item.place.id, item.existing])).toEqual([
      ['root', ['web/add-repository-by-path']],
      ['repos-repoid', []],
    ])
  })
})

describe('a session that authors', () => {
  it('reads the repo through its tools, checks its draft, and lands it in the committed file', async () => {
    const { persistence, events, index } = memoryPersistence()
    const toolCalls: string[] = []
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
      toolCalls.push(await callTool(input, 'list_places', {}))
      toolCalls.push(await callTool(input, 'read_file', { path: 'src/Home.tsx' }))
      toolCalls.push(await callTool(input, 'check_draft', HOME_FRAGMENT))
      input.onEvent({ type: 'assistant-turn', text: 'done', usage: usage() })
      return { kind: 'outcome', value: HOME_FRAGMENT }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })

    // The tools really read this repository.
    expect(toolCalls[0]).toContain('root')
    expect(toolCalls[1]).toContain('aria-label="Repository path"')
    expect(toolCalls[2]).toContain('The draft is valid')

    const home = result.places.find((p) => p.placeId === 'root')!
    expect(home.status).toBe('authored')
    expect(home.taskIds).toEqual(['web/add-repository-by-path'])
    expect(home.unresolved).toEqual(['the icon-only settings control has no accessible name'])
    expect(result.authored).toBe(1)

    // The committed file carries the task, its state registry, and a computed
    // fingerprint — and no `origin`, which only the merge may stamp.
    const file = readAuthoredFile()
    expect(file.interfaces.map((i) => i.id)).toEqual(['web/add-repository-by-path'])
    expect(file.interfaces[0].fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect('origin' in file.interfaces[0]).toBe(false)
    expect(file.states!.web.map((s) => s.id)).toEqual(['repository-registered'])

    // It reads back as a catalog half, and the MERGE is a valid catalog: the
    // task's `at` resolves against a place the derivation owns.
    expect(readAuthoredInterfaceCatalog(repo)!.interfaces).toHaveLength(1)
    const merged = mergeInterfaceCatalogs(DERIVED, readAuthoredInterfaceCatalog(repo))
    expect(() => InterfacesFileSchema.parse(merged)).not.toThrow()
    expect(merged.interfaces.find((i) => i.id === 'web/add-repository-by-path')!.origin).toBe('authored')

    // Every session left a transcript and an index row.
    expect(events.size).toBe(2)
    expect([...index.values()].map((row) => row.kind)).toEqual([
      'guard-interfaces.web-tasks',
      'guard-interfaces.web-tasks',
    ])
    expect([...index.values()][0].workItem).toBe('web:root')
  })

  it('sees the earlier place\'s work — a second session cannot author the same task twice', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place, input) => {
      if (place === 'root') return { kind: 'outcome', value: HOME_FRAGMENT }
      // The second place tries to hand back the first place's task.
      const check = await callTool(input, 'check_draft', HOME_FRAGMENT)
      expect(check).toContain('is the same task as `web/add-repository-by-path`')
      return { kind: 'outcome', value: HOME_FRAGMENT }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })
    expect(result.places.map((p) => p.status)).toEqual(['authored', 'rejected'])
    expect(result.places[1].problems.join('\n')).toContain('is the same task as')
    // The rejection changed nothing on disk.
    expect(readAuthoredFile().interfaces).toHaveLength(1)
  })
})

describe('an outcome that breaks a rule', () => {
  it('is dropped whole, with the reasons, and nothing is written', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place) =>
      place === 'root'
        ? {
            kind: 'outcome',
            value: {
              interfaces: [{ ...HOME_TASK, steps: [{ kind: 'activate', target: '#add-repo' }] }],
            } satisfies AuthoredFragment,
          }
        : { kind: 'outcome', value: { interfaces: [] } },
    )

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0].status).toBe('rejected')
    expect(result.places[0].problems.join('\n')).toContain('is not `<role> "<accessible name>"`')
    expect(result.authored).toBe(0)
    expect(fs.existsSync(guardAuthoredInterfacesPath(repo))).toBe(false)
  })

  it('records an empty fragment as an honest result, not a failure', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({
      kind: 'outcome',
      value: { interfaces: [], unresolved: ['no module renders this address'] },
    }))
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0]).toMatchObject({
      status: 'empty',
      unresolved: ['no module renders this address'],
    })
  })
})

describe('a session that fails', () => {
  it('costs its own place and no other', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place) =>
      place === 'root'
        ? {
            kind: 'failure',
            failure: { kind: 'transport', detail: 'connection reset', class: 'provider', retryability: 'transient' },
          }
        : { kind: 'outcome', value: REPORT_FRAGMENT },
    )

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })
    expect(result.places.map((p) => [p.placeId, p.status])).toEqual([
      ['root', 'failed'],
      ['repos-repoid', 'authored'],
    ])
    expect(result.places[0].problems[0]).toContain('the provider failed (provider): connection reset')
    expect(readAuthoredFile().interfaces.map((i) => i.id)).toEqual(['web/open-rules-panel'])
    // The dialog the session declared travels with it, or `to` names nothing.
    expect(readAuthoredFile().resources!.web.map((r) => r.id)).toEqual(['rules-dialog'])
  })
})

describe('re-running', () => {
  it('skips the places that already carry tasks, and re-authors them on --replace', async () => {
    const { persistence } = memoryPersistence()
    const script: Script = async (place) =>
      place === 'root'
        ? { kind: 'outcome', value: HOME_FRAGMENT }
        : { kind: 'outcome', value: { interfaces: [] } }

    await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(script).driver, persistence })

    const second = await authorWebInterfaces({
      repoRoot: repo,
      driver: scriptedDriver(script).driver,
      persistence,
    })
    expect(second.skipped).toEqual(['root'])
    expect(second.places.map((p) => p.placeId)).toEqual(['repos-repoid'])

    // `--replace` re-authors it: the same id may land again, in place.
    const third = await authorWebInterfaces({
      repoRoot: repo,
      driver: scriptedDriver(async (place) =>
        place === 'root'
          ? {
              kind: 'outcome',
              value: { ...HOME_FRAGMENT, interfaces: [{ ...HOME_TASK, title: 'Add a repository by path' }] },
            }
          : { kind: 'outcome', value: { interfaces: [] } },
      ).driver,
      persistence,
      replace: true,
    })
    expect(third.places.find((p) => p.placeId === 'root')!.status).toBe('authored')
    const file = readAuthoredFile()
    expect(file.interfaces).toHaveLength(1)
    expect(file.interfaces[0].title).toBe('Add a repository by path')
  })

  it('refuses a place the catalog does not have', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } }))
    await expect(
      authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['nowhere'] }),
    ).rejects.toThrow(/no such place: nowhere/)
  })
})

describe('the tools are read-only and bounded to the repository', () => {
  it('refuses a path outside the repo and reports it as a tool error the session can revise on', async () => {
    const { persistence } = memoryPersistence()
    let escape = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      escape = await callTool(input, 'read_file', { path: '../../etc/passwd' })
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(escape).toContain('is outside the repository')
  })

  it('searches the working tree', async () => {
    const { persistence } = memoryPersistence()
    let hits = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      hits = await callTool(input, 'search_repo', { query: 'Add Repository', glob: '.tsx' })
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(hits).toContain('src/Home.tsx:')
  })
})
