
// --- argument-type-mismatch shape: Promise.all with async map creating DB records ---
declare const db: { jobRun: { create: (opts: { data: object }) => Promise<{ id: string }> } };
declare function getEligibleHandlers(name: string): Array<{ id: string; name: string; version: string }>;
declare function enqueueWork(jobRunId: string, payload: unknown): Promise<void>;

async function dispatchJob(jobName: string, payload: unknown): Promise<void> {
  const handlers = getEligibleHandlers(jobName);

  await Promise.all(
    handlers.map(async (handler) => {
      const jobRun = await db.jobRun.create({
        data: {
          handlerId: handler.id,
          name: handler.name,
          version: handler.version,
          payload: payload as object,
        },
      });

      await enqueueWork(jobRun.id, payload);
    }),
  );
}



// --- argument-type-mismatch shape: client.createFunction({id, name, optimizeParallelism}, triggerConfig, async ctx handler) ---
declare class WorkflowClient {
  createFunction(
    config: { id: string; name: string; optimizeParallelism: boolean },
    trigger: { cron: string } | { event: string },
    handler: (ctx: { event: { data: unknown } }) => Promise<void>,
  ): void;
}
declare const workflowClient: WorkflowClient;

interface TaskDefinition {
  id: string;
  name: string;
  optimizeParallelism?: boolean;
  trigger: { cron?: string; name: string };
  handler: (opts: { payload: unknown }) => Promise<void>;
}

function registerTask(task: TaskDefinition): void {
  const triggerConfig: { cron: string } | { event: string } = task.trigger.cron
    ? { cron: task.trigger.cron }
    : { event: task.trigger.name };

  workflowClient.createFunction(
    {
      id: task.id,
      name: task.name,
      optimizeParallelism: task.optimizeParallelism ?? false,
    },
    triggerConfig,
    async (ctx) => {
      await task.handler({ payload: ctx.event.data });
    },
  );
}
