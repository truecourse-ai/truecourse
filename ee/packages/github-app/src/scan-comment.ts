/**
 * The interactive "run scan" PR comment. State lives in the comment body
 * itself (à la CodeRabbit): a hidden marker identifies our comment, and a
 * task-list checkbox drives the flow. Checking the box (an
 * `issue_comment.edited` webhook) requests the scan; we then rewrite the body
 * through running → result, which also removes the checkbox so it can't be
 * re-triggered.
 */

import { makeCommentKit } from './comment-kit.js';

/** Hidden marker that identifies our scan comment (one per PR). */
export const SCAN_MARKER = '<!-- truecourse-gate:scan -->';

/** Exact checkbox label — matched to detect a checked box. */
export const SCAN_CHECKBOX_LABEL =
  'Run TrueCourse scan & regenerate contracts';

const kit = makeCommentKit(SCAN_MARKER, SCAN_CHECKBOX_LABEL);

export type ScanCommentStatus =
  | 'offered'
  | 'running'
  | 'done'
  | 'nochange'
  | 'error'
  | 'fork';

export interface ScanCommentData {
  /** Spec docs that changed (shown in the offer). */
  specDocs?: string[];
  /** Contract files generated + the head commit they were stored for (success). */
  savedFileCount?: number;
  commitSha?: string;
  /** Deep link to the stored contracts in the dashboard (success). */
  dashboardUrl?: string;
  /** Unresolved spec conflicts the scan auto-defaulted (shown as a warning). */
  openConflicts?: number;
  /** Error message (shown on failure). */
  error?: string;
}

/** Does this comment body belong to us? */
export function isScanComment(body: string | undefined | null): boolean {
  return kit.isOurs(body);
}

/** Is the scan checkbox checked (`- [x] <label>`)? */
export function isScanCheckboxChecked(body: string | undefined | null): boolean {
  return kit.isChecked(body);
}

/**
 * Does the body still show an actionable (unchecked) offer? True for the
 * 'offered' and 'error' (retry) states; false for running/done/nochange — used
 * to avoid clobbering an in-progress or finished comment when refreshing.
 */
export function hasScanOffer(body: string | undefined | null): boolean {
  return kit.hasOffer(body);
}

export function renderScanComment(
  status: ScanCommentStatus,
  data: ScanCommentData = {},
): string {
  const head = SCAN_MARKER + '\n';
  const checkbox = kit.checkboxLine();
  switch (status) {
    case 'offered': {
      const docs = (data.specDocs ?? []).map((d) => `\`${d}\``).join(', ');
      return (
        head +
        `### 📋 Spec change detected\n\n` +
        `This PR changes spec documents${docs ? ` (${docs})` : ''}. ` +
        `Regenerate the TrueCourse contracts from the updated spec?\n\n` +
        `${checkbox}\n\n` +
        `_Checking the box runs a scan (this uses the LLM pipeline and may take a few minutes). ` +
        `The regenerated contracts are stored in TrueCourse and viewable in the dashboard — ` +
        `nothing is committed to your branch._`
      );
    }
    case 'running':
      return (
        head +
        `### ⏳ Running TrueCourse scan…\n\n` +
        `Scanning spec documents and regenerating contracts. This can take a few minutes.`
      );
    case 'done': {
      const n = data.savedFileCount ?? 0;
      const sha = data.commitSha ? ` for \`${data.commitSha.slice(0, 7)}\`` : '';
      const link = data.dashboardUrl
        ? `[view them in the dashboard](${data.dashboardUrl})`
        : 'view them in the dashboard';
      const c = data.openConflicts ?? 0;
      const conflicts =
        c > 0
          ? `\n\n⚠️ The scan left **${c} unresolved spec conflict${c === 1 ? '' : 's'}**, ` +
            `resolved with an auto-chosen default. The drift gate stays neutral until ` +
            `you ${data.dashboardUrl ? `[resolve them in the dashboard](${data.dashboardUrl})` : 'resolve them in the dashboard'}.`
          : '';
      return (
        head +
        `### ✅ Contracts regenerated\n\n` +
        `Generated ${n} contract file${n === 1 ? '' : 's'}${sha} and stored them in TrueCourse — ` +
        `${link}. Nothing was committed to this branch.${conflicts}`
      );
    }
    case 'nochange':
      return (
        head +
        `### ✅ Spec scanned — no contracts produced\n\n` +
        `The scan completed but produced no contracts to store for this PR.`
      );
    case 'error':
      return (
        head +
        `### ⚠️ Scan failed\n\n` +
        `${data.error ?? 'Unknown error.'}\n\n` +
        `${checkbox}\n\n_Check the box to retry._`
      );
    case 'fork':
      return (
        head +
        `### ℹ️ Fork PR — automatic scan unavailable\n\n` +
        `This PR comes from a fork, which TrueCourse can't scan automatically yet. ` +
        `Run \`truecourse spec scan && truecourse contracts generate\` locally to ` +
        `review the regenerated contracts.`
      );
  }
}
