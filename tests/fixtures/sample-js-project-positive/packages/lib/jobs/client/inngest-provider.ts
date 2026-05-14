
declare interface HonoContext { req: { url: string } }
declare function createHonoRoute(opts: { client: object; functions: object[] }): (ctx: HonoContext) => Promise<Response>;

class InngestJobProvider {
  private _client: object;
  private _functions: object[];

  constructor(client: object) {
    this._client = client;
    this._functions = [];
  }

  public getApiHandler() {
    return async (context: HonoContext) => {
      const handler = createHonoRoute({
        client: this._client,
        functions: this._functions,
      });

      return await handler(context);
    };
  }
}



declare interface EventContext { req: { raw: Request } }
declare function createInngestHandler(opts: { client: object; functions: object[] }): (ctx: EventContext) => Promise<Response>;

class InngestEventProvider {
  private _client: object;
  private _functions: object[];

  constructor(client: object) {
    this._client = client;
    this._functions = [];
  }

  getEventHandler() {
    return async (context: EventContext) => {
      const handler = createInngestHandler({
        client: this._client,
        functions: this._functions,
      });
      return await handler(context);
    };
  }
}
