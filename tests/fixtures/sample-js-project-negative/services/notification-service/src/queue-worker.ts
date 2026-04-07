/**
 * Queue worker — processes background jobs for notification delivery.
 * Contains various bug patterns found in real async processing code.
 */

import * as fs from 'fs';

interface Job {
  id: string;
  type: string;
  payload: any;
  attempts: number;
  maxAttempts: number;
}

// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export async function processJobs(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  jobs: Job[],
) {
  const results: any[] = [];
  for (const job of jobs) {
    // VIOLATION: bugs/deterministic/await-in-loop
    const result = await executeJob(job);
    results.push(result);
  }
  return results;
}

// VIOLATION: code-quality/deterministic/missing-return-type
async function executeJob(job: Job) {
  try {
    switch (job.type) {
      case 'email':
        return await sendEmailJob(job);
      case 'sms':
        return await sendSmsJob(job);
      case 'cleanup':
        return await cleanupJob(job);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  } catch (error) {
    // VIOLATION: bugs/deterministic/empty-catch
  }
}

// VIOLATION: code-quality/deterministic/missing-return-type
async function sendEmailJob(job: Job) {
  // VIOLATION: bugs/deterministic/race-condition-assignment
  let counter = 0;
  counter += await new Promise<number>((r) => setTimeout(() => r(1), 100));
  return { jobId: job.id, sent: true, counter };
}

// VIOLATION: code-quality/deterministic/require-await
// VIOLATION: code-quality/deterministic/missing-return-type
async function sendSmsJob(job: Job) {
  // VIOLATION: bugs/deterministic/loose-boolean-expression
  const recipient: string = job.payload.phone ?? '';
  if (recipient) {
    return { jobId: job.id, sent: true };
  }
  return { jobId: job.id, sent: false };
}

// VIOLATION: code-quality/deterministic/missing-return-type
async function cleanupJob(job: Job) {
  // VIOLATION: bugs/deterministic/error-swallowed-in-callback
  fs.readFile('/tmp/cleanup.txt', (err: Error | null, data: Buffer) => {
    const text = data?.toString();
  });
  return { jobId: job.id, cleaned: true };
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function createJob(type: string, payload: any) {
  // VIOLATION: bugs/deterministic/unthrown-error
  new Error('validation failed');

  return {
    id: Math.random().toString(36).substring(7),
    type,
    payload,
    attempts: 0,
    // VIOLATION: code-quality/deterministic/magic-number
    maxAttempts: 5,
  };
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function sortJobsByPriority(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  jobs: Job[],
) {
  // VIOLATION: bugs/deterministic/ignored-return-value
  jobs.filter((j) => j.attempts < j.maxAttempts);
  return jobs;
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function getJobResults(
  // VIOLATION: code-quality/deterministic/readonly-parameter-types
  results: Array<{ jobId: string; status: string }>,
) {
  // VIOLATION: bugs/deterministic/void-return-value-used
  const mapped = results.forEach((r) => r.status);
  return mapped;
}

// VIOLATION: bugs/deterministic/stateful-regex
const jobIdRegex = /^job-\d+$/g;

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function validateJobId(id: string) {
  return jobIdRegex.test(id);
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function processJobResult(items: number[]) {
  // VIOLATION: bugs/deterministic/invariant-return
  if (items.length > 0) {
    return true;
  }
  return true;
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: bugs/deterministic/generic-error-message
export function handleJobError() {
  throw new Error('Something went wrong');
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function checkJobProperty(obj: Record<string, any>) {
  // VIOLATION: bugs/deterministic/prototype-builtins-call
  return obj.hasOwnProperty('status');
}

// VIOLATION: code-quality/deterministic/missing-return-type
// VIOLATION: code-quality/deterministic/missing-boundary-types
export function adjustPriority(a: number, b: number) {
  // VIOLATION: bugs/deterministic/confusing-increment-decrement
  return a + b++;
}
