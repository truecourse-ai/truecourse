import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  buildRecipeUserPrompt,
  type AuthorUserContext,
  type FidelityUserContext,
  type SectionInput,
} from '@truecourse/guard-generator'
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'

/** The same content fingerprint the engine folds into the cache keys. */
const fingerprint = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16)

const SECTION: SectionInput = {
  doc: 'docs/cli.md',
  anchor: 'done',
  fingerprint: 'sha256:x',
  headingText: 'done',
  level: 2,
  ownText: '`done <id>` prints `Completed t<N> ✓`.',
  fullText: '',
  areaTags: [],
}

/** A retry authoring prompt for one claim carrying birth-failure evidence. */
function retryPrompt(): string {
  const ctx: AuthorUserContext = {
    doc: 'docs/cli.md',
    docContext: '## done\n`done <id>` prints `Completed t<N> ✓`.',
    areaTags: [],
    recipeEntry: ['node', 'cli.js'],
    recipeBuild: 'true',
    claims: [
      {
        ref: 'c0',
        claim: '`done <id>` prints `Completed t<N> ✓`',
        section: SECTION,
        retry: {
          scenarioTitle: 'done marks the task complete',
          step: 1,
          expected: 'stdout contains "Completed t1 ✓"',
          actual: 'Marked t1 as done',
        },
      },
    ],
  }
  return buildAuthorUserPrompt(ctx)
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
    // Pinned literal: support mining (item 9 — a quantified "supports/handles X"
    // promise becomes a `support`-flavor claim carrying the class + subject) moved
    // this from 4f1fa6e53abe4e1f. It must not move again silently.
    expect(fingerprint(EXTRACT_SYSTEM_PROMPT)).toBe('5f3a52a95d5e2767')
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
    expect(EXTRACT_SYSTEM_PROMPT).toContain('extract api/web/tui/library claims')
  })

  // Example mining — a fenced block + a stated outcome becomes an `example` claim.
  it('EXTRACT_SYSTEM_PROMPT mines documented example blocks into example claims', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('# Example blocks — a worked example is a high-value claim')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('"flavor": "example"')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('example.block')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('example.outcome')
    // Crisp "prose states an outcome" criteria.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('STATES AN OUTCOME')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('this fails')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('anti-pattern')
    // A bare snippet with no stated outcome must NOT become a claim.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('must NOT become a claim')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('ILLUSTRATE')
    // One positive and one negative worked example.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('POSITIVE — emit an example claim')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('NEGATIVE — do NOT emit a claim')
    // The block is copied byte-for-byte, never reformatted.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('copied VERBATIM')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('re-indented')
  })

  // Support mining (item 9) — a quantified "supports X" promise becomes a `support` claim.
  it('EXTRACT_SYSTEM_PROMPT recognizes quantified support claims, with a positive and a negative example', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('# Support claims — a "supports X" promise tested over a GENERATED corpus')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('"flavor": "support"')
    // The closed class enum + the subject payload.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('"kind": "language" | "dialect" | "format" | "syntax"')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('"subject"')
    // The deciding line: quantification over a class, not a mention.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('QUANTIFICATION over a class')
    // One positive and one negative worked example (a mere mention is NOT a support claim).
    expect(EXTRACT_SYSTEM_PROMPT).toContain('POSITIVE — emit a support claim')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('NEGATIVE — do NOT emit a support claim')
    expect(EXTRACT_SYSTEM_PROMPT).toContain('MENTIONS dialects without promising')
  })

  it('GENERATE_SYSTEM_PROMPT rules a support claim runs the documented operation over a generated corpus', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Support claims — ONE operation, run over a GENERATED corpus')
    // The shared boring expectation, authored from what the section promises.
    expect(GENERATE_SYSTEM_PROMPT).toContain('BORING PASS')
    expect(GENERATE_SYSTEM_PROMPT).toContain('unparsable')
    // One rule scenario; the engine stages the corpus, the model never seeds it.
    expect(GENERATE_SYSTEM_PROMPT).toContain('Return exactly ONE scenario for a support claim')
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

  // Example mining — the example claim's authoring rule is loud about byte-faithful inputs.
  it('GENERATE_SYSTEM_PROMPT rules an example claim seeds the doc block byte-faithfully', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Example claims — the doc\'s own block IS the input, byte-faithful')
    expect(GENERATE_SYSTEM_PROMPT).toContain('BYTE-FOR-BYTE')
    expect(GENERATE_SYSTEM_PROMPT).toContain('do NOT invent or paraphrase inputs')
    // No reformatting / no "fixing" a deliberately-broken example.
    expect(GENERATE_SYSTEM_PROMPT).toContain('re-indent')
    expect(GENERATE_SYSTEM_PROMPT).toContain('must stay broken')
    // The model still owns the mechanics (command, path, matcher form).
    expect(GENERATE_SYSTEM_PROMPT).toContain('only the MECHANICS')
  })

  // Example mining — buildAuthorUserPrompt threads the verbatim block + instruction.
  it('buildAuthorUserPrompt renders an example claim\'s block verbatim with the byte-faithful rule', () => {
    // A block with deliberately tricky whitespace/indentation to prove byte-faithfulness.
    const block = 'SELECT\n\t a.b,\n  a.c\nFROM  a   JOIN b USING (id)\n'
    const ctx: AuthorUserContext = {
      doc: 'docs/rules/st07.md',
      docContext: '## ST07\nThis query is an anti-pattern; ST07 flags it.',
      areaTags: [],
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      claims: [
        {
          ref: 'c0',
          claim: 'the query is flagged by ST07',
          section: SECTION,
          example: { block, outcome: 'ST07 flags this query' },
        },
      ],
    }
    const p = buildAuthorUserPrompt(ctx)
    expect(p).toContain('EXAMPLE BLOCK')
    // The exact bytes survive — no reformatting of tabs/multi-spaces/newlines.
    expect(p).toContain(block)
    expect(p).toContain('promised outcome: ST07 flags this query')
    // The instruction forbids editing the block.
    expect(p).toContain('BYTE-FOR-BYTE')
    expect(p).toMatch(/do NOT reformat/i)
  })

  it('buildAuthorUserPrompt carries no EXAMPLE BLOCK for a normal (non-example) claim', () => {
    const ctx: AuthorUserContext = {
      doc: 'docs/cli.md',
      docContext: '## done',
      areaTags: [],
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      claims: [{ ref: 'c0', claim: 'x', section: SECTION }],
    }
    expect(buildAuthorUserPrompt(ctx)).not.toContain('EXAMPLE BLOCK')
  })

  // Item 32 — mirrored rule in the RETRY prompt (buildAuthorUserPrompt with retry evidence).
  it('the RETRY authoring prompt keeps the claim assertion on a doc-vs-code disagreement', () => {
    const p = retryPrompt()
    expect(p).toContain('RETRY —')
    expect(p).toContain('fix COMMANDS')
    expect(p).toContain('DOC-vs-CODE disagreement on the asserted VALUE')
    expect(p).toContain("KEEP the claim's assertion")
    expect(p).toContain('correctly becomes a finding')
    expect(p).toContain('Do NOT change a')
  })

  // Fix 1 (PR 1) — the RETRY prompt renders the failing run's raw program output
  // as the evidence its doc-first language already refers to.
  it('the RETRY prompt renders program stdout/stderr blocks after expected/actual', () => {
    const ctx: AuthorUserContext = {
      doc: 'docs/cli.md',
      docContext: '## add',
      areaTags: [],
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      claims: [
        {
          ref: 'c0',
          claim: '`add` records an expense',
          section: SECTION,
          retry: {
            scenarioTitle: 'add records an expense',
            step: 1,
            expected: 'exit 3',
            actual: 'exit 2',
            stdout: 'usage: expense add --amount <n> --note <s>',
            stderr: 'error: missing required flag --amount',
          },
        },
      ],
    }
    const p = buildAuthorUserPrompt(ctx)
    // The excerpts follow the expected/actual lines.
    expect(p).toContain('expected: exit 3')
    expect(p).toContain('actual:   exit 2')
    expect(p).toContain('program stdout:')
    expect(p).toContain('usage: expense add --amount <n>')
    expect(p).toContain('program stderr:')
    expect(p).toContain('error: missing required flag --amount')
    expect(p.indexOf('actual:')).toBeLessThan(p.indexOf('program stdout:'))
    // The doc-first rules are untouched.
    expect(p).toContain("Do NOT change a")
    expect(p).toContain('fix COMMANDS')
  })

  it('the RETRY prompt omits an absent program-output stream', () => {
    // The default retryPrompt() carries no excerpts → neither block renders.
    const p = retryPrompt()
    expect(p).not.toContain('program stdout:')
    expect(p).not.toContain('program stderr:')
  })

  it('a non-retry authoring prompt carries no RETRY block', () => {
    const ctx: AuthorUserContext = {
      doc: 'docs/cli.md',
      docContext: '## done',
      areaTags: [],
      recipeEntry: ['node', 'cli.js'],
      recipeBuild: 'true',
      claims: [{ ref: 'c0', claim: 'x', section: SECTION }],
    }
    expect(buildAuthorUserPrompt(ctx)).not.toContain('RETRY —')
  })

  // Item 10 — the retry must ACT on a usage/setup error the program printed, not
  // treat every failure as a keep-the-assertion doc-vs-code disagreement. The
  // evidence was already in the prompt; the rule wording made the model keep the
  // broken invocation and let it become a finding instead of fixing setup.
  it('the RETRY prompt distinguishes a usage/setup error (always fix) from a doc-vs-code disagreement (keep)', () => {
    const p = retryPrompt()
    // The two failure kinds are named and handled oppositely.
    expect(p).toContain('FIRST decide which of two failures this is')
    expect(p).toContain('USAGE / SETUP error')
    expect(p).toContain('REJECTED the invocation')
    expect(p).toContain('never evaluated')
    // A usage/setup error is ALWAYS the scenario's own defect, never a finding.
    expect(p).toContain('ALWAYS a defect in YOUR scenario')
    // Fixing SETUP visibly includes creating/altering a config file.
    expect(p).toContain('CREATE OR EDIT the config file under `setup.files`')
    expect(p).toContain('Do NOT leave the rejected invocation in place')
    // The doc-vs-code branch still stands for a genuine value disagreement.
    expect(p).toContain('DOC-vs-CODE disagreement on the asserted VALUE')
    expect(p).toContain("KEEP the claim's assertion")
  })

  // Item 10 rule (a) — an example's assumed environment is part of the test.
  it("GENERATE_SYSTEM_PROMPT rules the example's assumed environment is reproduced in setup", () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# The assumed environment is part of the test — reproduce it in setup')
    expect(GENERATE_SYSTEM_PROMPT).toContain('REFUSES TO RUN WITHOUT')
    expect(GENERATE_SYSTEM_PROMPT).toContain('a config file under')
    expect(GENERATE_SYSTEM_PROMPT).toContain('DIFFERENT world')
  })

  // Item 10 rule (b) — a scenario verifies ONLY its claim; scope the invocation.
  it('GENERATE_SYSTEM_PROMPT rules a scenario verifies ONLY its claim and scopes the invocation', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Verify ONLY the claim — constrain the invocation so nothing else contaminates it')
    expect(GENERATE_SYSTEM_PROMPT).toContain('contaminate the outcome you assert')
    expect(GENERATE_SYSTEM_PROMPT).toContain('MINIMAL input')
    expect(GENERATE_SYSTEM_PROMPT).toContain("the claim's behavior ALONE")
  })

  // Overfit guard — the two item-10 authoring rules AND the item-1 two-sided rule must
  // stay tool-agnostic: no repo-specific token may leak into a prompt. Validated on the
  // exact rule slices. The forbidden set includes the calibration repos' own vocabulary
  // (a SQL linter's `dialect`, node-semver's `semver`/`comparator`/version tokens) so a
  // rule phrased around one battle-test target can never slip through.
  const REPO_TOKENS = /dialect|sqlfluff|tab_space_size|semver|comparator|\brange\b|version/i
  it('the item-10 authoring rules carry no repo-specific token', () => {
    const start = GENERATE_SYSTEM_PROMPT.indexOf('# The assumed environment is part of the test')
    const end = GENERATE_SYSTEM_PROMPT.indexOf("# Example claims — the doc's own block IS the input")
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const rules = GENERATE_SYSTEM_PROMPT.slice(start, end)
    expect(rules).not.toMatch(REPO_TOKENS)
  })

  // Item 1 — a two-sided claim (asserts both what DOES and does NOT happen) must get a
  // two-sided test. The GENERATE rule states the requirement; the FIDELITY prompt flags
  // the one-sided shape with the SAME criterion. Both phrased generally (overfit guard).
  it('GENERATE_SYSTEM_PROMPT rules a two-sided claim asserts BOTH halves observably', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# Two-sided claims — assert BOTH what DOES and what does NOT happen')
    // Both halves of the behavior are the contract, not just the positive one.
    expect(GENERATE_SYSTEM_PROMPT).toContain('BOTH halves are the contract')
    expect(GENERATE_SYSTEM_PROMPT).toContain('would STILL PASS')
    // The fix: exercise the excluded inputs and assert their exclusion observably.
    expect(GENERATE_SYSTEM_PROMPT).toContain('exercise the excluded inputs')
    expect(GENERATE_SYSTEM_PROMPT).toContain('assert their exclusion')
    // Prefer proving both directions in one invocation.
    expect(GENERATE_SYSTEM_PROMPT).toContain('ONE invocation')
  })

  it('FIDELITY_SYSTEM_PROMPT flags a one-sided scenario for a two-sided claim (same criterion)', () => {
    expect(FIDELITY_SYSTEM_PROMPT).toContain('# Two-sided claims — both halves must be asserted')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('BOTH halves are the contract')
    // A positive-only scenario is weak — it would still pass if the exclusion broke.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('exercises only the')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('STILL PASS')
    // The authoring rule and the flag criterion state the same requirement.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('exercises the excluded inputs')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('asserts their exclusion observably')
  })

  it('the item-1 two-sided rule carries no repo-specific token (both prompts)', () => {
    const gStart = GENERATE_SYSTEM_PROMPT.indexOf('# Two-sided claims — assert BOTH what DOES')
    const gEnd = GENERATE_SYSTEM_PROMPT.indexOf('# The assumed environment is part of the test')
    expect(gStart).toBeGreaterThan(-1)
    expect(gEnd).toBeGreaterThan(gStart)
    expect(GENERATE_SYSTEM_PROMPT.slice(gStart, gEnd)).not.toMatch(REPO_TOKENS)

    const fStart = FIDELITY_SYSTEM_PROMPT.indexOf('# Two-sided claims — both halves must be asserted')
    const fEnd = FIDELITY_SYSTEM_PROMPT.indexOf('# Confidence (on a flagged verdict)')
    expect(fStart).toBeGreaterThan(-1)
    expect(fEnd).toBeGreaterThan(fStart)
    expect(FIDELITY_SYSTEM_PROMPT.slice(fStart, fEnd)).not.toMatch(REPO_TOKENS)
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

  // Item 33 — fidelity review: does a green scenario actually verify its claim?
  it('FIDELITY_SYSTEM_PROMPT frames the faithful/flagged verdict over the three failure modes', () => {
    expect(FIDELITY_SYSTEM_PROMPT).toContain('faithful')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('flagged')
    // The three ways a green test can be worthless.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('weak')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('vacuous')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('miscast')
    // The bar: would this test turn red if the claimed behavior were broken?
    expect(FIDELITY_SYSTEM_PROMPT).toContain('would THIS scenario turn red')
    // A flagged verdict must state the mismatch (the finding evidence).
    expect(FIDELITY_SYSTEM_PROMPT).toContain('"mismatch"')
    // A flagged verdict also carries a confidence — a HIGH one self-heals (discard +
    // re-author) rather than raising a human task.
    expect(FIDELITY_SYSTEM_PROMPT).toContain('"confidence"')
    expect(FIDELITY_SYSTEM_PROMPT).toContain('DISCARD it and re-author once')
    expect(FIDELITY_SYSTEM_PROMPT).toContain(OUTPUT_ONLY_GUARDRAIL)
  })

  it('FIDELITY_PROMPT_FINGERPRINT is pinned — moves only with an intended re-review', () => {
    expect(FIDELITY_PROMPT_FINGERPRINT).toBe('fcac5b0f4e934de5')
  })

  it('buildFidelityUserPrompt carries the section text, the claim, and the scenario YAML', () => {
    const ctx: FidelityUserContext = {
      doc: 'docs/cli.md',
      sectionHeading: 'done',
      sectionText: '`done <id>` prints `Completed t<N> ✓`.',
      claim: '`done <id>` prints `Completed t<N> ✓`',
      scenarioYaml: 'title: done marks complete\nsteps:\n  - run: [done, t1]\n',
    }
    const p = buildFidelityUserPrompt(ctx)
    expect(p).toContain('Section: done')
    expect(p).toContain('SECTION TEXT')
    expect(p).toContain('Completed t<N> ✓')
    expect(p).toContain('CLAIM the scenario was authored from')
    expect(p).toContain('SCENARIO UNDER REVIEW')
    expect(p).toContain('title: done marks complete')
    expect(p).not.toContain('CORRECTION —')
  })

  it('buildFidelityUserPrompt appends a CORRECTION block on a re-ask', () => {
    const p = buildFidelityUserPrompt({
      doc: 'docs/cli.md',
      sectionHeading: 'done',
      sectionText: 'x',
      claim: 'x',
      scenarioYaml: 'title: y',
      correction: { invalidOutput: 'not json' },
    })
    expect(p).toContain('CORRECTION —')
    expect(p).toContain('not json')
    expect(p).toContain('"faithful" or "flagged"')
  })

  it('RECIPE_SYSTEM_PROMPT documents the optional install step with examples', () => {
    // The descriptive bullet, not just the rendered Zod schema key.
    expect(RECIPE_SYSTEM_PROMPT).toContain('npm ci')
    expect(RECIPE_SYSTEM_PROMPT).toContain('pnpm install --frozen-lockfile')
    expect(RECIPE_SYSTEM_PROMPT).toMatch(/install.*before.*build/is)
  })

  it('buildRecipeUserPrompt correction text names the optional install field', () => {
    const prompt = buildRecipeUserPrompt({
      manifests: [{ path: 'package.json', ecosystem: 'js', content: '{}' }],
      presentInputs: [],
      correction: { invalidOutput: '(not json)' },
    })
    expect(prompt).toContain('"install"')
  })
})
