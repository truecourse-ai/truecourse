declare const c: { text: (body: string, status: number) => Response };
declare const requestBody: unknown;
declare function parseBody(body: unknown): { success: boolean };

const handleJobRequest = () => {
  const result = parseBody(requestBody);

  if (!result.success) {
    return c.text('Bad request', 400);
  }

  return c.text('OK', 200);
};



declare function runJob<T>(jobId: string, payload: T): Promise<void>;
declare function logJobError(jobId: string, error: unknown): void;

class LocalJobQueue {
  private queue: Array<{ id: string; payload: unknown }> = [];
  private running = false;

  enqueue(jobId: string, payload: unknown) {
    this.queue.push({ id: jobId, payload });
    if (!this.running) {
      void this.drainQueue();
    }
  }

  private async drainQueue() {
    this.running = true;
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        await runJob(job.id, job.payload);
      } catch (err) {
        logJobError(job.id, err);
      }
    }
    this.running = false;
  }
}



// [unknown-catch-variable] catch(error) — passed to console.error in template literal; no property access
declare function executeCronJob(jobName: string): Promise<void>;
declare function scheduleNext(jobName: string, intervalMs: number): void;

async function runCronTick(jobName: string, intervalMs: number): Promise<void> {
  try {
    await executeCronJob(jobName);
  } catch (error) {
    console.error(`[JOBS]: Cron tick failed for ${jobName}`, error);
  } finally {
    scheduleNext(jobName, intervalMs);
  }
}
