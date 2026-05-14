
// shape: Hono route handler is async but only delegates to parseAsync then chains .then()/.catch(); async for Hono handler signature conformance
declare const jobSchema: { parseAsync(data: unknown): Promise<{ name: string }> };
declare const c: { req: { method(): string; header(k: string): string | undefined; json(): Promise<unknown> }; text(msg: string, status: number): Response };

const handleJobRequest = async () => {
  if (c.req.method() !== 'POST') {
    return c.text('Method not allowed', 405);
  }

  const jobId = c.req.header('x-job-id');
  const signature = c.req.header('x-job-signature');

  const options = await c.req
    .json()
    .then(async (data) => jobSchema.parseAsync(data))
    .catch(() => null);

  if (!options) {
    return c.text('Bad request', 400);
  }

  return c.text('OK', 200);
};



// shape: async method delegates to internal provider's triggerJob returning a Promise; async for interface method signature conformance
declare interface JobProvider { triggerJob(opts: unknown): Promise<void> }
declare const provider: JobProvider;

class JobClient {
  async triggerJob(options: { name: string; payload: unknown }) {
    return provider.triggerJob(options);
  }
}



declare const db: { task: { update: (args: object) => Promise<{ id: string }> } };
declare function runTaskLogic(taskId: string, jobId: string): Promise<unknown>;

async function processTask(taskId: string, jobId: string): Promise<unknown> {
  try {
    const result = await runTaskLogic(taskId, jobId);
    await db.task.update({
      where: { id: taskId, jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result;
  } catch (err) {
    await db.task.update({
      where: { id: taskId, jobId },
      data: { status: 'PENDING', retried: { increment: 1 } },
    });
    console.log(`[JOBS:${taskId}] Task failed`, err);
    throw err;
  }
}



declare const db: { job: { update: (args: object) => Promise<void> } };
declare function runJob(jobId: string): Promise<unknown>;

async function executeBackgroundJob(jobId: string): Promise<unknown> {
  try {
    const result = await runJob(jobId);
    await db.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result;
  } catch (error) {
    await db.job.update({
      where: { id: jobId },
      data: { status: 'FAILED' },
    });
    throw error;
  }
}



declare const store: { task: { update: (args: object) => Promise<{ id: string }> } };
declare function runLocalTask(taskId: string, jobId: string): Promise<unknown>;

class TaskProcessingError extends Error {
  constructor(message: string, public readonly taskId: string) {
    super(message);
    this.name = 'TaskProcessingError';
  }
}

async function processLocalTask(taskId: string, jobId: string): Promise<unknown> {
  try {
    const result = await runLocalTask(taskId, jobId);
    await store.task.update({
      where: { id: taskId, jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result;
  } catch (err) {
    const updated = await store.task.update({
      where: { id: taskId, jobId },
      data: { status: 'PENDING', retried: { increment: 1 } },
    });
    console.log(`[JOBS:${updated.id}] Task failed`, err);
    throw new TaskProcessingError('Task failed after retry', taskId);
  }
}
