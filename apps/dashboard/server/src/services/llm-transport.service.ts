/**
 * Installs the LLM transport the user selected with `truecourse config llm setup`
 * (`~/.truecourse/config.json`) so dashboard-triggered pipelines — spec scan,
 * guard generate, analyze, flow enrich — reach the model the CLI would. The
 * dashboard only reads that selection; it never edits it.
 *
 * Community only. Enterprise installs its own transport at boot from its
 * encrypted store (`registerLlmProviders`, always — the configured provider or
 * the loud no-provider stub) and has no CLI/file-config fallback by design, so
 * every call here is gated on `isEnterprise()`: the same predicate `ee-loader`
 * uses to decide whether that EE transport gets installed at all. In an
 * enterprise process nothing here ever reads the global config or touches the
 * process default, so the two can never compete for it.
 *
 * Called at boot and again at each pipeline entry: the install is keyed on the
 * config file's mtime, so a repeat call is one `stat` — and a `config llm setup`
 * run while the dashboard is up takes effect without a restart.
 */

import { log } from '@truecourse/core/lib/logger';
import { installConfiguredLlmTransport } from '@truecourse/core/services/llm/install-transport';
import { isEnterprise } from '../edition.js';

/**
 * Install (or refresh) the configured transport before work that spends on the
 * LLM. Throws `LlmApiConfigError` when API mode is selected with an unusable
 * config; routes let it surface through their normal error plumbing.
 */
export function ensureLlmTransport(): void {
  if (isEnterprise()) return;
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
