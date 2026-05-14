
declare type JobOptions = { name: string; payload: unknown };
declare type JobDefinition<N extends string, T> = { name: N; handler: (payload: T) => Promise<void> };

export abstract class BaseJobProvider {
  public async triggerJob(_options: JobOptions): Promise<void> {
    throw new Error('Not implemented');
  }

  public defineJob<N extends string, T>(_job: JobDefinition<N, T>): void {
    throw new Error('Not implemented');
  }

  public getApiHandler(): (req: any) => Promise<Response | void> {
    throw new Error('Not implemented');
  }

  public startScheduler(): void {
    // No-op by default — providers override if needed.
  }
}
