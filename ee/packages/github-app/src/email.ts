/**
 * Email notifications via Resend (resend.com), sent to the per-repo notify
 * addresses when inference captures new contracts from a PR's code. WorkOS
 * provides auth, not transactional email, so delivery goes through Resend.
 */

import { Resend } from 'resend';
import { log } from '@truecourse/core/lib/logger';
import type { DecisionSummary } from './infer-comment.js';

export interface InferResultEmail {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
  decisions: DecisionSummary[];
  /** Head commit the inferred contracts were stored for. */
  commitSha?: string;
}

export interface EmailNotifier {
  sendInferResult(to: string[], email: InferResultEmail): Promise<void>;
}

/** The slice of the Resend client we use — injectable for tests. */
export interface ResendLike {
  emails: {
    send(opts: {
      from: string;
      to: string[];
      subject: string;
      html: string;
    }): Promise<{ error?: { message: string } | null }>;
  };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
}

const plural = (n: number): string => (n === 1 ? '' : 's');

/** A PR link, label already escaped to `repo #n`. */
function prLink(email: { repoFullName: string; prNumber: number; prUrl: string }): string {
  return `<a href="${escapeHtml(email.prUrl)}">${escapeHtml(email.repoFullName)} #${email.prNumber}</a>`;
}

export function createEmailNotifier(
  apiKey: string,
  from: string,
  client?: ResendLike,
): EmailNotifier {
  const resend: ResendLike = client ?? new Resend(apiKey);

  // One message per recipient: addresses aren't disclosed to each other, and one
  // bad address can't fail the whole batch.
  async function sendEach(
    to: string[],
    subject: string,
    html: string,
  ): Promise<void> {
    if (to.length === 0) return;
    for (const addr of to) {
      try {
        const res = await resend.emails.send({ from, to: [addr], subject, html });
        if (res.error) {
          log.error(`[github-app] resend error for ${addr}: ${res.error.message}`);
        }
      } catch (err) {
        log.error(
          `[github-app] email send failed for ${addr}: ${(err as Error).message}`,
        );
      }
    }
  }

  return {
    async sendInferResult(to, email) {
      const n = email.decisions.length;
      const sha = email.commitSha ? ` (<code>${escapeHtml(email.commitSha.slice(0, 7))}</code>)` : '';
      const subject = `TrueCourse: ${n} undocumented decision${plural(n)} inferred on ${email.repoFullName} #${email.prNumber}`;
      const items = email.decisions
        .slice(0, 20)
        .map((d) => {
          const loc = d.path
            ? ` — <code>${escapeHtml(d.path)}${d.line ? `:${d.line}` : ''}</code>`
            : '';
          const reason = d.reason ? ` — ${escapeHtml(d.reason)}` : '';
          return `<li><strong>${escapeHtml(d.kind)}</strong> <code>${escapeHtml(d.identity)}</code>${loc}${reason}</li>`;
        })
        .join('');
      const more = n > 20 ? `<p>…and ${n - 20} more.</p>` : '';
      const html =
        `<p>TrueCourse inferred ${n} undocumented decision${plural(n)} from ${prLink(email)} ` +
        `and stored them in TrueCourse${sha} (viewable in the dashboard):</p><ul>${items}</ul>${more}`;
      await sendEach(to, subject, html);
    },
  };
}
