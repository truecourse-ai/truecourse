
// Private attribute written in start() and read in stop() via class-name-qualified access
export class MetricsClient {
  private static instance: MetricsClient | null = null;

  private flushInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static async start(): Promise<void> {
    if (MetricsClient.instance) return;
    const inst = new MetricsClient();
    MetricsClient.instance = inst;
    inst.flushInterval = setInterval(() => inst.flush(), 30_000);
  }

  public static stop(): void {
    const inst = MetricsClient.instance;
    if (!inst) return;
    if (inst.flushInterval) {
      clearInterval(inst.flushInterval);
      inst.flushInterval = null;
    }
    MetricsClient.instance = null;
  }

  private flush(): void {
    // flush metrics
  }
}
