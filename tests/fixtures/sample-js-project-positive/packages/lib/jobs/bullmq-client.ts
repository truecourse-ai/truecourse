
// --- void-zero-argument FP shape: module-toplevel-fire-and-forget (job scheduler upsert) ---
// void this._queue.upsertJobScheduler(...) is intentional fire-and-forget scheduler setup
declare class JobQueue {
  upsertJobScheduler(name: string, opts: { every: number }): Promise<void>;
}

class RecurringJobClient {
  private _queue: JobQueue;

  constructor() {
    this._queue = new JobQueue();
    void this._queue.upsertJobScheduler('cleanup-expired-tokens', { every: 3600000 });
    void this._queue.upsertJobScheduler('send-digest-emails', { every: 86400000 });
  }
}



declare interface JobDefinition<N extends string, T> { id: N; name: string; trigger: { cron?: string }; handler: (data: T) => Promise<void> }

declare type JobStore<N extends string, T> = Record<string, JobDefinition<N, T>>;

export class BullMqJobClient {
  private _jobDefinitions: Record<string, unknown> = {};

  public defineJob<N extends string, T>(definition: JobDefinition<N, T>): void {
    this._jobDefinitions[definition.id] = {
      ...definition,
      enabled: true,
    };
  }
}



declare type Json = string | number | boolean | null | { [K: string]: Json } | Json[];

export class BullMqRunIO {
  public runTask = async <T extends void | Json>(cacheKey: string, callback: () => Promise<T>): Promise<T> => {
    const cached = await this.lookupCache(cacheKey);
    if (cached !== null) {
      return cached as T;
    }
    const result = await callback();
    await this.storeCache(cacheKey, result);
    return result;
  };

  private async lookupCache(_key: string): Promise<unknown> { return null; }
  private async storeCache(_key: string, _value: unknown): Promise<void> {}
}
