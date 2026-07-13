/**
 * Rendering for the gate's PR surfaces: the Code Quality GitHub Check output and
 * the PR summary comment. The gate is automatic (no checkbox), so the comment is
 * a plain status comment kept fresh each run.
 */

import type { GateConclusion, CodeQualityDecision } from './gate.js';

export const GATE_MARKER = '<!-- truecourse-gate:result -->';
export const CODE_QUALITY_CHECK_NAME = 'TrueCourse / Code Quality';

const STATUS_EMOJI: Record<GateConclusion, string> = {
  success: '✅',
  failure: '❌',
  neutral: '⚪',
};

/** One-line Code Quality summary for the Check + comment. */
function codeQualitySummary(cq: CodeQualityDecision): string {
  if (cq.neutralReason === 'no-baseline') return 'no baseline analysis yet';
  if (cq.added.length > 0) {
    const n = cq.added.length;
    return `${n} new violation${n === 1 ? '' : 's'} at/above threshold`;
  }
  if (cq.total > 0) return `${cq.total} new violation${cq.total === 1 ? '' : 's'} (below threshold)`;
  return 'no new violations';
}

/** Output for the "TrueCourse / Code Quality" GitHub Check. */
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

export function isGateComment(body: string | undefined | null): boolean {
  return !!body && body.includes(GATE_MARKER);
}

/**
 * The PR summary comment: a single Code Quality status line with a deep-link, and
 * the new-violation list when the PR introduces any at/above the threshold.
 */
export function renderGateComment(
  cq: CodeQualityDecision,
  opts: { codeQualityUrl?: string } = {},
): string {
  const line = `- ${STATUS_EMOJI[cq.conclusion]} **Code Quality** — ${codeQualitySummary(cq)}`;
  const link = opts.codeQualityUrl ? `\n\n[View Code Quality →](${opts.codeQualityUrl})` : '';
  const head = `${GATE_MARKER}\n### TrueCourse gate\n\n${line}${link}`;

  if (cq.added.length === 0) return head;

  const list = cq.added
    .map((v) => `- **${v.severity}** ${v.title}${v.filePath ? ` — \`${v.filePath}\`` : ''}`)
    .join('\n');
  const advisory = cq.conclusion === 'neutral';
  const footer = advisory
    ? `\n\n_Advisory mode: this does not block the merge._`
    : `\n\n_Resolve the new violations to merge._`;
  return `${head}\n\n---\n\n${list}${footer}`;
}
