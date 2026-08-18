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
import { authorWebInterfaces, planWorkItems } from '../../packages/core/src/services/interface-author/author'
import type { AuthoredFragment } from '../../packages/core/src/services/interface-author/draft'
import { InterfacesFileSchema, type InterfacesFile } from '../../packages/shared/src/index'
import {
  guardAuthoredInterfacesPath,
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
      toolCalls.push(await callTool(input, 'read_file', { path: 'src/Home.tsx' }))
      toolCalls.push(await callTool(input, 'check_draft', HOME_FRAGMENT))
      input.onEvent({ type: 'assistant-turn', text: 'done', usage: usage() })
      return { kind: 'outcome', value: HOME_FRAGMENT }
    })

    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence })

    // The tools really read this repository.
    expect(toolCalls[0]).toContain('aria-label="Repository path"')
    expect(toolCalls[1]).toContain('The draft is valid')

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
        interfaces: [{ ...HOME_TASK, steps: [{ kind: 'activate', target: '#add-repo' }] }],
        findings: ['docs/setup.mdx names a "Import" button src/Home.tsx does not render'],
      } satisfies AuthoredFragment,
    }))
    const result = await authorWebInterfaces({ repoRoot: repo, driver, persistence, places: ['root'] })
    expect(result.places[0].status).toBe('rejected')
    expect(result.places[0].findings).toEqual([
      'docs/setup.mdx names a "Import" button src/Home.tsx does not render',
    ])
  })

  /**
   * The two lists are different claims, and the prompt has to keep them apart —
   * `unresolved` is what this session could not establish, a finding is what it
   * established and the repository contradicts. The prompt also has to demand
   * the EARLY `check_draft` (item 10): a rule broken at turn 24 costs the place.
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

/**
 * STALE AUTHORED PLACES (01 step 2h). An authored screen the derivation no
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
   * all (an unrecognized routing idiom, or a fresh clone that has not mapped
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
 * THE OUTCOME PRECONDITION (01 step 2k), wired onto this def. The prompt has
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
      'Outcome refused: you never ran `check_draft` in this session. Call `check_draft` on your complete draft now — it runs the exact validation the write path will run, so a problem it finds costs one turn to fix here instead of the whole fragment at the outcome. Fix anything it reports, then call `outcome` again.',
    ])
    // It fires at most once: the second outcome is taken though the tool still
    // never ran, so a stubborn session ends on its own merits, not in a loop.
    expect(result.places[0].status).toBe('authored')
    expect(result.places[0].taskIds).toEqual(['web/add-repository-by-path'])
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

describe('the briefing carries what the AST pass knows (item 105)', () => {
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

    expect(tools).toEqual(['read_file', 'search_repo', 'list_interfaces', 'check_draft'])
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
      return { kind: 'outcome', value: { interfaces: [] } }
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
    steps: [{ kind: 'activate', target: 'button "Go"' }],
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
   * in `list_interfaces` and authored over it anyway, and that is the refusal
   * item 104 exists for. Only the difference between the briefing and the fold
   * is forgiven.
   */
  it('still refuses a fragment that collides with what the session was briefed with', async () => {
    const { persistence } = memoryPersistence()
    const first = scriptedDriver(async (place) =>
      place === 'root'
        ? { kind: 'outcome', value: { interfaces: [taskAt('root', '/', 'web/create-webhook')] } }
        : { kind: 'outcome', value: { interfaces: [] } },
    )
    await authorWebInterfaces({ repoRoot: repo, driver: first.driver, persistence, concurrency: 1 })

    // A second run: `settings` is briefed with the catalog that already has it.
    const second = scriptedDriver(async (place) =>
      place === 'settings'
        ? { kind: 'outcome', value: { interfaces: [taskAt('settings', '/settings', 'web/create-webhook')] } }
        : { kind: 'outcome', value: { interfaces: [] } },
    )
    const result = await authorWebInterfaces({
      repoRoot: repo,
      driver: second.driver,
      persistence,
      concurrency: 1,
    })
    const settings = result.places.find((p) => p.placeId === 'settings')!
    expect(settings.status).toBe('rejected')
    expect(settings.raced).toBeUndefined()
    expect(settings.problems.join('\n')).toContain('is already authored')
  })

  /**
   * WHAT THE POOL COSTS, stated rather than hoped away. A session is briefed
   * with the catalog as it stands when it STARTS, so peers in flight beside it
   * are invisible — their states are not in its registry and their tasks are not
   * in its `list_interfaces`. This is why the default concurrency is small, and
   * why the standing registry (which every session does see) is where item 106's
   * reuse actually comes from.
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
      return { module, renders, closure: renders.length + 1, apiEffects: [], unjoined: [], rpcCalls: [] }
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
      const { driver } = scriptedDriver(async (place, input) => {
        prefixes.set(place, input.sharedPrefix)
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
      // which is exactly what running a cluster serially buys (item 4).
      expect(briefings.get('repos-repoid')).toContain('  repository-registered  ')
      expect(briefings.get('settings')).toContain('  repository-registered  ')
      // The other cluster started beside it and could not be told.
      expect(briefings.get('rules')).not.toContain('repository-registered')
    })

    /**
     * THE HAND-OFF ORDER (01 step 2j). A cluster's members run serially, so the
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
