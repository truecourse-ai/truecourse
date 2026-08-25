/**
 * THE ADJUDICATION SESSION — `guard-adjudicate.failure` (plan 05 step 21), one
 * per failing scenario of a guard run. The session does what the corpus runs
 * cost a human per red row: read the evidence, hunt the mechanism in the
 * source, discriminate flake from fact with a scoped rerun, and end with one
 * verdict object the fold validates and persists.
 *
 * Cache: name `guard/adjudicate`, key = prompt fingerprint + the FAILURE
 * IDENTITY (flow, surface, failing step, expected, actual) + the scenario's
 * behavior hash — so an identical failure across runs is a hit, and an edited
 * scenario re-adjudicates. Verdict sessions are author-class (a classification
 * of recorded inputs the key fully names); the CONTROL child is proof-class
 * and never cached (see control.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { SessionBudget, SessionDef } from '@truecourse/agent-loop';
import { extractSectionTexts, nodeRefContext } from '@truecourse/guard-runner';
import { GuardAdjudicationSchema, type GuardAdjudication, type GuardScenario } from '@truecourse/shared';
import { promptFingerprint } from '../agent/session-cache.js';
import { buildAdjudicationTools, RERUN_MAX, type AdjudicationSessionState } from './tools.js';
import type { AdjudicationExecution } from './execute.js';
import type { AdjudicationItem } from './pre-pass.js';

export const ADJUDICATE_SESSION_KIND = 'guard-adjudicate.failure';
export const ADJUDICATE_CACHE_NAME = 'guard/adjudicate';

export const ADJUDICATE_BUDGET: SessionBudget = {
  turns: 15,
  maxResumes: 1,
  tokenCeiling: 150_000,
};

export const ADJUDICATE_SYSTEM_PROMPT = `You are a FORENSIC ADJUDICATOR for one failing scenario of a spec-bound test run.

The scenario executed against the real program and settled red. Your job is to
classify WHY — by reading, running, and quoting evidence, never by guessing.

# The verdict classes (exactly one)
- "expected-red"     — the failure is the committed red the corpus already
                       declared (the briefing shows the declared prediction).
                       Use it only when the observed failure IS that prediction.
- "drift"            — the documentation and the code disagree in a way nothing
                       predicted. The doc promises X, the program verifiably
                       does Y, and the scenario faithfully asserted X.
- "bug"              — the CODE is wrong: you found the mechanism in the source
                       (name it as file + line in \`code\`), and at medium-or-
                       better confidence you ran a CONTROL that tried to
                       disprove it (\`verify_bug\`). A refuted control forbids
                       this class — downgrade.
- "authoring-defect" — the SCENARIO is wrong: a mis-authored assertion, a step
                       that never could have worked, a misread of the doc. The
                       doc and the code do not actually disagree. Requires
                       \`fix\` (which layer, what to change).
- "seed-defect"      — the seeded world (or the scenario's setup declaration)
                       failed before the behavior under test was reached.
                       Requires \`fix\`.
- "infrastructure"   — nothing about the repo is in dispute: a dead sandbox, a
                       timeout, a route no declared server serves, a
                       half-configured external.

# Discipline
- Read the evidence FIRST (the briefing opens with the digest; \`read_evidence\`
  pages the rest). Your verdict is refused if you never read any of it.
- Quote your grounds VERBATIM in \`evidence\` — lines from the evidence files,
  never paraphrases.
- Hunt the mechanism in the source with \`read_file\` / \`search_repo\`; a "bug"
  verdict without a file:line is refused.
- Flake discrimination: \`rerun_scoped\` re-executes the committed scenario in a
  fresh world (at most ${RERUN_MAX} times). A failure that does not reproduce is not a
  code verdict — say what that means for your class.
- Screenshots are read through \`visual_judge\`, never as bytes.
- Argue AGAINST the briefing's declared prediction when one exists but did not
  match: a near-miss red is not an expected red.
- \`findings\`: code-vs-docs discrepancies you noticed en route that are NOT this
  verdict (a doc line that contradicts the source, a derivation that misstates
  an interface). Verbatim, one line each; empty array when none.

# The outcome
End with exactly one JSON object matching the schema you were given:
{ "class": …, "mechanism": …, "code"?: {file,line}, "evidence": [ … ],
  "control"?: {conclusion,reasoning,transcriptRef}, "fix"?: {layer,description},
  "confidence": "low"|"medium"|"high", "findings": [ … ] }
- "bug" requires \`code\`; "bug" at medium/high confidence requires \`control\`
  citing the reference \`verify_bug\` named (the engine refuses one it never ran).
- "authoring-defect" and "seed-defect" require \`fix\`.`;

export const ADJUDICATE_PROMPT_FINGERPRINT = promptFingerprint(ADJUDICATE_SYSTEM_PROMPT);

/**
 * The behavior hash — what the scenario DOES, exactly the fidelity cache's
 * `scenarioBehavior` recipe: title, setup, steps, normalize. Editing the
 * scenario re-adjudicates its failure even when the recorded actual is
 * byte-identical.
 */
export function scenarioBehaviorHash(scenario: GuardScenario | undefined): string {
  const behavior = scenario
    ? JSON.stringify({
        title: scenario.title,
        setup: scenario.setup ?? null,
        steps: scenario.steps,
        normalize: scenario.normalize ?? null,
      })
    : '';
  return createHash('sha256').update(behavior).digest('hex');
}

/** The verdict cache key — see the module note. Exported for the estimate,
 *  which probes the SAME entries the run would (never a parallel guess). */
export function adjudicationCacheKey(item: AdjudicationItem): string {
  return createHash('sha256')
    .update(
      [
        ADJUDICATE_PROMPT_FINGERPRINT,
        item.flowId ?? '',
        item.surface,
        String(item.step),
        item.expected,
        item.actual,
        scenarioBehaviorHash(item.scenario),
      ].join('::'),
    )
    .digest('hex');
}

/** The work-item string the transcript and the session index record. */
export function adjudicationWorkItem(item: AdjudicationItem): string {
  return item.scenarioId;
}

// ---------------------------------------------------------------------------
// The briefing
// ---------------------------------------------------------------------------

/** Caps on what the briefing inlines (context is the budget, §3.3). */
const BRIEFING_SECTION_CHARS = 2200;
const BRIEFING_MAX_SECTIONS = 5;
const BRIEFING_YAML_CHARS = 8000;

/**
 * The spec text behind the failure: each bound section's full text (capped),
 * read off the working tree. A section whose current text no longer carries
 * the bound fingerprint is still quoted — with the drift said out loud, since
 * an adjudicator reading silently drifted text would blame the wrong side.
 */
export function sectionTextsForItem(repoRoot: string, item: AdjudicationItem): string {
  const binds = item.scenario?.binds ?? (item.row.binds ? [item.row.binds] : []);
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const bind of binds.slice(0, BRIEFING_MAX_SECTIONS)) {
    const key = `${bind.doc}\0${bind.section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const abs = path.resolve(repoRoot, bind.doc);
    let content: string;
    try {
      content = fs.readFileSync(abs, 'utf-8');
    } catch {
      blocks.push(`### ${bind.doc} #${bind.section}\n(the document is not on disk)`);
      continue;
    }
    // `extractSectionTexts` returns the sections keyed by anchor.
    const section = extractSectionTexts(bind.doc, content, nodeRefContext(repoRoot, abs)).get(bind.section);
    if (!section) {
      blocks.push(`### ${bind.doc} #${bind.section}\n(the section no longer exists in the document)`);
      continue;
    }
    const text = section.fullText.length > BRIEFING_SECTION_CHARS
      ? `${section.fullText.slice(0, BRIEFING_SECTION_CHARS)}… (truncated)`
      : section.fullText;
    blocks.push(`### ${bind.doc} #${bind.section} — ${section.headingText}\n${text}`);
  }
  return blocks.join('\n\n');
}

export interface AdjudicationBriefingInput {
  item: AdjudicationItem;
  /** The evidence digest (evidence.ts) — already rendered. */
  evidenceDigest: string;
  /** The bound sections' texts — already rendered ({@link sectionTextsForItem}). */
  sectionTexts: string;
}

export function adjudicationBriefing(input: AdjudicationBriefingInput): string {
  const { item } = input;
  const lines: string[] = [
    `# Failing scenario \`${item.scenarioId}\` — ${item.title}`,
    '',
    `- outcome: ${item.outcome}`,
    `- run: ${item.runId}`,
    `- surface: ${item.surface}${item.flowId ? ` · flow: ${item.flowId}` : ''}`,
    `- failing step: ${item.step}${item.row.failedMilestone !== undefined ? ` (milestone ${item.row.failedMilestone})` : ''}`,
    `- expected: ${item.expected}`,
    `- actual:   ${item.actual}`,
  ];
  if (item.row.blockedPrecondition) {
    lines.push('- note: the failing step carries no milestone — it only prepared the world (a precondition broke, not the specified behavior)');
  }
  if (item.row.interfaceDrifted) {
    lines.push('- note: the interface catalog has drifted since this scenario was grounded (the code surface moved)');
  }
  if (item.row.failure?.visual) {
    const v = item.row.failure.visual;
    lines.push(
      `- visual judge (advisory): expected visible = ${v.verdict}; screen: ${v.summary}${v.rationale ? `; rationale: ${v.rationale}` : ''}`,
    );
  }

  if (item.expectedRed) {
    lines.push(
      '',
      '## The committed diagnosis — the flow worker DECLARED a red for this scenario',
      `- declared step: ${item.expectedRed.step} · verdict: ${item.expectedRed.verdict}`,
      `- predicted actual: ${item.expectedRed.predictedActual}`,
      `- brief: ${item.expectedRed.brief}`,
      'The observed failure did NOT match this prediction (a match would have been settled without you).',
      'Argue against the prediction: is this a near-miss of the declared red, or a different failure?',
    );
  }
  if (item.diagnosis?.triage) {
    lines.push(
      '',
      `## Prior triage verdict (generate-time): ${item.diagnosis.triage.verdict} (${item.diagnosis.triage.confidence})`,
      `- brief: ${item.diagnosis.triage.brief}`,
    );
  }
  if (item.prior) {
    lines.push(
      '',
      `## Prior adjudication of this row (you were asked to re-adjudicate)`,
      `- class: ${item.prior.class} (${item.prior.confidence}) at ${item.prior.adjudicatedAt}`,
      `- mechanism: ${item.prior.mechanism}`,
    );
  }

  if (item.flow) {
    lines.push('', `## The flow — ${item.flow.title}`, `goal: ${item.flow.goal}`);
    for (const m of [...item.flow.milestones].sort((a, b) => a.order - b.order)) {
      lines.push(`  ${m.order}. ${m.claimTitle}  (${m.doc} #${m.anchor})`);
    }
  }

  if (input.sectionTexts) {
    lines.push('', '## The bound spec sections', input.sectionTexts);
  }

  if (item.scenarioYaml) {
    const yaml = item.scenarioYaml.length > BRIEFING_YAML_CHARS
      ? `${item.scenarioYaml.slice(0, BRIEFING_YAML_CHARS)}… (truncated)`
      : item.scenarioYaml;
    lines.push('', `## The committed scenario (${item.scenarioFile ?? 'file unknown'})`, '```yaml', yaml.trimEnd(), '```');
  }

  lines.push('', '## The evidence', input.evidenceDigest);
  return lines.join('\n');
}

export interface AdjudicationSessionInput {
  repoRoot: string;
  item: AdjudicationItem;
  exec: AdjudicationExecution;
  state: AdjudicationSessionState;
}

export function adjudicationSessionDef(input: AdjudicationSessionInput): SessionDef<GuardAdjudication> {
  return {
    kind: ADJUDICATE_SESSION_KIND,
    systemPrompt: ADJUDICATE_SYSTEM_PROMPT,
    tools: buildAdjudicationTools(input),
    outcomeSchema: GuardAdjudicationSchema,
    budget: ADJUDICATE_BUDGET,
    // A verdict from a session that never opened the evidence is a guess in a
    // verdict's clothing — refused once, then the session continues.
    outcomePrecondition: {
      tool: 'read_evidence',
      message:
        'Outcome refused: you never read any evidence in this session. Open at least one evidence file with ' +
        '`read_evidence` (start with transcript.txt or invocation.json) — the verdict must quote what actually ran — ' +
        'then produce the outcome again.',
    },
  };
}
