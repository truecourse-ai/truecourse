/**
 * THE SESSION POOL — one agent session per work item, `concurrency` at a time,
 * with a strictly serial fold (01 step 2), plus the throttle governor and the
 * transient re-queue (01 step 2i).
 *
 * Everything here drives the REAL `runAgentLoop` through a scripted fake
 * driver, so what is under test is the pool's own policy — the permit
 * accounting, the serial groups, the fold gate, the abort rule, the tee, and
 * what a throttled-to-death session costs.
 */

import { describe, it, expect, afterEach } from 'vitest'
import os from 'node:os'
import { z } from 'zod'
import {
  runSessionPool,
  defaultPoolConcurrency,
  type SessionPoolProgress,
} from '../../packages/core/src/services/agent/session-pool'
import type {
  DriverResult,
  SessionDef,
  SessionDriver,
  SessionEvent,
  SessionEventBody,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
  TurnUsage,
} from '../../packages/agent-loop/src/index'

// ---------------------------------------------------------------------------
// harness: a scripted fake driver + in-memory persistence
// ---------------------------------------------------------------------------

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const ticks = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await tick()
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}
function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

const usage = (): TurnUsage => ({
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreateTokens: 0,
  costUsd: 0,
  costSource: 'unpriced',
})

const outcomeSchema = z.object({ ok: z.boolean() })
type Outcome = z.infer<typeof outcomeSchema>

const makeDef = (workItem: string): SessionDef<Outcome> => ({
  kind: 'guard-interfaces.web-tasks',
  systemPrompt: `author ${workItem}`,
  tools: [],
  outcomeSchema,
  budget: { turns: 20, maxResumes: 0, tokenCeiling: 1_000_000 },
})

const done = (): DriverResult => ({ kind: 'outcome', value: { ok: true } })

/**
 * The work item a driver run serves. The briefing is the session's first
 * message; a RESUME carries none, so the prior transcript's `user-message` is
 * the honest source — exactly how a resumed model would re-read its task.
 */
function workItemOf(input: SessionRunInput): string {
  const first = input.initialMessages[0]
  if (first !== undefined) return first
  for (const event of input.resume?.events ?? []) {
    if (event.type === 'user-message') return event.content
  }
  return ''
}

interface ScriptCtx {
  input: SessionRunInput
  /** 1-based DRIVER run for this work item — the shell's own retry included. */
  run: number
  /** Emit one event body and yield, so the shell reacts before the next step. */
  emit(body: SessionEventBody): Promise<void>
  interrupted(): boolean
}
type Script = (workItem: string, ctx: ScriptCtx) => Promise<DriverResult>

function scriptedDriver(script: Script) {
  const runs: { workItem: string; input: SessionRunInput }[] = []
  const perItem = new Map<string, number>()
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      const workItem = workItemOf(input)
      const run = (perItem.get(workItem) ?? 0) + 1
      perItem.set(workItem, run)
      runs.push({ workItem, input })
      let interrupted = false
      const finished = (async () => {
        await tick() // let runSession return the handle first
        // Drivers record the opening messages at the moment they ingest them.
        for (const message of input.initialMessages) {
          input.onEvent({ type: 'user-message', content: message })
        }
        return script(workItem, {
          input,
          run,
          emit: async (body) => {
            input.onEvent(body)
            await tick()
          },
          interrupted: () => interrupted,
        })
      })()
      return {
        done: finished,
        status: () => 'running' as const,
        steer: () => {},
        interrupt: async () => {
          interrupted = true
        },
      }
    },
  }
  return { driver, runs }
}

function memoryPersistence() {
  const events = new Map<string, SessionEvent[]>()
  const index = new Map<string, SessionIndexEntry>()
  const indexWrites: SessionIndexEntry[] = []
  const persistence: SessionPersistence = {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? []
      list.push(event)
      events.set(sessionId, list)
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry)
      indexWrites.push(entry)
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? []
    },
  }
  return { persistence, events, index, indexWrites }
}

/** The common wiring every case repeats: items are their own work items. */
function poolOptions(items: readonly string[]) {
  return {
    items,
    workItem: (item: string) => item,
    session: (item: string) => makeDef(item),
    briefing: (item: string) => [item],
  }
}

const retry429 = (): SessionEventBody => ({
  type: 'provider-retry',
  attempt: 1,
  status: 429,
  message: 'rate limit',
  delayMs: 2000,
  model: 'scripted',
})

const transientFailure = (resumeCursor?: unknown): DriverResult => ({
  kind: 'failure',
  failure: {
    kind: 'transport',
    detail: '429 after every attempt',
    class: 'provider',
    retryability: 'transient',
  },
  ...(resumeCursor !== undefined ? { resumeCursor } : {}),
})

// ---------------------------------------------------------------------------
// concurrency, ordering, abort
// ---------------------------------------------------------------------------

describe('session pool concurrency and ordering', () => {
  it('never runs more sessions than the concurrency cap', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    const gates = new Map(items.map((item) => [item, deferred()]))
    const started: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const { driver } = scriptedDriver(async (workItem) => {
      started.push(workItem)
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await gates.get(workItem)!.promise
      inFlight--
      return done()
    })
    const { persistence } = memoryPersistence()

    const pending = runSessionPool({
      ...poolOptions(items),
      driver,
      persistence,
      concurrency: 2,
      fold: () => {},
    })

    await ticks(5)
    expect(started).toEqual(['a', 'b'])
    gates.get('a')!.resolve()
    await ticks(5)
    expect(started).toEqual(['a', 'b', 'c'])

    for (const gate of gates.values()) gate.resolve()
    const results = await pending
    expect(maxInFlight).toBe(2)
    expect(results.map((r) => r.workItem)).toEqual(items)
  })

  it('clamps a non-positive concurrency to one', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const { driver } = scriptedDriver(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await ticks(2)
      inFlight--
      return done()
    })
    const { persistence } = memoryPersistence()
    await runSessionPool({
      ...poolOptions(['a', 'b', 'c']),
      driver,
      persistence,
      concurrency: 0,
      fold: () => {},
    })
    expect(maxInFlight).toBe(1)
  })

  it('folds in completion order but reports in work-list order', async () => {
    const gates = new Map([
      ['one', deferred()],
      ['two', deferred()],
    ])
    const { driver } = scriptedDriver(async (workItem) => {
      await gates.get(workItem)!.promise
      return done()
    })
    const { persistence } = memoryPersistence()
    const folded: string[] = []

    const pending = runSessionPool({
      ...poolOptions(['one', 'two']),
      driver,
      persistence,
      concurrency: 2,
      fold: (item) => {
        folded.push(item)
      },
    })
    await ticks(3)
    // The second item lands first — provider latency, not the plan.
    gates.get('two')!.resolve()
    await ticks(3)
    gates.get('one')!.resolve()
    const results = await pending

    expect(folded).toEqual(['two', 'one'])
    expect(results.map((r) => r.workItem)).toEqual(['one', 'two'])
  })

  it('never lets two folds overlap, whatever the completion order', async () => {
    const gates = new Map([
      ['a', deferred()],
      ['b', deferred()],
      ['c', deferred()],
    ])
    const { driver } = scriptedDriver(async (workItem) => {
      await gates.get(workItem)!.promise
      return done()
    })
    const { persistence } = memoryPersistence()
    let depth = 0
    let maxDepth = 0
    const enters: string[] = []

    const pending = runSessionPool({
      ...poolOptions(['a', 'b', 'c']),
      driver,
      persistence,
      concurrency: 3,
      fold: async (item) => {
        enters.push(item)
        maxDepth = Math.max(maxDepth, ++depth)
        await ticks(2) // a fold that writes has awaits inside it
        depth--
      },
    })
    await ticks(3)
    // All three finish back to back, out of order — the gate must still line
    // their folds up one at a time.
    gates.get('c')!.resolve()
    gates.get('a')!.resolve()
    gates.get('b')!.resolve()
    await pending

    expect(maxDepth).toBe(1)
    expect(enters).toEqual(['c', 'a', 'b'])
  })

  it('a fold that throws rejects its own caller without breaking the gate', async () => {
    const { driver } = scriptedDriver(async () => done())
    const { persistence } = memoryPersistence()
    const folded: string[] = []
    const secondFold = deferred()

    const pending = runSessionPool({
      ...poolOptions(['a', 'b']),
      driver,
      persistence,
      concurrency: 2,
      fold: (item) => {
        folded.push(item)
        if (item === 'a') throw new Error('fold blew up')
        secondFold.resolve()
      },
    })

    await expect(pending).rejects.toThrow('fold blew up')
    await secondFold.promise
    expect(folded).toEqual(['a', 'b'])
  })

  it('resolves empty for an empty work list', async () => {
    const { driver, runs } = scriptedDriver(async () => done())
    const { persistence } = memoryPersistence()
    const results = await runSessionPool({
      ...poolOptions([]),
      driver,
      persistence,
      fold: () => {},
    })
    expect(results).toEqual([])
    expect(runs).toHaveLength(0)
  })

  it('starts nothing else once the run is aborted, and still folds what was in flight', async () => {
    const gate = deferred()
    const started: string[] = []
    const { driver } = scriptedDriver(async (workItem) => {
      started.push(workItem)
      await gate.promise
      return done()
    })
    const { persistence } = memoryPersistence()
    const controller = new AbortController()
    const folded: string[] = []

    const pending = runSessionPool({
      // `a1`/`a2` share a group: an interrupted serial chain is abandoned too.
      ...poolOptions(['a1', 'a2', 'b', 'c']),
      serialKey: (item) => item[0],
      driver,
      persistence,
      concurrency: 1,
      signal: controller.signal,
      fold: (item) => {
        folded.push(item)
      },
    })
    await ticks(3)
    expect(started).toEqual(['a1'])
    controller.abort()
    gate.resolve()
    const results = await pending

    expect(started).toEqual(['a1'])
    expect(folded).toEqual(['a1'])
    expect(results.map((r) => r.workItem)).toEqual(['a1'])
  })
})

// ---------------------------------------------------------------------------
// serial groups
// ---------------------------------------------------------------------------

describe('session pool serial groups', () => {
  it('briefs a group member only after its predecessor has folded', async () => {
    const log: string[] = []
    const { driver } = scriptedDriver(async (workItem) => {
      log.push(`session-run:${workItem}`)
      await ticks(2)
      return done()
    })
    const { persistence } = memoryPersistence()

    await runSessionPool({
      items: ['a1', 'a2', 'b1'],
      workItem: (item: string) => item,
      session: (item: string) => {
        log.push(`session:${item}`)
        return makeDef(item)
      },
      briefing: (item: string) => {
        log.push(`briefing:${item}`)
        return [item]
      },
      serialKey: (item: string) => item[0],
      driver,
      persistence,
      concurrency: 3,
      fold: async (item) => {
        log.push(`fold-start:${item}`)
        await ticks(2)
        log.push(`fold-end:${item}`)
      },
    })

    // Built back to back, no await between: one consistent snapshot.
    expect(log.indexOf('briefing:a1')).toBe(log.indexOf('session:a1') + 1)
    // A2 is briefed only once A1's work has LANDED.
    expect(log.indexOf('session:a2')).toBeGreaterThan(log.indexOf('fold-end:a1'))
    // …and the two never overlap.
    expect(log.indexOf('session-run:a2')).toBeGreaterThan(log.indexOf('session-run:a1'))
    // The other group is not held up by A's chain.
    expect(log.indexOf('session:b1')).toBeLessThan(log.indexOf('session:a2'))
  })

  it('hands each item its shared prefix untouched', async () => {
    const { driver, runs } = scriptedDriver(async () => done())
    const { persistence } = memoryPersistence()
    await runSessionPool({
      ...poolOptions(['a1', 'a2']),
      serialKey: () => 'a',
      sharedPrefix: (item: string) => ({ messages: [`pack for ${item[0]}`], cacheKey: 'cluster/a' }),
      driver,
      persistence,
      concurrency: 2,
      fold: () => {},
    })
    expect(runs.map((r) => r.input.sharedPrefix)).toEqual([
      { messages: ['pack for a'], cacheKey: 'cluster/a' },
      { messages: ['pack for a'], cacheKey: 'cluster/a' },
    ])
  })
})

// ---------------------------------------------------------------------------
// the tee
// ---------------------------------------------------------------------------

describe('session pool event tee', () => {
  it('reports every persisted event stamped, and passes index writes and reads through', async () => {
    const { driver } = scriptedDriver(async (_workItem, { emit }) => {
      await emit({ type: 'assistant-turn', text: 'working', usage: usage() })
      return done()
    })
    const { persistence, index } = memoryPersistence()
    const seen: { workItem: string; event: SessionEvent }[] = []

    const results = await runSessionPool({
      ...poolOptions(['a']),
      driver,
      persistence,
      concurrency: 1,
      fold: () => {},
      onSessionEvent: (workItem, event) => seen.push({ workItem, event }),
    })

    const sessionId = results[0].sessionId
    const persisted = persistence.readEvents(sessionId)
    // The observer sees exactly what the transcript records, in order, stamped.
    expect(seen.map((s) => s.event)).toEqual(persisted)
    expect(seen.every((s) => s.workItem === 'a')).toBe(true)
    expect(persisted.map((e) => e.seq)).toEqual(persisted.map((_, i) => i))
    for (const event of persisted) expect(typeof event.ts).toBe('string')
    // The wrapped persistence still writes the index and reads back untouched.
    expect(index.get(sessionId)).toMatchObject({ workItem: 'a', status: 'completed' })
  })
})

// ---------------------------------------------------------------------------
// defaultPoolConcurrency
// ---------------------------------------------------------------------------

describe('defaultPoolConcurrency', () => {
  const declared = process.env.TRUECOURSE_MAX_CONCURRENCY
  afterEach(() => {
    if (declared === undefined) delete process.env.TRUECOURSE_MAX_CONCURRENCY
    else process.env.TRUECOURSE_MAX_CONCURRENCY = declared
  })

  it('obeys TRUECOURSE_MAX_CONCURRENCY and falls back to min(cpus, 4)', () => {
    process.env.TRUECOURSE_MAX_CONCURRENCY = '7'
    expect(defaultPoolConcurrency()).toBe(7)

    delete process.env.TRUECOURSE_MAX_CONCURRENCY
    expect(defaultPoolConcurrency()).toBe(Math.min(os.cpus().length, 4))

    // Garbage (and non-positive) is not a limit — it is a typo.
    for (const value of ['banana', '0', '-3']) {
      process.env.TRUECOURSE_MAX_CONCURRENCY = value
      expect(defaultPoolConcurrency()).toBe(Math.min(os.cpus().length, 4))
    }
  })
})

// ---------------------------------------------------------------------------
// the throttle governor (01 step 2i)
// ---------------------------------------------------------------------------

describe('session pool throttle governor', () => {
  /** Run one item whose session emits a scripted event stream. */
  async function govern(
    concurrency: number,
    stream: (ctx: ScriptCtx & { throttles: number[] }) => Promise<void>,
  ): Promise<number[]> {
    const throttles: number[] = []
    const progress: SessionPoolProgress[] = []
    const { driver } = scriptedDriver(async (_workItem, ctx) => {
      await stream({ ...ctx, throttles })
      return done()
    })
    const { persistence } = memoryPersistence()
    await runSessionPool({
      ...poolOptions(['a']),
      driver,
      persistence,
      concurrency,
      fold: () => {},
      onProgress: (event) => {
        progress.push(event)
        if (event.kind === 'throttle') {
          expect(event.configured).toBe(concurrency)
          throttles.push(event.permits)
        }
      },
    })
    return throttles
  }

  it('halves once per congestion window, and again after a turn lands', async () => {
    const permits = await govern(20, async ({ emit }) => {
      await emit(retry429())
      // A volley from the sessions already in flight reports ONE saturated
      // deployment, not several.
      await emit(retry429())
      await emit({ type: 'assistant-turn', text: 'a turn landed', usage: usage() })
      await emit(retry429())
    })
    expect(permits).toEqual([10, 5])
  })

  it('never drops below one permit — a single-permit pool reports no throttle', async () => {
    const permits = await govern(1, async ({ emit }) => {
      await emit(retry429())
      await emit(retry429())
    })
    expect(permits).toEqual([])
  })

  it('restores a permit per four clean turns, and a 429 mid-streak resets the streak', async () => {
    const permits = await govern(8, async ({ emit, throttles }) => {
      await emit(retry429()) // 8 → 4
      await emit({ type: 'assistant-turn', text: '1', usage: usage() })
      await emit({ type: 'assistant-turn', text: '2', usage: usage() })
      await emit(retry429()) // 4 → 2, and the two clean turns are forfeited
      for (const n of ['3', '4', '5']) {
        await emit({ type: 'assistant-turn', text: n, usage: usage() })
      }
      // Had the streak survived the 429, the restore would already have fired.
      expect(throttles).toEqual([4, 2])
      await emit({ type: 'assistant-turn', text: '6', usage: usage() })
      expect(throttles).toEqual([4, 2, 3])
    })
    expect(permits).toEqual([4, 2, 3])
  })

  it('gates new sessions at the throttled permit count', async () => {
    const items = ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7']
    let late = 0
    let maxLate = 0
    const { driver } = scriptedDriver(async (workItem, { input }) => {
      if (workItem === 'i0') input.onEvent(retry429()) // 4 → 2, before anything ends
      const isLate = Number(workItem.slice(1)) >= 4
      if (isLate) maxLate = Math.max(maxLate, ++late)
      await ticks(3)
      if (isLate) late--
      return done()
    })
    const { persistence } = memoryPersistence()
    const throttles: number[] = []

    const results = await runSessionPool({
      ...poolOptions(items),
      driver,
      persistence,
      concurrency: 4,
      fold: () => {},
      onProgress: (event) => {
        if (event.kind === 'throttle') throttles.push(event.permits)
      },
    })

    expect(throttles).toEqual([2])
    // Everything still runs — the governor slows the pool, it never drops work.
    expect(results).toHaveLength(8)
    expect(maxLate).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// the transient re-queue (01 step 2i)
// ---------------------------------------------------------------------------

describe('session pool transient re-queue', () => {
  /** Session ids that read like the wave they belong to. */
  const mintIds = () => {
    let n = 0
    return () => `s${++n}`
  }

  it('re-queues a throttled-to-death item once, as a resume of the failed session', async () => {
    // Driver runs 1 and 2 are the first pool session and the SHELL's own single
    // transient retry; run 3 is the pool's re-queued session.
    const { driver, runs } = scriptedDriver(async (workItem, { run }) =>
      workItem === 'b' && run <= 2 ? transientFailure({ providerSessionId: 'p-b' }) : done(),
    )
    const { persistence } = memoryPersistence()
    const progress: SessionPoolProgress[] = []
    const folded: { item: string; status: string }[] = []

    const results = await runSessionPool({
      ...poolOptions(['a', 'b', 'c']),
      driver,
      persistence,
      concurrency: 1,
      mintSessionId: mintIds(),
      fold: (item, outcome) => {
        folded.push({ item, status: outcome.status })
      },
      onProgress: (event) => progress.push(event),
    })

    // The first failure never reaches the fold: one fold for `b`, completed.
    expect(folded).toEqual([
      { item: 'a', status: 'completed' },
      { item: 'c', status: 'completed' },
      { item: 'b', status: 'completed' },
    ])
    expect(progress.filter((e) => 'workItem' in e && e.workItem === 'b')).toEqual([
      { kind: 'item-start', workItem: 'b', index: 1, total: 3 },
      { kind: 'item-requeued', workItem: 'b', index: 1, total: 3 },
      { kind: 'item-start', workItem: 'b', index: 1, total: 3 },
      { kind: 'item-done', workItem: 'b', index: 1, total: 3 },
    ])

    // Two pool sessions for `b`, the second a RESUME of the first: the paid
    // turns are kept, and no briefing is spent again.
    const landed = results.find((r) => r.workItem === 'b')!
    expect(landed.sessionId).toBe('s4')
    expect(persistence.readEvents('s4')[0]).toMatchObject({
      type: 'session-start',
      resumeOf: 's2',
    })
    const rerun = runs.filter((r) => r.workItem === 'b').at(-1)!
    expect(rerun.input.initialMessages).toEqual([])
    expect(rerun.input.resume?.cursor).toEqual({ providerSessionId: 'p-b' })

    // The report is still the work list.
    expect(results.map((r) => r.workItem)).toEqual(['a', 'b', 'c'])
  })

  it('re-queues at most once, so a dead provider still terminates the run', async () => {
    const { driver } = scriptedDriver(async () => transientFailure())
    const { persistence, index } = memoryPersistence()
    const folded: string[] = []
    const progress: SessionPoolProgress[] = []

    const results = await runSessionPool({
      ...poolOptions(['a']),
      driver,
      persistence,
      concurrency: 1,
      mintSessionId: mintIds(),
      fold: (item) => {
        folded.push(item)
      },
      onProgress: (event) => progress.push(event),
    })

    expect(folded).toEqual(['a'])
    expect(results[0].outcome.status).toBe('failed')
    expect(progress.filter((e) => e.kind === 'item-requeued')).toHaveLength(1)
    // Two SESSIONS (each of which spent the shell's own retry), never a third.
    expect([...index.keys()]).toEqual(['s1', 's2'])
  })

  /** Failures the pool must NOT buy a second session for. */
  const notRequeueable: [string, DriverResult][] = [
    [
      'blocked',
      {
        kind: 'failure',
        failure: { kind: 'transport', detail: 'bad key', class: 'permission', retryability: 'blocked' },
      },
    ],
    [
      'final',
      {
        kind: 'failure',
        failure: { kind: 'transport', detail: '400', class: 'validation', retryability: 'none' },
      },
    ],
    ['malformed outcome', { kind: 'outcome', value: { nope: 1 } }],
    [
      'session-lost',
      {
        kind: 'failure',
        failure: { kind: 'session-lost', providerSessionId: 'p-1', retryability: 'transient' },
      },
    ],
  ]

  it.each(notRequeueable)('does not re-queue a %s failure', async (_name, result) => {
    const { driver } = scriptedDriver(async () => result)
    const { persistence, index } = memoryPersistence()
    const progress: SessionPoolProgress[] = []
    const results = await runSessionPool({
      ...poolOptions(['a']),
      driver,
      persistence,
      concurrency: 1,
      mintSessionId: mintIds(),
      fold: () => {},
      onProgress: (event) => progress.push(event),
    })
    expect(results[0].outcome.status).toBe('failed')
    expect(progress.some((e) => e.kind === 'item-requeued')).toBe(false)
    expect([...index.keys()]).toEqual(['s1'])
  })

  it('does not re-queue a budget-exhausted session', async () => {
    const { driver } = scriptedDriver(async (_workItem, { emit, interrupted }) => {
      for (let i = 0; i < 10 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage() })
      }
      return {
        kind: 'failure',
        failure: { kind: 'malformed', detail: 'session ended without outcome', retryability: 'none' },
      }
    })
    const { persistence, index } = memoryPersistence()
    const progress: SessionPoolProgress[] = []
    const results = await runSessionPool({
      items: ['a'],
      workItem: (item: string) => item,
      session: (item: string) => ({
        ...makeDef(item),
        budget: { turns: 2, maxResumes: 0, tokenCeiling: 1_000_000 },
      }),
      briefing: (item: string) => [item],
      driver,
      persistence,
      concurrency: 1,
      mintSessionId: mintIds(),
      fold: () => {},
      onProgress: (event) => progress.push(event),
    })
    const outcome = results[0].outcome
    expect(outcome.status === 'failed' && outcome.failure.kind).toBe('budget-exhausted')
    expect(progress.some((e) => e.kind === 'item-requeued')).toBe(false)
    expect([...index.keys()]).toEqual(['s1'])
  })

  it('never starts the queued re-run once the run is aborted', async () => {
    const controller = new AbortController()
    const { driver } = scriptedDriver(async () => transientFailure())
    const { persistence } = memoryPersistence()
    const progress: SessionPoolProgress[] = []

    const pending = runSessionPool({
      ...poolOptions(['a']),
      driver,
      persistence,
      concurrency: 1,
      signal: controller.signal,
      mintSessionId: mintIds(),
      fold: () => {},
      onProgress: (event) => {
        // The abort lands between the failure and the retry wave.
        if (event.kind === 'item-requeued') controller.abort()
        progress.push(event)
      },
    })
    await pending

    expect(progress.filter((e) => e.kind === 'item-start')).toHaveLength(1)
    expect(progress.filter((e) => e.kind === 'item-requeued')).toHaveLength(1)
  })
})
