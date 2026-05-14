import { logger } from '@sample/shared-utils';
interface Job { id: string; type: string; payload: Record<string, unknown>; }
interface JobResult { jobId: string; success: boolean; }
export function processJob(job: Job): JobResult {
  return { jobId: job.id, success: job.type === 'email' || job.type === 'sms' };
}
export function createJob(type: string, payload: Record<string, unknown>): Job {
  if (type.length === 0) throw new Error('Job type required');
  return { id: String(Date.now()), type, payload };
}
export function filterPending(jobs: readonly Job[]): Job[] {
  return jobs.filter((j) => j.type.length > 0);
}
const JOB_ID_REGEX = /^job-\d+$/u;
export function validateJobId(id: string): boolean { return JOB_ID_REGEX.test(id); }
export function checkJobProperty(obj: Record<string, unknown>): boolean { return Object.hasOwn(obj, 'status'); }
export function logJob(msg: string): void { logger.info(msg); }



// --- raw-error-in-response shape: non-http-context (background job, results sent via email not HTTP) ---
// catch block accumulates error.message into internal results array (no Response/json() call)
declare function sendJobResultEmail(to: string, results: Array<{ id: string; status: string; error?: string }>): Promise<void>;

async function runBulkNotificationJob(
  items: Array<{ id: string; recipientEmail: string; templateId: string }>,
  reportEmail: string
): Promise<void> {
  const results: Array<{ id: string; status: 'sent' | 'failed'; error?: string }> = [];

  for (const item of items) {
    try {
      await dispatchNotification(item.recipientEmail, item.templateId);
      results.push({ id: item.id, status: 'sent' });
    } catch (error) {
      // error.message accumulated into internal results array
      // then sent via email to the triggering user — NOT returned as HTTP response
      results.push({
        id: item.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  await sendJobResultEmail(reportEmail, results);
}

declare function dispatchNotification(email: string, templateId: string): Promise<void>;
