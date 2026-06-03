/**
 * Rendering for the drift-gate surfaces: the PR summary comment, the GitHub
 * Check output, and per-drift inline review comments. The gate is automatic
 * (no checkbox), so this is a plain status comment kept fresh each run.
 */

import type { GateDrift } from './store/types.js';
import type { GateDecision } from './gate.js';

export const GATE_MARKER = '<!-- truecourse-gate:result -->';
export const GATE_CHECK_NAME = 'TrueCourse / drift';

export function isGateComment(body: string | undefined | null): boolean {
  return !!body && body.includes(GATE_MARKER);
}

function loc(d: GateDrift): string {
  return `${d.filePath}:${d.lineStart}`;
}

function driftLine(d: GateDrift): string {
  return `- **${d.severity}** ${d.message} — \`${loc(d)}\``;
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
  opts: { conflictsUrl?: string } = {},
): string {
  const head = GATE_MARKER + '\n';

  if (decision.neutralReason === 'unresolved-conflicts') {
    const n = decision.unresolvedConflicts ?? 0;
    const where = opts.conflictsUrl
      ? `[resolve them in the dashboard](${opts.conflictsUrl})`
      : 'resolve them in the dashboard';
    return (
      head +
      `### ⚪ TrueCourse drift gate — spec needs resolution\n\n` +
      `This PR's spec has ${n} unresolved conflict${n === 1 ? '' : 's'}. ` +
      `The contracts were generated with an auto-chosen default, so the gate ` +
      `can't reliably check drift yet. Please ${where}; the gate re-runs on the ` +
      `next push.`
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

  const list = decision.added.map(driftLine).join('\n');
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
      title: 'Spec conflicts need resolution',
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
    title: `${n} new contract drift${n === 1 ? '' : 's'}`,
    summary: decision.added.map(driftLine).join('\n'),
  };
}

/** Body for a single inline review comment on a drift's line. */
export function inlineDriftBody(d: GateDrift): string {
  const spec = d.specSide ? `\n\n**Spec:** ${d.specSide}` : '';
  const code = d.codeSide ? `\n\n**Code:** ${d.codeSide}` : '';
  return `**TrueCourse drift (${d.severity}):** ${d.message}${spec}${code}`;
}
