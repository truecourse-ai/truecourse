// Job-definition pattern: a file that exports only a constant whose name
// differs from the module identifier. The constant is imported by the
// sibling job-registry file, so the dead-module rule must NOT fire here.

export function notifyUserJobRun(userId: string): string {
  return `notifying ${userId}`;
}

export const NOTIFY_USER_JOB = {
  id: 'notify-user',
  name: 'Notify User',
  version: '1.0.0',
  trigger: { name: 'notify-user' },
  run: notifyUserJobRun,
} as const;
