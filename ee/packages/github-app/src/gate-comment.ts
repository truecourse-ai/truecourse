/**
 * Rendering for the drift-gate surfaces: the PR summary comment, the GitHub
 * Check output, and per-drift inline review comments. The gate is automatic
 * (no checkbox), so this is a plain status comment kept fresh each run.
 */

import {
  driftContentKey,
  type EnrichedDrift,
} from '@truecourse/core/lib/drift-enrichment';
import type { GateDrift } from './store/types.js';
import type { GateConclusion, GateDecision, CodeQualityDecision } from './gate.js';

export const GATE_MARKER = '<!-- truecourse-gate:result -->';
export const GATE_CHECK_NAME = 'TrueCourse / drift';
export const CODE_QUALITY_CHECK_NAME = 'TrueCourse / Code Quality';

const STATUS_EMOJI: Record<GateConclusion, string> = {
  success: '✅',
  failure: '❌',
  neutral: '⚪',
};

/** One-line Code Quality summary for the Check + combined comment. */
function codeQualitySummary(cq: CodeQualityDecision): string {
  if (cq.neutralReason === 'no-baseline') return 'no baseline analysis yet';
  if (cq.added.length > 0) {
    const n = cq.added.length;
    return `${n} new violation${n === 1 ? '' : 's'} at/above threshold`;
  }
  if (cq.total > 0) return `${cq.total} new violation${cq.total === 1 ? '' : 's'} (below threshold)`;
  return 'no new violations';
}

/** Output for the standalone "TrueCourse / Code Quality" GitHub Check. */
export function cqCheckOutput(cq: CodeQualityDecision): { title: string; summary: string } {
  if (cq.neutralReason === 'no-baseline') {
    return {
      title: 'No baseline analysis yet',
      summary: 'Code Quality compares against the default branch analysis; none is stored yet.',
    };
  }
  if (cq.added.length === 0) {
    const below = cq.total > 0 ? ` ${cq.total} new below threshold.` : '';
    return { title: 'No new violations', summary: `No new code-quality violations at/above the threshold.${below}` };
  }
  const n = cq.added.length;
  return {
    title: `${n} new code-quality violation${n === 1 ? '' : 's'}`,
    summary: cq.added.map((v) => `- **${v.severity}** ${v.title}${v.filePath ? ` (${v.filePath})` : ''}`).join('\n'),
  };
}

/**
 * Combined two-signal header prepended to the gate comment when a Code Quality
 * result is present — one status line each for Code Quality + Verification, with
 * deep-links. The Verification drift detail still follows below.
 */
function combinedHeader(
  decision: GateDecision,
  cq: CodeQualityDecision,
  opts: { codeQualityUrl?: string; verifyUrl?: string },
): string {
  const cqLine = `- ${STATUS_EMOJI[cq.conclusion]} **Code Quality** — ${codeQualitySummary(cq)}`;
  const drift =
    decision.added.length > 0
      ? `${decision.added.length} new drift${decision.added.length === 1 ? '' : 's'}`
      : decision.neutralReason
        ? decision.neutralReason.replace(/-/g, ' ')
        : 'no new drift';
  const vLine = `- ${STATUS_EMOJI[decision.conclusion]} **Verification** — ${drift}`;
  const links = [
    opts.codeQualityUrl ? `[View Code Quality →](${opts.codeQualityUrl})` : null,
    opts.verifyUrl ? `[View Verification →](${opts.verifyUrl})` : null,
  ].filter(Boolean);
  return (
    `### TrueCourse gate\n\n${cqLine}\n${vLine}\n` +
    (links.length ? `\n${links.join(' · ')}\n` : '') +
    `\n---\n\n`
  );
}

/** Readable prose for the drifts in a decision, keyed by `driftContentKey`. */
export type DriftEnrichmentMap = Map<string, EnrichedDrift>;

export function isGateComment(body: string | undefined | null): boolean {
  return !!body && body.includes(GATE_MARKER);
}

function loc(d: GateDrift): string {
  return `${d.filePath}:${d.lineStart}`;
}

/**
 * One summary bullet per drift. When enriched prose is available for the drift
 * (matched by its content key) the human-facing text is the readable summary;
 * otherwise it's the structured `message`. The structured `message` stays the
 * AI/query anchor and is never dropped from the underlying decision.
 */
function driftLine(d: GateDrift, enriched?: DriftEnrichmentMap): string {
  const e = enriched?.get(driftContentKey(d));
  const text = e ? e.summary : d.message;
  return `- **${d.severity}** ${text} — \`${loc(d)}\``;
}

function resolvedNote(d: GateDecision): string {
  return d.resolved.length
    ? `\n\n${d.resolved.length} drift${d.resolved.length === 1 ? '' : 's'} resolved by this PR. 🎉`
    : '';
}

function belowNote(d: GateDecision): string {
  return d.belowThreshold.length
    ? `\n\n_${d.belowThreshold.length} lower-severity drift not gated._`
    : '';
}

export function renderGateComment(
  decision: GateDecision,
  opts: {
    conflictsUrl?: string;
    enriched?: DriftEnrichmentMap;
    /** When set, prepend a combined two-signal header (Code Quality + Verification). */
    codeQuality?: CodeQualityDecision;
    codeQualityUrl?: string;
    verifyUrl?: string;
  } = {},
): string {
  const head =
    GATE_MARKER +
    '\n' +
    (opts.codeQuality ? combinedHeader(decision, opts.codeQuality, opts) : '');

  if (decision.neutralReason === 'unresolved-conflicts') {
    const n = decision.unresolvedConflicts ?? 0;
    const where = opts.conflictsUrl
      ? `[resolve them in the dashboard](${opts.conflictsUrl})`
      : 'resolve them in the dashboard';
    const blocking = decision.conclusion === 'failure';
    const title = blocking
      ? `### ❌ TrueCourse drift gate — ${n} unresolved spec conflict${n === 1 ? '' : 's'}`
      : `### ⚪ TrueCourse drift gate — spec needs resolution`;
    const footer = blocking ? ` This blocks the merge until resolved.` : '';
    return (
      head +
      `${title}\n\n` +
      `This PR's spec has ${n} unresolved conflict${n === 1 ? '' : 's'}. ` +
      `The contracts were generated with an auto-chosen default, so the gate ` +
      `can't reliably check drift yet. Please ${where}; the gate re-runs on the ` +
      `next push.${footer}`
    );
  }

  if (decision.neutralReason === 'no-contracts') {
    return (
      head +
      `### ⚪ TrueCourse drift gate — no contracts\n\n` +
      `No committed contracts to verify. Run \`truecourse contracts generate\` ` +
      `and commit \`.truecourse/contracts\` so the gate can run.`
    );
  }

  if (decision.neutralReason === 'no-baseline') {
    return (
      head +
      `### ⚪ TrueCourse drift gate — baseline not established\n\n` +
      `No base contracts to compare against yet. The baseline is set when ` +
      `changes merge to the default branch; this PR isn't gated.`
    );
  }

  if (decision.added.length === 0) {
    return (
      head +
      `### ✅ TrueCourse drift gate passed\n\n` +
      `No new contract drift introduced.${resolvedNote(decision)}${belowNote(decision)}`
    );
  }

  const list = decision.added.map((d) => driftLine(d, opts.enriched)).join('\n');
  const n = decision.added.length;
  const advisory = decision.conclusion === 'neutral';
  const title = advisory
    ? `### ⚠️ TrueCourse drift gate — ${n} new drift${n === 1 ? '' : 's'} (advisory)`
    : `### ❌ TrueCourse drift gate — ${n} new drift${n === 1 ? '' : 's'}`;
  const footer = advisory
    ? `\n\n_Advisory mode: this does not block the merge._`
    : `\n\n_Resolve the drift, or update the spec to match, to merge._`;
  return (
    head +
    `${title}\n\n${list}${resolvedNote(decision)}${belowNote(decision)}${footer}`
  );
}

export function gateCheckOutput(decision: GateDecision): {
  title: string;
  summary: string;
} {
  if (decision.neutralReason === 'unresolved-conflicts') {
    const n = decision.unresolvedConflicts ?? 0;
    return {
      title: decision.conclusion === 'failure' ? 'Unresolved spec conflicts block this PR' : 'Spec conflicts need resolution',
      summary: `The head spec has ${n} unresolved conflict${n === 1 ? '' : 's'}; resolve them in the dashboard, then push again.`,
    };
  }
  if (decision.neutralReason === 'no-contracts') {
    return {
      title: 'No contracts to verify',
      summary: 'This repository has no committed contracts.',
    };
  }
  if (decision.neutralReason === 'no-baseline') {
    return {
      title: 'Baseline not established',
      summary: 'No base contracts to compare against yet.',
    };
  }
  if (decision.added.length === 0) {
    return {
      title: 'No new drift',
      summary: `No new contract drift. ${decision.resolved.length} resolved.`,
    };
  }
  const n = decision.added.length;
  return {
    // The Check is authoritative + deterministic — always structured, never enriched.
    title: `${n} new contract drift${n === 1 ? '' : 's'}`,
    summary: decision.added.map((d) => driftLine(d)).join('\n'),
  };
}

/**
 * Body for a single inline review comment on a drift's line. When enriched prose
 * is available (matched by content key) the spec/code lines read as plain prose
 * and a one-line summary leads; otherwise the structured `specSide`/`codeSide`
 * snippets are shown. The terse `message` always leads as the AI/query anchor.
 */
export function inlineDriftBody(d: GateDrift, enriched?: DriftEnrichmentMap): string {
  const e = enriched?.get(driftContentKey(d));
  if (e) {
    const summary = `\n\n${e.summary}`;
    const spec = `\n\n**Spec expectation:** ${e.specReadable}`;
    const code = `\n\n**Code observation:** ${e.codeReadable}`;
    return `**TrueCourse drift (${d.severity}):** ${d.message}${summary}${spec}${code}`;
  }
  const spec = d.specSide ? `\n\n**Spec:** ${d.specSide}` : '';
  const code = d.codeSide ? `\n\n**Code:** ${d.codeSide}` : '';
  return `**TrueCourse drift (${d.severity}):** ${d.message}${spec}${code}`;
}
