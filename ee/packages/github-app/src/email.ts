/**
 * Email notifications via Resend (resend.com), sent to a repo's per-repo notify
 * addresses. One trigger today: the guard gate fails on a PR with new failing
 * scenarios vs. its base. WorkOS provides auth, not transactional email, so
 * delivery goes through Resend.
 */

import { Resend } from 'resend';
import { log } from '@truecourse/core/lib/logger';
import type { GuardScenarioResult } from '@truecourse/shared';

export interface GuardGateFailureEmail {
  repoFullName: string;
  prNumber: number;
  prUrl: string;
  /** The scenarios that passed on base and fail on head — the only set that
   *  fails the Check, and the only set this email reports. */
  failing: GuardScenarioResult[];
  /** Deep link to the PR's Check run, when derivable. */
  checkUrl?: string;
  /** Deep link to the PR-scoped dashboard guard view, when derivable. */
  dashboardUrl?: string;
}

/** The "scenario generation is blocked on unresolved spec conflicts" email —
 *  the guard-generate / spec-regen analogue of the gate-failure notice. */
export interface GuardConflictsBlockedEmail {
  repoFullName: string;
  /** Open spec conflicts that blocked generation — resolve these to unblock. */
  conflicts: number;
  /** Deep link to the repo's Spec Guard → Coverage tab, when derivable. */
  dashboardUrl?: string;
}

export interface EmailNotifier {
  sendGuardGateFailure(to: string[], email: GuardGateFailureEmail): Promise<void>;
  sendGuardConflictsBlocked(to: string[], email: GuardConflictsBlockedEmail): Promise<void>;
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

/**
 * The notifier when Resend is configured, else undefined — the one place the
 * "unconfigured → the gate simply never emails" rule lives.
 */
export function notifierFromConfig(cfg: {
  resendApiKey: string | null;
  emailFrom: string;
}): EmailNotifier | undefined {
  return cfg.resendApiKey
    ? createEmailNotifier(cfg.resendApiKey, cfg.emailFrom)
    : undefined;
}

export function createEmailNotifier(
  apiKey: string,
  from: string,
  client?: ResendLike,
): EmailNotifier {
  const resend: ResendLike = client ?? new Resend(apiKey);

  // One message per recipient: addresses aren't disclosed to each other, and one
  // bad address can't fail the whole batch.
  async function sendEach(to: string[], subject: string, html: string): Promise<void> {
    if (to.length === 0) return;
    for (const addr of to) {
      try {
        const res = await resend.emails.send({ from, to: [addr], subject, html });
        if (res.error) {
          log.error(`[github-app] resend error for ${addr}: ${res.error.message}`);
        }
      } catch (err) {
        log.error(`[github-app] email send failed for ${addr}: ${(err as Error).message}`);
      }
    }
  }

  return {
    async sendGuardGateFailure(to, email) {
      const n = email.failing.length;
      const subject = `TrueCourse: ${n} new failing scenario${plural(n)} on ${email.repoFullName} #${email.prNumber}`;
      const items = email.failing
        .slice(0, 20)
        .map(
          (s) =>
            `<li><strong>${escapeHtml(s.title)}</strong> — <code>${escapeHtml(s.binds.doc)}#${escapeHtml(s.binds.section)}</code></li>`,
        )
        .join('');
      const more = n > 20 ? `<p>…and ${n - 20} more — see the pull request.</p>` : '';
      const linkParts: string[] = [];
      if (email.checkUrl) {
        linkParts.push(`<a href="${escapeHtml(email.checkUrl)}">View the Check run</a>`);
      }
      if (email.dashboardUrl) {
        linkParts.push(`<a href="${escapeHtml(email.dashboardUrl)}">Open the guard view in the dashboard</a>`);
      }
      const links = linkParts.length > 0 ? `<p>${linkParts.join(' · ')}</p>` : '';
      const html =
        `<p>The TrueCourse guard gate failed on ${prLink(email)} ` +
        `with ${n} new failing scenario${plural(n)}:</p><ul>${items}</ul>${more}${links}`;
      await sendEach(to, subject, html);
    },

    async sendGuardConflictsBlocked(to, email) {
      const n = email.conflicts;
      const subject = `TrueCourse: scenario generation blocked on ${email.repoFullName} — ${n} spec conflict${plural(n)}`;
      const link = email.dashboardUrl
        ? `<p><a href="${escapeHtml(email.dashboardUrl)}">Resolve them in the Spec Guard → Coverage tab</a></p>`
        : '';
      const html =
        `<p>TrueCourse could not generate guard scenarios for <strong>${escapeHtml(email.repoFullName)}</strong>: ` +
        `${n} open spec conflict${plural(n)} must be resolved first.</p>` +
        `<p>Extracting both sides of an unresolved overlap births a red finding that is really the dispute, ` +
        `so generation is paused until the conflicts are resolved.</p>${link}`;
      await sendEach(to, subject, html);
    },
  };
}
