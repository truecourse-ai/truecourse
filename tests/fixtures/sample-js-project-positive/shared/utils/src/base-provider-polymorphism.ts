/**
 * Abstract-by-convention base class. Its methods are overridden by
 * subclasses and called polymorphically through the parent type, so the
 * `architecture/deterministic/dead-method` rule should NOT flag them.
 */

export interface ProviderConfig {
  endpoint: string;
  scheduler: string;
}

export class BaseRemoteProvider {
  protected readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  public registerHandler(name: string): string {
    return `unregistered:${name}@${this.config.endpoint}`;
  }

  public startScheduler(): string {
    return `${this.config.scheduler}:idle`;
  }
}

export class WebhookRemoteProvider extends BaseRemoteProvider {
  public registerHandler(name: string): string {
    return `webhook:${name}@${this.config.endpoint}`;
  }

  public deliver(): string {
    const handler = this.registerHandler('webhook');
    const status = this.startScheduler();
    return `${handler}|${status}`;
  }
}
