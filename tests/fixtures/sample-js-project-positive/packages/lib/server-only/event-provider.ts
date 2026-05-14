
// Private constructor used internally via new ClassName({...}) inside static getInstance()
declare class BaseEventProvider {
  protected configure(opts: { appId: string }): void;
}

export class EventProvider extends BaseEventProvider {
  private static _instance: EventProvider;

  private _appId: string;

  private constructor(options: { appId: string }) {
    super();
    this._appId = options.appId;
    this.configure(options);
  }

  static getInstance(): EventProvider {
    if (!EventProvider._instance) {
      EventProvider._instance = new EventProvider({ appId: 'my-app' });
    }
    return EventProvider._instance;
  }

  track(event: string): void {
    console.log(this._appId, event);
  }
}
