// Positive fixture for code-quality/deterministic/unbound-method.
//
// `this.<field>` where `<field>` is a data field (not a method) is being
// passed around as a value — that's not an unbound-method risk because
// the field never had `this` bound to begin with.

type Client = { readonly id: string };
type JobDef = { readonly id: string };

declare function start(arg: { readonly client: Client; readonly functions: readonly JobDef[] }): void;
declare function capture(arg: { readonly distinctId: string; readonly nodeId: string | null }): void;
declare function processAll(defs: readonly JobDef[]): void;
declare function appLog(context: string, message: string): void;

export class InngestProvider {
  private readonly _client: Client;
  private readonly _functions: readonly JobDef[] = [];

  constructor(client: Client) {
    this._client = client;
  }

  public run(): void {
    start({ client: this._client, functions: this._functions });
  }

  public report(installationId: string | null, nodeId: string | null): void {
    capture({ distinctId: installationId ?? '', nodeId });
    this.installationId = installationId;
    this.nodeId = nodeId;
  }

  public installationId: string | null = null;
  public nodeId: string | null = null;

  private readonly _jobDefinitions: Record<string, JobDef> = {};

  public processAll(): void {
    processAll(Object.values(this._jobDefinitions));
  }

  private readonly context: string = 'inngest';

  public log(message: string): void {
    appLog(this.context, message);
  }
}
