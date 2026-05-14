
// Private constructor called internally via `new FeatureFlagClient()` in static factory/start — singleton guard
declare global {
  // eslint-disable-next-line no-var
  var __app_feature_flag_client__: FeatureFlagClient | undefined;
}

export class FeatureFlagClient {
  private flags: Record<string, boolean> = {};

  private constructor() {}

  public static async start(): Promise<void> {
    if (globalThis.__app_feature_flag_client__) return;
    const instance = new FeatureFlagClient();
    globalThis.__app_feature_flag_client__ = instance;
    await instance.load();
  }

  private async load(): Promise<void> {
    this.flags = { newDashboard: true };
  }

  public isEnabled(flag: string): boolean {
    return this.flags[flag] ?? false;
  }
}
