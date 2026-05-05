/**
 * Async callbacks in `.map(...)` always implicitly return a Promise — the
 * function body need not have an explicit `return`. The caller typically
 * passes the resulting `Promise<unknown>[]` to `Promise.all(...)`.
 *
 * Mirrors the documenso FP in
 *   packages/lib/jobs/client/bullmq.ts:143
 *   packages/lib/jobs/definitions/emails/send-document-cancelled-emails.handler.ts:87
 */

import { logger } from '@sample/shared-utils';

interface Job {
  readonly id: string;
  readonly name: string;
}

interface BackgroundQueue {
  enqueue: (job: Job) => Promise<{ id: string }>;
}

declare const queue: BackgroundQueue;

// Async callback with no explicit return — produces Promise<void>[] for Promise.all().
export async function runJobs(jobs: ReadonlyArray<Job>): Promise<void> {
  try {
    await Promise.all(
      jobs.map(async (job) => {
        await queue.enqueue(job);
      }),
    );
  } catch (err: unknown) {
    logger.error(`runJobs failed: ${String(err)}`);
  }
}

// Same shape, side-effect only.
export async function notifyAll(recipients: ReadonlyArray<{ email: string }>): Promise<void> {
  try {
    await Promise.all(
      recipients.map(async (recipient) => {
        await queue.enqueue({ id: recipient.email, name: 'notify' });
      }),
    );
  } catch (err: unknown) {
    logger.error(`notifyAll failed: ${String(err)}`);
  }
}
