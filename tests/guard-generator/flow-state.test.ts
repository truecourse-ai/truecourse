/**
 * The per-flow authoring state feed (`onFlowState`): every (flow, surface with
 * a plan) task emits 'queued' up front and EXACTLY ONE terminal — 'settled',
 * 'blocked', 'retired', or 'error' — with 'active' in between when a session
 * (or cache adjudication) actually runs. Unchanged flows and cache hits still
 * emit queued → terminal, so a counter over the events always sums.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { FlowAuthoringState } from '@truecourse/guard-generator'
import type { GuardDriverId } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  runGenerate,
  workerTurnBy,
  PASSING_STEPS,
  FAILING_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

interface Ev {
  key: string
  state: FlowAuthoringState
  detail?: string
}

function collector(): { events: Ev[]; onFlowState: (f: string, s: GuardDriverId, st: FlowAuthoringState, d?: string) => void } {
  const events: Ev[] = []
  return {
    events,
    onFlowState: (flowId, surface, state, detail) => events.push({ key: `${flowId}/${surface}`, state, detail }),
  }
}

const TERMINALS: ReadonlySet<FlowAuthoringState> = new Set(['settled', 'blocked', 'retired', 'error'])

/** The always-sums invariant: per task, 'queued' first and only first, the
 *  LAST event is a terminal, and consecutive events never repeat. Terminals
 *  may recur (a session settles live, the persist stage confirms the final
 *  word) and 'active' may follow a settle (a resumed session) — the board is
 *  last-write-wins, so only the final state per key enters the sums. */
function assertSums(events: Ev[]): void {
  const byKey = new Map<string, Ev[]>()
  for (const ev of events) {
    const list = byKey.get(ev.key) ?? []
    list.push(ev)
    byKey.set(ev.key, list)
  }
  for (const [key, list] of byKey) {
    expect(list[0].state, `${key} must queue first`).toBe('queued')
    for (const mid of list.slice(1)) expect(mid.state, `${key} queues only once`).not.toBe('queued')
    expect(TERMINALS.has(list[list.length - 1].state), `${key} must end on a terminal`).toBe(true)
    for (let i = 1; i < list.length; i++) {
      expect(
        list[i].state === list[i - 1].state && list[i].detail === list[i - 1].detail,
        `${key} must not repeat a state verbatim`,
      ).toBe(false)
    }
  }
}

function seedTwo(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: 'docs/a.md' }, { ref: 'docs/b.md' }])
  writeDoc(r, 'docs/a.md', '## alpha\n`relkit --version` exits 0.\n')
  writeDoc(r, 'docs/b.md', '## beta\n`relkit boom` exits 7.\n')
  return r
}

describe('generateGuards — onFlowState', () => {
  it('emits queued → active → one terminal per task, and the states always sum', async () => {
    const r = seedTwo()
    const { events, onFlowState } = collector()

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({
        alpha: raw('alpha passes', PASSING_STEPS),
        beta: { blockedOn: ['a running postgres'] },
      }),
      onFlowState,
    })

    expect(res.status).toBe('ok')
    // Every task queued FIRST, before any session started.
    expect(events.slice(0, 2).map((e) => e.state)).toEqual(['queued', 'queued'])
    assertSums(events)

    const terminal = (key: string): Ev => events.find((e) => e.key === key && TERMINALS.has(e.state))!
    expect(terminal('alpha/cli')).toMatchObject({ state: 'settled', detail: 'passing' })
    // The blocked terminal names the capability nouns.
    expect(terminal('beta/cli').state).toBe('blocked')
    expect(terminal('beta/cli').detail).toContain('a running postgres')
    // Both tasks went ACTIVE before their terminal (their sessions ran).
    expect(events.some((e) => e.key === 'alpha/cli' && e.state === 'active')).toBe(true)
    expect(events.some((e) => e.key === 'beta/cli' && e.state === 'active')).toBe(true)
  }, 60_000)

  it('a committed FAILING scenario settles with its diagnosis in the detail', async () => {
    const r = seedTwo()
    const { events, onFlowState } = collector()

    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({
        alpha: raw('alpha passes', PASSING_STEPS),
        beta: raw('beta drifts', FAILING_STEPS),
      }),
      onFlowState,
    })

    assertSums(events)
    const betaTerminal = events.find((e) => e.key === 'beta/cli' && TERMINALS.has(e.state))!
    expect(betaTerminal).toMatchObject({ state: 'settled', detail: 'failing: code-drift' })
  }, 60_000)

  it('an UNCHANGED re-run still emits queued → settled per task (cache hits sum too)', async () => {
    const r = seedTwo()
    const turnFn = workerTurnBy({
      alpha: raw('alpha passes', PASSING_STEPS),
      beta: raw('beta passes', PASSING_STEPS),
    })
    await runGenerate({ repoRoot: r, extractRunner: extractBy({}), turnFn })

    const { events, onFlowState } = collector()
    const res = await runGenerate({ repoRoot: r, extractRunner: extractBy({}), turnFn, onFlowState })

    expect(res.noChanges).toBe(true)
    assertSums(events)
    // Both tasks queued and immediately settled — no session, no 'active'.
    expect(events.filter((e) => e.state === 'active')).toEqual([])
    expect(events.filter((e) => e.state === 'settled').map((e) => e.key).sort()).toEqual([
      'alpha/cli',
      'beta/cli',
    ])
    expect(events.filter((e) => e.state === 'settled').every((e) => e.detail === 'passing')).toBe(true)
  }, 60_000)

  it('a session that dies on its turns ends in ONE error terminal, and retirement reports as retired', async () => {
    const r = seedTwo()
    const dead = workerTurnBy({
      alpha: raw('alpha passes', PASSING_STEPS),
      beta: { throws: 'transport is down' },
    })

    const first = collector()
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: dead,
      escalateAutoResolveAfter: 1,
      onFlowState: first.onFlowState,
    })
    assertSums(first.events)
    const betaFirst = first.events.find((e) => e.key === 'beta/cli' && TERMINALS.has(e.state))!
    expect(betaFirst.state).toBe('error')
    expect(betaFirst.detail).toContain('worker session ended')

    // The unsettled flow re-runs; its ledger budget (1) is exhausted, so the
    // second failure RETIRES it — reported as the 'retired' terminal.
    const second = collector()
    await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: dead,
      escalateAutoResolveAfter: 1,
      onFlowState: second.onFlowState,
    })
    assertSums(second.events)
    const betaSecond = second.events.find((e) => e.key === 'beta/cli' && TERMINALS.has(e.state))!
    expect(betaSecond.state).toBe('retired')
  }, 60_000)
})
