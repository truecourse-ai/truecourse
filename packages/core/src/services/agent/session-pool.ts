/**
 * THE SESSION POOL — the generic mechanics of running one agent session per
 * work item, `concurrency` at a time, with a strictly serial fold.
 *
 * Extracted from the interface-authoring run (SPEC_GUARD_PLAN item 104), which
 * remains its first consumer; the planning and the fold stay with each caller,
 * the pool owns only what every session-per-item command shares (§3.9):
 *
 * - a `pLimit` over the work, so sessions run in parallel while the FOLD runs
 *   one at a time — a session's result is validated against (and written into)
 *   live state, and two folds interleaved would each check state the other is
 *   in the middle of changing;
 * - folds run in COMPLETION order (that is the point: validate against state as
 *   it stands), while the RETURNED array is re-sorted to work-list order so the
 *   report reads like the plan, not like provider latency;
 * - an aborted run starts nothing else — a queued item is skipped when the
 *   signal is already aborted, and the sessions in flight get the signal
 *   through `runAgentLoop` and end themselves;
 * - every persisted transcript event is tee'd to the caller's observer, AFTER
 *   the shell stamped it (`seq`/`ts`), so the CLI's live line sees exactly what
 *   the transcript records.
 *
 * SERIAL GROUPS (item 8's cluster discipline, generalized). Items that share a
 * `serialKey` run one after another, in work-list order, on a single worker —
 * each one starts only after its predecessor has FOLDED, so its briefing can
 * include the peer's landed work. The permit unit is the group: groups run
 * concurrently with each other, so a serial chain costs no wall clock beyond
 * its own length. Absent `serialKey`, every item is its own group and the pool
 * is fully concurrent up to the cap.
 *
 * THE THROTTLE GOVERNOR (01 step 2i). `TRUECOURSE_MAX_CONCURRENCY` (or the
 * caller's `concurrency`) is a CEILING, not a fixed level: the pool watches the
 * `provider-retry` events its sessions already emit, and on a 429 halves its
 * live permits (floor 1) — twenty sessions each politely obeying a provider's
 * `Retry-After: 1` keep the deployment saturated indefinitely, because that
 * advice is about a world that does not include the load we ourselves generate.
 * Permits restore additively (+1 per {@link GOVERNOR_RESTORE_TURNS} consecutive
 * 429-free completed turns), never above the configured ceiling. Because the
 * permit unit is the GROUP, the governor throttles how many serial chains run
 * beside each other. Every change is emitted as `throttle` progress, so a
 * shrinking pool is visible rather than felt.
 *
 * THE TRANSIENT RE-QUEUE (same step). A session that dies `transport` +
 * `transient` + resumable — the retry ladder exhausted under sustained
 * throttling — is not discarded: the pool re-queues the item ONCE, at the end
 * of the work-list (behind everything still pending, at the governed permit
 * count), as a RESUME of the failed session, so its completed turns are kept
 * rather than re-bought. The first failure never reaches the fold or the
 * results; the re-run's outcome — whatever it is — does. One re-queue per work
 * item, so a genuinely dead provider still terminates the run.
 *
 * TWO CALLBACK GUARANTEES a caller may rely on:
 * - `session(item)` and `briefing(item)` are invoked back to back with no await
 *   between them, immediately before the session starts. A caller that briefs
 *   from mutable live state (the briefed-from-snapshot / validated-against-live
 *   discipline) therefore sees ONE consistent snapshot across both calls.
 * - `fold` never overlaps another `fold`, whatever the completion order.
 *
 * The pool never touches run status — `run.finish` belongs to the command
 * adapter, which knows what a partial run means for its command.
 */

import os from 'node:os'
import pLimit from 'p-limit'
import {
  runAgentLoop,
  type SessionDef,
  type SessionDriver,
  type SessionEvent,
  type SessionIndexEntry,
  type SessionOutcome,
  type SessionPersistence,
  type SharedPromptPrefix,
} from '@truecourse/agent-loop'

/*
 * SESSION-KIND NAMING CONVENTION. Every `SessionDef.kind` a pool consumer mints
 * is `<command>.<task>` — the command is the sessions-store directory the run
 * lives under (`SessionCommand`), the task names what one session of it does.
 * The registry, so a new kind lands in one shape and a transcript reader can
 * always resolve a kind back to its command:
 *
 *   spec-scan.curate-doc          spec-scan.settle-areas
 *   spec-scan.overlap             spec-scan.orchestrate
 *   guard-setup.recipe-repair     guard-setup.dependency-catalog
 *   guard-setup.reconcile-interfaces
 *   guard-setup.seed              guard-setup.auth-proof
 *   guard-generate.extract        guard-generate.flows
 *   guard-generate.flow-worker    guard-generate.fidelity
 *   guard-adjudicate.failure      guard-adjudicate.control
 *
 * (Interface authoring's `guard-interfaces.web-tasks` predates the list and
 * follows the same rule.)
 */

export interface SessionPoolItemResult<TOutcome> {
  workItem: string
  sessionId: string
  outcome: SessionOutcome<TOutcome>
}

/**
 * What the pool reports as it runs. `item-requeued` marks the transient
 * re-queue (the item will `item-start` a second time, as a resume); `throttle`
 * is the governor moving the live permit count under `configured`.
 */
export type SessionPoolProgress =
  | { kind: 'item-start'; workItem: string; index: number; total: number }
  | { kind: 'item-done'; workItem: string; index: number; total: number }
  | { kind: 'item-requeued'; workItem: string; index: number; total: number }
  | { kind: 'throttle'; permits: number; configured: number }

export interface SessionPoolOptions<TItem, TOutcome> {
  items: readonly TItem[]
  /** The work-item string the session index and the transcript record. */
  workItem: (item: TItem) => string
  /** Built immediately before the session starts (see the module note). */
  session: (item: TItem) => SessionDef<TOutcome>
  /** The initial user messages, built in the same tick as `session(item)`. */
  briefing: (item: TItem) => readonly string[]
  /**
   * Items sharing a key run SERIALLY in work-list order on one worker; the
   * concurrency permit is the group. Absent ⇒ every item its own group.
   */
  serialKey?: (item: TItem) => string
  /**
   * A prompt prefix this item's session shares with its group peers (the
   * cluster pack) — passed to `runAgentLoop` untouched. Called once per item,
   * right before the session starts; a caller wanting read-once-per-group
   * semantics memoizes by its own group key.
   */
  sharedPrefix?: (item: TItem) => SharedPromptPrefix | undefined
  driver: SessionDriver
  persistence: SessionPersistence
  /**
   * The CEILING on how many groups run at once — the governor may hold live
   * permits below it under provider throttling, never above it. Defaults to
   * {@link defaultPoolConcurrency}.
   */
  concurrency?: number
  signal?: AbortSignal
  /** Strictly serial across items, in COMPLETION order. Writes live here. */
  fold: (item: TItem, outcome: SessionOutcome<TOutcome>, sessionId: string) => void | Promise<void>
  onProgress?: (e: SessionPoolProgress) => void
  /** Every transcript event as it is persisted, stamped — the live line. */
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  mintSessionId?: () => string
  now?: () => string
}

/**
 * How many sessions (groups) run at once by default. Small on purpose: the
 * limit is not the machine, it is that a session cannot see the work of a peer
 * in flight beside it, so every extra worker buys wall clock and costs a little
 * cross-item agreement. Shares `TRUECOURSE_MAX_CONCURRENCY` with the
 * generator's own limit — one knob for "how much parallel LLM work at once".
 */
export function defaultPoolConcurrency(): number {
  const declared = process.env.TRUECOURSE_MAX_CONCURRENCY
  if (declared) {
    const n = Number.parseInt(declared, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return Math.min(os.cpus().length, 4)
}

/**
 * Restore threshold of the throttle governor: after this many consecutive
 * 429-free completed turns (pool-wide, any session) one permit is restored.
 * Small on purpose — restoration compounds as permits grow (more workers
 * complete turns faster), so AIMD converges on the sustainable rate in a few
 * minutes and simply re-halves if it overshoots.
 */
const GOVERNOR_RESTORE_TURNS = 4

/**
 * Run one session per item and fold each outcome as it lands. Resolves when
 * every item has folded (or was skipped by an abort); the results carry every
 * session that RAN, re-sorted to work-list order.
 */
export async function runSessionPool<TItem, TOutcome>(
  opts: SessionPoolOptions<TItem, TOutcome>,
): Promise<SessionPoolItemResult<TOutcome>[]> {
  const order = new Map(opts.items.map((item, index) => [opts.workItem(item), index]))
  const indexOf = new Map(opts.items.map((item, index) => [item, index]))
  const groups = groupItems(opts.items, opts.serialKey)
  const configured = Math.max(1, opts.concurrency ?? defaultPoolConcurrency())
  const runGroup = pLimit(configured)
  const fold = serially()
  const results: SessionPoolItemResult<TOutcome>[] = []

  // -------------------------------------------------------------------------
  // the throttle governor (see the module note): multiplicative decrease on a
  // 429, additive restore on sustained clean turns, ceiling = `configured`.
  // -------------------------------------------------------------------------
  let permits = configured
  let cleanTurns = 0
  // One halve per congestion observation: a volley of 429s from the sessions
  // already in flight reports ONE saturated deployment, not several — so after
  // a halve, further 429s only reset the clean streak until some turn lands.
  let halvedSinceTurn = false
  const setPermits = (next: number): void => {
    if (next === permits) return
    permits = next
    runGroup.concurrency = next
    opts.onProgress?.({ kind: 'throttle', permits: next, configured })
  }
  const govern = (event: SessionEvent): void => {
    if (event.type === 'provider-retry' && event.status === 429) {
      cleanTurns = 0
      if (!halvedSinceTurn) {
        halvedSinceTurn = true
        setPermits(Math.max(1, Math.floor(permits / 2)))
      }
    } else if (event.type === 'assistant-turn') {
      halvedSinceTurn = false
      if (permits < configured && ++cleanTurns >= GOVERNOR_RESTORE_TURNS) {
        cleanTurns = 0
        setPermits(Math.min(configured, permits + 1))
      }
    }
  }

  // -------------------------------------------------------------------------
  // the transient re-queue (see the module note)
  // -------------------------------------------------------------------------
  /** Work items already re-queued once — the bound that keeps a dead provider terminal. */
  const requeued = new Set<string>()
  /** Re-runs enqueued during the main wave; awaited after it drains. */
  const retryRuns: Promise<void>[] = []
  /** The driver's resume cursor per session, captured off the index writes the
   *  shell already makes — `SessionOutcome` deliberately does not carry it. */
  const cursorBySession = new Map<string, unknown>()
  const requeueable = (outcome: SessionOutcome<TOutcome>): boolean =>
    outcome.status === 'failed' &&
    outcome.resumable &&
    outcome.failure.kind === 'transport' &&
    outcome.failure.retryability === 'transient'

  /**
   * Run one item's session and fold its outcome. A re-run (`prior` set) is a
   * RESUME of the first session: same def — `session(item)`/`briefing(item)`
   * are NOT re-invoked, so the def still describes the snapshot the session
   * was actually briefed on and the transcript carries the briefing — a fresh
   * session id, and no new messages.
   */
  const runItem = async (
    item: TItem,
    prior?: { of: string; def: SessionDef<TOutcome>; sharedPrefix?: SharedPromptPrefix },
  ): Promise<void> => {
    const workItem = opts.workItem(item)
    const index = indexOf.get(item) ?? 0
    opts.onProgress?.({ kind: 'item-start', workItem, index, total: opts.items.length })

    const sessionId = (opts.mintSessionId ?? (() => globalThis.crypto.randomUUID()))()
    // Back to back, no await between: one consistent snapshot for both.
    const def = prior?.def ?? opts.session(item)
    const initialMessages = prior ? [] : opts.briefing(item)
    const sharedPrefix = prior ? prior.sharedPrefix : opts.sharedPrefix?.(item)
    const priorCursor = prior ? cursorBySession.get(prior.of) : undefined

    const outcome = await runAgentLoop<TOutcome>({
      def,
      workItem,
      initialMessages,
      ...(sharedPrefix ? { sharedPrefix } : {}),
      driver: opts.driver,
      persistence: tee(
        opts.persistence,
        (event) => {
          govern(event)
          opts.onSessionEvent?.(workItem, event)
        },
        (entry) => {
          if (entry.resumeCursor !== undefined) cursorBySession.set(entry.sessionId, entry.resumeCursor)
        },
      ),
      sessionId,
      ...(prior
        ? { resume: { of: prior.of, ...(priorCursor !== undefined ? { cursor: priorCursor } : {}) } }
        : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    }).outcome

    // A throttled-to-death session goes back on the queue once — behind
    // everything still pending, at the governed permit count — instead of
    // into the results. Its serial group does NOT wait for the re-run: the
    // chain already tolerates a failed predecessor, and holding the whole
    // group hostage to a provider recovery would idle a worker for nothing.
    if (requeueable(outcome) && !requeued.has(workItem) && !opts.signal?.aborted) {
      requeued.add(workItem)
      opts.onProgress?.({ kind: 'item-requeued', workItem, index, total: opts.items.length })
      retryRuns.push(
        runGroup(() =>
          opts.signal?.aborted
            ? undefined
            : runItem(item, { of: sessionId, def, ...(sharedPrefix ? { sharedPrefix } : {}) }),
        ),
      )
      return
    }

    // THE FOLD, one item at a time however many sessions are running: the
    // outcome is validated against live state, and that state cannot be
    // moving while it is checked.
    await fold(async () => {
      await opts.fold(item, outcome, sessionId)
      results.push({ workItem, sessionId, outcome })
    })
    opts.onProgress?.({ kind: 'item-done', workItem, index, total: opts.items.length })
  }

  await Promise.all(
    groups.map((group) =>
      runGroup(async () => {
        for (const item of group) {
          // A run the caller aborted starts nothing else — the rest of this
          // group is abandoned too, exactly as an interrupted serial chain
          // should be: its members were to be briefed on work that never landed.
          if (opts.signal?.aborted) return
          await runItem(item)
        }
      }),
    ),
  )
  // Re-runs were enqueued during the main wave and cannot spawn further ones
  // (one re-queue per work item), so a single second wait drains them.
  await Promise.all(retryRuns)

  // Completion order is provider latency; the report is the work list.
  results.sort((a, b) => (order.get(a.workItem) ?? 0) - (order.get(b.workItem) ?? 0))
  return results
}

/** The serial groups, in first-appearance order; members keep work-list order. */
function groupItems<TItem>(
  items: readonly TItem[],
  serialKey?: (item: TItem) => string,
): TItem[][] {
  if (!serialKey) return items.map((item) => [item])
  const byKey = new Map<string, TItem[]>()
  for (const item of items) {
    const key = serialKey(item)
    const group = byKey.get(key)
    if (group) group.push(item)
    else byKey.set(key, [item])
  }
  return [...byKey.values()]
}

/**
 * A one-at-a-time gate: each call runs after the previous one has settled,
 * whatever order the callers arrive in. A rejected fold still rejects for ITS
 * caller, but never blocks the chain for everyone behind it.
 */
function serially(): <T>(task: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => T | Promise<T>): Promise<T> => {
    const result = tail.then(task)
    tail = result.catch(() => undefined)
    return result
  }
}

/** Wrap persistence so the pool sees every event the transcript records (the
 *  caller's live line + the governor) and every index write (the resume
 *  cursor the re-queue needs). Reads pass through untouched. */
function tee(
  persistence: SessionPersistence,
  observe: (event: SessionEvent) => void,
  observeIndex: (entry: SessionIndexEntry) => void,
): SessionPersistence {
  return {
    appendEvent(sessionId, event) {
      persistence.appendEvent(sessionId, event)
      observe(event)
    },
    updateIndex(entry) {
      persistence.updateIndex(entry)
      observeIndex(entry)
    },
    readEvents: (sessionId) => persistence.readEvents(sessionId),
  }
}
