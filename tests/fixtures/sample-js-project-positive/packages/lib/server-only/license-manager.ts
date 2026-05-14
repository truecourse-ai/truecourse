
// Private constructor called internally via `new ClassName()` in static factory — singleton guard
declare global {
  // eslint-disable-next-line no-var
  var __app_license_manager__: LicenseManager | undefined;
}

export class LicenseManager {
  private cachedPlan: string | null = null;

  private constructor() {}

  public static async start(): Promise<void> {
    if (globalThis.__app_license_manager__) return;
    const instance = new LicenseManager();
    globalThis.__app_license_manager__ = instance;
    await instance.refresh();
  }

  private async refresh(): Promise<void> {
    this.cachedPlan = 'free';
  }

  public getPlan(): string | null {
    return this.cachedPlan;
  }
}
