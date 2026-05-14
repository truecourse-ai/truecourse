
declare interface JobDefinition<N extends string, T> { id: N; name: string; data: T }

export abstract class BaseJobClient {
  public defineJob<N extends string, T>(_job: JobDefinition<N, T>): void {
    throw new Error('Not implemented');
  }
}
