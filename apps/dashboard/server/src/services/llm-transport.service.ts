/**
 * Installs the LLM transport the user selected with `truecourse config llm setup`
 * (`~/.truecourse/config.json`) so dashboard-triggered pipelines — spec scan,
 * guard generate, analyze, flow enrich — reach the model the CLI would. The
 * dashboard only reads that selection; it never edits it.
 *
 * Called at boot and again at each pipeline entry: the install is keyed on the
 * config file's mtime, so a repeat call is one `stat` — and a `config llm setup`
 * run while the dashboard is up takes effect without a restart.
 */

import { log } from '@truecourse/core/lib/logger';
import { installConfiguredLlmTransport } from '@truecourse/core/services/llm/install-transport';

/**
 * Install (or refresh) the configured transport before work that spends on the
 * LLM. Throws `LlmApiConfigError` when API mode is selected with an unusable
 * config; routes let it surface through their normal error plumbing.
 */
export function ensureLlmTransport(): void {
  installConfiguredLlmTransport();
}

/**
 * Boot-time install. An unusable API config warns and boots anyway: Claude Code
 * mode still works, and the routes that actually spend re-install and surface
 * the error then.
 */
export function installLlmTransportAtBoot(): void {
  try {
    ensureLlmTransport();
  } catch (err) {
    log.warn(`[LLM] ${err instanceof Error ? err.message : String(err)}`);
  }
}
