/**
 * THE SESSION DRIVER a run's agent sessions run on — and every LLM call the
 * product makes is a turn of one. A workspace
 * on an API provider gets the per-turn loop against that provider; operator
 * mode gets the Agent SDK driver, one `claude` subprocess per session on this
 * process's own login.
 *
 * ONE MODEL EVERYWHERE: every session of every workstream runs on the same
 * model — operator mode's `resolveModel()` in claude-code mode, the workspace's
 * own in api mode. There is deliberately no per-session model knob to turn.
 *
 * Nothing about a SESSION TYPE reaches this module — it answers "which backend,
 * on which model", and the workstreams answer everything else.
 */

import { createApiSessionDriver } from '@truecourse/llm-api';
import {
  createClaudeAgentSessionDriver,
  loadSdk,
  providerSessionStore,
} from '@truecourse/llm-claude-agent';
import type { SessionDriver, SessionLlm } from '@truecourse/agent-loop';
import { resolveClaudeBinary } from '@truecourse/shared';
import { resolveFallbackModel, resolveModel } from '../../config/llm-models.js';
import type { LlmApiConfig, LlmTransportMode } from './provider-config.js';
import { buildProviderConfig, pricingFor } from './provider.js';

export interface ConfiguredSessionDriver {
  driver: SessionDriver;
  mode: LlmTransportMode;
  /**
   * What the sessions will actually run on — provider, model, and (api mode)
   * the gateway. Read from the driver itself rather than rebuilt here, so the
   * pre-flight and the run record both quote ONE source: the
   * declaration the driver also stamps on every `session-start`.
   */
  attribution: SessionLlm;
}

export interface SessionDriverOptions {
  /** Working directory for the claude-code subprocess (the run's tree). */
  cwd?: string;
  /**
   * Where the SDK driver mirrors provider session state — pass the run's
   * `<runDir>/provider`, so a parked session's context outlives the harness's
   * own retention window. Omitted, the SDK keeps it wherever it keeps it.
   */
  providerStateDir?: string;
}

/**
 * Build the api-mode session driver from a workspace's stored provider block.
 * Throws `LlmApiConfigError` when the block is unusable.
 */
export function createApiSessionDriverFor(
  api: LlmApiConfig | undefined,
): ConfiguredSessionDriver {
  const cfg = buildProviderConfig(api);
  const driver = createApiSessionDriver(cfg, { pricing: pricingFor(cfg) });
  return { driver, mode: 'api', attribution: driver.attribution };
}

/**
 * The claude-code session driver — the Agent SDK on the `claude` login of
 * whoever runs this process. Operator mode
 * (`TRUECOURSE_LLM_TRANSPORT=claude-code`) hands it to every run, on the one
 * operator model, with `TRUECOURSE_FALLBACK_MODEL` as the retry when that
 * model is overloaded.
 */
export function createClaudeCodeSessionDriver(
  opts: SessionDriverOptions = {},
): ConfiguredSessionDriver {
  const fallbackModel = resolveFallbackModel();
  const driver = createClaudeAgentSessionDriver({
    pathToClaudeCodeExecutable: resolveClaudeBinary(),
    model: resolveModel(),
    ...(fallbackModel ? { fallbackModel } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.providerStateDir ? { sessionStore: providerSessionStore(opts.providerStateDir) } : {}),
  });
  return { driver, mode: 'claude-code', attribution: driver.attribution };
}

/**
 * Prove the session backend can actually start, ONCE, before a run spends
 * anything. In claude-code mode that means the Agent SDK wrapper is installed:
 * it is an optional peer behind a lazy import (its bundled platform binary is
 * ~300MB, so it is deliberately not a dependency), and without it EVERY session
 * of a run fails identically with the same install line.
 *
 * In api mode there is nothing to load: building the driver already threw if
 * the provider block was unusable.
 */
export async function assertSessionBackendReady(mode: LlmTransportMode): Promise<void> {
  if (mode === 'api') return;
  await loadSdk();
}
