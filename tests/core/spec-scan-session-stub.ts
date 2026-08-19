/**
 * A SCRIPTED SESSION DRIVER for the spec-scan session tests (plan 02).
 *
 * The scan run (`packages/core/src/services/spec-scan/run.ts`) takes its driver
 * through a seam (`SpecScanSessionsOptions.driver` / `CurateInProcessOptions
 * .driver`), so every scan behavior — the cache, the pools, the folds, the
 * one-abort rule — is testable against a driver that answers from a script
 * instead of a provider. The real `runAgentLoop` still runs, so what a test
 * sees is the shell's semantics too (tool-result events, the outcome schema
 * gate, the outcome precondition).
 */

import type {
  DriverResult,
  SessionDef,
  SessionDriver,
  SessionEvent,
  SessionEventBody,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
} from '../../packages/agent-loop/src/index'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** One driver run, as the script sees it. */
export interface StubCall {
  /** `input.def.kind`, e.g. `spec-scan.curate-doc`. */
  kind: string
  /** The session's opening message (empty on a resume). */
  briefing: string
  def: SessionDef<unknown>
  input: SessionRunInput
  /** 1-based driver run of this session kind + briefing. */
  run: number
  /** Emit one transcript event body and yield so the shell reacts. */
  emit(body: SessionEventBody): Promise<void>
}

export type StubScript = (call: StubCall) => DriverResult | Promise<DriverResult>

export const outcome = (value: unknown): DriverResult => ({ kind: 'outcome', value })

export const transportFailure = (
  retryability: 'none' | 'transient' | 'blocked' = 'none',
): DriverResult => ({
  kind: 'failure',
  failure: { kind: 'transport', detail: 'the provider is gone', class: 'provider', retryability },
})

export const malformedFailure = (detail = 'the model never produced an outcome'): DriverResult => ({
  kind: 'failure',
  failure: { kind: 'malformed', detail, retryability: 'none' },
})

/**
 * A tool-result event body, as a driver emits one after running a tool. The
 * fold's `sectionsOpened` counter and the shell's outcome precondition both
 * read these off the transcript.
 */
export const toolResult = (toolName: string, content = 'ok', isError?: boolean): SessionEventBody => ({
  type: 'tool-result',
  toolName,
  content,
  ...(isError !== undefined ? { isError } : {}),
})

export interface StubDriver {
  driver: SessionDriver
  /** Every driver run, in start order. */
  calls: StubCall[]
  /** Work items (see {@link docPathOf}) per session kind, in start order. */
  kinds: string[]
}

export function stubDriver(script: StubScript): StubDriver {
  const calls: StubCall[] = []
  const kinds: string[] = []
  const runs = new Map<string, number>()
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      const briefing = input.initialMessages[0] ?? ''
      const key = `${input.def.kind}::${briefing}`
      const run = (runs.get(key) ?? 0) + 1
      runs.set(key, run)
      const call: StubCall = {
        kind: input.def.kind,
        briefing,
        def: input.def as SessionDef<unknown>,
        input,
        run,
        emit: async (body) => {
          input.onEvent(body)
          await tick()
        },
      }
      calls.push(call)
      kinds.push(input.def.kind)
      const done = (async (): Promise<DriverResult> => {
        await tick()
        for (const message of input.initialMessages) {
          input.onEvent({ type: 'user-message', content: message })
        }
        return script(call)
      })()
      return {
        done,
        status: () => 'running' as const,
        steer: () => {},
        interrupt: async () => {},
      }
    },
  }
  return { driver, calls, kinds }
}

/** A driver that must never be reached — any session start is the failure. */
export function forbiddenDriver(why = 'no session should have run'): SessionDriver {
  return stubDriver(() => {
    throw new Error(why)
  }).driver
}

/** The doc a `spec-scan.curate-doc` briefing is about. */
export function docPathOf(briefing: string): string {
  return /^PATH \(repo-relative\): (.+)$/m.exec(briefing)?.[1] ?? ''
}

export interface MemoryPersistence {
  persistence: SessionPersistence
  events: Map<string, SessionEvent[]>
  index: Map<string, SessionIndexEntry>
}

export function memoryPersistence(): MemoryPersistence {
  const events = new Map<string, SessionEvent[]>()
  const index = new Map<string, SessionIndexEntry>()
  return {
    events,
    index,
    persistence: {
      appendEvent(sessionId, event) {
        const list = events.get(sessionId) ?? []
        list.push(event)
        events.set(sessionId, list)
      },
      updateIndex(entry) {
        index.set(entry.sessionId, entry)
      },
      readEvents(sessionId) {
        return events.get(sessionId) ?? []
      },
    },
  }
}
