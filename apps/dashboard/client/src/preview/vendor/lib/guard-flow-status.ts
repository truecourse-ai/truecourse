// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/lib/guard-flow-status.ts; delete with the preview.
/**
 * THE GUARD STATUS VOCABULARY, the ONE place a guard status becomes words.
 *
 * The wire keeps its ids (bucket `guarded`/`partial`, gap kinds, coverage
 * statuses); everything a user READS about a status is derived here, so one state
 * can never wear two words:
 *
 *  - the FIVE WORDS of coverage ({@link GUARD_FLOW_STATUS_WORD}, owned by
 *    `@truecourse/shared` so the CLI says the same five), Succeeded / Failed /
 *    Blocked / Not testable / Never run. Every section, flow, counter, filter and
 *    chip wears one of them and nothing else ({@link guardStatusWord});
 *  - ONE SENTENCE table (the per-gap-kind copy behind {@link guardGapNeed}), what
 *    a state concretely NEEDS, in the words a user would use ("needs credentials
 *    and network access", "awaiting web driver", "no code path does this"), shown
 *    by DETAIL rows ({@link guardWhyNoTest}) as `word: sentence`. This is where a
 *    state's own name lives now that the word is one of five: "Blocked" says WHAT,
 *    "no code path mapped" says WHY, and the pair is the whole read;
 *  - the DETAIL label ({@link guardStatusLabel}) and hover hint
 *    ({@link guardStatusHint}), a state's own name, for the surfaces that must
 *    tell siblings apart (a run's drift groups, a surface chip's need). It is the
 *    five-word status unless the state needs naming apart, and then it is the
 *    sentence's own words. It is NEVER a coverage status word;
 *  - the VERDICT words ({@link GUARD_TEST_VERDICT_WORD}), a scenario that RAN
 *    keeps "Passing" / "Failing", per the ontology rule. The five words are
 *    coverage vocabulary, not run-verdict wording.
 *
 * `guard-status.ts` holds COLOUR only and reads its labels/hints from here, the
 * two are locked together by a test over every coverage status.
 */

import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_COVERAGE_STATUS_WORD,
  MISSING_DATA_NOUN,
  awaitingDriverIds,
  guardCoveragePlainStatus,
  guardDriver,
  guardFlowPlainStatus as sharedFlowPlainStatus,
  guardSetupServiceLabel,
  needsSetupIsDone,
  needsSetupServices,
  parseBlockedOnCapabilities,
} from '@/preview/vendor/shared';
import type {
  GuardCoveragePlainStatus,
  GuardDriverId,
  GuardFlowGap,
  GuardFlowListItem,
  GuardNeedsSetup,
  GuardOutcome,
  GuardResultStage,
  GuardSectionCoverageStatus,
  GuardTestStatus,
} from '@/preview/vendor/shared';

/**
 * A coverage state in plain words, the five, and the Flows-list filter domain.
 * The domain lives in `@truecourse/shared` so the CLI and the dashboard cannot
 * drift apart on it; this alias is the client's local name for it.
 */
export type GuardFlowPlainStatus = GuardCoveragePlainStatus;

/**
 * THE word table. One state, one word, chips, filters and detail rows all read
 * it, so a list row and the detail it opens can never disagree.
 */
export const GUARD_FLOW_STATUS_WORD = GUARD_COVERAGE_STATUS_WORD;

/** Severity-led order, bad news first, then the unproven, then the good news, and
 *  "Not testable" last (the one status that is nobody's to-do). */
export const GUARD_FLOW_STATUS_ORDER: GuardFlowPlainStatus[] = [...GUARD_COVERAGE_PLAIN_ORDER];

/** `awaiting web driver`, the one phrasing of a surface with no driver yet. */
const awaitingSentence = (driver: string) => `awaiting ${driver} driver`;

/**
 * One entry per wire status, the SENTENCE half of the vocabulary.
 *
 * `label` is omitted whenever the five-word status is the whole truth -
 * `blocked-on` is exactly "Blocked", and inventing a second status name for it
 * ("Needs setup") is the bug this table exists to prevent. It is spelled out only
 * where a surface must tell sibling states apart (a run's drift groups, a surface
 * chip's need), and then it is the sentence's own words, capitalized, never a
 * sixth coverage status.
 *
 * `plain` is NOT here: which of the five words a wire status wears is decided once,
 * in `@truecourse/shared`, by the same precedence tiers the rollups use. A label
 * and a word can therefore never contradict each other.
 */
interface GuardStatusVocab {
  /** The state's own name, for a surface that lists siblings side by side.
   *  Omitted ⇒ the five-word status ({@link guardStatusWord}). */
  label?: string;
  /** The plain sentence a detail row shows after the word, the gap kinds. */
  sentence?: string;
  /** A longer explainer for a state whose name doesn't say what happened. */
  hint?: string;
}

const VOCAB = {
  // The two RUN outcomes keep the verdict words wherever a run names its own
  // results (a drift group header, a run tally). Their coverage word is still
  // Succeeded / Failed, the questions differ, so the answers may.
  pass: { label: 'Passing' },
  fail: { label: 'Failing' },
  error: { label: 'Error', sentence: 'the test could not run' },
  stale: {
    label: 'Stale',
    hint: 'The bound spec text changed since generation, not run. Regenerate to re-anchor.',
  },
  orphaned: {
    label: 'Orphaned',
    hint: 'The bound spec section no longer exists, not run. Regenerate to re-anchor.',
  },
  // It PASSED, just not in this run. The word is "Succeeded"; the label and
  // sentence say which execution earned it, so nobody reads a stale green as fresh.
  guarded: { label: 'Passed earlier', sentence: 'passed when it was written, not in this run' },
  'never-run': {
    sentence: 'never executed',
    hint: 'The test is committed but has never executed, not in a run, and not when it was written. Run `truecourse guard run` to find out what it proves.',
  },
  ...(Object.fromEntries(
    awaitingDriverIds.map((id) => [
      id,
      { label: guardDriver(id)?.waitingLabel ?? id, sentence: awaitingSentence(id) },
    ]),
  ) as Record<(typeof awaitingDriverIds)[number], GuardStatusVocab>),
  // The RUN outcome: the scenario exists, binds a supplied dependency, and was held
  // back because nobody registered an instance of it. One registration away from a
  // verdict, so it says which registration, the result's `blockedOn` names the
  // dependency and the requirement behind that sentence.
  blocked: {
    label: 'Blocked',
    sentence: 'needs a test subject you provide',
    hint: 'The test binds a supplied dependency, a project, a corpus, credentials, that has no registered instance on this machine, so it did not run. Register one in dependencies.local.json.',
  },
  // No label: this state IS "Blocked". What it needs is a SENTENCE, and the
  // capability nouns the gap names decide it (`guardGapNeed`).
  'blocked-on': { sentence: 'needs setup' },
  // The one blocked state that is a TO-DO: the missing capability is an
  // external service the user can hand guard an account for. Its word is "Blocked"
  // like every other blocker; what makes it worth its own wire status is the
  // SERVICES it can name and the CTA it can offer (`guardGapNeed`), plus its own
  // attention colour.
  'needs-setup': {
    sentence: 'needs an external service or seed data you can provide',
    hint: 'Blocked on something you can provide: a third-party account (Dependencies page) or seed data the seed script doesn’t create yet. Provide it, then re-run guard generate.',
  },
  untestable: { label: 'Nothing testable', sentence: 'nothing testable' },
  'no-claim': { label: 'No testable claim', sentence: 'no testable claim' },
  // The two realization gaps, kept apart because their remedies are opposite, and
  // so are their WORDS: an empty catalog is an EXTRACTION gap that mapping the
  // surface clears (Blocked), while `unrealizable` is the settled "the spec
  // promises this, no code surface offers it" (Not testable).
  'no-interface': {
    label: 'No code path mapped',
    sentence: 'no code path mapped',
    hint: 'Nothing was mapped for this surface, the flow may be realizable, but no interface was found to realize it with.',
  },
  unrealizable: {
    label: 'No code path does this',
    sentence: 'no code path does this',
    hint: 'The surface was examined and no interface path serves this flow.',
  },
  // The user dismissed this claim's finding (won't-fix / noise), an honest,
  // muted status, never a fail.
  dismissed: { label: 'Dismissed', sentence: 'dismissed' },
  // Generate TRIED to author a test here and could not. Blocked in plain words -
  // nothing ran, so it is not a failing test, and re-running generate clears it -
  // but its OWN label, because "we tried and could not" is a different fact from
  // `unguarded`'s "nothing accounts for this", and the two used to read identically.
  'authoring-error': {
    label: 'Authoring error',
    sentence: 'couldn’t create the test',
    hint: 'Generate tried to author a test here and failed, nothing ran, so there is no result. Re-run generate to retry.',
  },
  // Nothing accounts for this section at all, no flow, no gap, no claim. A HOLE in
  // the coverage record rather than a verdict about the repo, which is why its word
  // is Blocked and its sentence says what closes it.
  unguarded: { sentence: 'nothing accounts for this yet' },
} satisfies Record<GuardSectionCoverageStatus, GuardStatusVocab>;

// Compile-time backstop: a new `GuardSectionCoverageStatus` (a new outcome,
// driver, or gap kind) with no entry above makes `_UnmappedStatus` non-`never`
// and fails the build, a state the UI can't name never ships.
type _UnmappedStatus = Exclude<GuardSectionCoverageStatus, keyof typeof VOCAB>;
const _allStatusesNamed: _UnmappedStatus extends never ? true : never = true;
void _allStatusesNamed;

/**
 * A coverage status's vocabulary entry. The runtime twin of the backstop above: a
 * status the table never learned (a payload from a newer server) has no sentence
 * of its own, its five-word status still speaks for it, and throws under test so
 * the mapping is fixed rather than papered over.
 */
function vocab(status: GuardSectionCoverageStatus): GuardStatusVocab {
  const entry: GuardStatusVocab | undefined = VOCAB[status];
  if (entry) return entry;
  if (import.meta.env.MODE === 'test') throw new Error(`Guard status with no plain status: ${status}`);
  return {};
}

/** A coverage status in plain words, one of the five. */
export const guardPlainStatus = guardCoveragePlainStatus;

/** The one WORD a status wears on a coverage surface, wherever it appears. */
export function guardStatusWord(status: GuardSectionCoverageStatus): string {
  return GUARD_FLOW_STATUS_WORD[guardPlainStatus(status)];
}

/** The state's own name, for a surface that must tell siblings apart, the
 *  five-word status unless this state needs naming apart from them. */
export function guardStatusLabel(status: GuardSectionCoverageStatus): string {
  return vocab(status).label ?? guardStatusWord(status);
}

/** The longer explainer, for the states whose name doesn't say what happened. */
export function guardStatusHint(status: GuardSectionCoverageStatus): string | undefined {
  return vocab(status).hint;
}

/** A flow's plain status, one of the five, derived once in `@truecourse/shared`
 *  so `guard flows` and the Flows tab can never disagree about a flow. */
export const guardFlowPlainStatus = sharedFlowPlainStatus;

// ---------------------------------------------------------------------------
// A TEST's status, the Tests tab's row word and the flow detail's test row.
// ---------------------------------------------------------------------------

/**
 * The RUN-VERDICT words. A scenario that executed keeps "Passing" / "Failing" -
 * the ontology's verdict wording, while its section's and flow's COVERAGE reads
 * "Succeeded" / "Failed". The two vocabularies answer different questions ("did
 * this run prove out?" vs "what do we know about this spec?"), so a test row and
 * the section it covers are allowed to word the same fact differently; nothing
 * else may.
 */
export const GUARD_TEST_VERDICT_WORD: Record<GuardFlowPlainStatus, string> = {
  succeeded: 'Passing',
  failed: 'Failing',
  blocked: GUARD_COVERAGE_STATUS_WORD.blocked,
  'not-testable': GUARD_COVERAGE_STATUS_WORD['not-testable'],
  'never-run': GUARD_COVERAGE_STATUS_WORD['never-run'],
};

/** A committed test's status and which execution decided it. */
export interface GuardTestStatusView {
  status: GuardSectionCoverageStatus;
  plain: GuardFlowPlainStatus;
  /** True when no run covers the test and its BIRTH execution decided the status. */
  birth: boolean;
  /** The one verdict word a row shows, "Passing", "Failing", "Failing (birth)". */
  word: string;
}

/**
 * What a committed test's status IS: the last run's outcome when a run covered
 * it, else the status the generate committed it with (guard commits a test that
 * failed its first execution, so a fresh clone paints its red tests red). A test
 * no run covered and no manifest names reads `guarded`, committed, never run.
 */
export function guardTestStatusView(test: {
  /** The last run's outcome for this test, when the run had one. */
  outcome?: GuardOutcome | null;
  /** The status the generate committed it with (absent on hand-written work). */
  committed?: GuardTestStatus;
  /** Overrides the derivation when the server already resolved both (flow rows). */
  status?: GuardSectionCoverageStatus;
  stage?: GuardResultStage;
}): GuardTestStatusView {
  const neverRun = test.outcome == null && test.committed === 'never-run';
  const status: GuardSectionCoverageStatus =
    test.status ??
    test.outcome ??
    (test.committed === 'failing' ? 'fail' : neverRun ? 'never-run' : 'guarded');
  // A test with no birth execution has no birth verdict either: `birth` says which
  // EXECUTION decided the status, and there was none.
  const birth = test.stage ? test.stage === 'birth' : test.outcome == null && !neverRun;
  const plain = guardPlainStatus(status);
  const verdict = GUARD_TEST_VERDICT_WORD[plain];
  const word = plain === 'failed' && birth ? `${verdict} (birth)` : verdict;
  return { status, plain, birth, word };
}

// ---------------------------------------------------------------------------
// The SENTENCE half of the pair, what a state needs, in plain words.
// ---------------------------------------------------------------------------

/** The sentence for a surface whose authoring was ATTEMPTED and never finished. */
export const GUARD_RETRY_SENTENCE = 'couldn’t create the test, will retry next generate';

/**
 * The LEAD of the sentence a REFUSED run puts in the retry sentence's place. The two
 * are opposite promises and must never be confused: an authoring error is
 * self-healing (the next generate re-authors and may succeed), while a refusal is a
 * fact about the world, the runner declined before anything was built or executed,
 * and every re-run declines identically until the configuration changes. Telling a
 * reader "will retry next generate" there sends them to run the same $35 command again.
 */
export const GUARD_BLOCKED_LEAD = 'nothing could be tested';

/**
 * The blocking reason of a run-level refusal, as the sentence a surface with no test
 * carries: the lead above, then the runner's OWN message (never re-worded, it is the
 * canonical wording every guard surface quotes).
 */
export function guardBlockedSentence(reason: string): string {
  return `${GUARD_BLOCKED_LEAD}, ${reason.trim()}`;
}

/**
 * The run-level refusal among a flow's generate errors, if any. Errors written
 * before the discriminator existed carry no `kind` and are read as authoring, which
 * is the wording those reports already got.
 */
export function guardRefusalError<T extends { kind?: string; message: string }>(
  errors: readonly T[],
): T | undefined {
  return errors.find((e) => e.kind === 'refusal');
}

/**
 * The sentence for a flow nothing has been attempted for yet, no test, no gap, no
 * error. "Blocked" is the word; this is what unblocks it, so the read is never a
 * bare dead end.
 */
export const GUARD_NOT_ATTEMPTED_SENTENCE = 'no test yet, will be attempted on the next generate';

/**
 * The sentence for a flow the specs no longer derive, kept for its committed test.
 * It stands WHERE THE GOAL WOULD BE, because the missing goal is what it explains.
 */
export const GUARD_UNDERIVED_SENTENCE =
  'No longer derived from your specs, kept because its test still runs.';

/**
 * The MARKER for that same flow, the chip it wears beside its status, in a list
 * row and in the detail header alike. The sentence above EXPLAINS; this is what a
 * reader spots while scanning. It is not a status and never borrows a status
 * colour: being underived says nothing about whether the flow's test passes.
 */
export const GUARD_NOT_IN_SPECS_LABEL = 'Not in specs';

/**
 * The marker a flow the USER ruled out wears, the same non-status idiom as the
 * one above, for the same reason: a dismissal is a decision about whether this
 * flow should be tested, not a verdict on whether it passes. It is derived from
 * `scenarios/decisions.json`, so it appears the instant the ruling is made, the
 * `dismissed` coverage status only follows on the next generate.
 */
export const GUARD_DISMISSED_LABEL = 'Dismissed';

/**
 * The marker a flow carries when the last generate produced a finding that is OUR
 * OWN defect, a `generation-defect` verdict or a fidelity rejection. Muted for
 * the same reason as its siblings: it is not a status. Nothing was committed and
 * nothing in the repo is broken, so it must never read as drift or take a status
 * colour; the flow simply re-authors on the next generate.
 */
export const GUARD_TOOL_DEFECT_LABEL = 'Tool defect';

/** The hover behind that marker, whose fault it is, and what happens next. */
export const GUARD_TOOL_DEFECT_HINT =
  'Guard wrote a test it judged faulty (a wrong assertion, a wrong endpoint), so nothing was committed. This is our defect, not drift in your code, the flow re-authors on the next generate.';

/** What a dismissed flow's detail says, under the marker, the whole consequence
 *  of the ruling in one line, so "undo" is never a leap of faith. */
export const GUARD_FLOW_DISMISSED_SENTENCE =
  'Ruled out of testing, the next generate drops this flow and deletes its tests.';

/** The ruling itself, as the button says it. */
export const GUARD_DISMISS_FLOW_ACTION = 'Don’t test this flow';

/** The hover explainer behind that button. */
export const GUARD_DISMISS_FLOW_HINT =
  'Removes this whole flow from testing. The next generate drops it and deletes its tests. Undo any time.';

/**
 * The capability nouns a `blocked-on` reason names, in the words a user would
 * use. Ordered, the first pattern that matches wins, so "a recipe `api` block"
 * reads as the API recipe and never as a bare "api".
 */
const CAPABILITY_NEEDS: [RegExp, string][] = [
  [/recipe.*\bapi\b|\bapi\b.*block/i, 'needs API recipe'],
  [/recipe.*\bentry\b|\bentry\b.*recipe/i, 'needs CLI recipe'],
  [/credential|secret|token|api[- ]key|password|auth/i, 'needs credentials'],
  [/network|internet/i, 'needs network access'],
  [/llm|model provider/i, 'needs an LLM provider'],
  [/database|datastore|\bdb\b|postgres|mysql|sqlite/i, 'needs a database'],
  // The "pre-existing DATA nothing seeds" noun, a record the API cannot
  // create through its own endpoints and no fixture provides. AFTER the database row,
  // which owns the INFRASTRUCTURE reading (`datastore` is a db, not a missing row).
  // `\bdata\b` is word-anchored on purpose: `database`, `metadata`, `dataset` must
  // not land here on a substring.
  [/missing[- ]?data|\bseed\b|\bfixture\b|\bdata\b/i, 'needs seed data'],
  // The generic third-party nouns. BEFORE the running-service row, which
  // `external-service` would otherwise match and read as "needs a running service" -
  // the opposite triage (that one is yours to start; this one is someone else's).
  // A reason naming a DETECTED service (`stripe`) matches no row and falls through
  // to `needs stripe`, which is exactly right, no row is needed per service.
  [
    /external[- ]?(service|api|system)|third[- ]?party|\bsaas\b|integration|upstream/i,
    'needs an external service (or a stub)',
  ],
  [/service|server|daemon|container/i, 'needs a running service'],
];

function capabilityNeed(capability: string): string {
  for (const [pattern, need] of CAPABILITY_NEEDS) {
    if (pattern.test(capability)) return need;
  }
  return `needs ${capability}`;
}

/**
 * Several needs as ONE English phrase, "needs credentials and network access",
 * not a `·`-separated list of fragments. The shared "needs " lead is said once.
 */
function joinNeeds(needs: string[]): string {
  if (needs.length === 1) return needs[0];
  const LEAD = 'needs ';
  const shared = needs.every((n) => n.startsWith(LEAD));
  const parts = shared ? needs.map((n) => n.slice(LEAD.length)) : needs;
  const phrase = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return shared ? `${LEAD}${phrase}` : phrase;
}

// ---------------------------------------------------------------------------
// NEEDS SETUP, the words for the one blocked state that is a to-do.
// ---------------------------------------------------------------------------

/** "open-meteo", "open-meteo and stripe", a list of service names as one phrase. */
function joinServiceLabels(services: string[]): string {
  const labels = services.map(guardSetupServiceLabel);
  if (labels.length <= 1) return labels[0] ?? 'an external service';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** "open-meteo", "open-meteo and stripe", the services a needs-setup row is about. */
export function guardNeedsSetupServiceList(needsSetup: GuardNeedsSetup): string {
  return joinServiceLabels(needsSetupServices(needsSetup));
}

/**
 * The COMPACT phrase a needs-setup gap wears where a line is all there is: a
 * surface chip ("API · needs setup: open-meteo"), an interface's need, a section's
 * flow row. Three sub-states, and they say different things: an external service
 * to provide, seed data the existing seed script doesn't create yet, or an
 * account already provided whose flows the next generate will author.
 *
 * The banner that has room for a real sentence uses {@link guardNeedsSetupHeadline}
 * instead, same state, same facts, told at the length the surface affords.
 */
export function guardNeedsSetupNeed(needsSetup: GuardNeedsSetup): string {
  if (needsSetupIsDone(needsSetup)) {
    return `${guardNeedsSetupServiceList(needsSetup)} is set up, re-run guard generate to author these flows`;
  }
  // The seed exists, its being outstanding means it doesn't create this data, and
  // "needs setup: seed data" would send the reader to a page with no row for it.
  if (needsSetup.services.every((s) => s === MISSING_DATA_NOUN)) return SEED_DATA_NEED;
  return `needs setup: ${guardNeedsSetupServiceList(needsSetup)}`;
}

/**
 * The FULL sentence the needs-setup banner leads with, the compact phrase is
 * three words and a colon, which is a label, not an explanation. This says what
 * is actually going on: nothing can be tested yet, these named third parties are
 * why, and an account clears it (the links beside it are how).
 *
 * Seed data is handled apart: it is not a service anyone signs up for, so it
 * never reads as one. An OUTSTANDING seed noun only exists when a seed script is
 * already declared AND the last generate ran with it (the setup index carries
 * `missing-data → incomplete` for exactly that case), so the sentence states the
 * verdict: the seed ran, and it doesn't create the data this flow needs.
 */
export function guardNeedsSetupHeadline(needsSetup: GuardNeedsSetup): string {
  const outstanding = needsSetupServices(needsSetup);
  const external = outstanding.filter((s) => s !== MISSING_DATA_NOUN);
  const plural = external.length > 1;

  if (needsSetupIsDone(needsSetup)) {
    const list = joinServiceLabels(outstanding);
    return `${list} ${outstanding.length > 1 ? 'are' : 'is'} already set up, these tests just haven’t been authored since.`;
  }
  const seed = external.length < outstanding.length ? SEED_DATA_SENTENCE : '';
  if (external.length === 0) {
    return 'Not testable yet, the seed script ran, but doesn’t create the data this flow needs.';
  }
  return (
    `Not testable yet, ${joinServiceLabels(external)} ${plural ? 'are external services that need accounts' : 'is an external service that needs an account'}` +
    ` before guard can test against ${plural ? 'them' : 'it'}.${seed}`
  );
}

/** The seed-data half of the state, the noun that is not a service, in the
 *  banner's words. */
const SEED_DATA_NEED = 'needs data the seed script doesn’t create yet';
const SEED_DATA_SENTENCE = ` It also ${SEED_DATA_NEED}.`;

/**
 * The CTA for ONE service, the words of a link that lands on that service's card.
 * A gap naming several outstanding services renders one of these per service: a
 * single link could only ever open the first, leaving the rest unreachable.
 */
export function guardProvideServiceCta(service: string): string {
  return `Provide ${guardSetupServiceLabel(service)}`;
}

/**
 * The CTA a needs-setup surface renders when it has no ONE service to name, the
 * done sub-state's command, or the whole-list fallback for a gap whose only
 * services are unlinkable. Per-service links use {@link guardProvideServiceCta}.
 */
export function guardNeedsSetupCta(needsSetup: GuardNeedsSetup): string {
  if (needsSetupIsDone(needsSetup)) return 'Re-run guard generate';
  // "Provide seed data" would name the Dependencies page, which has no row for a
  // seed, the action is editing the seed script, so the CTA says so.
  if (needsSetup.services.every((s) => s === MISSING_DATA_NOUN)) return 'Extend the seed script';
  return `Provide ${guardNeedsSetupServiceList(needsSetup)}`;
}

/** The command the "setup done" sub-state points at, spelled once. */
export const GUARD_REGENERATE_COMMAND = 'truecourse guard generate';

/**
 * The one line UNDER the banner headline: what the headline deliberately leaves
 * out, that a throwaway sandbox account is enough, and that providing one is
 * step 1 of 2. It must never restate the headline; the legend's standalone
 * explainer ({@link guardStatusHint}) still says the whole thing for a reader
 * who has no banner in front of them.
 */
export const GUARD_NEEDS_SETUP_NEXT = `A real or sandbox account both work, provide one, then re-run \`${GUARD_REGENERATE_COMMAND}\` to author these tests.`;

/** The command that DRAFTS a seed, the one action a missing-data gap
 *  with no `api.seed` has, spelled once for every surface that offers it. */
export const GUARD_SEED_INIT_COMMAND = 'truecourse guard seed --init';

/**
 * What this gap concretely NEEDS, in plain words, the sentence half of the pair.
 * An awaiting-driver gap names the driver it waits on; a `blocked-on` gap
 * translates the capability nouns its reason carries; the rest read the ONE
 * sentence table above, by the coverage status their kind is.
 */
export function guardGapNeed(gap: GuardFlowGap): string {
  if (gap.kind === 'awaiting-driver') return gap.driver ? awaitingSentence(gap.driver) : gap.label;
  // A gap promoted to needs-setup names the SERVICE, never a generic
  // noun, "needs setup: open-meteo" is the whole triage in three words.
  if (gap.needsSetup) return guardNeedsSetupNeed(gap.needsSetup);
  if (gap.kind === 'blocked-on') {
    const caps = parseBlockedOnCapabilities(gap.reason);
    if (caps.length === 0) return vocab('blocked-on').sentence!;
    return joinNeeds([...new Set(caps.map(capabilityNeed))]);
  }
  return vocab(gap.kind).sentence ?? gap.label;
}

/**
 * The WHY half of the pair, as its OWN line, "Needs credentials and network
 * access." A detail row answers two questions with two elements: the status chip
 * says WHAT state this surface is in (the word above), this says WHY.
 *
 * With no gap the answer depends on whether the test was ATTEMPTED: an authoring
 * that ran and failed retries, while a flow nothing has been attempted for is
 * simply waiting for the next generate. Neither is ever a blank row.
 *
 * A `blocked` reason OUTRANKS all of that, gap included: when the run was refused,
 * nothing about this surface was examined, not its gap, not its authoring, so the
 * only true thing to say is what stopped the run.
 */
export function guardWhyNoTest(
  gap?: GuardFlowGap,
  opts: { attempted?: boolean; blocked?: string } = {},
): string {
  const why = opts.blocked
    ? guardBlockedSentence(opts.blocked)
    : gap
      ? guardGapNeed(gap)
      : opts.attempted === false
        ? GUARD_NOT_ATTEMPTED_SENTENCE
        : GUARD_RETRY_SENTENCE;
  return `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
}

/** A surface's own name, "CLI", "Web", never "CLI test". */
export function surfaceLabel(surface: GuardDriverId): string {
  return guardDriver(surface)?.label ?? surface;
}

// ---------------------------------------------------------------------------
// The Flows list FILTER, ONE domain read by the list's filter bar and the row
// predicate alike, so a chip's count can never differ from what clicking it
// shows.
// ---------------------------------------------------------------------------

/** What the Flows list narrows to: a status word, the not-in-specs marker, or everything. */
export type GuardFlowFilter = GuardFlowPlainStatus | 'orphaned' | 'all';

/**
 * The word each filter wears. `all` is the corpus itself, so it reads as the
 * NOUN ("12 flows"); the rest are the status words and the one marker, spelled
 * exactly the way the rows spell them.
 */
export const GUARD_FLOW_FILTER_LABEL: Record<GuardFlowFilter, string> = {
  all: 'flows',
  ...GUARD_FLOW_STATUS_WORD,
  orphaned: GUARD_NOT_IN_SPECS_LABEL,
};

/** Filter display order: the corpus total, then severity-led, then the marker. */
export const GUARD_FLOW_FILTER_ORDER: GuardFlowFilter[] = ['all', ...GUARD_FLOW_STATUS_ORDER, 'orphaned'];

/** One filter as a chip / option: its key, its word, and how many flows match. */
export interface GuardFlowFilterCount {
  key: GuardFlowFilter;
  label: string;
  count: number;
}

/** The ONE predicate the list filters by and the counts are derived from. */
export function guardFlowMatchesFilter(
  flow: Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings' | 'orphaned'>,
  filter: GuardFlowFilter,
): boolean {
  if (filter === 'all') return true;
  // Not a status: a flow the specs no longer derive still passes or fails.
  if (filter === 'orphaned') return flow.orphaned === true;
  return guardFlowPlainStatus(flow) === filter;
}

/** Every filter with its count over the SAME payload the list filters. */
export function guardFlowFilterCounts(
  flows: readonly Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings' | 'orphaned'>[],
): GuardFlowFilterCount[] {
  return GUARD_FLOW_FILTER_ORDER.map((key) => ({
    key,
    label: GUARD_FLOW_FILTER_LABEL[key],
    count: flows.filter((f) => guardFlowMatchesFilter(f, key)).length,
  }));
}
