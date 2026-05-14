
declare interface JobDefinition<N extends string, T> { id: N; name: string; trigger: { cron?: string; name?: N }; handler: (ctx: { event: { data: T } }) => Promise<void> }

export class InngestJobClient {
  private _functions: unknown[] = [];

  public defineJob<N extends string, T>(job: JobDefinition<N, T>): void {
    const triggerConfig = job.trigger.cron
      ? { cron: job.trigger.cron }
      : { event: job.trigger.name! };
    this._functions.push({ id: job.id, name: job.name, trigger: triggerConfig, handler: job.handler });
  }
}
