
// while-loop bounded by wall-clock time comparison — not user input — FP shape ccbe0b357d85
declare const CronParser: any;

interface ScheduledJobEntry {
  cron: string;
  lastTickAt: Date;
}

function getDueScheduleSlots(job: ScheduledJobEntry): Date[] {
  const expr = CronParser.parse(job.cron, {
    currentDate: job.lastTickAt,
  });

  const now = new Date();
  const slots: Date[] = [];

  let next = expr.next();

  while (next.toDate() <= now) {
    slots.push(next.toDate());
    next = expr.next();
  }

  return slots;
}



// FP: typeof-type-guard-presence-check — typeof jobId/signature !== 'string' type guards for input validation before verify()
declare function verifyJobSignature(jobId: string, signature: string): boolean;
declare function rejectJobRequest(reason: string): never;

function processLocalJobRequest(jobId: unknown, signature: unknown) {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    rejectJobRequest('jobId must be a non-empty string');
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    rejectJobRequest('signature must be a non-empty string');
  }
  // narrowed to string; pass to verifier
  return verifyJobSignature(jobId as string, signature as string);
}



// FP: var inside declare global block is required TypeScript syntax for global augmentation
declare global {
  // eslint-disable-next-line no-var
  var __jobQueueClient: unknown;
}

if (!global.__jobQueueClient) {
  global.__jobQueueClient = null;
}

export function getJobQueueClient(): unknown {
  return global.__jobQueueClient;
}


// argument-type-mismatch FP: createRequire(import.meta.url) — types match Node.js createRequire signature
import { createRequire } from 'module';
import path from 'path';

class JobQueueDashboardServer {
  private resolveUiPackagePath() {
    const _require = createRequire(import.meta.url);
    const uiPkgPath = path.dirname(_require.resolve('bull-board/package.json'));
    return uiPkgPath;
  }
}

