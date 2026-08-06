/**
 * JOURNEY SELF-HEAL — a worker's `journey-defect` ending is verified against the
 * LIVE program before it may error the task, through one heal probe per surface:
 *  - cli: the disputed command's `--help` re-probed in a fresh sandbox, parsed
 *    with the journey-mapper's help parser, and unioned into the journey grammar;
 *  - api: a fresh boot of the bound server answering the disputed operation.
 * The same session then resumes ONCE with the verdict and routes normally. A
 * second defect from the resumed session errors exactly as before the heal; a
 * probe that itself fails skips the heal and appends its reason to the terminal.
 * These tests drive the REAL adapters: the cli ones against purpose-built help
 * binaries, the api ones against the fixture todos server.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readManifest } from '@truecourse/guard-runner'
import type { GuardDriverId, JourneysFile } from '@truecourse/shared'
import type { FlowAuthoringState, GuardGenerateResult } from '@truecourse/guard-generator'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  workerTurnBy,
  workerTurnsBy,
  runGenerate,
  journeysOf,
  cliJourney,
  apiJourney,
  raw,
  rawApi,
  isHealObservation,
  PASSING_STEPS,
  PASSING_API_STEPS,
  FAILING_API_STEPS,
  WORKER_FAILING,
  type WorkerSpec,
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

// ---------------------------------------------------------------------------
// cli — the `--help` re-probe adapter, driven end to end
// ---------------------------------------------------------------------------

const DOC = 'docs/cli.md'
const DOC_CONTENT = ['## boom', 'Running `boom` fails loudly and honestly.'].join('\n')

/** The help text whose facts the journey grammar LACKS: `--force` and `--mode`
 *  are net-new, so the union corrects the grammar and heals the defect. */
const CORRECTING_HELP = [
  'Usage: mycli boom [options]',
  '',
  'Options:',
  '  --json           emit JSON',
  '  --force          overwrite without asking',
  '  --mode <mode>    run mode (choices: "fast", "slow")',
].join('\\n')

/** The help text that documents exactly the journey grammar: `--json` only. */
const AGREEING_HELP = ['Usage: mycli boom [options]', '', 'Options:', '  --json  emit JSON'].join('\\n')

/**
 * Write a tiny CLI into the repo that answers `--version` (the passing
 * scenario's step) and, when `boomHelp` is given, `boom --help` with that text.
 * Everything else exits 64 with a usage error, like a real CLI.
 */
function writeHelpCli(r: string, boomHelp: string | null): string[] {
  const bin = path.join(r, 'help-cli.mjs')
  const lines = [
    "const args = process.argv.slice(2).join(' ')",
    "if (args === '--version') { console.log('9.9.9'); process.exit(0) }",
    ...(boomHelp !== null
      ? [`if (args === 'boom --help') { console.log('${boomHelp}'); process.exit(0) }`]
      : []),
    "console.error('unknown: ' + args)",
    'process.exit(64)',
  ]
  fs.writeFileSync(bin, lines.join('\n'))
  return ['node', bin]
}

const DEFECT = {
  argv: ['boom', '--legacy'],
  promised: 'the grammar lists --legacy for boom',
  observed: 'boom rejects --legacy as unknown',
}

/** Seed a repo whose one cli flow (`boom`) is bound to a `boom` journey that
 *  knows only `--json`, and run one generate with the given worker spec. */
async function runCliHeal(
  r: string,
  entry: string[],
  spec: WorkerSpec,
  onFlowState?: (f: string, s: GuardDriverId, st: FlowAuthoringState, d?: string) => void,
): Promise<{ res: GuardGenerateResult; observations: string[] }> {
  writeRecipe(r, { entry })
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  const observations: string[] = []
  const onTurn = (req: LlmTurnRequest): void => {
    const last = req.messages[req.messages.length - 1]
    if (last?.role === 'user' && isHealObservation(last.text) && !observations.includes(last.text)) {
      observations.push(last.text)
    }
  }
  const res = await runGenerate({
    repoRoot: r,
    journeys: journeysOf(r, cliJourney(['boom'], ['--json'])),
    extractRunner: extractBy({}),
    turnFn: workerTurnBy({ boom: spec }, onTurn),
    ...(onFlowState ? { onFlowState } : {}),
  })
  return { res, observations }
}

describe('journey self-heal — cli (`--help` re-probe)', () => {
  it('probe contradicts the grammar: corrects it, patches journeys.json, resumes, and the flow settles', async () => {
    const r = repo()
    const entry = writeHelpCli(r, CORRECTING_HELP)
    const { res, observations } = await runCliHeal(r, entry, {
      journeyDefect: DEFECT,
      afterHeal: raw('boom fails loudly', PASSING_STEPS),
    })

    expect(res.status).toBe('ok')
    // The flow settled IN-RUN — the healed session's scenario was committed.
    expect(res.written.map((w) => w.flowId)).toContain('boom')

    // The resume observation carried the CORRECTED grammar, rendered exactly
    // like the COMMAND GRAMMAR block (usage line + option facts).
    expect(observations).toHaveLength(1)
    expect(observations[0]).toContain('The grammar was re-derived from the live program and corrected.')
    expect(observations[0]).toContain('- boom [--json] [--force] [--mode <fast|slow>]')
    expect(observations[0]).toContain('Continue from your last draft.')

    // The defect row is still recorded (the mapper-bug feedback loop), healed.
    expect(res.journeyDefects).toHaveLength(1)
    expect(res.journeyDefects[0]).toMatchObject({ flowId: 'boom', surface: 'cli', healed: true })
    expect(res.journeyDefects[0].corrected).toContain('--force')

    // journeys.json was patched: the merged options landed on the journey, the
    // heal's diagnostics were appended, and the fingerprinted flags never moved.
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(r, '.truecourse', 'guard', 'journeys.json'), 'utf-8'),
    ) as JourneysFile
    const journey = snapshot.journeys.find((j) => j.id === 'cli/boom')!
    const step = journey.steps[0] as Extract<(typeof journey.steps)[number], { kind: 'invoke' }>
    expect(step.flags).toEqual(['--json'])
    expect(step.options?.map((o) => o.flag)).toEqual(['--json', '--force', '--mode'])
    expect(step.options?.find((o) => o.flag === '--mode')).toMatchObject({
      takesValue: true,
      choices: ['fast', 'slow'],
    })
    expect(snapshot.diagnostics?.map((d) => d.kind)).toEqual(['tree-missing-flag', 'tree-missing-flag'])
  }, 60_000)

  it('probe agrees with the grammar: resumes with the confirmation and the session settles', async () => {
    const r = repo()
    const entry = writeHelpCli(r, AGREEING_HELP)
    const { res, observations } = await runCliHeal(r, entry, {
      journeyDefect: DEFECT,
      afterHeal: raw('boom fails loudly', PASSING_STEPS),
    })

    expect(res.status).toBe('ok')
    expect(res.written.map((w) => w.flowId)).toContain('boom')
    expect(observations).toHaveLength(1)
    expect(observations[0]).toContain('The live --help output confirms the given command grammar.')
    expect(observations[0]).toContain('Trust the given grammar')

    // Healed (the session resumed and completed), but nothing was corrected.
    expect(res.journeyDefects).toHaveLength(1)
    expect(res.journeyDefects[0]).toMatchObject({ healed: true })
    expect(res.journeyDefects[0].corrected).toBeUndefined()

    // No correction ⇒ journeys.json untouched (no diagnostics appended).
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(r, '.truecourse', 'guard', 'journeys.json'), 'utf-8'),
    ) as JourneysFile
    expect(snapshot.diagnostics).toBeUndefined()
  }, 60_000)

  it('a SECOND journey-defect from the resumed session terminally errors, exactly as before the heal', async () => {
    const r = repo()
    const entry = writeHelpCli(r, AGREEING_HELP)
    const states: { key: string; state: FlowAuthoringState; detail?: string }[] = []
    const { res } = await runCliHeal(
      r,
      entry,
      { journeyDefect: DEFECT, afterHeal: { journeyDefect: DEFECT } },
      (flowId, surface, state, detail) => states.push({ key: `${flowId}/${surface}`, state, detail }),
    )

    expect(res.status).toBe('ok')
    expect(res.written).toEqual([])
    // Two endings, two rows: the healed first report and the terminal second.
    expect(res.journeyDefects).toHaveLength(2)
    expect(res.journeyDefects[0]).toMatchObject({ healed: true })
    expect(res.journeyDefects[1].healed).toBeUndefined()
    // The flow stays unsettled for the next generate, ending on ONE error.
    const boomStates = states.filter((s) => s.key === 'boom/cli')
    expect(boomStates[0].state).toBe('queued')
    const last = boomStates[boomStates.length - 1]
    expect(last.state).toBe('error')
    expect(last.detail).toContain('journey defect:')
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'boom')!.generationInputsHash).toBeNull()
  }, 60_000)

  it('a probe that itself fails skips the heal: no resume, terminal error with the failure appended', async () => {
    const r = repo()
    // No `boom --help` answer: the probe gets a usage error with no parseable
    // option grammar, which is a probe failure, never a verdict.
    const entry = writeHelpCli(r, null)
    const states: { key: string; state: FlowAuthoringState; detail?: string }[] = []
    const { res, observations } = await runCliHeal(
      r,
      entry,
      { journeyDefect: DEFECT, afterHeal: raw('boom fails loudly', PASSING_STEPS) },
      (flowId, surface, state, detail) => states.push({ key: `${flowId}/${surface}`, state, detail }),
    )

    expect(res.status).toBe('ok')
    expect(res.written).toEqual([])
    // The session was never resumed — the afterHeal scenario never authored.
    expect(observations).toEqual([])
    expect(res.journeyDefects).toHaveLength(1)
    expect(res.journeyDefects[0].healed).toBeUndefined()
    const last = states.filter((s) => s.key === 'boom/cli').at(-1)!
    expect(last.state).toBe('error')
    expect(last.detail).toContain('heal probe failed:')
    expect(last.detail).toContain('no parseable option grammar')
  }, 60_000)
})

// ---------------------------------------------------------------------------
// api — the bound-server operation probe, against the real fixture server
// ---------------------------------------------------------------------------

const API_DOC = 'docs/api.md'
const API_DOC_CONTENT = ['## list', 'GET /todos returns 200 with the todo list.'].join('\n')

const listExtract = extractBy({
  list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status + body' }],
})

async function runApiHeal(
  r: string,
  spec: WorkerSpec,
): Promise<{ res: GuardGenerateResult; observations: string[] }> {
  writeApiRecipe(r, { entry: null })
  writeCorpus(r, [{ ref: API_DOC }])
  writeDoc(r, API_DOC, API_DOC_CONTENT)
  const observations: string[] = []
  const onTurn = (req: LlmTurnRequest): void => {
    const last = req.messages[req.messages.length - 1]
    if (last?.role === 'user' && isHealObservation(last.text) && !observations.includes(last.text)) {
      observations.push(last.text)
    }
  }
  const res = await runGenerate({
    repoRoot: r,
    journeys: journeysOf(r, apiJourney('GET', '/todos')),
    extractRunner: listExtract,
    turnFn: workerTurnsBy({ api: { list: spec } }, onTurn),
  })
  return { res, observations }
}

describe('journey self-heal — api (bound-server operation probe)', () => {
  it('a 404 on the disputed operation confirms the defect; the resumed session settles with a diagnosis', async () => {
    const r = repo()
    const { res, observations } = await runApiHeal(r, {
      journeyDefect: {
        argv: ['GET', '/nope'],
        promised: 'the operations block lists GET /nope',
        observed: 'GET /nope answered 404',
      },
      afterHeal: { scenario: rawApi('listing surfaces the drift', FAILING_API_STEPS), failing: WORKER_FAILING },
    })

    expect(res.status).toBe('ok')
    // Defect confirmed against a fresh boot: no correction to offer, so the
    // resume carries the confirmation and the worker settles FAILING — the
    // in-run completion instead of a stranded flow.
    expect(observations).toHaveLength(1)
    expect(observations[0]).toContain('Your report was verified against the live program')
    expect(observations[0]).toContain('answers 404 for GET /nope')
    expect(res.journeyDefects).toHaveLength(1)
    expect(res.journeyDefects[0]).toMatchObject({ flowId: 'list', surface: 'api', healed: true })
    expect(res.journeyDefects[0].corrected).toBeUndefined()
    expect(res.written).toHaveLength(1)
    expect(res.written[0]).toMatchObject({ flowId: 'list', surface: 'api', status: 'failing' })
  }, 120_000)

  it('a served operation confirms the grammar; the resumed session settles passing', async () => {
    const r = repo()
    const { res, observations } = await runApiHeal(r, {
      journeyDefect: {
        argv: ['GET', '/todos'],
        promised: 'the operations block lists GET /todos',
        observed: 'the worker believed /todos was unserved',
      },
      afterHeal: rawApi('GET /todos answers 200 with the empty list', PASSING_API_STEPS),
    })

    expect(res.status).toBe('ok')
    expect(observations).toHaveLength(1)
    expect(observations[0]).toContain('serves GET /todos: it answered 200')
    expect(observations[0]).toContain('Trust the given grammar')
    expect(res.journeyDefects).toHaveLength(1)
    expect(res.journeyDefects[0]).toMatchObject({ healed: true })
    expect(res.written).toHaveLength(1)
    expect(res.written[0]).toMatchObject({ flowId: 'list', surface: 'api', status: 'passing' })
  }, 120_000)
})
