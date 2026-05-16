
// Private constructor with super() call in singleton extending base class — both are intentional
declare class BaseStorage {
  protected setup(opts?: Record<string, unknown>): void;
}

export class StorageProvider extends BaseStorage {
  private static _instance: StorageProvider;

  private _bucket: string = 'default';

  private constructor() {
    super();
  }

  static getInstance(): StorageProvider {
    if (!StorageProvider._instance) {
      StorageProvider._instance = new StorageProvider();
    }
    return StorageProvider._instance;
  }

  getBucket(): string {
    return this._bucket;
  }
}
