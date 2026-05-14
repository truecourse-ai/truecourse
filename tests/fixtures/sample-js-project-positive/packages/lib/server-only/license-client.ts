
class FeatureFlagClient {
  private static _instance: FeatureFlagClient | null = null;

  private constructor() {}

  static getInstance(): FeatureFlagClient {
    if (!FeatureFlagClient._instance) {
      FeatureFlagClient._instance = new FeatureFlagClient();
    }
    return FeatureFlagClient._instance;
  }

  isEnabled(flag: string): boolean {
    return flag.startsWith('beta_');
  }
}

class AnalyticsProvider {
  private constructor() {}

  static create(): AnalyticsProvider {
    return new AnalyticsProvider();
  }

  track(event: string): void {
    console.log('track', event);
  }
}
