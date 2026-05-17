// Paraphrase of the documenso job-definition pattern.
// This file exports only a constant whose name differs from the module identifier.
// It IS imported by job-registry-from-documenso-documenso.ts, so the dead-module
// rule must NOT fire here.

export const NOTIFY_USER_JOB = {
  id: 'notify-user',
  name: 'Notify User',
  version: '1.0.0',
  trigger: { name: 'notify-user' },
  run: (userId: string): string => `notifying ${userId}`,
} as const;
