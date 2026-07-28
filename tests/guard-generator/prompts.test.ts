import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_PROMPT_FINGERPRINT,
  GENERATE_API_PROMPT_FINGERPRINT,
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
  type FidelityUserContext,
  type MatchUserContext,
  type FlowsUserContext,
  type FlowsEpicUserContext,
} from '@truecourse/guard-generator'
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'

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

/** A retry authoring prompt carrying birth-failure evidence. */
function retryPrompt(): string {
  return buildAuthorUserPrompt(
    authorCtx({
      retry: {
        scenarioTitle: 'done marks the task complete',
        step: 1,
        expected: 'stdout contains "Completed t1 ✓"',
        actual: 'Marked t1 as done',
      },
    }),
  )
}

describe('guard-generator prompts', () => {
  it('GENERATE_SYSTEM_PROMPT carries the world-state capabilities block', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# World-state capabilities')
    expect(GENERATE_SYSTEM_PROMPT).toContain('setup.git')
    // The sandbox realities, one line each.
    expect(GENERATE_SYSTEM_PROMPT).toContain('no network')
    expect(GENERATE_SYSTEM_PROMPT).toContain('allowlisted')
    expect(GENERATE_SYSTEM_PROMPT).toContain('no shell')
  })

  it('GENERATE_SYSTEM_PROMPT documents the blockedOn output shape', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('blockedOn')
    expect(GENERATE_SYSTEM_PROMPT).toContain('service|db|network|credentials')
  })

  it('GENERATE_SYSTEM_PROMPT closes the action space (no tools / no repo access)', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# No tools, no repository access')
    expect(GENERATE_SYSTEM_PROMPT).toContain('You have NO tools and NO repository access')
    expect(GENERATE_SYSTEM_PROMPT).toContain('<tool_use>')
    // Points the model at the injected transcripts instead of inspecting code.
    expect(GENERATE_SYSTEM_PROMPT).toContain('REAL BEHAVIOR')
  })

  it('EXTRACT and RECIPE carry the shared output-only guardrail', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(RECIPE_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('GENERATE keeps its own richer no-tools block, not the shared constant', () => {
    // GENERATE was hardened by an earlier pass with a fuller block; leave it as is.
    expect(GENERATE_SYSTEM_PROMPT).not.toContain(OUTPUT_ONLY_GUARDRAIL)
    expect(GENERATE_SYSTEM_PROMPT).toContain('# No tools, no repository access')
  })

  it('EXTRACT_PROMPT_FINGERPRINT is pinned — moves only with an intended re-extract', () => {
    // Pinned literal: the prompt renders the driver registry's ids, so the
    // desktop + mobile journey-type rows moved this from 40e35f8ec26c72cb (the api
    // driver becoming authorable). It must not move again silently.
    expect(fingerprint(EXTRACT_SYSTEM_PROMPT)).toBe('bf102597e1e53068')
  })

  // Item 23 — LLM-dependent commands classify as blocked-on, never authored.
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

  // Item 32 — assertions come from the claim/doc, never the transcript (AUTHORING).
  it('GENERATE_SYSTEM_PROMPT rules assertions come from the claim, not the transcript', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Assertions come from the claim, never the transcript')
    expect(GENERATE_SYSTEM_PROMPT).toContain('you MUST STILL assert the CLAIM')
    expect(GENERATE_SYSTEM_PROMPT).toContain('fails birth')
    expect(GENERATE_SYSTEM_PROMPT).toContain('surfaces as a finding')
    expect(GENERATE_SYSTEM_PROMPT).toContain('effect-only check')
    // The old "ground every assertion in the transcript" instruction is gone.
    expect(GENERATE_SYSTEM_PROMPT).not.toContain('Ground every assertion about output in those transcripts')
  })

  it('GENERATE_SYSTEM_PROMPT carries the compact worked example (claim X vs transcript Y)', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('Worked example')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Completed t1 ✓')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Marked t1 as done')
  })

  it('GENERATE_SYSTEM_PROMPT keeps faithfulness the prime directive', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Faithfulness — the prime directive')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('# Faithfulness — the prime directive')
    // A green test that proves less than the claim is the worst outcome.
    expect(GENERATE_SYSTEM_PROMPT).toContain('must never claim more than the prose does')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('must never claim more than the prose does')
  })

  // The milestone contract — every milestone realized, plumbing steps unannotated.
  it('GENERATE_SYSTEM_PROMPT requires every milestone to carry a step, plumbing steps none', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# The path is the point: one scenario, every milestone')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Every milestone MUST be realized by at least one step')
    expect(GENERATE_SYSTEM_PROMPT).toContain("milestone: <that milestone's number>")
    // A seeding / unasserted step paints neutral.
    expect(GENERATE_SYSTEM_PROMPT).toContain('only prepares the world')
    expect(GENERATE_SYSTEM_PROMPT).toContain('carries NO `milestone`')
    // The numbers are given, not the model's to reshape.
    expect(GENERATE_SYSTEM_PROMPT).toContain('Never renumber, merge, split, skip, or invent a milestone')
    // Missing world-state is declared in `setup`, never an excuse to drop a milestone.
    expect(GENERATE_SYSTEM_PROMPT).toContain('never drop the milestone')
  })

  it('GENERATE_API_SYSTEM_PROMPT states the same milestone contract for the api surface', () => {
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('# The path is the point: one scenario, every milestone')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('Every milestone MUST be realized by at least one step')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('carries NO `milestone`')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('Never renumber, merge, split, skip, or invent a milestone')
    // One server, one path — chained with capture rather than guessed ids.
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('one freshly booted server')
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('`capture`')
  })

  it('both authoring prompts ask for ONE scenario object, or a blockedOn instead', () => {
    for (const prompt of [GENERATE_SYSTEM_PROMPT, GENERATE_API_SYSTEM_PROMPT]) {
      expect(prompt).toContain('# Output — ONE object, carrying one scenario')
      expect(prompt).toContain('Return EXACTLY ONE JSON object')
      expect(prompt).toContain('"scenario": { … the scenario, its steps carrying `milestone` … }')
      expect(prompt).toContain('"blockedOn"')
      expect(prompt).toContain('Exactly one of the two')
    }
    // Item 57: the api refusal shape asks for the SERVICE NAME, not a generic noun.
    expect(GENERATE_API_SYSTEM_PROMPT).toContain('the SERVICE NAME when it is a third party')
  })

  // Item 32 — mirrored rule in the RETRY prompt (buildAuthorUserPrompt with retry evidence).
  it('the RETRY authoring prompt keeps the claim assertion on a doc-vs-code disagreement', () => {
    const p = retryPrompt()
    expect(p).toContain('RETRY —')
    expect(p).toContain('fix COMMANDS')
    expect(p).toContain('DOC-vs-CODE disagreement on an asserted VALUE')
    expect(p).toContain("KEEP the claim's assertion")
    expect(p).toContain('correctly becomes a finding')
    expect(p).toContain('Never weaken an')
    // Reordering the path is allowed; dropping a milestone to go green is not.
    expect(p).toContain('MAY REORDER the milestones')
    expect(p).toContain('never drop a milestone')
  })

  it('the RETRY prompt is one per-flow block naming the failing step and its milestone', () => {
    const p = buildAuthorUserPrompt(
      authorCtx({
        milestones: [milestone({ order: 1 }), milestone({ order: 2, claim: '`list` prints open tasks' })],
        retry: {
          scenarioTitle: 'done marks the task complete',
          step: 3,
          expected: 'stdout contains "Completed t1 ✓"',
          actual: 'Marked t1 as done',
          milestone: 2,
        },
      }),
    )
    expect(p).toContain('scenario: done marks the task complete')
    expect(p).toContain('failing step: 3 (milestone 2)')
    // Exactly one retry block for the whole flow.
    expect(p.split('RETRY —').length - 1).toBe(1)
  })

  it('the RETRY prompt renders program stdout/stderr blocks after expected/actual', () => {
    const p = buildAuthorUserPrompt(
      authorCtx({
        milestones: [milestone({ claim: '`add` records an expense' })],
        retry: {
          scenarioTitle: 'add records an expense',
          step: 1,
          expected: 'exit 3',
          actual: 'exit 2',
          stdout: 'usage: expense add --amount <n> --note <s>',
          stderr: 'error: missing required flag --amount',
        },
      }),
    )
    // The excerpts follow the expected/actual lines.
    expect(p).toContain('expected: exit 3')
    expect(p).toContain('actual:   exit 2')
    expect(p).toContain('program stdout:')
    expect(p).toContain('usage: expense add --amount <n>')
    expect(p).toContain('program stderr:')
    expect(p).toContain('error: missing required flag --amount')
    expect(p.indexOf('actual:')).toBeLessThan(p.indexOf('program stdout:'))
    // The doc-first rules are untouched.
    expect(p).toContain("KEEP the claim's assertion")
    expect(p).toContain('fix COMMANDS')
  })

  it('the RETRY prompt omits an absent program-output stream', () => {
    // The default retryPrompt() carries no excerpts → neither block renders.
    const p = retryPrompt()
    expect(p).not.toContain('program stdout:')
    expect(p).not.toContain('program stderr:')
  })

  it('a non-retry authoring prompt carries no RETRY block', () => {
    expect(buildAuthorUserPrompt(authorCtx())).not.toContain('RETRY —')
  })

  // Item 6b — the seeding constraint, LOUD, in the capabilities block.
  it('GENERATE_SYSTEM_PROMPT makes the git-seeding constraint impossible to miss', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('SEEDING RULE')
    expect(GENERATE_SYSTEM_PROMPT).toContain('setup.git.commits[].files')
    expect(GENERATE_SYSTEM_PROMPT).toContain('setup.git.staged')
    expect(GENERATE_SYSTEM_PROMPT).toContain('MUST also be seeded')
    // The one-line wrong/right example.
    expect(GENERATE_SYSTEM_PROMPT).toContain('Wrong:')
    expect(GENERATE_SYSTEM_PROMPT).toContain('Right:')
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

  it('buildAuthorUserPrompt omits the realization lines for an unmatched milestone', () => {
    const p = buildAuthorUserPrompt(authorCtx({ milestones: [milestone({ realization: [] })], journeyPath: [] }))
    expect(p).toContain('--- milestone 1')
    expect(p).not.toContain('realize with:')
    expect(p).not.toContain('realized through:')
  })

  it('buildAuthorUserPrompt quotes back the uncovered and unknown milestone numbers', () => {
    const p = buildAuthorUserPrompt(
      authorCtx({
        milestones: [milestone({ order: 1 }), milestone({ order: 2 }), milestone({ order: 3 })],
        issues: { uncoveredMilestones: [2, 3], unknownMilestones: [7] },
      }),
    )
    expect(p).toContain('CORRECTION — no step realized these milestones.')
    expect(p).toContain('one step carrying its number in `milestone`')
    expect(p).toContain('  2, 3')
    expect(p).toContain('CORRECTION — these `milestone` values match no milestone of this flow.')
    // The closed number set is stated, and plumbing steps stay unannotated.
    expect(p).toContain('the numbers listed above (1..3), or omit `milestone` for a plumbing step:')
    expect(p).toContain('  7')
    expect(p).toContain('Return the COMPLETE scenario again, as one JSON object matching the schema.')
  })

  it('buildAuthorUserPrompt renders no issues block when the engine found none', () => {
    expect(buildAuthorUserPrompt(authorCtx())).not.toContain('CORRECTION —')
  })

  it('buildAuthorUserPrompt appends a CORRECTION block restating the one-object output shape', () => {
    const p = buildAuthorUserPrompt(authorCtx({ correction: { invalidOutput: 'not json' } }))
    expect(p).toContain('CORRECTION — your previous response was NOT valid.')
    expect(p).toContain('not json')
    expect(p).toContain('Return exactly ONE JSON object: { "scenario": { … } }')
    expect(p).toContain('driver "cli"')
    expect(p).toContain('{ "blockedOn": ["<capability>"] }')
  })

  // Item 33 — fidelity review: does a green scenario actually verify its flow?
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
    expect(FIDELITY_PROMPT_FINGERPRINT).toBe('8fe12997f659a0c4')
    expect(fingerprint(FIDELITY_SYSTEM_PROMPT)).toBe('8fe12997f659a0c4')
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
    expect(p).toContain('"blockedOn": ["credentials"]')
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

  it('GENERATE_PROMPT_FINGERPRINT is pinned — moves only with an intended re-author', () => {
    // A moved fingerprint re-authors every cli scenario (it is folded into the
    // authoring cache key), so it must move only when the AUTHORED vocabulary or the
    // flow-authoring rules genuinely change — never for USER-prompt features
    // (grounding transcripts, the realization plan, retry evidence), which belong in
    // buildAuthorUserPrompt.
    expect(fingerprint(GENERATE_SYSTEM_PROMPT)).toBe('1d085dd48332778a')
    expect(GENERATE_PROMPT_FINGERPRINT).toBe('1d085dd48332778a')
  })

  it('the cli prompt roll re-plans every flow — the fingerprint is folded into generationInputsHash', () => {
    // The incremental gate compares a flow's RECORDED manifest hash with the current
    // one; the current one folds GENERATE_PROMPT_FINGERPRINT, so rolling the prompt
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
    expect(GENERATE_SYSTEM_PROMPT).toContain('A step may also carry `env`')
    expect(GENERATE_SYSTEM_PROMPT).toContain('THAT step alone')
    // The api driver has no such thing (a booted server's env is fixed at boot).
    expect(GENERATE_API_SYSTEM_PROMPT).not.toContain('A step may also carry `env`')
  })

  it('GENERATE_API_PROMPT_FINGERPRINT is pinned — credential/fixture/response-guidance live in the USER prompt', () => {
    // A moved fingerprint re-authors every api scenario (it is folded into the
    // authoring cache key). The static api system prompt carries the AUTHORED scenario
    // JSON schema (from RawGeneratedApiScenarioSchema) and the flow-authoring rules, so
    // it legitimately moves when the model's own vocabulary changes. It must NOT move
    // for USER-prompt features (credentials, fixtures, request/response schema
    // guidance): if it does, prompt text leaked into the system prompt — put it back in
    // buildAuthorUserPrompt.
    // Rolled once for item 57 (Phase 3): the static "name the third party you are
    // blocked on" rule is an AUTHORING rule, so it belongs here; the per-repo LIST of
    // detected services stays in the user prompt.
    expect(fingerprint(GENERATE_API_SYSTEM_PROMPT)).toBe('f97a8d266ae7e274')
    expect(GENERATE_API_PROMPT_FINGERPRINT).toBe('f97a8d266ae7e274')
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

  // Item 42 / B4 — OpenAPI write-op request schemas advertised in the AUTHORING USER prompt.
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

  it('MATCH_PROMPT_FINGERPRINT is pinned — moves only with an intended re-match', () => {
    // A moved fingerprint invalidates the match cache and re-runs matching for every
    // (flow, surface) pair, so the value changes only when the rules intentionally do.
    expect(MATCH_PROMPT_FINGERPRINT).toBe('57830535ea5d67b2')
    expect(fingerprint(MATCH_SYSTEM_PROMPT)).toBe('57830535ea5d67b2')
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
