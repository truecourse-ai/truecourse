/**
 * THE GUARD STATUS VOCABULARY — the ONE place a guard status becomes words.
 *
 * The wire keeps its ids (bucket `guarded`/`partial`, gap kinds, coverage
 * statuses); everything a user READS about a status is derived here, so one state
 * can never wear two words:
 *
 *  - ONE WORD table ({@link GUARD_FLOW_STATUS_WORD}) — the four plain statuses
 *    (Passing / Failing / Blocked / Not generated) every chip, filter and header
 *    shows, over the whole coverage-status domain ({@link guardStatusWord});
 *  - ONE SENTENCE table (the per-gap-kind copy behind {@link guardGapNeed}) — what
 *    a state concretely NEEDS, in the words a user would use ("needs credentials
 *    and network access", "awaiting web driver", "no code path does this"), shown
 *    by DETAIL rows ({@link guardNoTestSentence}) as `word: sentence`;
 *  - the LEGEND label ({@link guardStatusLabel}) and hover hint
 *    ({@link guardStatusHint}) the coverage surfaces render — a label is the plain
 *    word unless the state needs naming apart from its siblings (a legend lists
 *    every gap kind side by side), and it is then the sentence's own words.
 *
 * `guard-status.ts` holds COLOUR only and reads its labels/hints from here — the
 * two are locked together by a test over every coverage status.
 */

import {
  awaitingDriverIds,
  guardDriver,
  needsSetupIsDone,
  needsSetupServices,
  parseBlockedOnCapabilities,
} from '@truecourse/shared';
import type {
  GuardDriverId,
  GuardFlowGap,
  GuardFlowListItem,
  GuardNeedsSetup,
  GuardOutcome,
  GuardResultStage,
  GuardSectionCoverageStatus,
  GuardTestStatus,
} from '@truecourse/shared';

/** A flow's state in plain words — the Flows-list filter domain. */
export type GuardFlowPlainStatus =
  | 'failing'
  | 'needs-setup'
  | 'blocked'
  | 'ungenerated'
  | 'passing';

/**
 * THE word table. One state, one word — chips, filters and detail rows all read
 * it, so a list row and the detail it opens can never disagree.
 */
export const GUARD_FLOW_STATUS_WORD: Record<GuardFlowPlainStatus, string> = {
  failing: 'Failing',
  'needs-setup': 'Needs setup',
  blocked: 'Blocked',
  ungenerated: 'Not generated',
  passing: 'Passing',
};

/** Severity-led order — bad news first, good news last. Needs-setup sits directly
 *  below failing: it is not a failure, but it is the one state a user can clear
 *  today, so it outranks the blocked wall it was promoted out of. */
export const GUARD_FLOW_STATUS_ORDER: GuardFlowPlainStatus[] = [
  'failing',
  'needs-setup',
  'blocked',
  'ungenerated',
  'passing',
];

/** `awaiting web driver` — the one phrasing of a surface with no driver yet. */
const awaitingSentence = (driver: string) => `awaiting ${driver} driver`;

/**
 * One entry per wire status.
 *
 * `label` is omitted whenever the plain WORD is the whole truth — `blocked-on` is
 * exactly "Blocked", and inventing a second name for it ("Needs setup") is the
 * bug this table exists to prevent. It is spelled out only where a legend must
 * tell sibling states apart, and then it is the sentence's own words, capitalized.
 *
 * That rule is why item 65 shipped `needs-setup` as a DIFFERENT wire status rather
 * than as a second label for `blocked-on`: the server derives it by joining the
 * gap against the externals view, which the client could not do, so the two really
 * are two states — and the table names them accordingly, once each.
 */
interface GuardStatusVocab {
  plain: GuardFlowPlainStatus;
  /** Legend/chip label. Omitted ⇒ `GUARD_FLOW_STATUS_WORD[plain]`. */
  label?: string;
  /** The plain sentence a detail row shows after the word — the gap kinds. */
  sentence?: string;
  /** A longer explainer for a state whose name doesn't say what happened. */
  hint?: string;
}

const VOCAB = {
  pass: { plain: 'passing' },
  fail: { plain: 'failing' },
  error: { plain: 'failing', label: 'Error', sentence: 'the test could not run' },
  stale: {
    plain: 'blocked',
    label: 'Stale',
    hint: 'The bound spec text changed since generation — not run. Regenerate to re-anchor.',
  },
  orphaned: {
    plain: 'blocked',
    label: 'Orphaned',
    hint: 'The bound spec section no longer exists — not run. Regenerate to re-anchor.',
  },
  guarded: { plain: 'passing', label: 'Not run yet', sentence: 'not run yet' },
  ...(Object.fromEntries(
    awaitingDriverIds.map((id) => [
      id,
      {
        plain: 'blocked',
        label: guardDriver(id)?.waitingLabel ?? id,
        sentence: awaitingSentence(id),
      },
    ]),
  ) as Record<(typeof awaitingDriverIds)[number], GuardStatusVocab>),
  // No label: this state IS "Blocked". What it needs is a SENTENCE, and the
  // capability nouns the gap names decide it (`guardGapNeed`).
  'blocked-on': { plain: 'blocked', sentence: 'needs setup' },
  // Item 65 — the one blocked state that is a TO-DO: the missing capability is an
  // external service the user can hand guard an account for. It gets its own word
  // (the comment above forbids a second name for `blocked-on`; this is a DIFFERENT
  // wire status, derived from the externals view, precisely so the two can be told
  // apart) and its own attention colour. The SERVICES ride the gap (`guardGapNeed`).
  'needs-setup': {
    plain: 'needs-setup',
    sentence: 'needs an external service you can provide',
    hint: 'Blocked on a third party you can hand guard a real or sandbox account for. Provide it on the External APIs page, then re-run guard generate.',
  },
  untestable: { plain: 'blocked', label: 'Nothing testable', sentence: 'nothing testable' },
  'no-claim': { plain: 'blocked', label: 'No testable claim', sentence: 'no testable claim' },
  // The two realization gaps, kept apart because their remedies are opposite: an
  // empty catalog is an EXTRACTION gap (teach the mapper this surface), while
  // `unrealizable` is the real "the spec promises this, no code surface offers it".
  'no-journey': {
    plain: 'blocked',
    label: 'No code path mapped',
    sentence: 'no code path mapped',
    hint: 'Nothing was mapped for this surface — the flow may be realizable, but no journey was found to realize it with.',
  },
  unrealizable: {
    plain: 'blocked',
    label: 'No code path does this',
    sentence: 'no code path does this',
    hint: 'The surface was examined and no journey path serves this flow.',
  },
  // The user dismissed this claim's finding (won't-fix / noise) — an honest,
  // muted status, never a fail.
  dismissed: { plain: 'blocked', label: 'Dismissed', sentence: 'dismissed' },
  unguarded: { plain: 'ungenerated', sentence: 'no test yet' },
} satisfies Record<GuardSectionCoverageStatus, GuardStatusVocab>;

// Compile-time backstop: a new `GuardSectionCoverageStatus` (a new outcome,
// driver, or gap kind) with no entry above makes `_UnmappedStatus` non-`never`
// and fails the build — a state the UI can't name never ships.
type _UnmappedStatus = Exclude<GuardSectionCoverageStatus, keyof typeof VOCAB>;
const _allStatusesNamed: _UnmappedStatus extends never ? true : never = true;
void _allStatusesNamed;

/**
 * A coverage status's vocabulary entry. The runtime twin of the backstop above: a
 * status the table never learned (a payload from a newer server) reads as
 * "blocked" — attention-needing, never blank — and throws under test so the
 * mapping is fixed rather than papered over.
 */
function vocab(status: GuardSectionCoverageStatus): GuardStatusVocab {
  const entry: GuardStatusVocab | undefined = VOCAB[status];
  if (entry) return entry;
  if (import.meta.env.MODE === 'test') throw new Error(`Guard status with no plain status: ${status}`);
  return { plain: 'blocked' };
}

/** A coverage status in plain words — one of the four. */
export function guardPlainStatus(status: GuardSectionCoverageStatus): GuardFlowPlainStatus {
  return vocab(status).plain;
}

/** The one WORD a status wears, wherever it appears. */
export function guardStatusWord(status: GuardSectionCoverageStatus): string {
  return GUARD_FLOW_STATUS_WORD[guardPlainStatus(status)];
}

/** The legend/chip label — the word itself unless a legend must name this state
 *  apart from its siblings. */
export function guardStatusLabel(status: GuardSectionCoverageStatus): string {
  return vocab(status).label ?? guardStatusWord(status);
}

/** The longer explainer, for the states whose name doesn't say what happened. */
export function guardStatusHint(status: GuardSectionCoverageStatus): string | undefined {
  return vocab(status).hint;
}

/**
 * A flow's plain status — exactly one of the four, for every flow the wire can
 * carry. FAILING MEANS A TEST RAN AND FAILED (at birth or in a run): guard commits
 * failing tests, so a birth failure reaches the list as a `fail` surface and the
 * flow's own status carries it. A recorded birth failure the surface join lost
 * still decides, so that flow can never read blank.
 *
 * An AUTHORING error is deliberately NOT failing: nothing ran, so there is no
 * result to report. Such a flow has no test and no gap, which is exactly
 * "Not generated" — its detail says it will retry next generate.
 */
export function guardFlowPlainStatus(
  flow: Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings'>,
): GuardFlowPlainStatus {
  if (flow.findings > 0) return 'failing';
  if (flow.bucket === 'ungenerated') return 'ungenerated';
  return guardPlainStatus(flow.status);
}

// ---------------------------------------------------------------------------
// A TEST's status — the Tests tab's row word and the flow detail's test row.
// ---------------------------------------------------------------------------

/** A committed test's status and which execution decided it. */
export interface GuardTestStatusView {
  status: GuardSectionCoverageStatus;
  plain: GuardFlowPlainStatus;
  /** True when no run covers the test and its BIRTH execution decided the status. */
  birth: boolean;
  /** The one status word a row shows — "Passing", "Failing", "Failing (birth)". */
  word: string;
}

/**
 * What a committed test's status IS: the last run's outcome when a run covered
 * it, else the status the generate committed it with (guard commits a test that
 * failed its first execution, so a fresh clone paints its red tests red). A test
 * no run covered and no manifest names reads `guarded` — committed, never run.
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
  const status: GuardSectionCoverageStatus =
    test.status ?? test.outcome ?? (test.committed === 'failing' ? 'fail' : 'guarded');
  const birth = test.stage ? test.stage === 'birth' : test.outcome == null;
  const plain = guardPlainStatus(status);
  const word = plain === 'failing' && birth ? `${GUARD_FLOW_STATUS_WORD[plain]} (birth)` : GUARD_FLOW_STATUS_WORD[plain];
  return { status, plain, birth, word };
}

// ---------------------------------------------------------------------------
// The SENTENCE half of the pair — what a state needs, in plain words.
// ---------------------------------------------------------------------------

/** The sentence for a surface whose authoring was ATTEMPTED and never finished. */
export const GUARD_RETRY_SENTENCE = 'couldn’t create the test — will retry next generate';

/**
 * The sentence for a flow nothing has been attempted for yet — no test, no gap, no
 * error. "Not generated" is the state; this is what happens next, so the read is
 * never a bare dead end.
 */
export const GUARD_NOT_ATTEMPTED_SENTENCE = 'no test yet — will be attempted on the next generate';

/**
 * The sentence for a flow the specs no longer derive, kept for its committed test.
 * It stands WHERE THE GOAL WOULD BE, because the missing goal is what it explains.
 */
export const GUARD_UNDERIVED_SENTENCE =
  'No longer derived from your specs — kept because its test still runs.';

/**
 * The MARKER for that same flow — the chip it wears beside its status, in a list
 * row and in the detail header alike. The sentence above EXPLAINS; this is what a
 * reader spots while scanning. It is not a status and never borrows a status
 * colour: being underived says nothing about whether the flow's test passes.
 */
export const GUARD_NOT_IN_SPECS_LABEL = 'Not in specs';

/**
 * The capability nouns a `blocked-on` reason names, in the words a user would
 * use. Ordered — the first pattern that matches wins, so "a recipe `api` block"
 * reads as the API recipe and never as a bare "api".
 */
const CAPABILITY_NEEDS: [RegExp, string][] = [
  [/recipe.*\bapi\b|\bapi\b.*block/i, 'needs API recipe'],
  [/recipe.*\bentry\b|\bentry\b.*recipe/i, 'needs CLI recipe'],
  [/credential|secret|token|api[- ]key|password|auth/i, 'needs credentials'],
  [/network|internet/i, 'needs network access'],
  [/llm|model provider/i, 'needs an LLM provider'],
  [/database|datastore|\bdb\b|postgres|mysql|sqlite/i, 'needs a database'],
  // Item 60: the "pre-existing DATA nothing seeds" noun — a record the API cannot
  // create through its own endpoints and no fixture provides. AFTER the database row,
  // which owns the INFRASTRUCTURE reading (`datastore` is a db, not a missing row).
  // `\bdata\b` is word-anchored on purpose: `database`, `metadata`, `dataset` must
  // not land here on a substring.
  [/missing[- ]?data|\bseed\b|\bfixture\b|\bdata\b/i, 'needs seed data'],
  // Item 57: the generic third-party nouns. BEFORE the running-service row, which
  // `external-service` would otherwise match and read as "needs a running service" —
  // the opposite triage (that one is yours to start; this one is someone else's).
  // A reason naming a DETECTED service (`stripe`) matches no row and falls through
  // to `needs stripe`, which is exactly right — no row is needed per service.
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
 * Several needs as ONE English phrase — "needs credentials and network access",
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
// NEEDS SETUP (item 65) — the words for the one blocked state that is a to-do.
// ---------------------------------------------------------------------------

/** "open-meteo", "open-meteo and stripe" — the services a needs-setup row is about. */
export function guardNeedsSetupServiceList(needsSetup: GuardNeedsSetup): string {
  const services = needsSetupServices(needsSetup);
  if (services.length <= 1) return services[0] ?? 'an external service';
  return `${services.slice(0, -1).join(', ')} and ${services[services.length - 1]}`;
}

/**
 * The SENTENCE a needs-setup gap wears. Two sub-states, and they say opposite
 * things: something to provide, or an account already provided whose flows the
 * next generate will author.
 */
export function guardNeedsSetupNeed(needsSetup: GuardNeedsSetup): string {
  const list = guardNeedsSetupServiceList(needsSetup);
  return needsSetupIsDone(needsSetup)
    ? `${list} is set up — re-run guard generate to author these flows`
    : `needs setup: ${list}`;
}

/** The CTA a needs-setup surface renders — the link's own words. */
export function guardNeedsSetupCta(needsSetup: GuardNeedsSetup): string {
  return needsSetupIsDone(needsSetup)
    ? 'Re-run guard generate'
    : `Provide ${guardNeedsSetupServiceList(needsSetup)}`;
}

/** The command the "setup done" sub-state points at, spelled once. */
export const GUARD_REGENERATE_COMMAND = 'truecourse guard generate';

/**
 * What this gap concretely NEEDS, in plain words — the sentence half of the pair.
 * An awaiting-driver gap names the driver it waits on; a `blocked-on` gap
 * translates the capability nouns its reason carries; the rest read the ONE
 * sentence table above, by the coverage status their kind is.
 */
export function guardGapNeed(gap: GuardFlowGap): string {
  if (gap.kind === 'awaiting-driver') return gap.driver ? awaitingSentence(gap.driver) : gap.label;
  // Item 65: a gap promoted to needs-setup names the SERVICE, never a generic
  // noun — "needs setup: open-meteo" is the whole triage in three words.
  if (gap.needsSetup) return guardNeedsSetupNeed(gap.needsSetup);
  if (gap.kind === 'blocked-on') {
    const caps = parseBlockedOnCapabilities(gap.reason);
    if (caps.length === 0) return vocab('blocked-on').sentence!;
    return joinNeeds([...new Set(caps.map(capabilityNeed))]);
  }
  return vocab(gap.kind).sentence ?? gap.label;
}

/**
 * The WHY half of the pair, as its OWN line — "Needs credentials and network
 * access." A detail row answers two questions with two elements: the status chip
 * says WHAT state this surface is in (the word above), this says WHY.
 *
 * With no gap the answer depends on whether the test was ATTEMPTED: an authoring
 * that ran and failed retries, while a flow nothing has been attempted for is
 * simply waiting for the next generate. Neither is ever a blank row.
 */
export function guardWhyNoTest(gap?: GuardFlowGap, opts: { attempted?: boolean } = {}): string {
  const why = gap
    ? guardGapNeed(gap)
    : opts.attempted === false
      ? GUARD_NOT_ATTEMPTED_SENTENCE
      : GUARD_RETRY_SENTENCE;
  return `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
}

/** A surface's own name — "CLI", "Web" — never "CLI test". */
export function surfaceLabel(surface: GuardDriverId): string {
  return guardDriver(surface)?.label ?? surface;
}

// ---------------------------------------------------------------------------
// The Flows list FILTER — ONE domain read by the list's dropdown, the overview's
// stat chips and the row predicate alike, so a chip's count can never differ
// from what clicking it shows.
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
