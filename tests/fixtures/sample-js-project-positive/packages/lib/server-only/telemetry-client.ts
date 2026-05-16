
class MetricsCollector {
  private static _instance: MetricsCollector | null = null;

  private constructor() {}

  static start(): MetricsCollector {
    MetricsCollector._instance = new MetricsCollector();
    return MetricsCollector._instance;
  }

  static stop(): void {
    MetricsCollector._instance = null;
  }

  record(event: string, data: Record<string, unknown>) {
    console.log('metric', event, data);
  }
}
