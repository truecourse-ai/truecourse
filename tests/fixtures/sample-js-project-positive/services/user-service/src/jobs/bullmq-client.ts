/**
 * Class with private data fields (`_connection`, `_queue`, `_jobs`)
 * holding non-function values. Passing `this._connection` as a property
 * is NOT an unbound-method reference — there's no `this` to lose,
 * because the field doesn't carry one.
 *
 * The `unbound-method` rule must distinguish field declarations from
 * method definitions in the class body.
 *
 * Mirrors documenso's
 *   packages/lib/jobs/client/bullmq.ts:57, :69, :138, :207
 *   packages/lib/jobs/client/inngest.ts:80, :81
 */

interface RedisConnection { host: string; port: number }
interface JobDefinition { name: string; handler: () => Promise<void> }

export class BullMQClient {
  private readonly _connection: RedisConnection;
  private readonly _queue: { name: string };
  private readonly _jobDefinitions: Map<string, JobDefinition>;

  constructor(connection: RedisConnection) {
    this._connection = connection;
    this._queue = { name: 'default' };
    this._jobDefinitions = new Map();
  }

  buildWorkerOptions(): { connection: RedisConnection; queues: Array<{ name: string }> } {
    // `this._connection` and `this._queue` are data fields, not methods.
    return { connection: this._connection, queues: [this._queue] };
  }

  filterEligibleJobs(): JobDefinition[] {
    // Field referenced as object value — no method-binding concern.
    return Array.from(this._jobDefinitions.values()).filter((j) => j.name !== '');
  }
}
