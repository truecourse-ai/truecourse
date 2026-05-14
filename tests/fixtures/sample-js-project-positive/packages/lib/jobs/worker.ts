
// --- unknown-catch-variable shape: catch(err) console.log with template literal + err as value; re-throw ---
declare function runTask(taskId: string, payload: unknown): Promise<unknown>;
declare function markTaskFailed(taskId: string, jobId: string): Promise<void>;

async function executeJobTask(taskId: string, jobId: string, payload: unknown) {
  try {
    return await runTask(taskId, payload);
  } catch (err) {
    await markTaskFailed(taskId, jobId);
    console.log(`[JOBS:${taskId}] Task failed`, err);
    throw err;
  }
}



// --- unknown-catch-variable shape: catch(error) never property-accessed; DB update + instanceof check + re-throw ---
declare function updateJobStatus(jobId: string, status: 'COMPLETED' | 'FAILED' | 'PENDING'): Promise<void>;
declare function executeJob(jobId: string, payload: unknown): Promise<unknown>;
declare const DEFAULT_MAX_RETRIES: number;

async function runBackgroundJob(
  jobId: string,
  payload: unknown,
  attemptsMade: number,
  maxAttempts: number = DEFAULT_MAX_RETRIES,
) {
  try {
    const result = await executeJob(jobId, payload);
    await updateJobStatus(jobId, 'COMPLETED');
    return result;
  } catch (error) {
    const isFinalAttempt = attemptsMade >= maxAttempts - 1;
    await updateJobStatus(jobId, isFinalAttempt ? 'FAILED' : 'PENDING');
    throw error;
  }
}
