import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  EXTRACT_SYSTEM_PROMPT,
  WORKER_CLI_SYSTEM_PROMPT,
  WORKER_API_SYSTEM_PROMPT,
  WORKER_CLI_PROMPT_FINGERPRINT,
  WORKER_API_PROMPT_FINGERPRINT,
  RECIPE_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  FLOWS_SYSTEM_PROMPT,
  FLOWS_PROMPT_FINGERPRINT,
  FLOWS_EPIC_SYSTEM_PROMPT,
  FLOWS_EPIC_PROMPT_FINGERPRINT,
  MATCH_SYSTEM_PROMPT,
  MATCH_PROMPT_FINGERPRINT,
  flowGenerationInputsHash,
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  buildMatchUserPrompt,
  buildRecipeUserPrompt,
  buildFlowsUserPrompt,
  buildFlowsEpicUserPrompt,
  type AuthorMilestone,
  type AuthorUserContext,
  type CommandGrammarEntry,
  type FidelityUserContext,
  type MatchUserContext,
  type FlowsUserContext,
  type FlowsEpicUserContext,
} from '@truecourse/guard-generator'
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { deriveCliJourneysFromTree } from '../../packages/journey-mapper/src/cli-tree'

/** The same content fingerprint the engine folds into the cache keys. */
const fingerprint = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

// ---------------------------------------------------------------------------
// Fixtures — one flow, its milestones, and the per-stage contexts built from it.
// Each test overrides only the field it is about.
// ---------------------------------------------------------------------------

const FLOW = {
  id: 'tasks/complete-a-task',
  title: 'Create and complete a task',
  goal: 'A user adds a task and marks it done.',
}

/** One milestone of the flow — the claim, its section, and how to reach it. */
function milestone(overrides: Partial<AuthorMilestone> = {}): AuthorMilestone {
  return {
    order: 1,
    claim: '`done <id>` prints `Completed t<N> ✓`',
    doc: 'docs/cli.md',
    sectionHeading: 'done',
    sectionText: '`done <id>` prints `Completed t<N> ✓`.',
    realization: ['run: ["done"]   (journey cli:done)'],
    ...overrides,
  }
}

function authorCtx(overrides: Partial<AuthorUserContext> = {}): AuthorUserContext {
  return {
    flow: FLOW,
    milestones: [milestone()],
    journeyPath: ['cli:done'],
    areaTags: [],
    driver: 'cli',
    recipeEntry: ['node', 'cli.js'],
    recipeBuild: 'true',
    ...overrides,
  }
}

function apiAuthorCtx(overrides: Partial<AuthorUserContext> = {}): AuthorUserContext {
  return authorCtx({
    driver: 'api',
    recipeEntry: undefined,
    recipeServe: ['node', 'server.js'],
    recipeHealthPath: '/health',
    journeyPath: ['api:create-user'],
    milestones: [
      milestone({
        claim: 'POST /users creates a user',
        doc: 'docs/api.md',
        sectionHeading: 'users',
        sectionText: 'POST /users creates a user and returns 201.',
        realization: ['request: POST /users   (journey api:create-user)'],
      }),
    ],
    ...overrides,
  })
}

function fidelityCtx(overrides: Partial<FidelityUserContext> = {}): FidelityUserContext {
  return {
    flow: FLOW,
    milestones: [
      {
        order: 1,
        claim: '`done <id>` prints `Completed t<N> ✓`',
        doc: 'docs/cli.md',
        sectionHeading: 'done',
        sectionText: '`done <id>` prints `Completed t<N> ✓`.',
      },
    ],
    scenarioYaml: 'title: done marks complete\nsteps:\n  - run: [done, t1]\n',
    scenarioId: 'done.cli.1',
    surface: 'cli',
    ...overrides,
  }
}

function matchCtx(overrides: Partial<MatchUserContext> = {}): MatchUserContext {
  return {
    flow: FLOW,
    milestones: [
      { order: 1, claim: '`add <title>` creates a task' },
      { order: 2, claim: '`done <id>` prints `Completed t<N> ✓`', note: 'observe the completion' },
    ],
    surface: 'cli',
    journeys: [
      {
        id: 'cli:tasks-add',
        title: 'Add a task',
        entry: 'tasks add',
        steps: ['invoke: tasks add  flags: --json', 'writes: tasks.json'],
      },
      { id: 'cli:tasks-done', title: 'Complete a task', entry: 'tasks done', steps: ['invoke: tasks done'] },
    ],
    ...overrides,
  }
}

describe('guard-generator prompts', () => {
  it('WORKER_CLI_SYSTEM_PROMPT carries the world-state capabilities block', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# World-state capabilities')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('setup.git')
    // The sandbox realities, one line each.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('no network egress')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('no credentials')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('no shell')
  })

  it('WORKER_CLI_SYSTEM_PROMPT names the blocked-on nouns the settle carries', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('blockedOn')
    // The closed noun vocabulary: a secret, the third party itself, missing data.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`"credentials"` when a SECRET is missing')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('the SERVICE ITSELF when a third party is missing')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`"missing-data"`')
    // A blocked milestone never holds its testable siblings hostage.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('blockedMilestones')
  })

  it('WORKER_CLI_SYSTEM_PROMPT gives the session ONE tool and a converging loop', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# Your loop')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('You have ONE tool: `run_scenario`')
    // The sandbox capture is what a revision reads — draft → run → observe → revise.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('draft → run →\nobserve → revise')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Your turns are budgeted')
    // The settle is on an EXECUTED scenario, never on an unexecuted draft.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('The LAST run is your answer')
  })

  it('EXTRACT and RECIPE carry the shared output-only guardrail', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(RECIPE_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('both worker prompts are agentic — the loop, the one tool, the last-run answer', () => {
    for (const prompt of [WORKER_CLI_SYSTEM_PROMPT, WORKER_API_SYSTEM_PROMPT]) {
      expect(prompt).not.toContain(OUTPUT_ONLY_GUARDRAIL)
      expect(prompt).not.toContain('You have NO tools')
      expect(prompt).toContain('# Your loop')
      expect(prompt).toContain('You have ONE tool: `run_scenario`')
      expect(prompt).toMatch(/draft → run →\s*observe → revise/)
      expect(prompt).toContain('Your turns are budgeted')
      expect(prompt).toContain('The LAST run is your answer')
    }
    // There is no retry stage: the capture is read in-loop, never a "retry supplies".
    expect(WORKER_API_SYSTEM_PROMPT).not.toContain('retry supplies')
  })

  it('EXTRACT_PROMPT_FINGERPRINT is pinned — moves only with an intended re-extract', () => {
    // Pinned literal: the prompt renders the driver registry's ids, so the
    // desktop + mobile journey-type rows moved this from 40e35f8ec26c72cb (the api
    // driver becoming authorable). It must not move again silently.
    // Rolled once: the `api` driver row now covers the SERVER PROCESS
    // (startup under a configuration, a failed start, boot migrations, request
    // logging, shutdown, restart persistence), because those claims were landing on
    // `cli` and dying as "blocked on a recipe `entry`" on repos that have no CLI at
    // all. A re-extract of every doc is the cost, and it is the point.
    expect(fingerprint(EXTRACT_SYSTEM_PROMPT)).toBe('87fe2fdd9881b428')
  })

  it('EXTRACT_SYSTEM_PROMPT routes SERVER-PROCESS claims to api, not cli', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('the behavior of the service PROCESS itself')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('shuts down on SIGTERM/SIGINT')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('state survives a restart')
    // …and the line that keeps a package script on cli.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('`cli` is for a\n  COMMAND a user runs to completion')
  })

  // LLM-dependent commands classify as blocked-on, never authored.
  it('EXTRACT_SYSTEM_PROMPT classifies LLM-provider-dependent commands as blocked-on', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('commands that need an LLM provider are not cli-testable')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('authenticated LLM provider')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('external AI CLI')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('llm-provider')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('Do NOT extract such a command')
    // General, not a fixed command list.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('any provider-auth-dependent command')
  })

  // Programmatic import-by-name API claims classify as library (recorded, not authored).
  it('EXTRACT_SYSTEM_PROMPT classifies programmatic-API claims as library, by consumption form', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('- library — ')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('IMPORTING it from user')
    // The deciding line is how the docs consume it, not which feature it is.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('documented consumption form')
    // api became authorable; only web/tui/library stay recorded-only.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('web/tui/library claims')
  })

  // Assertions come from the claim/doc, never what the sandbox happened to print.
  it('WORKER_CLI_SYSTEM_PROMPT rules assertions come from the claim, not the observed run', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain(
      '# Assertions come from the claim, never from observed behavior',
    )
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('you MUST STILL')
    // The disagreement is the point: keep the assertion, watch it fail, settle failing.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('settle FAILING with a\ndiagnosis')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('this scenario exists to surface')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('effect-only')
    // Softening an assertion to make the sandbox go green is the worst outcome.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('a green test that proves less than the claim is')
  })

  it('WORKER_CLI_SYSTEM_PROMPT carries the compact worked example (claim X vs observed Y)', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Worked example')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Completed t1 ✓')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Marked t1 as done')
  })

  it('both authoring prompts keep faithfulness the prime directive', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# Faithfulness — the prime directive')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('# Faithfulness — the prime directive')
    // A green test that proves less than the claim is the worst outcome.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('must never claim more than the prose does')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('must never claim more than the prose does')
  })

  // The milestone contract — every milestone realized, plumbing steps unannotated.
  it('WORKER_CLI_SYSTEM_PROMPT requires every milestone to carry a step, plumbing steps none', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# The path is the point: one scenario, every milestone')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Every milestone MUST be realized by at least one step')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain("milestone: <that milestone's number>")
    // A seeding / unasserted step paints neutral.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('only prepares\n  the world')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('carries NO `milestone`')
    // The numbers are given, not the model's to reshape.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Never renumber, merge, split, skip, or invent a milestone')
    // Missing world-state is declared in `setup`, never an excuse to drop a milestone.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('never drop the milestone')
  })

  // Two-sided promises get two-sided tests — the same rule, in each driver's words.
  it('both authoring prompts demand both halves of a two-sided promise', () => {
    for (const prompt of [WORKER_CLI_SYSTEM_PROMPT, WORKER_API_SYSTEM_PROMPT]) {
      expect(prompt).toContain('# Two-sided promises get two-sided tests')
      expect(prompt).toContain("BOTH halves are that milestone's contract")
      expect(prompt).toContain('steps for BOTH halves')
    }
  })

  // The doc's own worked examples run byte-for-byte, on both surfaces.
  it('both authoring prompts run a DOC EXAMPLE verbatim, never reformatted', () => {
    for (const prompt of [WORKER_CLI_SYSTEM_PROMPT, WORKER_API_SYSTEM_PROMPT]) {
      expect(prompt).toContain("# The doc's own examples run VERBATIM")
      expect(prompt).toContain('DOC EXAMPLE markers')
      expect(prompt).toContain('BYTE-FOR-BYTE')
      // A block nothing runs/sends constrains nothing.
      expect(prompt).toContain('constrains nothing')
    }
    // The cli half seeds the bytes as scenario INPUT; a broken example stays broken.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain("seed the DOC EXAMPLE's bytes")
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('deliberately-broken example must stay broken')
  })

  // A long-running command is drivable from a cli scenario — the managed-service verbs.
  it('WORKER_CLI_SYSTEM_PROMPT teaches the managed-service step vocabulary and its limit', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# A long-running SERVICE is drivable')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('"boot"')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('"signal"')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('"logs"')
    // An ordinary `run` step waits for exit, so it can never test such a command…
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('An ordinary `run` step waits for EXIT')
    // …and a command that EXITS stays an ordinary `run` step.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('never a `boot`')
  })

  it('WORKER_API_SYSTEM_PROMPT states the same milestone contract for the api surface', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('# The path is the point: one scenario, every milestone')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('Every milestone MUST be realized by at least one step')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('carries NO `milestone`')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('Never renumber, merge, split, skip, or invent a milestone')
    // One server, one path — chained with capture rather than guessed ids.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('one freshly booted server')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`capture`')
  })

  it('the api worker closes the outcome space a session may end on', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('# Outcomes — how a session ends')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('Every session ends with exactly one outcome')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('- `settled` —')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('- `blocked` —')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('- `journey-defect` —')
    // A blocked api flow still names the SERVICE, never a generic noun.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('write the SERVICE (`"stripe"`')
  })

  // The cli surface settles an OUTCOME instead of returning one object: the same
  // three answers (a scenario, a refusal, a defect report), reached over turns.
  it('WORKER_CLI_SYSTEM_PROMPT closes the outcome space a session may end on', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# Outcomes — how a session ends')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('Every session ends with exactly one outcome')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('- `settled` —')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('- `blocked` —')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('- `journey-defect` —')
  })

  // Where the deleted evidence-retry's job went: a run that fails because code and
  // doc disagree is SETTLED failing, with the diagnosis the triage stage used to
  // produce — verdict, confidence, brief, recommendation.
  it('WORKER_CLI_SYSTEM_PROMPT settles a genuine disagreement FAILING, with a diagnosis', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain(
      'Settle FAILING when the run fails because code and doc genuinely disagree',
    )
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`code-drift`')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`doc-drift`')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`confidence` (high | medium | low)')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('`recommendation`')
    // A scenario broken by its OWN defect is fixed or run out honestly — never
    // settled failing, which is what would turn a bad test into a false finding.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain(
      'A scenario that fails because of ITS OWN defect is never\n  settled failing',
    )
  })

  // The COMMAND GRAMMAR block — the cli analog of the api operations block:
  // the bound commands' flags are parsed facts, never prose-reconstructed guesses.
  const grammar = (): CommandGrammarEntry[] => [
    {
      command: ['config', 'llm', 'setup'],
      label: 'Choose the LLM transport',
      options: [
        { flag: '--transport', required: true, choices: ['claude-code', 'api'] },
        { flag: '--provider', takesValue: true, valueHint: 'name', description: 'API provider' },
        { flag: '--model', takesValue: true, valueHint: 'id', description: 'Model id every stage runs on' },
        { flag: '--no-test' },
      ],
    },
  ]

  it('renders one usage line per bound command — required bare, optional bracketed, choices enumerated', () => {
    const p = buildAuthorUserPrompt(authorCtx({ commandGrammar: grammar() }))
    expect(p).toContain('COMMAND GRAMMAR')
    expect(p).toContain(
      '- config llm setup --transport <claude-code|api> [--provider <name>] [--model <id>] [--no-test]   (Choose the LLM transport)',
    )
    // Per-option detail lines carry the declared descriptions.
    expect(p).toContain('    --provider <name>: API provider')
    expect(p).toContain('    --model <id>: Model id every stage runs on')
  })

  it('renders program-scope options on their own line, never in the usage line', () => {
    const p = buildAuthorUserPrompt(
      authorCtx({
        commandGrammar: [
          {
            command: ['analyze'],
            options: [
              { flag: '--diff' },
              { flag: '--verbose', scope: 'program', description: 'Print every step' },
              {
                flag: '--config',
                scope: 'program',
                required: true,
                takesValue: true,
                valueHint: 'path',
              },
            ],
          },
        ],
      }),
    )
    expect(p).toContain('- analyze [--diff]')
    expect(p).not.toContain('analyze [--diff] [--verbose]')
    expect(p).toContain(
      '    program-level flags (pass before the subcommand): [--verbose] --config <path>',
    )
    // Program-scope descriptions still render in the per-option detail lines.
    expect(p).toContain('    --verbose: Print every step')
  })

  it('renders no grammar block without data, and never on api', () => {
    const bare = buildAuthorUserPrompt(authorCtx())
    expect(bare).not.toContain('COMMAND GRAMMAR')
    expect(buildAuthorUserPrompt(authorCtx({ commandGrammar: [] }))).toBe(bare)
    expect(buildAuthorUserPrompt(apiAuthorCtx({ commandGrammar: grammar() }))).not.toContain(
      'COMMAND GRAMMAR',
    )
  })

  it('a re-authoring prompt carries the same grammar block', () => {
    // A prompt built with PRIOR-REJECTION evidence is still the same flow's prompt:
    // the given facts it composes argv from must survive the re-ask.
    const p = buildAuthorUserPrompt(
      authorCtx({
        commandGrammar: grammar(),
        priorFlag: { title: 'setup stores the key', mismatch: 'asserted only the exit code' },
      }),
    )
    expect(p).toContain('PRIOR FLAG —')
    expect(p).toContain('- config llm setup --transport <claude-code|api>')
  })

  it('the cli system prompt states the grammar rule; the api prompt says nothing of it', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('# Command grammar is given')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('never pass a flag')
    // A sandbox that contradicts the given grammar is reported, never worked around.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('a sandbox contradiction is a JOURNEY DEFECT')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('do NOT work around it')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('the fix heals every flow')
    // The doc-example precedence stays intact: a worked example still runs verbatim.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('still runs byte-for-byte')
    expect(WORKER_API_SYSTEM_PROMPT).not.toContain('COMMAND GRAMMAR')
  })

  // The field case, end to end: a commander registration with a required
  // `--transport <mode>` option reaches the authoring context as a usage block
  // naming it — through the real analyzer and the journey mapper.
  it('a commander registration reaches the authoring context as its usage block', () => {
    const journeys = deriveCliJourneysFromTree([
      analyzeFileContent(
        'src/cli.ts',
        `
        import { Command } from 'commander'
        const program = new Command()
        const config = program.command('config').description('Configuration')
        const llm = config.command('llm').description('LLM transport')
        llm.command('setup')
          .description('Choose the LLM transport')
          .requiredOption('--transport <mode>', 'Transport to save')
          .option('--model <id>', 'Model id every stage runs on')
          .action(runSetup)
        `,
        'typescript',
      ),
    ])
    const setup = journeys.find((j) => j.id === 'cli/config-llm-setup')
    const invoke = setup?.steps[0]
    if (!invoke || invoke.kind !== 'invoke') throw new Error('expected an invoke step')
    const p = buildAuthorUserPrompt(
      authorCtx({
        commandGrammar: [
          {
            command: invoke.command,
            ...(invoke.label ? { label: invoke.label } : {}),
            options: invoke.options ?? [],
          },
        ],
      }),
    )
    expect(p).toContain('COMMAND GRAMMAR')
    expect(p).toContain('- config llm setup --transport <mode> [--model <id>]   (Choose the LLM transport)')
    expect(p).toContain('    --transport <mode>: Transport to save')
  })

  // The seeding constraint, LOUD, in the capabilities block.
  it('WORKER_CLI_SYSTEM_PROMPT makes the git-seeding constraint impossible to miss', () => {
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('SEEDING RULE (do not skip)')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('setup.git.commits[].files')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('setup.git.staged')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('MUST also be seeded')
    // …and what it costs to skip it: the whole test never builds.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('is never materialized')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('the WHOLE test fails to build')
  })

  // --- authoring USER prompt: the flow and its milestones -------------------

  it('buildAuthorUserPrompt renders the flow header and the realization provenance', () => {
    const p = buildAuthorUserPrompt(authorCtx())
    expect(p).toContain('Program entrypoint: ["node","cli.js"]')
    expect(p).toContain(`FLOW: ${FLOW.title}`)
    expect(p).toContain(`goal: ${FLOW.goal}`)
    expect(p).toContain('milestones: 1')
    expect(p).toContain('realized through: cli:done')
  })

  it('buildAuthorUserPrompt renders one block per milestone — claim, section text, realization', () => {
    const p = buildAuthorUserPrompt(
      authorCtx({
        milestones: [
          milestone({
            order: 1,
            claim: '`add <title>` creates a task',
            sectionHeading: 'add',
            sectionText: '`add <title>` creates a task and prints its id.',
            realization: ['run: ["add"]   (journey cli:add)'],
          }),
          milestone({
            order: 2,
            note: 'observe the completion the previous step enabled',
            realization: ['run: ["done"]   (journey cli:done)', 'run: ["list"]   (journey cli:list)'],
          }),
        ],
      }),
    )
    expect(p).toContain('MILESTONES — the path, in order.')
    expect(p).toContain('Every milestone number below must appear on at least one step:')
    // Milestone 1 — its own claim, heading, and section text.
    expect(p).toContain('--- milestone 1')
    expect(p).toContain('claim: `add <title>` creates a task')
    expect(p).toContain('section: add  (docs/cli.md)')
    expect(p).toContain('`add <title>` creates a task and prints its id.')
    // Milestone 2 — the synthesis note plus every realization line.
    expect(p).toContain('--- milestone 2')
    expect(p).toContain('note: observe the completion the previous step enabled')
    expect(p).toContain('realize with:')
    expect(p).toContain('  run: ["done"]   (journey cli:done)')
    expect(p).toContain('  run: ["list"]   (journey cli:list)')
    // In path order.
    expect(p.indexOf('--- milestone 1')).toBeLessThan(p.indexOf('--- milestone 2'))
  })

  // The standing rule: never silently thin what a model sees. Authoring reasons over
  // the spec text its claims are read against, so that text is embedded VERBATIM —
  // there is no size budget, no outline fallback, and no truncation anywhere on the
  // authoring path. A document that physically exceeds the context must fail loud.
  it('buildAuthorUserPrompt embeds a very large section text VERBATIM — never thinned', () => {
    const huge = ['# Rate limits', ...Array.from({ length: 4000 }, (_, i) => `line ${i}: the limit is 100/min.`)].join('\n')
    const p = buildAuthorUserPrompt(authorCtx({ milestones: [milestone({ sectionText: huge })] }))

    expect(p).toContain(huge)
    expect(p).not.toContain('OUTLINE')
    expect(p).not.toContain('(truncated)')
    expect(p).not.toContain('…')
  })

  it('buildFidelityUserPrompt embeds a very large section text VERBATIM — never thinned', () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `line ${i}: the limit is 100/min.`).join('\n')
    const p = buildFidelityUserPrompt(
      fidelityCtx({
        milestones: [
          { order: 1, claim: 'the limit is 100/min', doc: 'docs/api.md', sectionHeading: 'limits', sectionText: huge },
        ],
      }),
    )

    expect(p).toContain(huge)
    expect(p).not.toContain('(truncated)')
  })

  it('buildAuthorUserPrompt omits the realization lines for an unmatched milestone', () => {
    const p = buildAuthorUserPrompt(authorCtx({ milestones: [milestone({ realization: [] })], journeyPath: [] }))
    expect(p).toContain('--- milestone 1')
    expect(p).not.toContain('realize with:')
    expect(p).not.toContain('realized through:')
  })

  it('buildAuthorUserPrompt renders no correction block — malformed turns re-ask in-loop', () => {
    // The one-shot corrective re-ask is gone: an invalid draft is answered by the
    // run_scenario validation result, and a malformed reply by the loop's re-ask.
    expect(buildAuthorUserPrompt(authorCtx())).not.toContain('CORRECTION —')
  })

  // Fidelity review: does a green scenario actually verify its flow?
  it('FIDELITY_SYSTEM_PROMPT frames the faithful/flagged verdict over the four failure modes', () => {
    expect(FIDELITY_SYSTEM_PROMPT).toContain('faithful')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('flagged')
    // The four ways a green test can be worthless.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('weak')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('vacuous')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('miscast')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('broken chain')
    // The bar: would this test turn red if the claimed behavior were broken?
    expect(FIDELITY_SYSTEM_PROMPT).toContain('would THIS scenario turn red')
    // A flagged verdict must state the mismatch (the finding evidence).
    expect(FIDELITY_SYSTEM_PROMPT).toContain('"mismatch"')
    expect(FIDELITY_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('FIDELITY_SYSTEM_PROMPT judges the scenario against the flow milestone by milestone', () => {
    expect(FIDELITY_SYSTEM_PROMPT).toContain('MILESTONES')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('exercised as a PATH')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('Ask, milestone by milestone')
    // Nothing beyond the milestones is in scope.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('flagged for failing to test something no milestone states')
  })

  it('FIDELITY_PROMPT_FINGERPRINT is pinned — moves only with an intended re-review', () => {
    // A moved fingerprint invalidates the fidelity cache and re-reviews every green
    // scenario, so the value changes only when the review instructions intentionally do.
    // Moved 2026-08: the flagged verdict gained a stated confidence.
    // Moved 2026-08-01: the reviewer flags a ONE-SIDED scenario
    // `weak` on the same two-sided criterion the authoring prompts teach — a claim
    // stating a positive AND a negative half is verified only when the exclusion
    // half is asserted observably too.
    expect(FIDELITY_PROMPT_FINGERPRINT).toBe('a4c250b19c101083')
    expect(fingerprint(FIDELITY_SYSTEM_PROMPT)).toBe('a4c250b19c101083')
  })

  it('buildFidelityUserPrompt carries the flow, every milestone with its section text, and the YAML', () => {
    const p = buildFidelityUserPrompt(
      fidelityCtx({
        milestones: [
          {
            order: 1,
            claim: '`add <title>` creates a task',
            doc: 'docs/cli.md',
            sectionHeading: 'add',
            sectionText: '`add <title>` creates a task.',
          },
          {
            order: 2,
            claim: '`done <id>` prints `Completed t<N> ✓`',
            doc: 'docs/cli.md',
            sectionHeading: 'done',
            sectionText: '`done <id>` prints `Completed t<N> ✓`.',
          },
        ],
      }),
    )
    expect(p).toContain(`FLOW: ${FLOW.title}`)
    expect(p).toContain('MILESTONES the scenario must verify, in order')
    expect(p).toContain('--- milestone 1')
    expect(p).toContain('claim: `add <title>` creates a task')
    expect(p).toContain('section: add  (docs/cli.md)')
    expect(p).toContain('--- milestone 2')
    expect(p).toContain('Completed t<N> ✓')
    expect(p).toContain('SCENARIO UNDER REVIEW')
    expect(p).toContain('title: done marks complete')
    expect(p).not.toContain('CORRECTION —')
  })

  it('buildFidelityUserPrompt appends a CORRECTION block on a re-ask', () => {
    const p = buildFidelityUserPrompt(fidelityCtx({ correction: { invalidOutput: 'not json' } }))
    expect(p).toContain('CORRECTION —')
    expect(p).toContain('not json')
    expect(p).toContain('"faithful" or "flagged"')
  })

  // Batched-birth hygiene — the `${unique}` collision-avoidance authoring rule.
  it('the api authoring prompt instructs embedding ${unique} in created identifiers', () => {
    const p = buildAuthorUserPrompt(apiAuthorCtx())
    expect(p).toContain('${unique}')
    expect(p).toContain('UNIQUE IDENTIFIERS')
  })

  it('the cli authoring prompt also carries the ${unique} rule (it interpolates in cli too)', () => {
    expect(buildAuthorUserPrompt(authorCtx())).toContain('${unique}')
  })

  // Phase 1 — declared api credentials advertised in the AUTHORING USER prompt.
  it('the api authoring prompt advertises declared credentials by name/header + placeholder', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({ credentials: [{ name: 'api-key', header: 'Authorization' }] }),
    )
    expect(p).toContain('CREDENTIALS AVAILABLE')
    expect(p).toContain('api-key')
    expect(p).toContain('Authorization')
    // The exact placeholder syntax the runner substitutes.
    expect(p).toContain('{{cred:api-key}}')
    // Values are never advertised; undeclared credentials still block.
    expect(p).toContain('name `"credentials"` in `blockedOn`')
  })

  it('the api authoring prompt renders identically whether credentials are absent or empty', () => {
    const withoutField = buildAuthorUserPrompt(apiAuthorCtx())
    const withEmpty = buildAuthorUserPrompt(apiAuthorCtx({ credentials: [] }))
    // An absent OR empty credential set adds nothing at all.
    expect(withEmpty).toBe(withoutField)
    expect(withoutField).not.toContain('CREDENTIALS AVAILABLE')
    expect(withoutField).not.toContain('{{cred:')
  })

  it('a cli authoring prompt never renders credential wording', () => {
    // Even if passed, credentials are an api-only concept.
    const ctx = authorCtx({ credentials: [{ name: 'api-key', header: 'Authorization' }] })
    expect(buildAuthorUserPrompt(ctx)).not.toContain('CREDENTIALS AVAILABLE')
  })

  // B7 — per-operation security → credential mapping advertised in the USER prompt.
  it('the api authoring prompt renders both satisfied and unsatisfied operation-auth blocks', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({
        credentials: [{ name: 'api-key', header: 'X-API-Key' }],
        operationAuth: {
          satisfiedBy: [{ scheme: 'apiKeyAuth', credential: 'api-key', header: 'X-API-Key' }],
          unsatisfied: ['oauth2Auth'],
        },
      }),
    )
    expect(p).toContain('OPERATION SECURITY')
    // Satisfied: names the scheme, the credential, its placeholder, and the header.
    expect(p).toContain('apiKeyAuth')
    expect(p).toContain('{{cred:api-key}}')
    expect(p).toContain('X-API-Key')
    // Unsatisfied: names the exact scheme and instructs a blockedOn.
    expect(p).toContain('oauth2Auth')
    expect(p).toContain('blockedOn')
  })

  it('the api authoring prompt renders identically when the operation is public', () => {
    const withoutField = buildAuthorUserPrompt(apiAuthorCtx())
    const withEmpty = buildAuthorUserPrompt(
      apiAuthorCtx({ operationAuth: { satisfiedBy: [], unsatisfied: [] } }),
    )
    expect(withEmpty).toBe(withoutField)
    expect(withoutField).not.toContain('OPERATION SECURITY')
  })

  it('a cli authoring prompt never renders operation-security wording', () => {
    const ctx = authorCtx({
      operationAuth: { satisfiedBy: [{ scheme: 's', credential: 'c', header: 'H' }], unsatisfied: ['x'] },
    })
    expect(buildAuthorUserPrompt(ctx)).not.toContain('OPERATION SECURITY')
  })

  it('WORKER_CLI_PROMPT_FINGERPRINT is pinned — moves only with an intended re-author', () => {
    // A moved fingerprint re-authors every cli flow (it is folded into the worker
    // authoring cache key AND into `flowGenerationInputsHash`), so it must move only
    // when the AUTHORED vocabulary, the session protocol, or the flow-authoring rules
    // genuinely change — never for USER-prompt features (the realization plan, the
    // command grammar, prior-rejection evidence), which belong in buildAuthorUserPrompt.
    expect(fingerprint(WORKER_CLI_SYSTEM_PROMPT)).toBe('b9f0a92760c509d3')
    expect(WORKER_CLI_PROMPT_FINGERPRINT).toBe('b9f0a92760c509d3')
  })

  it('the worker author wakes flows retired under the one-shot cli author', () => {
    // The retirement reset compares the ledger's recorded `promptFingerprint` against
    // the CURRENT surface fingerprint (`retirementResets`, generate.ts). A flow retired
    // under the one-shot cli author recorded 2528d52c09f0e75a; the worker prompt is a
    // different prompt, so that record no longer matches and the flow re-enters work.
    expect(WORKER_CLI_PROMPT_FINGERPRINT).not.toBe('2528d52c09f0e75a')
    expect(WORKER_CLI_PROMPT_FINGERPRINT).not.toBe('51c1ea533c42a935')
  })

  // The enumerated `missing-data` noun — an AUTHORING rule (which
  // noun names which class of missing world), so it lives in both system prompts.
  it('both authoring prompts enumerate the missing-data capability noun', () => {
    for (const prompt of [WORKER_CLI_SYSTEM_PROMPT, WORKER_API_SYSTEM_PROMPT]) {
      expect(prompt).toContain('"missing-data"')
      // Distinguished from the credential and third-party classes, and paired with the
      // entity that names what a seed would have to create.
      expect(prompt).toContain('credentials')
    }
    // Each names the entity a seed would have to create, in its own driver's words.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('add a SECOND entry naming the entity')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('an already-cancelled booking')
  })

  // The story surfaces render the title beside the flow's promise, so
  // a title that quotes the literal expected output says nothing a reviewer needs.
  it('both authoring prompts forbid a title that restates the expected output', () => {
    for (const prompt of [WORKER_CLI_SYSTEM_PROMPT, WORKER_API_SYSTEM_PROMPT]) {
      expect(prompt).toContain('# The title states the PROMISE, never the expected output')
      // (the api prompt wraps the line one word later)
      expect(prompt).toContain('in the words a reader of the doc would')
    }
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('not "stdout contains')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('not "response status is 201"')
  })

  it('the cli prompt roll re-plans every flow — the fingerprint is folded into generationInputsHash', () => {
    // The incremental gate compares a flow's RECORDED manifest hash with the current
    // one; the current one folds WORKER_CLI_PROMPT_FINGERPRINT, so rolling the prompt
    // makes every committed cli flow mismatch and re-plan — which is exactly how a
    // new authoring capability converts the flows that settled `blocked-on` for want
    // of it, with no migration and no manual invalidation.
    const inputs = {
      flowFingerprint: 'sha256:flow',
      sectionKeys: ['sha256:section'],
      journeyFingerprints: ['sha256:journey'],
      recipeFingerprint: 'sha256:recipe',
    }
    const hash = flowGenerationInputsHash(inputs)
    // The hash these very inputs produced under the PRE-roll cli prompt
    // (fingerprint 81604a8d9fa37b2e, before per-step env) — a recorded manifest
    // entry carrying it no longer matches, so its flow becomes work again.
    expect(hash).not.toBe('sha256:974e06334928305e277513d603a023ebb6f4704f9d0913b672eb865c00079332')
    // Deterministic for the inputs themselves: nothing else re-plans.
    expect(flowGenerationInputsHash(inputs)).toBe(hash)
  })

  it('the cli authoring prompt offers per-step env (the same command under several environments)', () => {
    // The field itself arrives via the Zod-derived schema; the prompt adds only what
    // the schema cannot say — WHEN to reach for it.
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('A step may also carry `env`')
    expect(WORKER_CLI_SYSTEM_PROMPT).toContain('THAT step alone')
    // The api driver has no such thing (a booted server's env is fixed at boot).
    expect(WORKER_API_SYSTEM_PROMPT).not.toContain('A step may also carry `env`')
  })

  // The capability is Zod-advertised, but the SEMANTICS ("only when
  // the base URL comes from an env var", "an unmatched call fails") are prose.
  it('the api system prompt teaches setup.http — the env-var precondition and its rules', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`setup.http` FAKES a third-party HTTP')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('${HTTP_STUB:<name>}')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('A request no route matches FAILS the scenario')
    // A third party WITHOUT a base-URL override is still an honest blocked flow.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('a\nthird-party with NO base-URL env override')
    // The capability itself rides the Zod-derived schema, not hand-written prose.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"http"')
  })

  // A PROVIDED service's faults are scriptable — an AUTHORING rule, hence
  // the system prompt, and the reason a flow about upstream failure stops being
  // blocked.
  it('the api system prompt teaches setup.externals — the fault vocabulary and what it unblocks', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('FAULTS on a provided service ARE scriptable')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`setup.externals`')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`refuse: true`')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"once": true')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('must NOT be left `blockedOn`')
    // The block itself rides the Zod-derived schema, not hand-written prose.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"externals"')
  })

  it('the verbatim-path rule spans BOTH operations blocks, with ONE carve-out', () => {
    // The setup half: a flow whose milestones never mention signing up still has to
    // sign up, and the operation for it lives in the second block.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('TWO blocks list them');
    expect(WORKER_API_SYSTEM_PROMPT).toContain('OTHER\n  operations available for setup steps');
    expect(WORKER_API_SYSTEM_PROMPT).toContain('take that operation from the second block rather than inventing one');
    // The carve-out: a claim ABOUT unknown paths must request one.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('ONE carve-out, and only this one');
    expect(WORKER_API_SYSTEM_PROMPT).toContain('an unknown path, an unsupported method on a listed');
    expect(WORKER_API_SYSTEM_PROMPT).toContain('keeps the verbatim rule');
  });

  it('the api system prompt teaches the process-lifecycle steps and their limits', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('# The server PROCESS is drivable')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"boot"')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"signal"')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"logs"')
    // boot.env vs setup.env, stated as a choice.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('Choose `boot.env` over `setup.env` when the claim is about that environment')
    // The restart-persistence shape, spelled out.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`boot` → write it → `signal` → `boot` → read it')
    // Back-compat is stated, so an ordinary flow does not sprout lifecycle steps.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('A scenario that declares NO `boot` gets the usual implicit one')
    // A package script is honestly out of scope — the cli driver is not bent for it.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('A claim about a\npackage script')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('stays honestly `blockedOn`')
    // The stale "scenarios never manage processes" line is gone.
    expect(WORKER_API_SYSTEM_PROMPT).not.toContain('scenarios never manage processes')
  })

  it('MATCH_SYSTEM_PROMPT makes a process milestone realizable on api', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('# The api surface also owns the SERVER PROCESS')
    expect(MATCH_SYSTEM_PROMPT).toContain('state SURVIVING a\nrestart')
    expect(MATCH_SYSTEM_PROMPT).toContain('the journey the test observes it THROUGH')
    expect(MATCH_SYSTEM_PROMPT).toContain('a package script, a build')
  })

  it('WORKER_API_PROMPT_FINGERPRINT is pinned — credential/fixture/response-guidance live in the USER prompt', () => {
    // A moved fingerprint re-authors every api scenario (it is folded into the
    // authoring cache key). The static api system prompt carries the AUTHORED scenario
    // JSON schema (from RawGeneratedApiScenarioSchema) and the flow-authoring rules, so
    // it legitimately moves when the model's own vocabulary changes. It must NOT move
    // for USER-prompt features (credentials, fixtures, request/response schema
    // guidance): if it does, prompt text leaked into the system prompt — put it back in
    // buildAuthorUserPrompt.
    // Rolled once: the static "name the third party you are
    // blocked on" rule is an AUTHORING rule, so it belongs here; the per-repo LIST of
    // detected services stays in the user prompt.
    // Rolled again: the `setup.http` capability entered the
    // authored schema AND the static world-state rules ("the sandbox can fake a
    // third-party HTTP dependency when its base URL comes from env"), so every api
    // section re-authors once — which is how flows blocked on a third party convert.
    // Rolled again: `captureHeaders` entered the AUTHORED schema
    // (so it is in the embedded JSON schema regardless) and the per-scenario cookie jar
    // is a static execution-model rule — a session login is now authorable, so every api
    // section re-authors once.
    // Rolled again: the `missing-data` noun and the "data the
    // flow can create for itself is not blocked" rule are AUTHORING vocabulary, so every
    // api section re-authors once — which is how flows that settled on an unnamed data
    // blocker acquire a countable noun.
    // Rolled again for external API accounts: a USER-PROVIDED external is a
    // new AUTHORING RULE, not a per-repo fact — "a provided service is live: author
    // against it, never stub it, assert shapes not upstream-dependent values, and use
    // setup.http only when the flow needs response control". The per-repo LIST of which
    // services are provided stays in the user prompt. Every api section re-authors once
    // — which is exactly how a flow that settled `blocked-on <service>` converts the
    // moment the user supplies an account for it.
    // Rolled again for fault injection on a PROVIDED external: a new
    // AUTHORING RULE — a provided service's faults are scriptable through
    // `setup.externals`, so a flow about upstream-failure behavior is authorable
    // rather than blocked. The per-repo LIST of provided services stays in the user
    // prompt. Every api section re-authors once, which is how the flows that settled
    // `blocked-on <service>` for want of response control convert.
    // Rolled again for grounding authoring in extracted code truth: three new
    // static RULES — author every request against a path the user prompt LISTS, carry
    // every field it marks REQUIRED, and script a `setup.http` stub so the response
    // satisfies the fields the app READS off that upstream. The per-repo FACTS (the
    // operations, their required fields, the outbound query params and response reads)
    // stay in the user prompt; only the rules that read them are static. Every api
    // section re-authors once, which is how the three measured failure classes —
    // invented paths, 400 on a setup step, a stub the app rejects — convert.
    // Rolled again for server-lifecycle steps: the `boot` / `signal` /
    // `logs` step kinds entered the AUTHORED scenario schema, which the api system
    // prompt embeds verbatim — the model's own vocabulary grew, so every api section
    // re-authors once. This roll is the SCHEMA half; the authoring rules that say when
    // to reach for a lifecycle step roll it again in the same program.
    // Rolled again for the api authoring rules (setup operations + the off-catalog
    // carve-out): the verbatim-path rule now spans BOTH operations blocks and names
    // the setup one explicitly, and a claim ABOUT unknown paths / unsupported methods
    // is exempted from it. Both are static AUTHORING rules, so every api section
    // re-authors once — which is how the flows that invented `/auth/register` and the
    // 404/405 flow that was ruled unrealizable convert.
    // Rolled again for the lifecycle RULES: when to reach for `boot`/`signal`/
    // `logs`, `boot.env` vs `setup.env`, the restart-persistence shape, and the line
    // that keeps a package script off this surface.
    // Rolled again for "one service, one server": a static authoring rule
    // that forbids re-routing a documented path to another service — the cal.com
    // improvisations (`/v2/x` → `/api/v2/x`, a lookalike endpoint) — and names the
    // `missing-server` refusal to return instead. Every api section re-authors once,
    // which is exactly how the scenarios that asked the wrong server convert.
    // Rolled again for the scenario story: the same TITLE rule as the
    // cli prompt, in api words — the promise, never "response status is 201".
    // Rolled again 2026-08-01 (the doc's own examples run
    // VERBATIM), in api words: a documented request a step sends carries the DOC
    // EXAMPLE's bytes as its body, and a documented response is asserted exactly
    // as shown. The bytes stay in the user prompt; every api flow re-authors once.
    // Rolled with it (same wave, 2026-08-01) — two-sided
    // promises get two-sided tests — in api words: a milestone claiming "valid X
    // accepted, invalid X rejected" gets a step for EACH half — the documented
    // success AND the documented rejection — so validation that silently stopped
    // rejecting can never stay green.
    // Rolled again 2026-08-04 for the `sinceLastStep` window: the
    // rule now states the boundary the runner enforces — the window OPENS where the
    // previous step BEGAN, so a line the service flushes after that step's response
    // still counts. Every api flow re-authors once.
    // Rolled 2026-08-05 for the WORKER pivot: the api surface authors through the
    // flow worker session (the one-shot framing became the loop conduct, the Output
    // section became the worker Outcomes, blocked mechanics became the blocked
    // outcome + blockedMilestones, and the operation-contract contradiction became
    // the journey-defect outcome). Every api flow re-authors once — intended.
    expect(fingerprint(WORKER_API_SYSTEM_PROMPT)).toBe('fe0af580a64fe733')
    expect(WORKER_API_PROMPT_FINGERPRINT).toBe('fe0af580a64fe733')
  })

  it('the api authoring prompt teaches the cookie jar and captureHeaders', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('COOKIE JAR')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('never capture or\nre-send the cookie yourself')
    expect(WORKER_API_SYSTEM_PROMPT).toContain('`captureHeaders`')
    // The field itself rides the Zod-derived schema, not hand-written prose.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"captureHeaders"')
  })

  // Phase 2 — the seed fixture catalog advertised in the AUTHORING USER prompt.
  it('the api authoring prompt advertises the seed fixture catalog (names + fields + syntax)', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({
        fixtures: [
          { name: 'user', fields: ['id', 'username'] },
          { name: 'eventType', fields: ['id'] },
        ],
      }),
    )
    expect(p).toContain('FIXTURES AVAILABLE')
    expect(p).toContain('user')
    expect(p).toContain('username')
    expect(p).toContain('eventType')
    // The exact placeholder syntax the runner substitutes (broader than credentials).
    expect(p).toContain('{{fixture:<name>.<field>}}')
    // The "data not listed above" sentence names the canonical noun, so a
    // fixture gap is countable instead of free text.
    expect(p).toContain('name `"missing-data"` plus the entity in `blockedOn`')
  })

  it('the api authoring prompt advertises seed-provided credentials alongside declared ones', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({
        // A declared credential AND a seed-provided one land in the same list.
        credentials: [
          { name: 'api-key', header: 'X-Api-Key' },
          { name: 'pro-user', header: 'Authorization' },
        ],
        fixtures: [{ name: 'user', fields: ['id'] }],
      }),
    )
    expect(p).toContain('{{cred:api-key}}')
    expect(p).toContain('{{cred:pro-user}}')
  })

  // Phase 3 — credential role descriptions rendered next to the name.
  it('the api authoring prompt renders each credential description (role) when present', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({
        credentials: [
          { name: 'owner', header: 'Authorization', description: 'org owner' },
          { name: 'member', header: 'Authorization', description: 'regular member' },
        ],
      }),
    )
    // Both role-distinct descriptions render so the author picks the right principal.
    expect(p).toContain('org owner')
    expect(p).toContain('regular member')
  })

  it('a credential with no description renders the bare name/header/placeholder line', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({ credentials: [{ name: 'api-key', header: 'Authorization' }] }),
    )
    // The description adds nothing when absent.
    expect(p).toContain("- api-key → request header `Authorization`; write `{{cred:api-key}}` as that header's value")
  })

  it('the api authoring prompt renders identically when there is no seed stage (no fixtures)', () => {
    const base = apiAuthorCtx({ credentials: [{ name: 'api-key', header: 'Authorization' }] })
    const withoutFixtures = buildAuthorUserPrompt(base)
    const withEmptyFixtures = buildAuthorUserPrompt({ ...base, fixtures: [] })
    expect(withEmptyFixtures).toBe(withoutFixtures)
    expect(withoutFixtures).not.toContain('FIXTURES AVAILABLE')
    expect(withoutFixtures).not.toContain('{{fixture:')
  })

  // OpenAPI write-op request schemas advertised in the AUTHORING USER prompt.
  it('the api authoring prompt renders the matched request-body schemas', () => {
    const p = buildAuthorUserPrompt(
      apiAuthorCtx({
        endpointSchemas: [
          {
            method: 'POST',
            path: '/v2/bookings',
            requestSchema: '{\n  "type": "object",\n  "required": [\n    "start"\n  ]\n}',
          },
        ],
      }),
    )
    expect(p).toContain('REQUEST BODY SCHEMAS')
    expect(p).toContain('POST /v2/bookings')
    expect(p).toContain('"required"')
    // The schema block comes before the MILESTONES block.
    expect(p.indexOf('REQUEST BODY SCHEMAS')).toBeLessThan(p.indexOf('MILESTONES — the path, in order.'))
  })

  it('renders no request-body schema block when the flow matches no write op (B4 gate: absent vs empty are equal)', () => {
    // This asserts the B4 endpointSchemas GATE (an absent field and an empty array both
    // render nothing) — the api prompt itself is a moving target as USER-prompt
    // features land.
    const withoutField = buildAuthorUserPrompt(apiAuthorCtx())
    const withEmpty = buildAuthorUserPrompt(apiAuthorCtx({ endpointSchemas: [] }))
    expect(withEmpty).toBe(withoutField)
    expect(withoutField).not.toContain('REQUEST BODY SCHEMAS')
  })

  // B5 — response-schema conformance authoring guidance (api-only, operation-bound only).
  it('the api authoring prompt advises `schema: true` when the flow binds to an OpenAPI operation', () => {
    const p = buildAuthorUserPrompt(apiAuthorCtx({ bindsOpenApiOperation: true }))
    expect(p).toContain('RESPONSE SCHEMA CONFORMANCE')
    expect(p).toContain('schema: true')
  })

  it('an api flow NOT bound to an OpenAPI operation renders no response-conformance guidance', () => {
    // Absent flag and explicit false both suppress it, and identically so.
    const absent = buildAuthorUserPrompt(apiAuthorCtx())
    const explicitFalse = buildAuthorUserPrompt(apiAuthorCtx({ bindsOpenApiOperation: false }))
    expect(absent).not.toContain('RESPONSE SCHEMA CONFORMANCE')
    expect(explicitFalse).toBe(absent)
  })

  it('a cli authoring prompt never renders response-schema conformance wording', () => {
    const ctx = authorCtx({ bindsOpenApiOperation: true })
    expect(buildAuthorUserPrompt(ctx)).not.toContain('RESPONSE SCHEMA CONFORMANCE')
  })

  it('a cli authoring prompt never renders request-body schema wording', () => {
    const ctx = authorCtx({ endpointSchemas: [{ method: 'POST', path: '/x', requestSchema: '{}' }] })
    expect(buildAuthorUserPrompt(ctx)).not.toContain('REQUEST BODY SCHEMAS')
  })

  it('RECIPE_SYSTEM_PROMPT documents the optional install step with examples', () => {
    // The descriptive bullet, not just the rendered Zod schema key.
    expect(RECIPE_SYSTEM_PROMPT).toContain('npm ci')
    expect(RECIPE_SYSTEM_PROMPT).toContain('pnpm install --frozen-lockfile')
    expect(RECIPE_SYSTEM_PROMPT).toMatch(/install.*before.*build/is)
  })

  // A frozen install against a repo that commits no lockfile fails
  // outright — the failure mode `npm ci` produced on a lockfile-less repo.
  it('RECIPE_SYSTEM_PROMPT ties each frozen install to the lockfile that must be present', () => {
    expect(RECIPE_SYSTEM_PROMPT).toContain('THE LOCKFILE THAT IS')
    expect(RECIPE_SYSTEM_PROMPT).toContain('pnpm-lock.yaml     → "pnpm install --frozen-lockfile"')
    expect(RECIPE_SYSTEM_PROMPT).toContain('package-lock.json  → "npm ci"')
    expect(RECIPE_SYSTEM_PROMPT).toContain('no lockfile at all → plain "npm install"')
    expect(RECIPE_SYSTEM_PROMPT).toMatch(/FAIL outright when their lockfile is\s+absent/)
  })

  it('WORKER_API_SYSTEM_PROMPT forbids re-routing a documented path to another service', () => {
    expect(WORKER_API_SYSTEM_PROMPT).toContain('# One service, one server — never re-route a documented path')
    // The three improvisations the cal.com bench measured, each named and forbidden.
    expect(WORKER_API_SYSTEM_PROMPT).toMatch(/NOT\s+rewrite\s+its\s+prefix/)
    expect(WORKER_API_SYSTEM_PROMPT).toMatch(/NOT\s+substitute\s+a\s+different\s+endpoint/)
    expect(WORKER_API_SYSTEM_PROMPT).toMatch(/hoping\s+it\s+is\s+proxied/)
    // …with the refusal it must return instead — the noun the generate gate uses.
    expect(WORKER_API_SYSTEM_PROMPT).toContain('"blockedOn": ["missing-server"')
  })

  it('buildAuthorUserPrompt names the BOUND server, and stays byte-identical without one', () => {
    const bound = buildAuthorUserPrompt(
      apiAuthorCtx({ server: { name: 'api-v2', app: 'apps/api/v2', description: 'the public REST API' } }),
    )
    expect(bound).toContain('Service: "api-v2" — the workspace app apps/api/v2 (the public REST API).')
    expect(bound).toContain('your scenario runs against THIS one only')
    // A single-service repo (no binding) renders exactly the prompt it always did.
    expect(buildAuthorUserPrompt(apiAuthorCtx())).not.toContain('Service: "')
  })

  it('RECIPE_SYSTEM_PROMPT tells a multi-service workspace to declare api.servers with `app`', () => {
    expect(RECIPE_SYSTEM_PROMPT).toContain('api.servers')
    expect(RECIPE_SYSTEM_PROMPT).toContain('api.defaultServer')
    expect(RECIPE_SYSTEM_PROMPT).toMatch(/MORE THAN ONE HTTP service/)
    // The join key to the route manifest, and why declaring one service is not enough.
    expect(RECIPE_SYSTEM_PROMPT).toContain('apps/api/v2')
    expect(RECIPE_SYSTEM_PROMPT).toMatch(/untestable/)
  })

  it('buildRecipeUserPrompt lists the workspace apps and their route prefixes', () => {
    const prompt = buildRecipeUserPrompt({
      packageJson: '{}',
      presentInputs: ['package.json'],
      apps: [
        { dir: 'apps/web', pkg: '@acme/web', framework: 'next', prefixes: ['/api'] },
        { dir: 'apps/api/v2', pkg: '@acme/api-v2', framework: 'nest', prefixes: ['/v2'] },
      ],
    })
    expect(prompt).toContain('Workspace apps in this repository')
    expect(prompt).toContain('apps/api/v2 · @acme/api-v2 · nest · /v2')
    // A single-package repo gets exactly the prompt it always did.
    expect(buildRecipeUserPrompt({ packageJson: '{}', presentInputs: [] })).not.toContain('Workspace apps')
  })

  it('buildRecipeUserPrompt correction text names the optional install field', () => {
    const prompt = buildRecipeUserPrompt({
      packageJson: '{}',
      presentInputs: ['package.json'],
      correction: { invalidOutput: '(not json)' },
    })
    expect(prompt).toContain('"install"')
  })

  it('buildRecipeUserPrompt quotes the rejected proposal and the verification report verbatim', () => {
    const failure = 'after `pnpm build`, entry file not found: dist/cli.js (resolved: /r/dist/cli.js)\ndist/ contains: cli.mjs'
    const prompt = buildRecipeUserPrompt({
      packageJson: '{}',
      presentInputs: ['package.json'],
      retry: { proposal: '{\n  "build": "pnpm build"\n}', failure },
    })
    expect(prompt).toContain('RETRY — the engine RAN your previous proposal and it did NOT verify.')
    // The engine's own text, line for line — the prompt never classifies or
    // summarizes it, so any failure kind reads the same way.
    for (const line of failure.split('\n')) expect(prompt).toContain(line)
    expect(prompt).toContain('"build": "pnpm build"')
  })

  // Observed on a legacy tree where the package manager crashes but
  // the CLI is a plain script — dropping the install IS the fix, not a workaround.
  it('the revision block allows dropping a failing install for a dependency-free CLI', () => {
    const prompt = buildRecipeUserPrompt({
      packageJson: '{}',
      presentInputs: ['package.json'],
      retry: { proposal: '{"install":"npm ci","build":"true"}', failure: 'install `npm ci` failed: EUSAGE' },
    })
    expect(prompt).toContain('OMITTING install entirely')
    expect(prompt).toContain('is a VALID revision')
    // …and the engine still proves it: a wrong omission fails the same verification.
    expect(prompt).toMatch(/the engine still verifies that the entry answers/)
    // The lockfile half of the same failure class.
    expect(prompt).toContain('a lockfile the repository does not commit')
  })

  it('buildRecipeUserPrompt renders no retry wording on a first ask', () => {
    const prompt = buildRecipeUserPrompt({ packageJson: '{}', presentInputs: ['package.json'] })
    expect(prompt).not.toContain('RETRY')
  })

  // --- realization matching (guard.match) -----------------------------------

  it('MATCH_SYSTEM_PROMPT closes the action space with the shared no-tools guardrail', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('MATCH_SYSTEM_PROMPT forbids inventing journey ids — the catalog is the closed set', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('Use ONLY journeys from the catalog below')
    expect(MATCH_SYSTEM_PROMPT).toContain('copied VERBATIM')
    expect(MATCH_SYSTEM_PROMPT).toContain('An id that is not in the catalog invalidates your whole answer')
    // Every milestone is covered, in path order, matched on behavior not wording.
    expect(MATCH_SYSTEM_PROMPT).toContain('Every milestone must appear in the plan at least once')
    expect(MATCH_SYSTEM_PROMPT).toContain('Keep the plan in milestone order')
    expect(MATCH_SYSTEM_PROMPT).toContain('Match on BEHAVIOR, not on wording')
  })

  it('MATCH_SYSTEM_PROMPT makes `unrealizable` a first-class answer, never a partial plan', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('# When the surface cannot do it — say so, and say why')
    expect(MATCH_SYSTEM_PROMPT).toContain('do NOT return a partial plan')
    expect(MATCH_SYSTEM_PROMPT).toContain('do NOT stretch an')
    expect(MATCH_SYSTEM_PROMPT).toContain('first-class, useful answer')
    // The two answers, and only the two.
    expect(MATCH_SYSTEM_PROMPT).toContain('{ "unrealizable": "<one sentence: which milestone nothing realizes, and why>" }')
    expect(MATCH_SYSTEM_PROMPT).toContain('Exactly one of the two')
  })

  it('MATCH_SYSTEM_PROMPT keeps an off-catalog claim realizable on the api surface', () => {
    expect(MATCH_SYSTEM_PROMPT).toContain('# A route the app does NOT have is still the api surface');
    expect(MATCH_SYSTEM_PROMPT).toContain('the catalog lists the routes that\nEXIST');
    expect(MATCH_SYSTEM_PROMPT).toContain('Do not call it unrealizable.');
  });

  it('MATCH_PROMPT_FINGERPRINT is pinned — moves only with an intended re-match', () => {
    // A moved fingerprint invalidates the match cache and re-runs matching for every
    // (flow, surface) pair, so the value changes only when the rules intentionally do.
    // Rolled once: a milestone about an UNKNOWN path or an unsupported method
    // is realizable on the api surface (the catalog lists what EXISTS; the claim is
    // about what happens off that list), so the 404/405 flow that settled
    // `unrealizable` re-matches into a plan.
    // Rolled again for the lifecycle half: the api surface owns the server
    // PROCESS, so a startup/shutdown/logging/restart milestone is planned against the
    // journey it is observed through instead of settling `unrealizable`.
    expect(MATCH_PROMPT_FINGERPRINT).toBe('df2d1a56fb52b946')
    expect(fingerprint(MATCH_SYSTEM_PROMPT)).toBe('df2d1a56fb52b946')
  })

  it('buildMatchUserPrompt renders the milestones and the catalog digest (ids, entries, steps)', () => {
    const p = buildMatchUserPrompt(matchCtx())
    expect(p).toContain('Surface: cli')
    expect(p).toContain(`FLOW: ${FLOW.title}`)
    expect(p).toContain('MILESTONES — the path to walk, in order:')
    expect(p).toContain('  1. `add <title>` creates a task')
    // Synthesis' note rides next to the claim.
    expect(p).toContain('  (observe the completion)')
    expect(p).toContain('JOURNEY CATALOG for cli')
    // Each journey: its id, title, entry descriptor, and one line per step.
    expect(p).toContain('--- id: cli:tasks-add')
    expect(p).toContain('title: Add a task')
    expect(p).toContain('entry: tasks add')
    expect(p).toContain('steps:')
    expect(p).toContain('  invoke: tasks add  flags: --json')
    expect(p).toContain('  writes: tasks.json')
    expect(p).toContain('--- id: cli:tasks-done')
    expect(p).toContain('entry: tasks done')
    expect(p).not.toContain('CORRECTION —')
  })

  it('buildMatchUserPrompt renders a journey with no steps as id/title/entry only', () => {
    const p = buildMatchUserPrompt(
      matchCtx({ journeys: [{ id: 'cli:version', title: 'Print the version', entry: 'version', steps: [] }] }),
    )
    expect(p).toContain('--- id: cli:version')
    expect(p).toContain('entry: version')
    expect(p).not.toContain('steps:')
  })

  it('buildMatchUserPrompt quotes back the unknown journeys and the milestone gaps', () => {
    const p = buildMatchUserPrompt(
      matchCtx({
        issues: {
          unknownJourneys: ['cli:tasks-archive'],
          uncoveredMilestones: [2],
          unknownMilestones: [9],
        },
      }),
    )
    // The exact invented id, quoted back.
    expect(p).toContain('CORRECTION — these journey ids are NOT in the catalog above.')
    expect(p).toContain('- cli:tasks-archive')
    // The exact out-of-range milestone, plus the closed number set.
    expect(p).toContain('CORRECTION — these `milestone` values match no milestone of this flow.')
    expect(p).toContain('the numbers listed above (1..2):')
    expect(p).toContain('  9')
    // The uncovered milestone, and the honest way out.
    expect(p).toContain('CORRECTION — your plan covered no journey for these milestones.')
    expect(p).toContain('answer `unrealizable` naming what is missing')
    expect(p).toContain('  2')
    expect(p).toContain('Return the COMPLETE answer again as one JSON object matching the schema.')
  })

  it('buildMatchUserPrompt appends a CORRECTION block quoting the invalid output', () => {
    const p = buildMatchUserPrompt(matchCtx({ correction: { invalidOutput: 'here is my plan: …' } }))
    expect(p).toContain('CORRECTION — your previous response was NOT valid. You returned:')
    expect(p).toContain('here is my plan: …')
    expect(p).toContain('{ "plan": [ { "journeyId", "milestone" }, … ] }')
    expect(p).toContain('or { "unrealizable": "<one')
  })

  // --- flow synthesis (guard.flows) -----------------------------------------

  it('FLOWS_SYSTEM_PROMPT closes the action space with the shared no-tools guardrail', () => {
    expect(FLOWS_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(FLOWS_EPIC_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('FLOWS_SYSTEM_PROMPT keeps synthesis spec-only — the independence invariant', () => {
    // Milestones are copies of extracted claims, never new assertions.
    expect(FLOWS_SYSTEM_PROMPT).toContain('COPIES one given claim')
    expect(FLOWS_SYSTEM_PROMPT).toContain('Never invent, reword, translate, shorten, merge, or split a claim')
    // No code, no probes, no recipe ever reach this stage.
    expect(FLOWS_SYSTEM_PROMPT).toContain('You have NO code, NO commands, NO test framework, and NO repository')
    expect(FLOWS_SYSTEM_PROMPT).not.toContain('transcript')
    expect(FLOWS_SYSTEM_PROMPT).not.toContain('recipe')
    expect(FLOWS_SYSTEM_PROMPT).not.toContain('journey')
  })

  it('FLOWS_SYSTEM_PROMPT states the coverage honesty rule and the granularity spectrum', () => {
    expect(FLOWS_SYSTEM_PROMPT).toContain('# Coverage honesty')
    expect(FLOWS_SYSTEM_PROMPT).toContain('account: required')
    expect(FLOWS_SYSTEM_PROMPT).toContain('noFlowClaims')
    // Atomic flows are legitimate; near-duplicates are not.
    expect(FLOWS_SYSTEM_PROMPT).toContain('A ONE-MILESTONE flow is correct and expected')
    expect(FLOWS_SYSTEM_PROMPT).toContain('No near-duplicates')
  })

  it('FLOWS_PROMPT_FINGERPRINT is pinned — moves only with an intended re-synthesis', () => {
    expect(FLOWS_PROMPT_FINGERPRINT).toBe('654d47c7386fcd58')
    expect(FLOWS_EPIC_PROMPT_FINGERPRINT).toBe('e49a339b46f07d79')
  })

  it('FLOWS_EPIC_SYSTEM_PROMPT defaults to no epics and only chains listed flows', () => {
    expect(FLOWS_EPIC_SYSTEM_PROMPT).toContain('The default answer is none')
    expect(FLOWS_EPIC_SYSTEM_PROMPT).toContain('DIFFERENT areas')
    expect(FLOWS_EPIC_SYSTEM_PROMPT).toContain('{ "epics": [] }')
  })

  it('buildFlowsUserPrompt carries the claims, the outlines, and the accounting marks', () => {
    const ctx: FlowsUserContext = {
      areaId: 'tasks',
      claims: [
        { doc: 'docs/tasks.md', anchor: 'tasks/creating-tasks', claim: '`add <title>` creates a task', driver: 'cli', required: true },
        { doc: 'docs/tasks.md', anchor: 'tasks/board', claim: 'the board shows one card per task', driver: 'web', required: false },
      ],
      docs: [
        {
          doc: 'docs/tasks.md',
          outline: [{ anchor: 'tasks/creating-tasks', headingText: 'Creating tasks', level: 2 }],
          untestable: [{ anchor: 'tasks/rationale', reason: 'design history' }],
        },
      ],
    }
    const p = buildFlowsUserPrompt(ctx)
    expect(p).toContain('Area: tasks')
    expect(p).toContain('DOCUMENT OUTLINES')
    expect(p).toContain('tasks/creating-tasks — Creating tasks')
    expect(p).toContain('no testable behavior: tasks/rationale')
    expect(p).toContain('claim: `add <title>` creates a task')
    expect(p).toContain('surface: cli   account: required')
    expect(p).toContain('surface: web   account: optional')
    expect(p).not.toContain('CORRECTION')
  })

  it('buildFlowsUserPrompt quotes back unknown references and unaccounted claims', () => {
    const p = buildFlowsUserPrompt({
      areaId: 'tasks',
      claims: [],
      docs: [],
      issues: {
        unknownReferences: ['docs/tasks.md#tasks/creating-tasks — "`archive` hides a task"'],
        uncoveredClaims: ['docs/tasks.md#tasks/listing-tasks — "`list` prints open tasks"'],
      },
    })
    expect(p).toContain('matched NO claim above')
    expect(p).toContain('`archive` hides a task')
    expect(p).toContain('account: required` but your answer put')
    expect(p).toContain('`list` prints open tasks')
    expect(p).toContain('Return the COMPLETE answer again')
  })

  it('buildFlowsEpicUserPrompt renders digests only — refs, titles, milestones', () => {
    const ctx: FlowsEpicUserContext = {
      digests: [
        {
          ref: 'F1',
          areaId: 'tasks',
          title: 'Create and complete a task',
          goal: 'A user finishes a task.',
          milestones: [{ doc: 'docs/tasks.md', anchor: 'tasks/creating-tasks', claimTitle: '`add <title>` creates a task' }],
        },
      ],
    }
    const p = buildFlowsEpicUserPrompt(ctx)
    expect(p).toContain('--- F1  (area: tasks)')
    expect(p).toContain('title: Create and complete a task')
    expect(p).toContain('1. docs/tasks.md#tasks/creating-tasks — `add <title>` creates a task')
  })
})
