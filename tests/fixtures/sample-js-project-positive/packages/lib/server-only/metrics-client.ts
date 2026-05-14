
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



// Positive: unread-private-attribute — heartbeatInterval is written in start() and read in stop().
// The read occurs through instance-qualified access: `if (instance.heartbeatInterval)` before clearInterval.
export class TelemetryClient {
  private static instance: TelemetryClient | null = null;

  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  public static async start(): Promise<void> {
    if (TelemetryClient.instance) return;
    const inst = new TelemetryClient();
    TelemetryClient.instance = inst;
    inst.heartbeatInterval = setInterval(() => inst.sendHeartbeat(), 60_000);
  }

  public static stop(): void {
    const instance = TelemetryClient.instance;
    if (!instance) return;
    if (instance.heartbeatInterval) {
      clearInterval(instance.heartbeatInterval);
      instance.heartbeatInterval = null;
    }
    TelemetryClient.instance = null;
  }

  private sendHeartbeat(): void {
    // send heartbeat to telemetry endpoint
  }
}

