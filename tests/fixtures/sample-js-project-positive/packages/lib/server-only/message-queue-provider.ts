
// Private constructor used via new ClassName() inside static getInstance() — singleton pattern
declare class BaseQueue {
  protected connect(): void;
}

export class MessageQueueProvider extends BaseQueue {
  private static _instance: MessageQueueProvider | undefined;

  private _handlers: Map<string, () => void> = new Map();

  private constructor() {
    super();
    this.connect();
  }

  static getInstance(): MessageQueueProvider {
    if (!MessageQueueProvider._instance) {
      MessageQueueProvider._instance = new MessageQueueProvider();
    }
    return MessageQueueProvider._instance;
  }

  register(topic: string, handler: () => void): void {
    this._handlers.set(topic, handler);
  }
}
