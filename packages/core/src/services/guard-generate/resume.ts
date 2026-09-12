import type { PublicRunRecord } from '../../lib/sessions-store.js';
import { ChecklistItemSchema } from '@truecourse/agent-loop';

/** A resume replays completed authoring from durable caches. Live proof still runs. */
export interface GuardGenerateResume {
  runId: string;
  gitRef: string;
  completedSteps: string[];
}

const STEPS = ['index', 'extract', 'interfaces', 'flows', 'match', 'author', 'validate'];

export function guardGenerateResume(record: PublicRunRecord): GuardGenerateResume {
  if (record.command !== 'guard-generate' || !['interrupted', 'failed'].includes(record.status)) {
    throw new Error('Only interrupted or failed guard generation can be resumed.');
  }
  const items = (record.display?.blocks.flatMap(block =>
    block.kind === 'checklist' && Array.isArray(block.items) ? block.items : []) ?? [])
    .flatMap(item => {
      const parsed = ChecklistItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  // A pool may tick done before its final fold/epic pass. A later step must
  // have started too. Author and validate overlap, so neither is replay-only.
  const completedSteps: string[] = [];
  for (const key of STEPS.slice(0, 5)) {
    const index = STEPS.indexOf(key);
    const laterStarted = items.some(item => STEPS.indexOf(item.key) > index && item.status !== 'pending');
    if (items.find(item => item.key === key)?.status !== 'done' || !laterStarted) break;
    completedSteps.push(key);
  }
  return { runId: record.runId, gitRef: record.gitRef, completedSteps };
}

export class GuardGenerateResumeError extends Error {
  constructor(step: string, reason?: string) {
    super(reason ?? `Cannot resume: saved ${step} results are missing or no longer match the inputs. Completed work was not restarted. Start a new generation explicitly to regenerate it.`);
    this.name = 'GuardGenerateResumeError';
  }
}

export function assertGuardGenerateResumeCommit(resume: GuardGenerateResume, commitSha: string): void {
  // A failure before checkout has no commit or completed generation to protect.
  if ((!resume.gitRef || resume.gitRef === 'unknown') && resume.completedSteps.length === 0) return;
  if (commitSha !== resume.gitRef) {
    throw new GuardGenerateResumeError('index', 'Cannot resume: the repository commit has changed. Start a new generation explicitly.');
  }
}
