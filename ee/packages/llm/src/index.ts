/**
 * The transport core lives in the OSS package `@truecourse/llm-api` — both
 * editions install the same direct-API transport. This package stays as its
 * enterprise-facing name so ee-server/ee-client imports are unchanged; EE's own
 * pieces (the encrypted config store, Models page, trace recorder) are elsewhere
 * under `ee/`.
 */

export {
  createApiTransport,
  createAiSdkTransport,
  buildModel,
  runWithTrace,
  currentTrace,
  type ApiTransportOptions,
  type AiSdkTransportOptions,
  type TraceContext,
  type ProviderConfig,
  type LlmProviderKind,
} from '@truecourse/llm-api';
