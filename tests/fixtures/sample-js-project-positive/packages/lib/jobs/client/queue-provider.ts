
declare interface TriggerDefinition { name: string; cron?: string; schema?: object }
declare interface TaskDefinition<N extends string, T> { id: string; name: string; version: string; trigger: TriggerDefinition }
declare function registerCron(id: string, cronPattern: string, label: string): void;

function scheduleDefinedTasks<N extends string, T>(tasks: TaskDefinition<N, T>[]): void {
  for (const task of tasks) {
    if (task.trigger.cron) {
      registerCron(task.id, task.trigger.cron, task.trigger.name);
    }
  }
}



declare class JobQueue { add(name: string, data: object): Promise<void> }
declare class QueueDashboard { constructor(queue: JobQueue): void }

class BullMqProvider {
  private _queue: JobQueue;

  constructor(redisUrl: string) {
    this._queue = new JobQueue();
  }

  private createDashboard() {
    return new QueueDashboard(this._queue);
  }
}



declare class RedisConnection { constructor(url: string, opts: object): void }
declare class BackgroundWorker { constructor(queueName: string, handler: (job: any) => Promise<void>, opts: object): void }

const WORKER_QUEUE = 'background-jobs';

class WorkerJobProvider {
  private _connection: RedisConnection;
  private _worker: BackgroundWorker;

  constructor(redisUrl: string, concurrency: number) {
    this._connection = new RedisConnection(redisUrl, { maxRetriesPerRequest: null });
    this._worker = new BackgroundWorker(
      WORKER_QUEUE,
      async (job) => {
        await this.processJob(job);
      },
      {
        connection: this._connection,
        concurrency,
      },
    );
  }

  private async processJob(job: any): Promise<void> {
    // no-op in fixture
  }
}



declare class RedisConn { constructor(url: string, opts: object): void }
declare class TaskQueue { constructor(name: string, opts: object): void }

const TASK_QUEUE_NAME = 'task-queue';

class TaskQueueProvider {
  private _connection: RedisConn;
  private _queue: TaskQueue;

  constructor(redisUrl: string, prefix: string) {
    this._connection = new RedisConn(redisUrl, { maxRetriesPerRequest: null });
    this._queue = new TaskQueue(TASK_QUEUE_NAME, {
      connection: this._connection,
      prefix,
    });
  }
}
