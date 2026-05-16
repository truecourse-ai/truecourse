
// Private constructor used internally via `new ClassName()` inside static getInstance()
declare class BaseProvider {
  protected setup(): void;
}

export class QueueProvider extends BaseProvider {
  private static _instance: QueueProvider | undefined;

  private _jobs: Map<string, () => Promise<void>> = new Map();

  private constructor() {
    super();
    this.setup();
  }

  static getInstance(): QueueProvider {
    if (!QueueProvider._instance) {
      QueueProvider._instance = new QueueProvider();
    }
    return QueueProvider._instance;
  }

  enqueue(id: string, fn: () => Promise<void>): void {
    this._jobs.set(id, fn);
  }
}
