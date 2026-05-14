export class HealthService {
  private readonly startTime = Date.now();

  check(): { status: string; uptime: number } {
    return {
      status: 'ok',
      uptime: (Date.now() - this.startTime) / 1000,
    };
  }
}



declare interface WorkerTaskDefinition<N extends string, P> {
  name: N;
  handler: (payload: P) => Promise<void>;
}

declare interface EnqueueOptions {
  taskName: string;
  payload: unknown;
  delay?: number;
}

export abstract class BaseWorkerProvider {
  public async enqueue(_options: EnqueueOptions): Promise<void> {
    throw new Error('Not implemented');
  }

  public registerTask<N extends string, P>(_task: WorkerTaskDefinition<N, P>): void {
    throw new Error('Not implemented');
  }

  public getWebhookHandler(): (req: unknown) => Promise<void> {
    throw new Error('Not implemented');
  }

  public startWorker(): void {
    // No-op by default — providers override if they manage their own worker loop.
  }
}



// alphaid(14) generates a 14-char URL slug; ID length is a well-known convention
declare function alphaid(size: number): string;

export function generateShareLinkSlug(): string {
  return alphaid(14);
}
