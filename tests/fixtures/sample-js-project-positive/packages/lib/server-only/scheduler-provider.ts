
// Private constructor called via `new SchedulerProvider()` in static getInstance() — singleton
declare class BaseScheduler {
  protected init(): void;
}

export class SchedulerProvider extends BaseScheduler {
  private static _instance: SchedulerProvider;

  private _jobs: string[] = [];

  private constructor() {
    super();
    this.init();
  }

  static getInstance(): SchedulerProvider {
    if (!SchedulerProvider._instance) {
      SchedulerProvider._instance = new SchedulerProvider();
    }
    return SchedulerProvider._instance;
  }

  schedule(id: string): void {
    this._jobs.push(id);
  }
}
