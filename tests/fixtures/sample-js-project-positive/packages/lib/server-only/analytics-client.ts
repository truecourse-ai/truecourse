
// FP: this.sessionId is a string field, not a method.
// It is read inside a properties object literal — not detached.
declare const metricsBackend: { track: (opts: { distinctId: string; event: string; properties: Record<string, unknown> }) => void };
declare const APP_BUILD: string;

class SessionMetrics {
  private sessionId: string;
  private workspaceId: string;

  constructor(sessionId: string, workspaceId: string) {
    this.sessionId = sessionId;
    this.workspaceId = workspaceId;
  }

  private recordEvent(event: string): void {
    if (!metricsBackend || !this.sessionId) {
      return;
    }

    metricsBackend.track({
      distinctId: this.sessionId,
      event,
      properties: {
        appBuild: APP_BUILD,
        sessionId: this.sessionId,
        workspaceId: this.workspaceId,
      },
    });
  }
}



// FP: this.nodeId is a string field read inside a properties object literal.
declare const eventsHub: { publish: (opts: { source: string; event: string; tags: Record<string, string> }) => void };
declare const RUNTIME_ENV: string;

class EventPublisher {
  private clientKey: string;
  private instanceId: string;
  private nodeId: string;

  constructor(clientKey: string, instanceId: string, nodeId: string) {
    this.clientKey = clientKey;
    this.instanceId = instanceId;
    this.nodeId = nodeId;
  }

  private publishEvent(eventType: string): void {
    if (!eventsHub || !this.clientKey) {
      return;
    }

    eventsHub.publish({
      source: this.clientKey,
      event: eventType,
      tags: {
        env: RUNTIME_ENV,
        instanceId: this.instanceId,
        nodeId: this.nodeId,
      },
    });
  }
}



// FP: this.buildVersion is a string field read inside an object literal in a method call.
declare const telemetryPipeline: { send: (payload: { id: string; type: string; data: Record<string, string> }) => void };

class TelemetrySender {
  private clientId: string;
  private buildVersion: string;
  private region: string;

  constructor(clientId: string, buildVersion: string, region: string) {
    this.clientId = clientId;
    this.buildVersion = buildVersion;
    this.region = region;
  }

  private sendMetric(type: string): void {
    if (!telemetryPipeline || !this.clientId) {
      return;
    }

    telemetryPipeline.send({
      id: this.clientId,
      type,
      data: {
        buildVersion: this.buildVersion,
        region: this.region,
      },
    });
  }
}



// Private static instance used via ClassName.instance references inside static methods
export class AnalyticsClient {
  private static instance: AnalyticsClient | null = null;

  private client: unknown = null;

  private constructor() {}

  public static async start(): Promise<void> {
    if (AnalyticsClient.instance) return;
    AnalyticsClient.instance = new AnalyticsClient();
  }

  public static stop(): void {
    if (!AnalyticsClient.instance) return;
    AnalyticsClient.instance = null;
  }

  public static isRunning(): boolean {
    return AnalyticsClient.instance !== null;
  }

  public static flush(): void {
    const inst = AnalyticsClient.instance;
    if (inst) {
      // flush
    }
  }
}
