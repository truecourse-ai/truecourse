/**
 * The interactive "infer undocumented decisions" PR comment. Same checkbox
 * state model as the scan comment, with its own marker so the two coexist.
 */

import { makeCommentKit } from './comment-kit.js';

export const INFER_MARKER = '<!-- truecourse-gate:infer -->';
export const INFER_CHECKBOX_LABEL =
  'Capture undocumented decisions as inferred contracts';

const kit = makeCommentKit(INFER_MARKER, INFER_CHECKBOX_LABEL);

export type InferCommentStatus =
  | 'offered'
  | 'running'
  | 'done'
  | 'nochange'
  | 'error'
  | 'fork';

/** A decision summarized for display (subset of the verifier's InferredDecision). */
export interface DecisionSummary {
  kind: string;
  identity: string;
  path?: string;
  line?: number;
  reason?: string;
}

export interface InferCommentData {
  decisions?: DecisionSummary[];
  commitSha?: string;
  /** Deep link to the stored inferred contracts in the dashboard (success). */
  dashboardUrl?: string;
  error?: string;
}

export function isInferComment(body: string | undefined | null): boolean {
  return kit.isOurs(body);
}
export function isInferCheckboxChecked(body: string | undefined | null): boolean {
  return kit.isChecked(body);
}
export function hasInferOffer(body: string | undefined | null): boolean {
  return kit.hasOffer(body);
}

export function renderInferComment(
  status: InferCommentStatus,
  data: InferCommentData = {},
): string {
  const head = INFER_MARKER + '\n';
  const checkbox = kit.checkboxLine();
  switch (status) {
    case 'offered':
      return (
        head +
        `### 🔎 Check for undocumented decisions\n\n` +
        `Reverse-engineer decisions from this PR's code that the spec doesn't ` +
        `capture, and add them as inferred contracts?\n\n` +
        `${checkbox}\n\n` +
        `_Checking the box runs inference (LLM pipeline, may take a few minutes). ` +
        `Inferred contracts are stored in TrueCourse and viewable in the dashboard — ` +
        `nothing is committed to your branch._`
      );
    case 'running':
      return head + `### ⏳ Inferring undocumented decisions…`;
    case 'done': {
      const ds = data.decisions ?? [];
      const sha = data.commitSha ? ` (\`${data.commitSha.slice(0, 7)}\`)` : '';
      const list = ds
        .slice(0, 10)
        .map(
          (d) =>
            `- **${d.kind}** \`${d.identity}\`` +
            (d.path ? ` — \`${d.path}${d.line ? `:${d.line}` : ''}\`` : '') +
            (d.reason ? ` — ${d.reason}` : ''),
        )
        .join('\n');
      const more = ds.length > 10 ? `\n\n…and ${ds.length - 10} more.` : '';
      const view = data.dashboardUrl
        ? `[view them in the dashboard](${data.dashboardUrl})`
        : 'view them in the dashboard';
      return (
        head +
        `### 🔎 ${ds.length} undocumented decision${ds.length === 1 ? '' : 's'} found\n\n` +
        `Stored inferred contracts in TrueCourse${sha} — ${view} and ` +
        `promote them into the spec as appropriate. Nothing was committed to this branch.\n\n${list}${more}`
      );
    }
    case 'nochange':
      return (
        head +
        `### ✅ No undocumented decisions\n\n` +
        `The code's decisions are all already captured by the spec.`
      );
    case 'error':
      return (
        head +
        `### ⚠️ Inference failed\n\n` +
        `${data.error ?? 'Unknown error.'}\n\n` +
        `${checkbox}\n\n_Check the box to retry._`
      );
    case 'fork':
      return (
        head +
        `### ℹ️ Fork PR — automatic inference unavailable\n\n` +
        `This PR comes from a fork, which TrueCourse can't analyze automatically yet. ` +
        `Run \`truecourse infer\` locally to review undocumented decisions.`
      );
  }
}
