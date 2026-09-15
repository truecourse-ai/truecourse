/**
 * Per-repo email notification preferences. Stored sparsely on the repo link
 * (absent = every type on) and resolved here so the connect API can answer a
 * simple yes/no. Unused today — nothing sends; kept for the notification
 * design, which is not built yet.
 */

import type { GithubNotificationPrefs, RepositoryRecord } from '@truecourse/shared';
import { DEFAULT_NOTIFICATION_PREFS } from '@truecourse/shared';

/** Every notification type key — for validating/iterating partial updates. */
export const NOTIFICATION_KEYS: (keyof GithubNotificationPrefs)[] = [
  'gateFailure',
  'conflicts',
  'specRegen',
];

/** A repo's notification prefs with defaults applied for any unset type. */
export function resolveNotificationPrefs(
  link: Pick<RepositoryRecord, 'notifications'>,
): GithubNotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(link.notifications ?? {}) };
}

/** Whether a repo wants a given notification type (default on). */
export function wantsNotification(
  link: Pick<RepositoryRecord, 'notifications'>,
  kind: keyof GithubNotificationPrefs,
): boolean {
  return resolveNotificationPrefs(link)[kind];
}
