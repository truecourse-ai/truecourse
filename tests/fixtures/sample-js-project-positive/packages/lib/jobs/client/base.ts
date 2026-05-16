export abstract class BaseQueueProvider {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async enqueue(_options: { name: string; payload: unknown }): Promise<void> {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public registerHandler<T>(_handler: { name: string; fn: (payload: T) => Promise<void> }): void {
    throw new Error('Not implemented');
  }

  public getWebhookHandler(): (req: any) => Promise<Response | void> {
    throw new Error('Not implemented');
  }
}



export abstract class BaseQueueClient {
  abstract readonly queueName: string;

  defineJob(
    _jobName: string,
    _handler: (...args: unknown[]) => Promise<void>,
  ): void {
    throw new Error('Not implemented');
  }
}



export abstract class BaseSchedulerClient {
  abstract readonly schedulerName: string;

  scheduleJob(
    _cronExpression: string,
    _handler: () => Promise<void>,
  ): void {
    throw new Error('Not implemented');
  }

  cancelJob(_jobId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}



export abstract class BaseEventBus {
  abstract readonly busName: string;

  publishEvent(
    _eventType: string,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    throw new Error('Not implemented');
  }
}



export abstract class BaseWorkerClient {
  abstract readonly workerName: string;

  /**
   * Called when a job starts. Override in subclasses to add observability.
   */
  onJobStart(_jobId: string, _jobName: string): void {
    // no-op default — subclasses override for logging/metrics
  }

  /**
   * Called when a job completes. Override in subclasses to add observability.
   */
  onJobComplete(_jobId: string, _durationMs: number): void {
    // no-op default
  }

  abstract startWorker(): Promise<void>;
  abstract stopWorker(): Promise<void>;
}
