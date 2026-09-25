/**
 * THE RUN — interface authoring as agent sessions, end to end, with a SCRIPTED
 * driver in place of a model. What is under test is everything around the model:
 * the work list, the per-place session, the tools it reaches the repository
 * with, the validation gate, the fold into the authored file, and what
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
import {
  INTERFACE_AUTHOR_CACHE_NAME,
  authorWebInterfaces,
  planWorkItems,
} from '../../packages/core/src/services/interface-author/author'
import { installMemoryKvCache, resetKvCacheStore, type MemoryKvCacheStore } from '../helpers/memory-kv-cache'
import { readGuardInterfaces } from '../../packages/core/src/commands/guard-read'
import { collectGuardSetupBundle, materializeGuardSetupBundle } from '../../packages/core/src/services/guard-setup/bundle'
import { setGuardStore, type GuardStore } from '../../packages/core/src/lib/guard-store'
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store'
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays'
import { buildScreens, screenShowRows } from '../../apps/dashboard/client/src/lib/interface-pom'
import type { AuthoredFragment } from '../../packages/core/src/services/interface-author/draft'
import type { LiveScreens } from '../../packages/core/src/services/interface-author/live-screen'
import { InterfacesFileSchema, interfaceFingerprint, type InterfacesFile } from '../../packages/shared/src/index'
import {
  guardAuthoredInterfacesPath,
  authoringRecipeContract,
  guardInterfacesPath,
  mergeInterfaceCatalogs,
  readAuthoredInterfaceCatalog,
  staleAuthoredPlaceDiagnostics,
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

/** The four empty kinds — what a place that shows nothing of them claims. */
const NO_READABLES = { markers: [], elements: [], controls: [], rows: [] } as const

const HOME_TASK = {
  id: 'web/add-repository-by-path',
  type: 'web' as const,
  title: 'Register a repository from its path',
  group: 'home',
  entry: { method: 'GET', path: '/' },
  steps: [
    { kind: 'input' as const, target: { role: 'textbox', name: 'Repository path' } },
    { kind: 'activate' as const, target: { role: 'button', name: 'Add Repository' } },
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
      steps: [{ kind: 'activate', target: { role: 'button', name: 'Browse Rules' } }],
      at: 'repos-repoid',
      to: 'rules-dialog',
    },
  ],
  resources: [{ id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid', readables: NO_READABLES }],
  unresolved: ['"the Rules dialog" lists rules only once a scan ran'],
}

beforeEach(() => {
  installWorkTreeGuardStore()
  installMemoryGuardOverlays()
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
  resetGuardStore()
  resetGuardOverlayStore()
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

/**
 * A driver that runs `script` per session.
 *
 * Two things it does beyond calling the script, both because a real driver does
 * them and the shell's own machinery reads them back:
 *
 * - it records a `user-message` as it ingests each opening message. The shell
 *   probes the transcript for exactly that to decide whether a retry has to
 *   replay the briefing, and it is what lets {@link placeOf} still name the
 *   place on a run that opens with no briefing at all.
 * - it records a `check_draft` tool-result before an outcome, unless the script
 *   already called the tool itself. The session def carries an
 *   `outcomePrecondition` on `check_draft`, so a session that never ran it has
 *   its FIRST outcome refused; a script standing in for a model that followed
 *   the prompt has run it. `checksDraft: false` opts out — that is the model
 *   the precondition exists for.
 */
function scriptedDriver(
  script: Script,
  opts: { checksDraft?: boolean } = {},
): { driver: SessionDriver; seen: SessionRunInput[] } {
  const seen: SessionRunInput[] = []
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      seen.push(input)
      let ranCheckDraft = false
      const observed: SessionRunInput = {
        ...input,
        onEvent: (event) => {
          if (event.type === 'tool-result' && event.toolName === 'check_draft') ranCheckDraft = true
          input.onEvent(event)
        },
      }
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content })
      const done = (async () => {
        await new Promise((r) => setTimeout(r, 0))
        const result = await script(placeOf(input), observed)
        if (result.kind === 'outcome' && !ranCheckDraft && opts.checksDraft !== false) {
          input.onEvent({
            type: 'tool-result',
            toolName: 'check_draft',
            content: 'The draft is valid.',
            isError: false,
          })
        }
        return result
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

/**
 * The place the briefing names — the driver's stand-in for the model reading it.
 * The briefing is the LAST opening message: a cluster's shared pack rides in
 * front of it, and the pack is about several places at once.
 *
 * A CONTINUED run opens with no briefing: the shell's transient retry, its
 * outcome-precondition refusal and the pool's transient re-queue each hand the
 * driver the transcript so far instead. The briefing is in that transcript, as
 * the `user-message` the first run recorded when it ingested it.
 */
function placeOf(input: SessionRunInput): string {
  const openings = [
    input.initialMessages.at(-1) ?? '',
    ...[...(input.resume?.events ?? [])]
      .reverse()
      .flatMap((event) => (event.type === 'user-message' ? [event.content] : [])),
  ]
  for (const opening of openings) {
    const match = /^\s+place\s+(\S+)/m.exec(opening)
    if (match) return match[1]
  }
  return ''
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
  input.onEvent({ type: 'tool-result', toolName: name, content: result.content, isError: result.isError, artifact: result.artifact })
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
    expect(planWorkItems(DERIVED, authored, '').map((item) => [item.place.id, item.existing])).toEqual([
      ['root', ['web/add-repository-by-path']],
      ['repos-repoid', []],
    ])
  })
})

describe('a session that authors', () => {
  it('keeps same-named local actions and dialogs from two concurrent screens', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place, input) => {
      const address = DERIVED.resources!.web.find(r => r.id === place)!.address!
      const draft: AuthoredFragment = {
        interfaces: [{ ...HOME_TASK, id: 'web/save', at: 'editor-dialog', entry: { method: 'GET', path: address } }],
        resources: [{ id: 'editor-dialog', kind: 'dialog', title: 'Editor', of: place, readables: NO_READABLES }],
        states: HOME_FRAGMENT.states,
      }
      const checked = await callTool(input, 'check_draft', draft)
      expect(checked).toContain('Accepted and kept')
      const draftId = /"draftId":"([^"]+)"/.exec(checked)![1]
      return { kind: 'outcome', value: { draftId } }
    })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 2 })
    expect(result.places.every(p => p.status === 'authored')).toBe(true)
    const file = readAuthoredFile()
    expect(file.interfaces).toHaveLength(2)
    expect(new Set(file.interfaces.map(i => i.id)).size).toBe(2)
    expect(new Set(file.interfaces.map(i => i.type === 'web' && i.at)).size).toBe(2)
    expect(file.states?.web).toEqual(HOME_FRAGMENT.states)
    expect(() => InterfacesFileSchema.parse(mergeInterfaceCatalogs(DERIVED, file))).not.toThrow()
  })

  it('persists complete checked actions and states from a compact final reference', async () => {
    const { persistence, events } = memoryPersistence()
    const { driver } = scriptedDriver(async (_place, input) => {
      const checked = await callTool(input, 'check_draft', HOME_FRAGMENT)
      expect(checked).toContain('Accepted and kept')
      const draftId = /"draftId":"([^"]+)"/.exec(checked)![1]
      input.onEvent({ type: 'assistant-turn', toolCall: { name: 'outcome', args: { draftId } }, usage: usage() })
      return { kind: 'outcome', value: { draftId } }
    })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.authored).toBe(1)
    expect(readAuthoredFile().interfaces[0]).toMatchObject({ steps: HOME_TASK.steps, at: HOME_TASK.at, endState: HOME_TASK.endState })
    expect(readAuthoredFile().states?.web).toEqual(HOME_FRAGMENT.states)
    expect([...events.values()].flat().find(e => e.type === 'outcome')).toMatchObject({ value: { interfaces: [expect.objectContaining({ steps: HOME_TASK.steps })] } })
  })

  it('reads the repo through its tools, checks its draft, and lands it in the committed file', async () => {
    const { persistence, events, index } = memoryPersistence()
    const toolCalls: string[] = []
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
      toolCalls.push(await callTool(input, 'read_file', { path: 'src/Home.tsx' }))
      toolCalls.push(await callTool(input, 'check_draft', HOME_FRAGMENT))
      input.onEvent({ type: 'assistant-turn', text: 'done', usage: usage() })
      return { kind: 'outcome', value: HOME_FRAGMENT }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })

    // The tools really read this repository.
    expect(toolCalls[0]).toContain('aria-label="Repository path"')
    expect(toolCalls[1]).toContain('Accepted and kept')

    const home = result.places.find((p) => p.placeId === 'root')!
    expect(home.status).toBe('authored')
    expect(home.taskIds).toEqual(['web/add-repository-by-path'])
    expect(home.unresolved).toEqual(['the icon-only settings control has no accessible name'])
    expect(result.authored).toBe(1)

    // The authored file carries the task, its state registry, and a computed
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

  /**
   * INCREMENTAL CHECKING. A call carries the piece it is about; what passes is
   * kept for the session and is what the next call is checked against, so a fix
   * costs the one interface it fixes instead of the whole catalog. The outcome
   * still names one draft id, and it resolves everything that accumulated.
   */
  it('builds its draft one interface at a time, and the outcome resolves what accumulated', async () => {
    const { persistence } = memoryPersistence()
    const open = {
      id: 'web/open-repository',
      type: 'web' as const,
      title: 'Open a registered repository',
      group: 'home',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'activate' as const, target: { role: 'link' as const, name: 'the repository' } }],
      at: 'root',
      startingState: 'repository-registered',
    }
    const fixedSteps = [
      { kind: 'activate' as const, target: { role: 'link' as const, name: 'Open repository' } },
    ]
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
      expect(await callTool(input, 'check_draft', HOME_FRAGMENT)).toContain('holds 1 task(s)')
      // The second call restates NOTHING of the first, and the draft grows.
      const second = await callTool(input, 'check_draft', { interfaces: [open] })
      expect(second).toContain('holds 2 task(s)')
      expect(second).toContain('add-repository-by-path')
      // A re-sent id CORRECTS that one entry, at the cost of that one entry.
      const fixed = await callTool(input, 'check_draft', {
        interfaces: [{ ...open, steps: fixedSteps }],
      })
      expect(fixed).toContain('holds 2 task(s)')
      const draftId = /"draftId":"([^"]+)"/.exec(fixed)![1]
      return { kind: 'outcome', value: { draftId } }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })

    const home = result.places.find((p) => p.placeId === 'root')!
    expect(home.status).toBe('authored')
    expect(home.taskIds).toHaveLength(2)
    // The first call's unresolved line rode along, as part of the same draft.
    expect(home.unresolved).toEqual(HOME_FRAGMENT.unresolved)
    const file = readAuthoredFile()
    expect(file.interfaces).toHaveLength(2)
    expect(file.interfaces.find((i) => i.title === open.title)!.steps).toEqual(fixedSteps)
    expect(file.interfaces.find((i) => i.title === HOME_TASK.title)!.steps).toEqual(HOME_TASK.steps)
    expect(file.states!.web.map((s) => s.id)).toEqual(['repository-registered'])
  })

  /**
   * A catalog written while a step target was ONE STRING still reads: the
   * string is parsed back into its two fields, the fingerprint it was stored
   * under is unmoved (so every scenario grounded on it still resolves), and the
   * next write puts only the structured form on disk.
   */
  it('reads an authored catalog written with string targets, and rewrites it structured', async () => {
    const legacyTask = {
      id: 'web/browse-rules',
      type: 'web',
      title: 'Browse the rules of a repository',
      entry: { method: 'GET', path: '/repos/{repoId}' },
      steps: [{ kind: 'activate', target: 'button "Browse Rules"' }],
      at: 'repos-repoid',
      fingerprint: interfaceFingerprint({
        type: 'web',
        entry: { method: 'GET', path: '/repos/{repoId}' },
        steps: [{ kind: 'activate', target: { role: 'button', name: 'Browse Rules' } }],
      }),
    }
    fs.writeFileSync(
      guardAuthoredInterfacesPath(repo),
      JSON.stringify({ version: 2, generatedAt: '', recipeFingerprint: '', interfaces: [legacyTask] }),
    )

    // The reader hands back the two fields, under the fingerprint it was stored with.
    const read = readAuthoredInterfaceCatalog(repo)!
    expect(read.interfaces[0].steps).toEqual([
      { kind: 'activate', target: { role: 'button', name: 'Browse Rules' } },
    ])
    expect(read.interfaces[0].fingerprint).toBe(legacyTask.fingerprint)

    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place, input) =>
      place === 'root'
        ? { kind: 'outcome', value: HOME_FRAGMENT }
        : { kind: 'outcome', value: { interfaces: [] } },
    )
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })

    // The string form is gone from disk; the entry is otherwise untouched.
    const written = readAuthoredFile()
    const rewritten = written.interfaces.find((i) => i.id === legacyTask.id)!
    expect(rewritten.steps).toEqual([
      { kind: 'activate', target: { role: 'button', name: 'Browse Rules' } },
    ])
    expect(rewritten.fingerprint).toBe(legacyTask.fingerprint)
    expect(JSON.stringify(written)).not.toContain('button \\"Browse Rules\\"')
  })

  /**
   * What SERIAL folding buys, at `concurrency: 1`: the second session's tools
   * and its `check_draft` run against the catalog the first one already joined,
   * so it is told about the collision while it can still do something about it.
   * A session running BESIDE the first cannot be told — that collision is caught
   * at the fold instead, and costs one task rather than the place (see the pool
   * tests below).
   */
  it('sees the earlier place\'s work — a second session cannot author the same task twice', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place, input) => {
      if (place === 'root') return { kind: 'outcome', value: HOME_FRAGMENT }
      // The second place tries to hand back the first place's task.
      const check = await callTool(input, 'check_draft', HOME_FRAGMENT)
      expect(check).toContain('is the same task as `web/add-repository-by-path`')
      return { kind: 'outcome', value: HOME_FRAGMENT }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 1 })
    expect(result.places.map((p) => p.status)).toEqual(['authored', 'failed'])
    expect(result.places[1].problems.join('\n')).toContain('is the same task as')
    // The rejection changed nothing on disk.
    expect(readAuthoredFile().interfaces).toHaveLength(1)
  })
})

describe('concurrent state definitions', () => {
  it.each([false, true])('repairs a conflicting screen in the same session, check after peer save=%s', async (checkAfterSave) => {
    const { persistence, events, index } = memoryPersistence()
    let draftChecked!: () => void
    const checked = new Promise<void>(resolve => { draftChecked = resolve })
    let rootSaved!: () => void
    const saved = new Promise<void>(resolve => { rootSaved = resolve })
    const home: AuthoredFragment = {
      ...HOME_FRAGMENT,
      resources: [{ id: 'root', kind: 'screen', title: '/', address: '/', readables: NO_READABLES }],
    }
    const detail: AuthoredFragment = {
      ...REPORT_FRAGMENT,
      interfaces: REPORT_FRAGMENT.interfaces.map(task => ({ ...task, startingState: 'repository-registered' })),
      states: [{ id: 'repository-registered', description: 'The requested repository is registered.' }],
      resources: [
        ...REPORT_FRAGMENT.resources!,
        { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}', readables: NO_READABLES },
      ],
    }
    const repaired: AuthoredFragment = {
      ...detail,
      interfaces: detail.interfaces.map(task => ({ ...task, startingState: 'requested-repository-registered' })),
      states: [{ id: 'requested-repository-registered', description: 'The requested repository is registered.' }],
    }
    const { driver, seen } = scriptedDriver(async (place, input) => {
      if (place === 'root') {
        if (input.resume) {
          expect(input.initialMessages.join('\n')).toContain('already names')
          return { kind: 'outcome', value: {
            ...home,
            interfaces: home.interfaces.map(task => ({ ...task, endState: 'listed-repository-registered' })),
            states: [{ ...home.states![0], id: 'listed-repository-registered' }],
          } }
        }
        await checked
        return { kind: 'outcome', value: home }
      }
      if (input.resume) {
        expect(input.initialMessages.join('\n')).toContain('already names')
        expect(await callTool(input, 'check_draft', repaired)).toContain('Accepted and kept')
        return { kind: 'outcome', value: repaired }
      }
      expect(await callTool(input, 'check_draft', detail)).toContain('Accepted and kept')
      draftChecked()
      if (checkAfterSave) {
        await saved
        expect(await callTool(input, 'check_draft', detail)).toContain('already names')
        expect(await callTool(input, 'list_interfaces', { surface: 'web' })).toContain(HOME_TASK.id)
      }
      // Return the previously checked draft, including when both peers finish together.
      return { kind: 'outcome', value: detail }
    })
    const result = await authorWebInterfaces({
      repoRoot: repo, driver, persistence, concurrency: 2,
      onProgress: event => {
        if (event.kind === 'place-done' && event.place.placeId === 'root') rootSaved()
      },
      onSessionEvent: (place, event) => {
        if (event.type === 'outcome') {
          // A completed transcript must describe output already on disk.
          const taskId = place === 'root' ? HOME_TASK.id : REPORT_FRAGMENT.interfaces[0].id
          expect(readAuthoredFile().interfaces.some(task => task.id === taskId)).toBe(true)
        }
      },
    })
    expect(result.places.map(place => place.status)).toEqual(['authored', 'authored'])
    expect(result.authored).toBe(2)
    expect(seen).toHaveLength(3)
    expect(index.size).toBe(2)
    expect([...index.values()].every(session => session.status === 'completed')).toBe(true)
    const file = readAuthoredFile()
    expect(file.resources?.web.filter(place => place.kind === 'screen')).toHaveLength(2)
    expect(file.states?.web).toHaveLength(2)
    const homeState = file.interfaces.find(task => task.id === HOME_TASK.id)?.endState
    const detailState = file.interfaces.find(task => task.id === REPORT_FRAGMENT.interfaces[0].id)?.startingState
    expect(homeState).not.toBe(detailState)
    expect(file.states?.web.find(state => state.id === homeState)?.description).toBe(home.states![0].description)
    expect(file.states?.web.find(state => state.id === detailState)?.description).toBe(detail.states![0].description)
    for (const transcript of events.values()) {
      expect(transcript.filter(event => event.type === 'outcome')).toHaveLength(1)
    }
  })
})

describe('an outcome that breaks a rule', () => {
  it('fails after exhausting corrections, with the reasons and nothing written', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place) =>
      place === 'root'
        ? {
            kind: 'outcome',
            value: {
              interfaces: [{ ...HOME_TASK, at: 'repos-repoid' }],
            } satisfies AuthoredFragment,
          }
        : { kind: 'outcome', value: { interfaces: [] } },
    )

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0].status).toBe('failed')
    expect(result.places[0].problems.join('\n')).toContain('is not a task of `root`')
    expect(result.authored).toBe(0)
    // Nothing of the fragment lands; the ledger keeps the verdict, which is the
    // whole of what the file gains.
    expect(readAuthoredFile().interfaces).toEqual([])
    expect(readAuthoredFile().authoring).toEqual({ root: { status: 'failed', inputFingerprint: expect.any(String) } })
  })

  /**
   * A place with an unstated readable kind is refused rather than completed
   * here: the empty array is a CLAIM about what the session read, and nothing
   * comes back to the screen once its ledger row settles.
   */
  it('turns back a place that leaves a readable kind unstated, and fills none in', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({
      kind: 'outcome',
      value: {
        interfaces: [],
        resources: [{ ...DERIVED.resources!.web[0], readables: { markers: [], elements: [], controls: [] } }],
      } satisfies AuthoredFragment,
    }))

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })

    expect(result.places[0].status).toBe('failed')
    expect(result.places[0].problems.join('\n')).toContain(
      '`root` leaves `rows` unstated — state each of `markers`, `elements`, `controls` and `rows` explicitly, `[]` when this place has none of that kind',
    )
    expect(readAuthoredFile().resources).toBeUndefined()
  })

  it('accepts the same place once every kind is stated', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({
      kind: 'outcome',
      value: {
        interfaces: [],
        resources: [{ ...DERIVED.resources!.web[0], readables: NO_READABLES }],
      } satisfies AuthoredFragment,
    }))

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })

    expect(result.places[0].status).toBe('authored')
    expect(readAuthoredFile().resources!.web[0].readables).toEqual(NO_READABLES)
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

/**
 * ITEM 13. A finding is a code-vs-docs discrepancy, not an authoring complaint:
 * it is about the REPOSITORY, so it survives a fragment that was refused, and it
 * never reaches the catalog — the interface schema has no home for a diagnostic.
 */
describe('the findings a session reports', () => {
  it('rides the place result, joins the run result with its place, and stays out of the catalog', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place) =>
      place === 'root'
        ? {
            kind: 'outcome',
            value: {
              ...HOME_FRAGMENT,
              findings: ['docs/setup.mdx says the path field is a file picker; src/Home.tsx renders a textbox'],
            } satisfies AuthoredFragment,
          }
        : { kind: 'outcome', value: { interfaces: [] } },
    )

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 1 })

    const home = result.places.find((p) => p.placeId === 'root')!
    expect(home.status).toBe('authored')
    expect(home.findings).toEqual([
      'docs/setup.mdx says the path field is a file picker; src/Home.tsx renders a textbox',
    ])
    expect(result.findings).toEqual([
      {
        placeId: 'root',
        note: 'docs/setup.mdx says the path field is a file picker; src/Home.tsx renders a textbox',
      },
    ])
    expect(result.places.find((p) => p.placeId === 'repos-repoid')!.findings).toEqual([])
    // The written half carries interfaces, states and places — never a finding.
    expect(JSON.stringify(readAuthoredFile())).not.toContain('file picker')
  })

  it('survives a fragment the rules refused — the doc bug is real either way', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({
      kind: 'outcome',
      value: {
        interfaces: [{ ...HOME_TASK, at: 'repos-repoid' }],
        findings: ['docs/setup.mdx names a "Import" button src/Home.tsx does not render'],
      } satisfies AuthoredFragment,
    }))
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0].status).toBe('failed')
    expect(result.places[0].findings).toEqual([
      'docs/setup.mdx names a "Import" button src/Home.tsx does not render',
    ])
  })

  /**
   * The two lists are different claims, and the prompt has to keep them apart —
   * `unresolved` is what this session could not establish, a finding is what it
   * established and the repository contradicts. The prompt also has to demand
   * the EARLY `check_draft`: a rule broken at turn 24 costs the place.
   */
  it('is a field the session is told about, beside the early draft check', async () => {
    const { persistence } = memoryPersistence()
    let prompt = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      prompt = input.def.systemPrompt
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(prompt).toContain("`findings` is the fragment's other list, and it is NOT `unresolved`")
    expect(prompt).toContain('Run it EARLY')
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
  it('skips places with tasks and established readable kinds, and re-authors them on --replace', async () => {
    const { persistence } = memoryPersistence()
    const script: Script = async (place) =>
      place === 'root'
        ? { kind: 'outcome', value: { ...HOME_FRAGMENT, resources: [{ ...DERIVED.resources!.web[0], readables: { markers: [], elements: [], controls: [], rows: [] } }] } }
        : { kind: 'outcome', value: { interfaces: [] } }

    await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(script).driver, persistence })

    // Both screens settled: one with tasks, one with the honest empty outcome.
    const second = await authorWebInterfaces({
      repoRoot: repo,
      driver: scriptedDriver(script).driver,
      persistence,
    })
    expect(second.skipped).toEqual(['root', 'repos-repoid'])
    expect(second.places).toEqual([])

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

  /**
   * THE LEDGER. A screen's row says what its last session settled and over which
   * inputs, which is what turns "did this screen ever get a session" from an
   * inference off the file's own contents into something the file states.
   */
  describe('the authoring ledger', () => {
    const fails: Script = async (place) =>
      place === 'root'
        ? { kind: 'failure', failure: { kind: 'transport', detail: 'connection reset', class: 'provider', retryability: 'none' } }
        : { kind: 'outcome', value: REPORT_FRAGMENT }
    /** A driver that must never be asked for a session. */
    const refuses = scriptedDriver(async (place) => {
      throw new Error(`no session should have opened for ${place}`)
    }).driver

    async function firstRun(): Promise<void> {
      const { persistence } = memoryPersistence()
      const result = await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(fails).driver, persistence })
      expect(result.places.map((p) => [p.placeId, p.status])).toEqual([
        ['root', 'failed'],
        ['repos-repoid', 'authored'],
      ])
      const ledger = readAuthoredFile().authoring ?? {}
      expect(Object.fromEntries(Object.entries(ledger).map(([id, row]) => [id, row.status]))).toEqual({
        root: 'failed',
        'repos-repoid': 'authored',
      })
    }

    it('records every screen a run reached, whatever its session made of it', async () => {
      await firstRun()
    })

    it('does not re-open a failed screen on the next run', async () => {
      await firstRun()
      const { persistence } = memoryPersistence()
      const second = await authorWebInterfaces({ repoRoot: repo, driver: refuses, persistence })
      expect(second.places).toEqual([])
      expect(second.skipped).toEqual(['root', 'repos-repoid'])
    })

    it('re-opens exactly the failed screen whose derived place moved', async () => {
      await firstRun()
      fs.writeFileSync(
        guardInterfacesPath(repo),
        JSON.stringify({
          ...DERIVED,
          resources: { web: [{ ...DERIVED.resources!.web[0], address: '/home' }, DERIVED.resources!.web[1]] },
        }),
      )
      const { persistence } = memoryPersistence()
      const started: string[] = []
      const result = await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: { interfaces: [] } }
        }).driver,
        persistence,
      })
      expect(started).toEqual(['root'])
      expect(result.places.map((p) => [p.placeId, p.status])).toEqual([['root', 'empty']])
    })

    it('re-opens a failed screen on a refresh, and nothing else', async () => {
      await firstRun()
      const { persistence } = memoryPersistence()
      const started: string[] = []
      await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: HOME_FRAGMENT }
        }).driver,
        persistence,
        refresh: true,
      })
      expect(started).toEqual(['root'])
      expect(readAuthoredFile().authoring!['root'].status).toBe('authored')
    })

    /**
     * RECONCILE. A settled screen re-opens when what it was authored from
     * moved — here the source file its row recorded — and its session accounts
     * for the tasks it already has instead of re-inventing them.
     */
    describe('a settled screen whose source moved', () => {
      const context = new Map([['root', {
        module: 'src/Home.tsx', renders: [], closure: 1, renderClosure: [],
        apiEffects: ['api/post-api-repos'], rpcCalls: [], unjoined: [],
      }]])
      const both: Script = async (place) =>
        ({ kind: 'outcome', value: place === 'root' ? HOME_FRAGMENT : { interfaces: [] } })

      async function settle(): Promise<void> {
        installMemoryKvCache()
        const { persistence } = memoryPersistence()
        await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(both).driver, persistence, context })
        expect(readAuthoredFile().authoring!['root'].sources).toEqual({ 'src/Home.tsx': expect.any(String) })
      }
      afterEach(() => resetKvCacheStore())

      it('stays settled while its source holds', async () => {
        await settle()
        const { persistence } = memoryPersistence()
        const again = await authorWebInterfaces({ repoRoot: repo, driver: refuses, persistence, context })
        expect(again.places).toEqual([])
      })

      it('re-opens just that screen, past its cached fragment, briefed with its tasks to account for', async () => {
        await settle()
        fs.writeFileSync(path.join(repo, 'src', 'Home.tsx'), 'export function Home() { return <main>Repositories</main> }\n')
        const started: string[] = []
        let briefing = ''
        const { persistence } = memoryPersistence()
        const result = await authorWebInterfaces({
          repoRoot: repo,
          driver: scriptedDriver(async (place, input) => {
            started.push(place)
            briefing = input.initialMessages.join('\n')
            return {
              kind: 'outcome',
              value: { interfaces: [], retired: [{ id: HOME_TASK.id, reason: 'the add form is gone from Home.tsx' }] },
            }
          }).driver,
          persistence,
          context,
        })
        expect(started).toEqual(['root'])
        expect(briefing).toContain('Account for EACH of these tasks')
        expect(briefing).toContain(`  ${HOME_TASK.id}`)
        expect(result.places[0]).toMatchObject({
          status: 'authored',
          retired: [{ id: HOME_TASK.id, reason: 'the add form is gone from Home.tsx' }],
        })
        expect(readAuthoredFile().interfaces).toEqual([])
      })

      it('keeps a task the session says still stands, byte for byte', async () => {
        await settle()
        const before = readAuthoredFile().interfaces
        fs.appendFileSync(path.join(repo, 'src', 'Home.tsx'), '// a comment\n')
        const { persistence } = memoryPersistence()
        await authorWebInterfaces({
          repoRoot: repo,
          driver: scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [], kept: [HOME_TASK.id] } })).driver,
          persistence,
          context,
        })
        expect(readAuthoredFile().interfaces).toEqual(before)
      })

      it('refuses an outcome that leaves one of its tasks unaccounted for', async () => {
        await settle()
        fs.appendFileSync(path.join(repo, 'src', 'Home.tsx'), '// a comment\n')
        const { persistence } = memoryPersistence()
        const result = await authorWebInterfaces({
          repoRoot: repo,
          driver: scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } })).driver,
          persistence,
          context,
        })
        expect(result.places[0].status).not.toBe('authored')
        expect(result.places[0].problems.join('\n')).toContain(`\`${HOME_TASK.id}\` are not accounted for`)
        expect(readAuthoredFile().interfaces.map((task) => task.id)).toEqual([HOME_TASK.id])
      })
    })

    /**
     * A screen authored with no live screen to look at (no browser, no web
     * surface up) is settled only for runs that cannot look either: the first
     * run that can re-opens it, and one that still cannot leaves it be.
     */
    describe('a screen authored from source alone', () => {
      const both: Script = async (place) =>
        ({ kind: 'outcome', value: place === 'root' ? HOME_FRAGMENT : { interfaces: [] } })
      /** A live world whose one observer reaches every address and sees an empty page. */
      const world = (): LiveScreens => ({
        observer: {
          principal: 'webSession',
          async observe({ path }: { path: string }) {
            return {
              ok: true as const,
              observation: { path, address: path, title: '', tree: '- main', omittedLines: 0, activated: [], problems: [], reachedBy: 'load' as const },
            }
          },
          async probe() {
            return { ok: true as const, readings: [] }
          },
          async close() {},
        },
      })

      it('is recorded as such, and re-opened by the first run that can look at it live', async () => {
        await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(both).driver, persistence: memoryPersistence().persistence })
        expect(Object.values(readAuthoredFile().authoring ?? {}).map((row) => row.sourceOnly)).toEqual([true, true])

        const started: string[] = []
        const live = await authorWebInterfaces({
          repoRoot: repo,
          driver: scriptedDriver(async (place) => {
            started.push(place)
            return { kind: 'outcome', value: place === 'root' ? { interfaces: [], kept: [HOME_TASK.id] } : { interfaces: [] } }
          }).driver,
          persistence: memoryPersistence().persistence,
          openLive: async () => world(),
        })
        expect(started.sort()).toEqual(['repos-repoid', 'root'])
        expect(live.places.map((place) => place.status)).toEqual(['authored', 'empty'])
        expect(Object.values(readAuthoredFile().authoring ?? {}).map((row) => row.sourceOnly)).toEqual([undefined, undefined])

        const again = await authorWebInterfaces({ repoRoot: repo, driver: refuses, persistence: memoryPersistence().persistence, openLive: async () => world() })
        expect(again.places).toEqual([])
      })

      it('is left settled by a run whose live world does not come up', async () => {
        await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(both).driver, persistence: memoryPersistence().persistence })
        const before = readAuthoredFile().authoring
        let opened = 0
        const result = await authorWebInterfaces({
          repoRoot: repo,
          driver: refuses,
          persistence: memoryPersistence().persistence,
          openLive: async () => {
            opened++
            return undefined
          },
        })
        expect(opened).toBe(1)
        expect(result.places).toEqual([])
        expect(readAuthoredFile().authoring).toEqual(before)
      })
    })

    it('re-opens a settled screen whose derived place moved', async () => {
      await firstRun()
      fs.writeFileSync(
        guardInterfacesPath(repo),
        JSON.stringify({
          ...DERIVED,
          resources: { web: [DERIVED.resources!.web[0], { ...DERIVED.resources!.web[1], title: 'The repository report' }] },
        }),
      )
      const started: string[] = []
      const { persistence } = memoryPersistence()
      await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: { interfaces: [], kept: ['web/open-rules-panel'] } }
        }).driver,
        persistence,
      })
      expect(started).toEqual(['repos-repoid'])
    })

    // The upgrade: an authored half written before the ledger. What the old
    // inference calls done is recorded as done, for free, and never re-bought.
    it('writes a row for a screen the old inference calls done, with no session', async () => {
      fs.writeFileSync(
        guardAuthoredInterfacesPath(repo),
        JSON.stringify({
          version: 2,
          generatedAt: '2026-08-17T00:00:00.000Z',
          recipeFingerprint: 'sha256:recipe',
          interfaces: [{ ...HOME_TASK, fingerprint: 'sha256:home' }],
          states: { web: [{ id: 'repository-registered', description: 'registered' }] },
          resources: {
            web: [{ ...DERIVED.resources!.web[0], readables: { markers: [], elements: [], controls: [], rows: [] } }],
          },
        }),
      )
      const { persistence } = memoryPersistence()
      const started: string[] = []
      const result = await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: { interfaces: [] } }
        }).driver,
        persistence,
      })
      expect(started).toEqual(['repos-repoid'])
      expect(result.skipped).toEqual(['root'])
      const ledger = readAuthoredFile().authoring!
      expect(ledger['root'].status).toBe('authored')
      expect(ledger['repos-repoid'].status).toBe('empty')
      // Both rows stand on the same inputs the next run computes, so it spends
      // nothing at all.
      const second = await authorWebInterfaces({ repoRoot: repo, driver: refuses, persistence })
      expect(second.places).toEqual([])
    })
  })

  /**
   * THE CACHE. A screen whose inputs have not moved is served the fragment its
   * last session handed back: the same catalog, the same ledger row, no spend.
   * The entries live in the workspace's KV store, so a fresh clone with a warm
   * cache authors nothing at all.
   */
  describe('the authoring cache', () => {
    const script: Script = async (place) =>
      place === 'root'
        ? { kind: 'outcome', value: { ...HOME_FRAGMENT, findings: ['README.md says "Add repo"; Home.tsx renders "Add Repository"'] } }
        : { kind: 'outcome', value: REPORT_FRAGMENT }

    /** Author both screens once, into the in-memory cache. */
    async function warm(): Promise<MemoryKvCacheStore> {
      const store = installMemoryKvCache()
      const { persistence } = memoryPersistence()
      await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(script).driver, persistence })
      expect(store.list().filter((entry) => entry.cacheName === INTERFACE_AUTHOR_CACHE_NAME)).toHaveLength(2)
      return store
    }

    /** What a fresh clone hands the run: the derived half, and nothing authored. */
    function asFreshClone(): void {
      fs.rmSync(guardAuthoredInterfacesPath(repo))
    }

    afterEach(() => resetKvCacheStore())

    it('writes the same catalog from the cache as the sessions wrote, and spends nothing', async () => {
      await warm()
      const authoredBySessions = readAuthoredFile()
      asFreshClone()

      const { persistence } = memoryPersistence()
      const result = await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          throw new Error(`no session should have opened for ${place}`)
        }).driver,
        persistence,
      })

      expect(result.places.map((p) => [p.placeId, p.status, p.fromCache])).toEqual([
        ['root', 'authored', true],
        ['repos-repoid', 'authored', true],
      ])
      expect(result.spent).toEqual({ turns: 0, tokens: 0, costUsd: 0 })
      const fromCache = readAuthoredFile()
      expect(fromCache.interfaces).toEqual(authoredBySessions.interfaces)
      expect(fromCache.resources).toEqual(authoredBySessions.resources)
      expect(fromCache.states).toEqual(authoredBySessions.states)
      expect(fromCache.authoring).toEqual(authoredBySessions.authoring)
      // And the finding the session reported is reported again, so the findings
      // ledger of a cached run says what a live one would.
      expect(result.findings).toEqual([
        { placeId: 'root', note: 'README.md says "Add repo"; Home.tsx renders "Add Repository"' },
      ])
    })

    it("misses when a screen's inputs moved", async () => {
      await warm()
      asFreshClone()
      fs.writeFileSync(
        guardInterfacesPath(repo),
        JSON.stringify({
          ...DERIVED,
          resources: { web: [{ ...DERIVED.resources!.web[0], address: '/home' }, DERIVED.resources!.web[1]] },
        }),
      )

      const started: string[] = []
      const { persistence } = memoryPersistence()
      await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: { interfaces: [] } }
        }).driver,
        persistence,
      })

      expect(started).toEqual(['root'])
    })

    it('reads no cached fragment on an explicit re-author', async () => {
      await warm()
      const started: string[] = []
      const { persistence } = memoryPersistence()
      await authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async (place) => {
          started.push(place)
          return { kind: 'outcome', value: place === 'root' ? HOME_FRAGMENT : REPORT_FRAGMENT }
        }).driver,
        persistence,
        replace: true,
      })
      expect(started.sort()).toEqual(['repos-repoid', 'root'])
    })
  })

  /**
   * A TASK'S IDENTITY, where the screen declares what it shows. A step whose
   * locator resolves to a declared readable is that readable, so re-wording the
   * control leaves every scenario grounded on the task exactly where it was.
   */
  describe('the re-authored task identity', () => {
    const control = (id: string, role: 'textbox' | 'button', name: string) =>
      ({ id, control: { role, name }, states: ['disabled' as const] })
    const rootWith = (path: string, add: string): AuthoredFragment['resources'] => [
      {
        ...DERIVED.resources!.web[0],
        readables: {
          markers: [],
          elements: [],
          controls: [control('path-field', 'textbox', path), control('add-button', 'button', add)],
          rows: [],
        },
      },
    ]
    const withSteps = (path: string, add: string): AuthoredFragment => ({
      ...HOME_FRAGMENT,
      interfaces: [
        {
          ...HOME_TASK,
          steps: [
            { kind: 'input', target: { role: 'textbox', name: path } },
            { kind: 'activate', target: { role: 'button', name: add } },
          ],
        },
      ],
      resources: rootWith(path, add),
    })

    const reauthor = (fragment: AuthoredFragment) =>
      authorWebInterfaces({
        repoRoot: repo,
        driver: scriptedDriver(async () => ({ kind: 'outcome', value: fragment })).driver,
        persistence: memoryPersistence().persistence,
        places: ['root'],
        replace: true,
      })

    it('holds through a reworded control, and counts no re-key', async () => {
      await reauthor(withSteps('Repository path', 'Add Repository'))
      const before = readAuthoredFile().interfaces[0].fingerprint

      const result = await reauthor(withSteps('Path to the repository', 'Add repository'))

      expect(readAuthoredFile().interfaces[0].steps).toEqual([
        { kind: 'input', target: { role: 'textbox', name: 'Path to the repository' } },
        { kind: 'activate', target: { role: 'button', name: 'Add repository' } },
      ])
      expect(readAuthoredFile().interfaces[0].fingerprint).toBe(before)
      expect(result.labelRekeys).toBe(0)
    })

    it('moves when the reworded target resolves to nothing, and says so', async () => {
      await reauthor(withSteps('Repository path', 'Add Repository'))
      const before = readAuthoredFile().interfaces[0].fingerprint

      // The readables no longer name the button, so its label is its identity.
      const result = await reauthor({
        ...withSteps('Repository path', 'Add repository'),
        resources: [
          {
            ...DERIVED.resources!.web[0],
            readables: { markers: [], elements: [], controls: [control('path-field', 'textbox', 'Repository path')], rows: [] },
          },
        ],
      })

      expect(readAuthoredFile().interfaces[0].fingerprint).not.toBe(before)
      expect(result.labelRekeys).toBe(1)
    })
  })

  it('refuses a place the catalog does not have', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } }))
    await expect(
      authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['nowhere'] }),
    ).rejects.toThrow(/no such place: nowhere/)
  })
})

/**
 * STALE AUTHORED PLACES. An authored screen the derivation no
 * longer produces is an address nobody can stand at — the measured case is a
 * route module that now only redirects. It stays in the MERGED catalog (a fresh
 * clone has no derived half at all), but it earns no session: a work-list rule,
 * reported by name rather than silently dropped.
 */
describe('an authored screen the derivation no longer produces', () => {
  /** An authored half naming a screen the derivation does not, and a dialog. */
  const AUTHORED_WITH_STALE: InterfacesFile = {
    version: 2,
    generatedAt: '2026-08-17T00:00:00.000Z',
    recipeFingerprint: 'sha256:recipe',
    interfaces: [],
    resources: {
      web: [
        { id: 'home', kind: 'screen', title: 'the old home screen', address: '/home' },
        { id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repos-repoid' },
      ],
    },
  }

  beforeEach(() => {
    fs.writeFileSync(guardAuthoredInterfacesPath(repo), JSON.stringify(AUTHORED_WITH_STALE))
  })

  /** Every place a session was actually opened for, in start order. */
  function runOver(
    derived: InterfacesFile | null,
  ): Promise<{ started: string[]; result: Awaited<ReturnType<typeof authorWebInterfaces>> }> {
    if (derived) fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(derived))
    else fs.rmSync(guardInterfacesPath(repo))
    const { persistence } = memoryPersistence()
    const started: string[] = []
    const { driver } = scriptedDriver(async (place) => {
      started.push(place)
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    return authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 1 }).then(
      (result) => ({ started, result }),
    )
  }

  it('is reported by name and earns no session', async () => {
    expect(staleAuthoredPlaceDiagnostics(DERIVED, AUTHORED_WITH_STALE)).toEqual([
      {
        surface: 'web',
        kind: 'authored-place-not-derived',
        subject: 'home',
        detail: expect.stringContaining('authored screen `home` (/home) is not in the derived catalog'),
      },
    ])

    const { started, result } = await runOver(DERIVED)
    expect(result.diagnostics.map((d) => [d.kind, d.subject])).toEqual([
      ['authored-place-not-derived', 'home'],
    ])
    // Not authored, not reported as a place, and not merely "skipped" either —
    // `skipped` means "already has tasks", which is a different statement.
    expect(started).toEqual(['root', 'repos-repoid'])
    expect(result.places.map((p) => p.placeId)).toEqual(['root', 'repos-repoid'])
    expect(result.skipped).toEqual([])
  })

  it('never reports a dialog or a panel — nothing derives those in the first place', async () => {
    const { result } = await runOver(DERIVED)
    expect(result.diagnostics.map((d) => d.subject)).not.toContain('rules-dialog')
  })

  /**
   * THE ESCAPE HATCH. A repository whose web half the derivation cannot read at
   * all (an unrecognized routing idiom, or a tree that has not been mapped
   * yet) has every authored screen legitimately unbacked — reporting them all
   * would be reporting the derivation's own gap as the author's mistake.
   */
  it('is authored normally when the derived web half is empty', async () => {
    const { started, result } = await runOver({ ...DERIVED, resources: { web: [] } })
    expect(result.diagnostics).toEqual([])
    expect(started).toEqual(['home'])
  })

  it('is authored normally when nothing has been derived at all', async () => {
    const { started, result } = await runOver(null)
    expect(result.diagnostics).toEqual([])
    expect(started).toEqual(['home'])
  })

  /** It is a WORK-LIST rule: the catalog readers see is unchanged by it. */
  it('stays in the merged catalog regardless', async () => {
    await runOver(DERIVED)
    const merged = mergeInterfaceCatalogs(DERIVED, readAuthoredInterfaceCatalog(repo))
    expect(merged.resources!.web.map((place) => place.id)).toContain('home')
  })

  it('is refused by name, and says why instead of "no such place"', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } }))
    await expect(
      authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['home'] }),
    ).rejects.toThrow(/stale authored place: home/)
    await expect(
      authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['nowhere'] }),
    ).rejects.toThrow(/no such place: nowhere/)
  })

  it('is an empty list on a run with nothing to report', async () => {
    fs.rmSync(guardAuthoredInterfacesPath(repo))
    const { result } = await runOver(DERIVED)
    expect(result.diagnostics).toEqual([])
  })
})

/**
 * THE OUTCOME PRECONDITION, wired onto this def. The prompt has
 * demanded an early `check_draft` in the strongest terms it has, and across 110
 * measured sessions the median first call was turn 9 — eight never called it.
 * So the shell refuses the FIRST outcome of a session that skipped it, feeds
 * the def's message back, and lets the session carry on.
 */
describe('a session that skipped `check_draft`', () => {
  it('has its first outcome refused, is told so, and its second accepted', async () => {
    const { persistence } = memoryPersistence()
    const opened: string[][] = []
    const { driver } = scriptedDriver(
      async (_place, input) => {
        opened.push([...input.initialMessages])
        return { kind: 'outcome', value: HOME_FRAGMENT }
      },
      { checksDraft: false },
    )

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })

    // Two runs of one session: the briefing, then the refusal message alone.
    expect(opened).toHaveLength(2)
    expect(opened[0][0]).toContain('  place    root (screen)')
    expect(opened[1]).toEqual([
      'Outcome refused: you never ran `check_draft` in this session. Call `check_draft` on your draft now — it runs the exact validation the write path will run, so a problem it finds costs one turn to fix here instead of the whole fragment at the outcome. Fix anything it reports, then call `outcome` with the draftId of the accepted check.',
    ])
    // It fires at most once: the second outcome is taken though the tool still
    // never ran, so a stubborn session ends on its own merits, not in a loop.
    expect(result.places[0].status).toBe('authored')
    expect(result.places[0].taskIds).toEqual(['web/add-repository-by-path'])
  })
})

describe('source and task evidence in the initial session', () => {
  const context = new Map([['root', {
    module: 'src/Home.tsx', renders: ['src/Form.tsx'], closure: 2, renderClosure: ['src/Form.tsx'],
    apiEffects: ['api/post-api-repos'], rpcCalls: [], unjoined: [],
  }]])

  it('accepts a singleton task from supplied late-line controls with no source tool call', async () => {
    fs.writeFileSync(path.join(repo, 'src/Home.tsx'), "import { Form } from './Form'; export const Home = Form")
    fs.writeFileSync(path.join(repo, 'src/Form.tsx'), `${' '.repeat(850)}<form onSubmit={() => api.addRepo(path)}><input aria-label="Repository path"/><button>Add Repository</button></form>`)
    const { persistence, events } = memoryPersistence()
    const { driver } = scriptedDriver(async (_place, input) => {
      const briefing = input.initialMessages.join('\n')
      expect(input.sharedPrefix).toBeUndefined()
      expect(briefing).toContain('api.addRepo(path)')
      expect(briefing).toContain('<button>Add Repository</button>')
      expect(briefing).toContain('"status":"complete"')
      expect(await callTool(input, 'check_draft', HOME_FRAGMENT)).toContain('Accepted and kept')
      return { kind: 'outcome', value: HOME_FRAGMENT }
    }, { checksDraft: false })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'], context })
    expect(result.places[0].status).toBe('authored')
    const calls = [...events.values()].flat().filter(event => event.type === 'tool-result').map(event => event.toolName)
    expect(calls).toEqual(['check_draft'])
    const saved = readAuthoredInterfaceCatalog(repo)!.interfaces[0]
    expect(saved.steps).toEqual(HOME_TASK.steps)
    expect(saved.at).toBe('root')
    expect(saved.endState).toBe('repository-registered')
  })

  it('recovers a later editor control using only the supplied continuation', async () => {
    fs.writeFileSync(path.join(repo, 'src/Home.tsx'), '/*' + '界'.repeat(14_000) + '*/\n<input aria-label="Repository path"/><button>Add Repository</button>')
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (_place, input) => {
      let evidence = input.initialMessages.join('\n')
      expect(evidence).not.toContain('<button>Add Repository</button>')
      for (let page = 0; page < 5 && !evidence.includes('<button>Add Repository</button>'); page++) {
        const hint = evidence.match(/Continue with read_file\((.*)\)/)
        expect(hint).not.toBeNull()
        evidence = await callTool(input, 'read_file', JSON.parse(hint![1]))
      }
      expect(evidence).toContain('<button>Add Repository</button>')
      expect(await callTool(input, 'check_draft', HOME_FRAGMENT)).toContain('Accepted and kept')
      return { kind: 'outcome', value: HOME_FRAGMENT }
    }, { checksDraft: false })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'], context })
    expect(result.places[0].status).toBe('authored')
  })

  it('supplies exact existing steps for replacement and preserves them on acceptance', async () => {
    const { persistence } = memoryPersistence()
    await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(async () => ({ kind: 'outcome', value: HOME_FRAGMENT })).driver, persistence, places: ['root'] })
    const { driver } = scriptedDriver(async (_place, input) => {
      const briefing = input.initialMessages.join('\n')
      expect(briefing).toContain(JSON.stringify(HOME_TASK.steps))
      expect(briefing).toContain('Reconcile: account for every authored task')
      expect(briefing).toContain('1 complete definitions included, 0 omitted')
      expect(await callTool(input, 'check_draft', { interfaces: [HOME_TASK] })).toContain('Accepted and kept')
      return { kind: 'outcome', value: { interfaces: [HOME_TASK] } }
    }, { checksDraft: false })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'], replace: true, context })
    expect(result.places[0].status).toBe('authored')
    expect(readAuthoredInterfaceCatalog(repo)!.interfaces[0].steps).toEqual(HOME_TASK.steps)
  })

  it('retains the original source snapshot across a transport continuation', async () => {
    const { persistence } = memoryPersistence()
    let calls = 0
    const { driver } = scriptedDriver(async (_place, input) => {
      calls++
      if (calls === 1) {
        expect(input.initialMessages.join('\n')).toContain('<button type="submit">Add Repository</button>')
        fs.writeFileSync(path.join(repo, 'src/Home.tsx'), '<button>Changed after briefing</button>')
        return { kind: 'failure', failure: { kind: 'transport', detail: 'retry', class: 'provider', retryability: 'transient' } }
      }
      expect(input.initialMessages).toEqual([])
      const original = input.resume!.events.filter(event => event.type === 'user-message').map(event => event.content).join('\n')
      expect(original).toContain('<button type="submit">Add Repository</button>')
      expect(original).not.toContain('Changed after briefing')
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'], context })
    expect(calls).toBe(2)
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
      hits = await callTool(input, 'search_repo', { query: 'Add Repository', glob: '**/*.tsx' })
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(hits).toContain('src/Home.tsx:')
  })

  /**
   * The `contains` filter answers "is this in the catalog"; a MISS answers
   * nothing, and the pilot spent six turns re-asking it with different guesses.
   * A miss against a small surface hands the surface over instead.
   */
  it('hands back the whole surface when `contains` matches nothing', async () => {
    const { persistence } = memoryPersistence()
    let answer = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      answer = await callTool(input, 'list_interfaces', { surface: 'api', contains: 'apiToken' })
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(answer).toContain('Nothing matches `apiToken`')
    expect(answer).toContain('api/post-api-repos')
  })
})

describe('the briefing carries what the AST pass knows', () => {
  it('states the route module, the modules it renders, and the calls with no api id', async () => {
    const { persistence } = memoryPersistence()
    let briefing = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      briefing = input.initialMessages.join('\n')
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence,
      places: ['root'],
      context: new Map([
        [
          'root',
          {
            module: 'src/Home.tsx',
            renders: ['src/RepoGrid.tsx'],
            closure: 4,
            renderClosure: ['src/RepoGrid.tsx'],
            apiEffects: ['api/post-api-repos'],
            unjoined: ['GET /v3/insights — no api interface declares it'],
            rpcCalls: ['repo.list'],
          },
        ],
      ]),
    })
    expect(briefing).toContain('  module   src/Home.tsx')
    expect(briefing).toContain('  renders  src/RepoGrid.tsx')
    expect(briefing).toContain('  api      api/post-api-repos')
    expect(briefing).toContain('  calls    repo.list')
    expect(briefing).toContain('GET /v3/insights — no api interface declares it')
    // Item 12 inverted the rule this paragraph used to state: a procedure the
    // derivation mapped IS an api effect, and only the unmapped remainder is here.
    expect(briefing).toContain('tRPC procedures the catalog does NOT define')
    expect(briefing).toContain('A procedure that DOES have one is already in')
    expect(briefing).not.toContain('NEVER belong in `apiEffects`')
  })

  /**
   * The registry is the mechanism tasks chain by: an id means the same world at
   * every place, or it means nothing. A session that cannot SEE the worlds the
   * catalog already names mints a fresh id for each one — the pilot referenced
   * the standing registry once in 180 state references.
   */
  it('states the worlds the catalog already names, and the later place sees the earlier one\'s', async () => {
    const { persistence } = memoryPersistence()
    const briefings = new Map<string, string>()
    const { driver } = scriptedDriver(async (place, input) => {
      briefings.set(place, input.initialMessages.join('\n'))
      return place === 'root'
        ? { kind: 'outcome', value: HOME_FRAGMENT }
        : { kind: 'outcome', value: { interfaces: [] } }
    })
    // Serially: a session is briefed with every place folded before it STARTED,
    // so `repos-repoid` opens after `root` landed. Running beside it, it would
    // not — which is the pool's cost, held to its own test below.
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 1 })

    // Nothing was authored when the first session opened, so it has no registry.
    expect(briefings.get('root')).not.toContain('repository-registered')
    // The second one is briefed with the world the first one named.
    expect(briefings.get('repos-repoid')).toContain(
      '  repository-registered  The repository is registered and on the home grid.',
    )
    expect(briefings.get('repos-repoid')).toContain('Reuse an id above')
  })

  it('briefs a place with no context exactly as it did before the pack existed', async () => {
    const { persistence } = memoryPersistence()
    let briefing = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      briefing = input.initialMessages.join('\n')
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'], context: new Map() })
    expect(briefing).not.toContain('  module   ')
    expect(briefing).toContain('Start by finding the module that renders this place')
  })
})

/**
 * ITEM 9. The places were a TOOL, and a tool result is re-sent on every turn
 * after it — 245KB of re-sent `list_places` per run. The two facts a draft
 * resolves against are in the briefing instead, where they sit in the prefix a
 * provider caches: the screens with their addresses, and the places on this one.
 */
describe('the places are in the briefing, not a tool', () => {
  it('states every screen with its address, and no `list_places` tool exists', async () => {
    const { persistence } = memoryPersistence()
    let briefing = ''
    let tools: string[] = []
    const { driver } = scriptedDriver(async (_place, input) => {
      briefing = input.initialMessages.join('\n')
      tools = input.def.tools.map((tool) => tool.name)
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })

    expect(tools).toEqual(['read_file', 'read_files', 'search_repo', 'list_interfaces', 'search_interfaces', 'get_interfaces', 'get_resources', 'get_states', 'check_draft'])
    expect(briefing).toContain('Every screen this catalog knows')
    expect(briefing).toContain('  root          /')
    expect(briefing).toContain('  repos-repoid  /repos/{repoId}')
  })

  it('states the dialogs and panels an earlier session put on this place', async () => {
    const { persistence } = memoryPersistence()
    // The first run authors the rules dialog onto `repos-repoid`…
    await authorWebInterfaces({
      repoRoot: repo,
      driver: scriptedDriver(async (place) =>
        place === 'repos-repoid'
          ? { kind: 'outcome', value: REPORT_FRAGMENT }
          : { kind: 'outcome', value: { interfaces: [] } },
      ).driver,
      persistence,
      concurrency: 1,
    })

    // …so the re-author of that place is told the dialog already exists.
    let briefing = ''
    const { driver } = scriptedDriver(async (_place, input) => {
      briefing = input.initialMessages.join('\n')
      return { kind: 'outcome', value: { interfaces: [], kept: ['web/open-rules-panel'] } }
    })
    await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence,
      places: ['repos-repoid'],
      replace: true,
    })
    expect(briefing).toContain('The places already on this one')
    expect(briefing).toContain('rules-dialog  ·  dialog  ·  the Rules dialog')
    expect(briefing).toContain('(all of them sit `of: "repos-repoid"`.)')
    // The dialog is not a screen, so it never joins the screen table.
    expect(briefing).not.toMatch(/^ {2}rules-dialog {2}—$/m)
  })
})

/**
 * THE POOL. Sessions are network-bound, so they run several at a time; the FOLD
 * is not, and must not. These hold the three properties that makes that safe:
 * the sessions really do overlap, the validate-then-write never does, and a task
 * a peer claimed mid-flight costs that task rather than the whole place.
 */
describe('sessions run in a pool, the fold does not', () => {
  /** A derived catalog with four screens, so a pool has something to fill. */
  const FOUR_SCREENS: InterfacesFile = {
    ...DERIVED,
    resources: {
      web: [
        { id: 'root', kind: 'screen', title: '/', address: '/' },
        { id: 'repos-repoid', kind: 'screen', title: '/repos/{repoId}', address: '/repos/{repoId}' },
        { id: 'settings', kind: 'screen', title: '/settings', address: '/settings' },
        { id: 'rules', kind: 'screen', title: '/rules', address: '/rules' },
      ],
    },
  }

  const taskAt = (place: string, address: string, id: string): AuthoredFragment['interfaces'][number] => ({
    id,
    type: 'web',
    title: `Do the thing at ${place}`,
    entry: { method: 'GET', path: address },
    steps: [{ kind: 'activate', target: { role: 'button', name: 'Go' } }],
    at: place,
  })

  beforeEach(() => {
    fs.writeFileSync(guardInterfacesPath(repo), JSON.stringify(FOUR_SCREENS))
  })

  it('overlaps the sessions and serializes every fold', async () => {
    const { persistence } = memoryPersistence()
    let running = 0
    let peak = 0
    let foldsInFlight = 0
    let foldOverlaps = 0

    const { driver } = scriptedDriver(async (place) => {
      running += 1
      peak = Math.max(peak, running)
      // Hold every session open until the others have started.
      await new Promise((r) => setTimeout(r, 5))
      running -= 1
      const address = FOUR_SCREENS.resources!.web.find((r) => r.id === place)!.address!
      return { kind: 'outcome', value: { interfaces: [taskAt(place, address, `web/task-${place}`)] } }
    })

    const result = await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence,
      concurrency: 4,
      // `place-done` fires inside the fold's critical section, so a second one
      // arriving before the first returns would mean two folds interleaved.
      onProgress: (event) => {
        if (event.kind !== 'place-done') return
        foldsInFlight += 1
        if (foldsInFlight > 1) foldOverlaps += 1
        foldsInFlight -= 1
      },
    })

    expect(peak).toBeGreaterThan(1)
    expect(foldOverlaps).toBe(0)
    expect(result.places.map((p) => p.status)).toEqual(['authored', 'authored', 'authored', 'authored'])
    // Every place landed, and the file is a valid half.
    expect(readAuthoredFile().interfaces).toHaveLength(4)
    expect(() => InterfacesFileSchema.parse(mergeInterfaceCatalogs(FOUR_SCREENS, readAuthoredFile()))).not.toThrow()
  })

  it('reports the places in work-list order, not completion order', async () => {
    const { persistence } = memoryPersistence()
    // The later a place is in the work list, the faster its session — so
    // completion order is the reverse of the work list.
    const delays: Record<string, number> = { root: 20, 'repos-repoid': 15, settings: 10, rules: 5 }
    const { driver } = scriptedDriver(async (place) => {
      await new Promise((r) => setTimeout(r, delays[place] ?? 0))
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4 })
    expect(result.places.map((p) => p.placeId)).toEqual(['root', 'repos-repoid', 'settings', 'rules'])
  })

  /**
   * The race the pool introduces: two sessions in flight cannot see each other,
   * so both may claim one id. The one that folds second loses THAT TASK and
   * keeps the rest — refusing its whole fragment would throw away a screen's
   * work over a name two settings pages both wanted.
   */
  it('drops only the task a peer authored first, and keeps the rest of the place', async () => {
    const { persistence } = memoryPersistence()
    const { driver } = scriptedDriver(async (place) => {
      const address = FOUR_SCREENS.resources!.web.find((r) => r.id === place)!.address!
      if (place === 'root') {
        return { kind: 'outcome', value: { interfaces: [taskAt('root', '/', 'web/create-webhook')] } }
      }
      if (place === 'settings') {
        // Slower, so `root` folds first — and it wants the same id.
        await new Promise((r) => setTimeout(r, 20))
        return {
          kind: 'outcome',
          value: {
            interfaces: [
              taskAt('settings', address, 'web/create-webhook'),
              taskAt('settings', address, 'web/rotate-signing-secret'),
            ],
          },
        }
      }
      return { kind: 'outcome', value: { interfaces: [] } }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4 })

    const settings = result.places.find((p) => p.placeId === 'settings')!
    expect(settings.status).toBe('authored')
    expect(settings.raced).toEqual(['web/create-webhook'])
    expect(settings.taskIds).toEqual(['web/rotate-signing-secret'])
    expect(settings.problems).toEqual([])
    // One `web/create-webhook` in the file, and it is the one that got there first.
    const file = readAuthoredFile()
    expect(file.interfaces.filter((i) => i.id === 'web/create-webhook')).toHaveLength(1)
    expect(file.interfaces.find((i) => i.id === 'web/create-webhook')!.at).toBe('root')
    expect(file.interfaces.map((i) => i.id).sort()).toEqual([
      'web/create-webhook',
      'web/rotate-signing-secret',
    ])
  })

  /**
   * A collision with an entry the session was SHOWN is not a race: it had the id
   * in `list_interfaces` and authored over it anyway, so the fold refuses it.
   * Only the difference between the briefing and the fold is forgiven.
   */
  it('still refuses a fragment that collides with what the session was briefed with', async () => {
    const { persistence } = memoryPersistence()
    const first = scriptedDriver(async (place) =>
      place === 'root'
        ? { kind: 'outcome', value: { interfaces: [taskAt('root', '/', 'web/create-webhook')] } }
        : { kind: 'outcome', value: { interfaces: [] } },
    )
    await authorWebInterfaces({ repoRoot: repo, driver: first.driver, persistence, concurrency: 1 })

    // A second run over `settings` alone: it is briefed with the catalog that
    // already has the id.
    const second = scriptedDriver(async (place) =>
      place === 'settings'
        ? { kind: 'outcome', value: { interfaces: [taskAt('settings', '/settings', 'web/create-webhook')] } }
        : { kind: 'outcome', value: { interfaces: [] } },
    )
    const result = await authorWebInterfaces({
      repoRoot: repo,
      driver: second.driver,
      persistence,
      places: ['settings'],
      concurrency: 1,
    })
    const settings = result.places.find((p) => p.placeId === 'settings')!
    expect(settings.status).toBe('failed')
    expect(settings.raced).toBeUndefined()
    expect(settings.problems.join('\n')).toContain('is already authored')
  })

  /**
   * WHAT THE POOL COSTS, stated rather than hoped away. A session is briefed
   * with the catalog as it stands when it STARTS, so peers in flight beside it
   * are invisible — their states are not in its registry and their tasks are not
   * in its `list_interfaces`. This is why the default concurrency is small, and
   * why the standing registry (which every session does see) is where the reuse
   * actually comes from.
   */
  it('cannot brief a session with a peer that is still running', async () => {
    const { persistence } = memoryPersistence()
    const briefings = new Map<string, string>()
    const { driver } = scriptedDriver(async (place, input) => {
      briefings.set(place, input.initialMessages.join('\n'))
      if (place !== 'root') await new Promise((r) => setTimeout(r, 10))
      return place === 'root'
        ? { kind: 'outcome', value: HOME_FRAGMENT }
        : { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4 })
    // `root` names `repository-registered`, and every peer had already opened.
    expect(readAuthoredFile().states!.web.map((s) => s.id)).toEqual(['repository-registered'])
    for (const place of ['repos-repoid', 'settings', 'rules']) {
      expect(briefings.get(place), place).not.toContain('repository-registered')
    }
  })

  /**
   * ITEM 4 + ITEM 8. The pool consumes CLUSTERS: the places that render the same
   * modules run one after another, so each is briefed with its peers' work
   * already folded in — and they open on one shared pack under one cache key.
   */
  describe('a cluster runs serially, on a shared pack', () => {
    /** Four screens: three render the same shell, `rules` renders its own thing. */
    const SHELL = ['src/Shell.tsx', 'src/Table.tsx', 'src/Field.tsx', 'src/Dialog.tsx', 'src/Button.tsx']
    const context = new Map([
      ['root', pack('src/Home.tsx', [...SHELL, 'src/Grid.tsx'])],
      ['repos-repoid', pack('src/Repo.tsx', [...SHELL, 'src/Report.tsx'])],
      ['settings', pack('src/Settings.tsx', [...SHELL, 'src/Form.tsx'])],
      ['rules', pack('src/Rules.tsx', ['src/RuleList.tsx', 'src/RuleRow.tsx'])],
    ])

    function pack(module: string, renders: string[]) {
      return { module, renders, closure: renders.length + 1, renderClosure: renders, apiEffects: [], unjoined: [], rpcCalls: [] }
    }

    beforeEach(() => {
      for (const module of [...SHELL, 'src/Grid.tsx', 'src/Report.tsx', 'src/Form.tsx']) {
        fs.writeFileSync(path.join(repo, module), `export const ${path.basename(module, '.tsx')} = () => null\n`)
      }
    })

    it('never overlaps two places of one cluster, and does overlap the clusters', async () => {
      const { persistence } = memoryPersistence()
      const inFlight = new Set<string>()
      let clusterOverlaps = 0
      let peak = 0
      const cluster = new Set(['root', 'repos-repoid', 'settings'])

      const { driver } = scriptedDriver(async (place) => {
        inFlight.add(place)
        peak = Math.max(peak, inFlight.size)
        if ([...inFlight].filter((id) => cluster.has(id)).length > 1) clusterOverlaps += 1
        await new Promise((r) => setTimeout(r, 5))
        inFlight.delete(place)
        return { kind: 'outcome', value: { interfaces: [] } }
      })

      await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4, context })
      expect(clusterOverlaps).toBe(0)
      // `rules` is its own cluster, so it runs beside the shell cluster.
      expect(peak).toBe(2)
    })

    it('opens every member on the same pack, under the same cluster key', async () => {
      const { persistence } = memoryPersistence()
      const prefixes = new Map<string, SessionRunInput['sharedPrefix']>()
      const briefings = new Map<string, string>()
      const { driver } = scriptedDriver(async (place, input) => {
        prefixes.set(place, input.sharedPrefix)
        briefings.set(place, input.initialMessages.join('\n'))
        return { kind: 'outcome', value: { interfaces: [] } }
      })
      await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4, context })

      const shared = prefixes.get('root')!
      expect(shared.cacheKey).toBe('cluster/root')
      // The five modules all three render — and only those.
      for (const module of SHELL) expect(shared.messages[0]).toContain(`${module} (2 lines)`)
      expect(shared.messages[0]).not.toContain('src/Grid.tsx')
      expect(shared.messages[0]).toContain('Do NOT `read_file` any of them again')

      // Byte-identical across the cluster: that is the whole point of a prefix.
      expect(prefixes.get('repos-repoid')).toEqual(shared)
      expect(prefixes.get('settings')).toEqual(shared)
      // A cluster of one shares nothing, so it opens on its briefing alone.
      expect(prefixes.get('rules')).toBeUndefined()
      expect(shared.messages[0]).not.toContain('Existing tasks owned by this screen')
      for (const briefing of briefings.values()) expect(briefing).not.toContain('export const Shell =')
      expect(briefings.get('root')).toContain('export const Grid =')
      expect(briefings.get('repos-repoid')).toContain('export const Report =')
      expect(briefings.get('repos-repoid')).not.toContain('export const Grid =')
    })

    it('briefs the second member with what the first one authored', async () => {
      const { persistence } = memoryPersistence()
      const briefings = new Map<string, string>()
      const { driver } = scriptedDriver(async (place, input) => {
        briefings.set(place, input.initialMessages.join('\n'))
        return place === 'root'
          ? { kind: 'outcome', value: HOME_FRAGMENT }
          : { kind: 'outcome', value: { interfaces: [] } }
      })
      await authorWebInterfaces({ repoRoot: repo, driver, persistence, concurrency: 4, context })

      // `root` folded before its cluster peers started, so they see its world —
      // which is exactly what running a cluster serially buys.
      expect(briefings.get('repos-repoid')).toContain('  repository-registered  ')
      expect(briefings.get('settings')).toContain('  repository-registered  ')
      // The other cluster started beside it and could not be told.
      expect(briefings.get('rules')).not.toContain('repository-registered')
    })

    /**
     * THE HAND-OFF ORDER. A cluster's members run serially, so the
     * run cannot finish before its longest chain does; the pool starts groups in
     * the order it is handed them, so handing over the longest one first is the
     * whole of the scheduling. What must NOT move is the report.
     */
    it('hands the pool the longest cluster first, and still reports the work list', async () => {
      // `root` is its own cluster; the other three share a shell — so the LPT
      // order is the reverse of the work list at its head.
      const lopsided = new Map([
        ['root', pack('src/Home.tsx', ['src/Grid.tsx'])],
        ['repos-repoid', pack('src/Repo.tsx', [...SHELL, 'src/Report.tsx'])],
        ['settings', pack('src/Settings.tsx', [...SHELL, 'src/Form.tsx'])],
        ['rules', pack('src/Rules.tsx', [...SHELL, 'src/RuleList.tsx'])],
      ])
      const { persistence } = memoryPersistence()
      const started: string[] = []
      const { driver } = scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } }))

      const result = await authorWebInterfaces({
        repoRoot: repo,
        driver,
        persistence,
        concurrency: 1,
        context: lopsided,
        onProgress: (event) => {
          if (event.kind === 'place-start') started.push(event.placeId)
        },
      })

      expect(started).toEqual(['repos-repoid', 'settings', 'rules', 'root'])
      expect(result.places.map((p) => p.placeId)).toEqual([
        'root',
        'repos-repoid',
        'settings',
        'rules',
      ])
    })
  })

  it('starts nothing new once the caller aborts', async () => {
    const { persistence } = memoryPersistence()
    const controller = new AbortController()
    const started: string[] = []
    const { driver } = scriptedDriver(async (place) => {
      started.push(place)
      controller.abort()
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence,
      concurrency: 1,
      signal: controller.signal,
    })
    expect(started).toEqual(['root'])
  })
})

// This chain starts at the authoring session's source/tools and output. Both
// read modes and the screen model consume the resulting stored catalog bytes.
describe('readable authoring through storage and the screen read view', () => {
  it('enriches an action-only catalog, including nested facts, without changing tasks', async () => {
    const { persistence } = memoryPersistence()
    await authorWebInterfaces({ repoRoot: repo, persistence, places: ['root'],
      driver: scriptedDriver(async () => ({ kind: 'outcome', value: HOME_FRAGMENT })).driver })
    const oldTasks = readAuthoredFile().interfaces
    fs.writeFileSync(path.join(repo, 'src/Home.tsx'), `export function Home({ repos, includeArchived }) {
      return <main><h1>Repositories</h1>
        <label><input type="checkbox" checked={includeArchived} />Include archived</label>
        <section aria-label="Repository list"><ul>{repos.map(repo => <li>{repo.name}</li>)}</ul></section>
        <dialog aria-label="Repository details"><section aria-label="Status"><p>No analysis yet</p></section></dialog>
      </main>
    }`)
    const fragment: AuthoredFragment = {
      interfaces: [],
      kept: oldTasks.map((task) => task.id),
      resources: [
        { id: 'root', kind: 'screen', title: '/', readables: {
          markers: [], elements: [{ id: 'heading', element: { role: 'heading', name: 'Repositories' } }],
          controls: [{ id: 'include-archived', control: { label: 'Include archived' }, states: ['checked'] }], rows: [],
        } },
        { id: 'repo-list', kind: 'panel', title: 'Repository list', of: 'root', readables: {
          markers: [], elements: [], controls: [], rows: [{ id: 'repository', within: { role: 'region', name: 'Repository list' },
            item: 'listitem', template: '<name>', slots: [{ name: 'name', kind: 'text' }] }],
        } },
        { id: 'repo-details', kind: 'dialog', title: 'Repository details', of: 'root', readables: {
          markers: [], elements: [], controls: [], rows: [],
        } },
        { id: 'repo-status', kind: 'panel', title: 'Status', of: 'repo-details', readables: {
          markers: [{ id: 'no-analysis', marker: 'No analysis yet', when: 'the Repository details dialog is open' }],
          elements: [], controls: [], rows: [],
        } },
      ],
    }
    const { driver } = scriptedDriver(async (place, input) => {
      expect(place).toBe('root')
      expect(input.initialMessages.join('\n')).toContain('Account for EACH of these tasks')
      const source = await callTool(input, 'read_file', { path: 'src/Home.tsx' })
      expect(source).toContain('<h1>Repositories</h1>')
      expect(source).toContain('repos.map(repo => <li>{repo.name}</li>)')
      expect(source).toContain('checked={includeArchived}')
      expect(source).toContain('No analysis yet')
      expect(await callTool(input, 'check_draft', fragment)).toContain('Accepted and kept')
      return { kind: 'outcome', value: fragment }
    })
    // A named place is reconciled: its one task stands, and only readables land.
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0].status).toBe('authored')
    expect(result.authored).toBe(0)
    expect(result.path).toBe(guardAuthoredInterfacesPath(repo))
    expect(readAuthoredFile().interfaces).toEqual(oldTasks)
    const local = await readGuardInterfaces(repo)
    const screen = buildScreens('web', local.resources!.web, local.interfaces).find((s) => s.place.id === 'root')!
    const rows = screenShowRows(screen)
    expect(rows.map((row) => [row.kind, row.part.id])).toEqual([
      ['renders', 'root'], ['click', 'root'], ['lists', 'repo-list'], ['shows', 'repo-status'],
    ])
    expect(rows.find((row) => row.kind === 'lists')).toMatchObject({ what: '<name>', locator: expect.stringContaining('Repository list') })
    expect(rows.find((row) => row.kind === 'shows')!.when).toContain('dialog is open')
    expect(local.resources!.web[0].address).toBe('/')

    const bundle = collectGuardSetupBundle(repo)
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-readables-clone-'))
    try {
      materializeGuardSetupBundle(clone, bundle)
      expect((await readGuardInterfaces(clone)).resources).toEqual(local.resources)
    } finally {
      fs.rmSync(clone, { recursive: true, force: true })
    }
    setGuardStore({ loadGuardSetupBundle: async () => bundle,
      readGuardBaselineCommit: async () => null } as unknown as GuardStore)
    const hosted = await readGuardInterfaces('acme/app')
    expect(hosted.resources).toEqual(local.resources)
    expect(screenShowRows(buildScreens('web', hosted.resources!.web, hosted.interfaces)[0])).toEqual(rows)
    resetGuardStore()

    const before = readAuthoredFile()
    const rerun = await authorWebInterfaces({ repoRoot: repo, persistence,
      driver: scriptedDriver(async (place) => {
        expect(place).toBe('repos-repoid')
        return { kind: 'outcome', value: { interfaces: [] } }
      }).driver })
    expect(rerun.skipped).toEqual(['root'])
    // The authored half itself is untouched; only the ledger learns something.
    const after = readAuthoredFile()
    expect(after.interfaces).toEqual(before.interfaces)
    expect(after.resources).toEqual(before.resources)
  })

  // The old inference is what judges a screen the ledger does not name — an
  // authored half written before the ledger existed, or one a person hand-wrote.
  it('judges a screen with no ledger row by its tasks and its readable kinds', () => {
    const authoredWith = (readables: Record<string, unknown>): InterfacesFile => ({
      version: 2, generatedAt: '', recipeFingerprint: '', interfaces: [{ ...HOME_TASK, fingerprint: 'sha256:home' }],
      resources: { web: [{ ...DERIVED.resources!.web[0], readables }] },
    })
    const needs = (file: InterfacesFile): boolean => planWorkItems(DERIVED, file, '')[0].needsAuthoring
    expect(needs(authoredWith({ markers: [] }))).toBe(true)
    expect(needs(authoredWith({ markers: [], elements: [], controls: [], rows: [] }))).toBe(false)
    const withNested = authoredWith({ markers: [], elements: [], controls: [], rows: [] })
    withNested.resources!.web.push({ id: 'nested', kind: 'dialog', of: 'root', title: 'Nested' })
    expect(needs(withNested)).toBe(true)
  })

  it('persists a read-only screen', async () => {
    const { persistence } = memoryPersistence()
    const readables = { markers: [], elements: [], controls: [], rows: [] }
    const result = await authorWebInterfaces({ repoRoot: repo, persistence,
      driver: scriptedDriver(async (place) => ({ kind: 'outcome', value: place === 'root'
        ? { interfaces: [], resources: [{ ...DERIVED.resources!.web[0], readables }] } : { interfaces: [] } })).driver })
    expect(result.places[0].status).toBe('authored')
    expect(readAuthoredFile().resources!.web[0].readables).toEqual(readables)
    expect(planWorkItems(DERIVED, readAuthoredFile(), authoringRecipeContract(repo), { repoRoot: repo })[0].needsAuthoring).toBe(false)
  })
})

/**
 * SHARED PLACES — a component several screens render is registered as a place of
 * kind `component`, authored ONCE before the screens, and named in each screen's
 * briefing with its tasks instead of being authored again there.
 */
describe('a shared component', () => {
  const SIDEBAR = { id: 'component-sidebar-1a2b3c4d', module: 'src/Sidebar.tsx', title: 'Sidebar', screens: ['root', 'repos-repoid'] }
  const shared = { components: [SIDEBAR], rendered: new Map([['root', [SIDEBAR.id]], ['repos-repoid', [SIDEBAR.id]]]) }
  const grounding = (module: string) => ({ module, renders: [], closure: 1, renderClosure: [], apiEffects: [], unjoined: [], rpcCalls: [] })
  const context = new Map([
    ['root', grounding('src/Home.tsx')],
    ['repos-repoid', grounding('src/Report.tsx')],
    [SIDEBAR.id, grounding(SIDEBAR.module)],
  ])
  const COLLAPSE = {
    id: 'web/collapse-sidebar',
    type: 'web' as const,
    title: 'Collapse the sidebar',
    entry: { method: 'GET', path: '/' },
    steps: [{ kind: 'activate' as const, target: { role: 'button', name: 'Collapse' } }],
    at: SIDEBAR.id,
  }
  const script: Script = async (place, input) => {
    if (place !== SIDEBAR.id) return { kind: 'outcome', value: { interfaces: [] } }
    const checked = await callTool(input, 'check_draft', { interfaces: [COLLAPSE] })
    expect(checked).toContain('Accepted and kept')
    return { kind: 'outcome', value: { draftId: /"draftId":"([^"]+)"/.exec(checked)![1] } }
  }

  beforeEach(() => {
    installMemoryKvCache()
    fs.writeFileSync(path.join(repo, 'src', 'Sidebar.tsx'), 'export function Sidebar() { return <button onClick={() => toggle()}>Collapse</button> }\n')
    fs.writeFileSync(path.join(repo, 'src', 'Report.tsx'), 'export function Report() { return <h1>Report</h1> }\n')
  })
  afterEach(() => resetKvCacheStore())

  it('is registered as its own place and authored once, before the screens, at a screen that renders it', async () => {
    const { persistence } = memoryPersistence()
    const { driver, seen } = scriptedDriver(script)
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, context, shared })
    expect(seen.map(placeOf)).toEqual([SIDEBAR.id, 'root', 'repos-repoid'])
    // The task's id lands in the component's own namespace, like any place's.
    const [collapse] = result.places.find((place) => place.placeId === SIDEBAR.id)!.taskIds
    expect(collapse).toMatch(/^web\/screen-component-sidebar-.*-task-collapse-sidebar-/)
    const file = readAuthoredFile()
    expect(file.resources!.web.find((place) => place.id === SIDEBAR.id)).toMatchObject({ kind: 'component', title: 'Sidebar' })
    expect(file.interfaces.map((task) => [task.id, task.type === 'web' && task.at])).toEqual([[collapse, SIDEBAR.id]])
    expect(file.authoring?.[SIDEBAR.id]?.sources).toEqual({ [SIDEBAR.module]: expect.any(String) })
    // The component's session is told what it is and where it is observed.
    expect(seen[0].initialMessages.at(-1)).toContain('This place is a SHARED COMPONENT: `src/Sidebar.tsx`, rendered by 2 screen(s)')
    // Each screen is told the shared place it renders, with its tasks, and never asked to author it.
    for (const screen of seen.slice(1)) {
      expect(screen.initialMessages.at(-1)).toContain(`${SIDEBAR.id}  ·  Sidebar  ·  ${collapse}`)
    }
  })

  it('refuses a screen session that authors the shared component’s controls', async () => {
    const { persistence } = memoryPersistence()
    const refusals: string[] = []
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return script(place, input)
      refusals.push(await callTool(input, 'check_draft', { interfaces: [{ ...COLLAPSE, id: 'web/collapse-sidebar-again' }] }))
      return { kind: 'outcome', value: { interfaces: [] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence, context, shared })
    expect(refusals[0]).toContain('is not a task of `root`')
  })

  it('is served from the cache on the next run, and re-opened when its module changes', async () => {
    await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(script).driver, persistence: memoryPersistence().persistence, context, shared })
    const again = scriptedDriver(script)
    const second = await authorWebInterfaces({ repoRoot: repo, driver: again.driver, persistence: memoryPersistence().persistence, context, shared })
    expect(again.seen).toHaveLength(0)
    expect(second.skipped).toContain(SIDEBAR.id)

    fs.writeFileSync(path.join(repo, 'src', 'Sidebar.tsx'), 'export function Sidebar() { return <button onClick={() => collapse()}>Collapse</button> }\n')
    const third = scriptedDriver(script)
    await authorWebInterfaces({ repoRoot: repo, driver: third.driver, persistence: memoryPersistence().persistence, context, shared })
    expect(third.seen.map(placeOf)).toEqual([SIDEBAR.id])
  })

  it('re-opens a screen whose rendered component became shared, and moves the screen’s copy of its task to it', async () => {
    // Before: the sidebar is part of Home's own grounding, and its task is Home's.
    const unshared = new Map([['root', { ...grounding('src/Home.tsx'), renders: [SIDEBAR.module] }]])
    const ownCopy = { ...COLLAPSE, id: 'web/collapse-sidebar-on-home', at: 'root' }
    await authorWebInterfaces({
      repoRoot: repo,
      persistence: memoryPersistence().persistence,
      context: unshared,
      driver: scriptedDriver(async (place, input) => {
        if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
        const checked = await callTool(input, 'check_draft', { interfaces: [ownCopy] })
        return { kind: 'outcome', value: { draftId: /"draftId":"([^"]+)"/.exec(checked)![1] } }
      }).driver,
    })
    const [homeCopy] = readAuthoredFile().interfaces.map((task) => task.id)


    // After: a second screen renders it, so it is shared and leaves Home's
    // grounding. No file Home recorded changed, and Home re-opens all the same.
    const refusals: string[] = []
    const next = scriptedDriver(async (place, input) => {
      if (place !== 'root') return script(place, input)
      refusals.push(await callTool(input, 'check_draft', { interfaces: [], kept: [homeCopy] }))
      const checked = await callTool(input, 'check_draft', {
        interfaces: [],
        retired: [{ id: homeCopy, reason: 'the sidebar is a shared place now' }],
      })
      return { kind: 'outcome', value: { draftId: /"draftId":"([^"]+)"/.exec(checked)![1] } }
    })
    const result = await authorWebInterfaces({
      repoRoot: repo,
      driver: next.driver,
      persistence: memoryPersistence().persistence,
      context: new Map([['root', grounding('src/Home.tsx')], [SIDEBAR.id, grounding(SIDEBAR.module)]]),
      shared: { components: [SIDEBAR], rendered: new Map([['root', [SIDEBAR.id]]]) },
    })
    expect(next.seen.map(placeOf)).toEqual([SIDEBAR.id, 'root'])
    // The component's first draft twins Home's copy, and is accepted: Home re-opens in this run.
    expect(result.places.find((place) => place.placeId === SIDEBAR.id)!.status).toBe('authored')
    // Home may not keep its twin of the component's task.
    expect(refusals[0]).toContain(`\`${homeCopy}\` is kept, and it is the same task as`)
    expect(readAuthoredFile().interfaces.map((task) => task.type === 'web' && task.at)).toEqual([SIDEBAR.id])
  })

  it('earns no session once the grounding no longer finds it shared', async () => {
    await authorWebInterfaces({ repoRoot: repo, driver: scriptedDriver(script).driver, persistence: memoryPersistence().persistence, context, shared })
    fs.writeFileSync(path.join(repo, 'src', 'Sidebar.tsx'), 'export function Sidebar() { return null }\n')
    const next = scriptedDriver(script)
    const result = await authorWebInterfaces({ repoRoot: repo, driver: next.driver, persistence: memoryPersistence().persistence, context })
    expect(next.seen).toHaveLength(0)
    expect(result.skipped).toContain(SIDEBAR.id)
    expect(readAuthoredFile().interfaces.map((task) => task.type === 'web' && task.at)).toEqual([SIDEBAR.id])
  })
})

/**
 * THE PRINCIPAL OF A SCREEN — the first look observes each literal address as
 * the default principal, and the session decides whom else to observe and act
 * as from the principals it is briefed with.
 */
describe('the principal a screen is observed as', () => {
  /** An observer that reaches only the paths `reaches` admits, ending at /dashboard otherwise. */
  const observerAs = (principal: string, reaches: (path: string) => boolean) => ({
    principal,
    async observe({ path }: { path: string }) {
      const reached = reaches(path)
      return {
        ok: true as const,
        observation: {
          path,
          address: reached ? path : '/dashboard',
          title: '',
          tree: `- heading "as ${principal}"`,
          omittedLines: 0,
          activated: [],
          problems: [],
          ...(reached ? { reachedBy: 'load' as const } : {}),
        },
      }
    },
    async probe({ path }: { path: string }) {
      return reaches(path)
        ? { ok: true as const, readings: [{ matches: 1, visible: true }] }
        : { ok: false as const, reason: `${path} could not be reached`, unreached: path }
    },
    async close() {},
  })

  it('takes the first look as the default principal only, and briefs the session with who else it can be', async () => {
    const owner = observerAs('webSession', () => false)
    const anonymous = observerAs('anonymous', () => true)
    const { driver, seen } = scriptedDriver(async () => ({ kind: 'outcome', value: { interfaces: [] } }))
    await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence: memoryPersistence().persistence,
      openLive: async () => ({
        observer: owner,
        principals: new Map([['webSession', owner], ['anonymous', anonymous]]),
        descriptions: new Map([['webSession', 'owns the seeded repositories']]),
      }),
    })
    const briefing = seen.find((input) => placeOf(input) === 'root')!.initialMessages.at(-1)!
    expect(briefing).toContain('signed in as the default principal `webSession`')
    expect(briefing).toContain('  `webSession` — owns the seeded repositories')
    expect(briefing).toContain('The default principal was SENT AWAY from this address')
    expect(briefing).toContain('- heading "as webSession"')
    expect(briefing).not.toContain('- heading "as anonymous"')
  })

  it('refuses a css proof sent away from an address another principal reaches, naming who does', async () => {
    const owner = observerAs('webSession', () => false)
    const admin = observerAs('instanceAdminWebSession', () => true)
    const task = { ...HOME_TASK, endState: undefined, steps: [{ kind: 'activate', target: { css: 'main button:has(svg[data-icon="plus"])' }, why: 'icon-only add button, no aria-label' }] }
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
      const refused = await callTool(input, 'check_draft', { interfaces: [task] })
      expect(refused).toContain('is never reached as `webSession`, and is reached as `instanceAdminWebSession`')
      const checked = await callTool(input, 'check_draft', { interfaces: [{ ...task, principal: 'instanceAdminWebSession' }] })
      expect(checked).toContain('Accepted and kept')
      return { kind: 'outcome', value: { draftId: /"draftId":"([^"]+)"/.exec(checked)![1] } }
    })
    await authorWebInterfaces({
      repoRoot: repo,
      driver,
      persistence: memoryPersistence().persistence,
      openLive: async () => ({ observer: owner, principals: new Map([['webSession', owner], ['instanceAdminWebSession', admin]]) }),
    })
    const [authored] = readAuthoredFile().interfaces
    expect(authored.principal).toBe('instanceAdminWebSession')
    expect(authored.steps[0]).not.toHaveProperty('proven')
  })

  it('accepts css from source, stamped unproven, where no principal reaches the address', async () => {
    const owner = observerAs('webSession', () => false)
    const { driver } = scriptedDriver(async (place, input) => {
      if (place !== 'root') return { kind: 'outcome', value: { interfaces: [] } }
      const checked = await callTool(input, 'check_draft', {
        interfaces: [{ ...HOME_TASK, endState: undefined, steps: [{ kind: 'activate', target: { css: 'main button:has(svg[data-icon="plus"])' }, why: 'icon-only add button, no aria-label' }] }],
      })
      expect(checked).toContain('Accepted and kept')
      return { kind: 'outcome', value: { draftId: /"draftId":"([^"]+)"/.exec(checked)![1] } }
    })
    await authorWebInterfaces({ repoRoot: repo, driver, persistence: memoryPersistence().persistence, openLive: async () => ({ observer: owner }) })
    const [task] = readAuthoredFile().interfaces
    expect(task.steps[0]).toMatchObject({ proven: false })
    expect(task.principal).toBe('webSession')
  })
})
