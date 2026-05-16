
// Private static _instance used via ClassName._instance (not this._instance) in singleton pattern
export class WorkerPool {
  private static _instance: WorkerPool;

  private _workers: number[] = [];

  private constructor() {}

  static getInstance(): WorkerPool {
    if (!WorkerPool._instance) {
      WorkerPool._instance = new WorkerPool();
    }
    return WorkerPool._instance;
  }

  addWorker(id: number): void {
    this._workers.push(id);
  }
}
