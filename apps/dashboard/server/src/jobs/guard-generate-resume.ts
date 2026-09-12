import { guardGenerateResume, type GuardGenerateResume } from '@truecourse/core/commands/guard-in-process';
import { openStoredSessionRun, SessionRunNotFoundError } from '@truecourse/core/lib/sessions-store';
import { createAppError } from '@truecourse/core/lib/errors';

/** Resolve through the authorized repository, never a workspace-wide run-id lookup. */
export async function readGuardGenerateResume(repoKey: string, runId: unknown): Promise<GuardGenerateResume> {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId)) {
    throw createAppError('Invalid resume run ID.', 400);
  }
  try {
    const run = await openStoredSessionRun(repoKey, 'guard-generate', runId);
    try { return guardGenerateResume(run.record()); }
    catch (error) { throw createAppError((error as Error).message, 422); }
  } catch (error) {
    if (error instanceof SessionRunNotFoundError) throw createAppError('Guard generation run not found.', 404);
    throw error;
  }
}
