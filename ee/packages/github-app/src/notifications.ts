/**
 * Per-repo email notification preferences. Stored sparsely on the repo link
 * (absent = every type on); these helpers resolve the defaults so the gate's
 * send sites and the connect API can ask a simple yes/no.
 */

import type { GithubNotificationPrefs } from '@truecourse/shared';
import { DEFAULT_NOTIFICATION_PREFS } from '@truecourse/shared';
import type { RepoLinkRecord } from './store/types.js';

/** Every notification type key — for validating/iterating partial updates. */
export const NOTIFICATION_KEYS: (keyof GithubNotificationPrefs)[] = [
  'gateFailure',
  'inferResult',
  'conflicts',
];

/** A repo's notification prefs with defaults applied for any unset type. */
export function resolveNotificationPrefs(
  link: Pick<RepoLinkRecord, 'notifications'>,
): GithubNotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(link.notifications ?? {}) };
}

/** Whether a repo wants a given notification type (default on). */
export function wantsNotification(
  link: Pick<RepoLinkRecord, 'notifications'>,
  kind: keyof GithubNotificationPrefs,
): boolean {
  return resolveNotificationPrefs(link)[kind];
}
