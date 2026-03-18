import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { config } from '../../config/index.js';

let sdk: NodeSDK | null = null;
let spanProcessor: LangfuseSpanProcessor | null = null;

export function initTelemetry(): void {
  if (!config.langfuse.publicKey || !config.langfuse.secretKey) {
    return;
  }

  spanProcessor = new LangfuseSpanProcessor({
    publicKey: config.langfuse.publicKey,
    secretKey: config.langfuse.secretKey,
    baseUrl: config.langfuse.baseUrl,
  });

  sdk = new NodeSDK({
    spanProcessors: [spanProcessor],
  });

  sdk.start();
  console.log('[Telemetry] Langfuse OTel tracing initialized');
}

export async function shutdownTelemetry(): Promise<void> {
  if (spanProcessor) {
    await spanProcessor.forceFlush();
  }
  if (sdk) {
    await sdk.shutdown();
  }
}
