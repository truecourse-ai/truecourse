/**
 * The interactive "regenerate guard scenarios for this PR head" comment. A PR
 * that changes spec documents gets this checkbox offer; ticking it regenerates
 * the PR head's scenarios server-side and re-gates. Same checkbox state model as
 * the scan/infer comments, with its own marker so all three coexist.
 */

import { makeCommentKit } from './comment-kit.js';

export const GUARD_SPEC_MARKER = '<!-- truecourse-gate:guard-spec -->';
export const GUARD_SPEC_CHECKBOX_LABEL = 'Regenerate guard scenarios for this PR head';

const kit = makeCommentKit(GUARD_SPEC_MARKER, GUARD_SPEC_CHECKBOX_LABEL);

export type GuardSpecCommentStatus =
  | 'offered'
  | 'running'
  | 'done'
  | 'nochange'
  | 'blocked'
  | 'error';

export interface GuardSpecCommentData {
  /** Spec documents the PR changed (drives the offer's "why you're seeing this"). */
  specDocs?: string[];
  /** Scenarios written by the regenerate (the `done` summary). */
  scenariosWritten?: number;
  /** The PR head commit the scenarios were generated from + persisted under. */
  commitSha?: string;
  /** Open spec conflicts blocking regeneration (the `blocked` summary). */
  conflicts?: number;
  error?: string;
}

export function isGuardSpecComment(body: string | undefined | null): boolean {
  return kit.isOurs(body);
}
export function isGuardSpecCheckboxChecked(body: string | undefined | null): boolean {
  return kit.isChecked(body);
}

export function renderGuardSpecComment(
  status: GuardSpecCommentStatus,
  data: GuardSpecCommentData = {},
): string {
  const head = GUARD_SPEC_MARKER + '\n';
  const checkbox = kit.checkboxLine();
  switch (status) {
    case 'offered': {
      const docs = data.specDocs ?? [];
      const list = docs
        .slice(0, 10)
        .map((d) => `- \`${d}\``)
        .join('\n');
      const more = docs.length > 10 ? `\n\n…and ${docs.length - 10} more.` : '';
      const changed = docs.length
        ? `\n\nSpec documents changed on this PR:\n\n${list}${more}\n`
        : '';
      return (
        head +
        `### 🛡️ Spec changed — regenerate guard scenarios?\n\n` +
        `This PR edits spec documents, so the guard scenarios generated from them ` +
        `may be out of date.${changed}\n` +
        `${checkbox}\n\n` +
        `_Checking the box regenerates scenarios for this PR head server-side ` +
        `(LLM pipeline, may take a few minutes) and re-gates the PR. Scenarios are ` +
        `stored in TrueCourse — nothing is committed to your branch._`
      );
    }
    case 'running':
      return head + `### ⏳ Regenerating guard scenarios for the PR head…`;
    case 'done': {
      const n = data.scenariosWritten ?? 0;
      const sha = data.commitSha ? ` (\`${data.commitSha.slice(0, 7)}\`)` : '';
      return (
        head +
        `### 🛡️ ${n} guard scenario${n === 1 ? '' : 's'} regenerated\n\n` +
        `Regenerated the PR head's scenarios${sha} and re-gated. ` +
        `Nothing was committed to this branch.`
      );
    }
    case 'nochange':
      return (
        head +
        `### ✅ No guard scenarios to regenerate\n\n` +
        `The changed spec documents produced no scenarios (no doc universe yet).`
      );
    case 'blocked': {
      const n = data.conflicts ?? 0;
      return (
        head +
        `### 🛡️ Scenario generation blocked — spec conflicts\n\n` +
        `${n} open spec conflict${n === 1 ? '' : 's'} must be resolved before scenarios can ` +
        `regenerate. Resolve them in the dashboard's Spec Guard → Coverage tab, then re-tick to retry.\n\n` +
        `${checkbox}\n\n_Check the box to retry once the conflicts are resolved._`
      );
    }
    case 'error':
      return (
        head +
        `### ⚠️ Guard regeneration failed\n\n` +
        `${data.error ?? 'Unknown error.'}\n\n` +
        `${checkbox}\n\n_Check the box to retry._`
      );
  }
}
