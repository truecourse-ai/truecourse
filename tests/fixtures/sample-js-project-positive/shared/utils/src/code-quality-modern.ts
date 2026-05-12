import { readFileSync } from 'fs';
export function restParams(...args: readonly unknown[]): unknown[] { return Array.from(args); }
export function spreadMax(arr: readonly number[]): number { return Math.max(...arr); }
export function* generatorWithYield(): Generator<number> { yield 42; }
export function includesCheck(arr: readonly number[], item: number): boolean { return arr.includes(item); }
export function templateString(name: string): string { return `Hello, ${name}`; }
export class Service {
  name = 'service';
  toString(): string { return this.name; }
}
export function readSync(): typeof readFileSync { return readFileSync; }



declare const inngestClient: { createFunction: (cfg: { id: string }, trigger: { event: string }, handler: (ctx: { event: { data: unknown } }) => Promise<void>) => unknown };
declare const buildEnv: { JOBS_DRIVER: string; APP_NAME: string };

interface JobDefinition { id: string; trigger: string; handler: (data: unknown) => Promise<void>; }

export class InngestJobProvider {
  private static _instance: InngestJobProvider;
  private readonly _client = inngestClient;
  private readonly _registered: JobDefinition[] = [];

  public static getInstance(): InngestJobProvider {
    if (!InngestJobProvider._instance) {
      InngestJobProvider._instance = new InngestJobProvider();
    }
    return InngestJobProvider._instance;
  }

  public defineJob(job: JobDefinition): void {
    const fn = this._client.createFunction(
      { id: job.id },
      { event: job.trigger },
      async (ctx) => {
        const payload = ctx.event.data as any;
        await job.handler(payload);
      },
    );
    this._registered.push(job);
    void fn;
  }
}

export class LocalJobProvider {
  private static _instance: LocalJobProvider;
  private readonly _queue: Array<{ id: string; payload: unknown }> = [];

  public static getInstance(): LocalJobProvider {
    if (!LocalJobProvider._instance) {
      LocalJobProvider._instance = new LocalJobProvider();
    }
    return LocalJobProvider._instance;
  }

  public enqueue(id: string, payload: unknown): void {
    this._queue.push({ id, payload });
  }

  public drain(): number {
    const n = this._queue.length;
    this._queue.length = 0;
    return n;
  }
}

export class TelemetryClient {
  private static instance: TelemetryClient | null = null;
  private readonly appName: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(appName: string) {
    this.appName = appName;
  }

  public static start(): TelemetryClient {
    if (!TelemetryClient.instance) {
      TelemetryClient.instance = new TelemetryClient(buildEnv.APP_NAME);
      TelemetryClient.instance.flushTimer = setInterval(() => {
        TelemetryClient.instance?.flush();
      }, 30_000);
    }
    return TelemetryClient.instance;
  }

  public static stop(): void {
    if (TelemetryClient.instance?.flushTimer) {
      clearInterval(TelemetryClient.instance.flushTimer);
    }
    TelemetryClient.instance = null;
  }

  public flush(): string {
    return `flushed:${this.appName}`;
  }
}
