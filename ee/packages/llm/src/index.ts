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
  // The api-mode SESSION DRIVER (AGENTIC_PIPELINE_PLAN §3.1: EE and api mode
  // run our own loop). It ships in `llm-api` with the transport, so it
  // re-exports with it — an EE session reaches the same driver OSS does.
  createApiSessionDriver,
  OUTCOME_TOOL_NAME,
  buildModel,
  runWithTrace,
  currentTrace,
  type ApiSessionDriverOptions,
  type ApiTransportOptions,
  type AiSdkTransportOptions,
  type TraceContext,
  type ProviderConfig,
  type LlmProviderKind,
} from '@truecourse/llm-api';
