/**
 * Process-wide LLM transport registry. The OSS default is the CLI transport;
 * the enterprise edition calls `setLlmTransport` at startup to swap in an
 * API-backed transport. Everything else just calls `getLlmTransport().complete`.
 */

import type { LlmTransport } from './transport.js';
import { cliTransport } from './cli-transport.js';

let active: LlmTransport | null = null;

/** Install a transport (e.g. the enterprise AI-SDK transport). */
export function setLlmTransport(transport: LlmTransport): void {
  active = transport;
}

/** The active transport, or the default CLI transport when none is installed. */
export function getLlmTransport(): LlmTransport {
  return active ?? cliTransport;
}

/** Restore the default CLI transport (used by tests). */
export function resetLlmTransport(): void {
  active = null;
}
