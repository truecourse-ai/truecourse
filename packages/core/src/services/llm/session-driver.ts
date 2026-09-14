/**
 * THE SESSION DRIVER a run's agent sessions run on — the injection point
 * sessions have that one-shot calls have in `install-transport.ts`. A workspace
 * on an API provider gets the per-turn loop against that provider; operator
 * mode gets the Agent SDK driver, one `claude` subprocess per session on this
 * process's own login.
 *
 * ONE MODEL EVERYWHERE: every session of every workstream runs on the same
 * capable model — Opus in claude-code mode, the workspace's flagship in api
 * mode. There is deliberately no per-session model knob to turn.
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
import type { LlmApiConfig, LlmTransportMode } from './provider-config.js';
import { buildProviderConfig, priceCall } from './install-transport.js';

/** The model claude-code mode runs every session on. */
export const SESSION_MODEL_CLAUDE_CODE = 'opus';

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
  const driver = createApiSessionDriver(buildProviderConfig(api), { pricing: priceCall });
  return { driver, mode: 'api', attribution: driver.attribution };
}

/**
 * The claude-code session driver — the Agent SDK on the `claude` login of
 * whoever runs this process. Operator mode
 * (`TRUECOURSE_LLM_TRANSPORT=claude-code`) hands it to every run.
 */
export function createClaudeCodeSessionDriver(
  opts: SessionDriverOptions = {},
): ConfiguredSessionDriver {
  const driver = createClaudeAgentSessionDriver({
    pathToClaudeCodeExecutable: resolveClaudeBinary(),
    model: SESSION_MODEL_CLAUDE_CODE,
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
