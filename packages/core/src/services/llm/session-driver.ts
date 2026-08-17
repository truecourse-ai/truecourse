/**
 * THE SESSION DRIVER THE CONFIGURED TRANSPORT SELECTS — the injection point
 * agent sessions have that one-shot calls have in `install-transport.ts`
 * (AGENTIC_PIPELINE_PLAN §3.1): `claude-code` mode runs the Agent SDK driver
 * (one `claude` subprocess per session, the user's own harness login), `api`
 * mode runs our per-turn loop against the configured provider.
 *
 * ONE MODEL EVERYWHERE (§3.4): every session of every workstream runs on the
 * same capable model — Opus in claude-code mode, the configured flagship in api
 * mode. There is deliberately no per-session model knob to turn: the multi-model
 * cost split is retired, and a session type that ever earns an exception gets it
 * with evidence, per case.
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
import type { SessionDriver } from '@truecourse/agent-loop';
import { resolveClaudeBinary } from '@truecourse/shared';
import { effectiveLlmMode, readApiLlmConfig } from '../../config/global-config.js';
import type { LlmTransportFlag, LlmTransportMode } from '../../config/global-config.js';
import { buildProviderConfig, priceCall } from './install-transport.js';

/** The model claude-code mode runs every session on (§3.4). */
export const SESSION_MODEL_CLAUDE_CODE = 'opus';

export interface ConfiguredSessionDriver {
  driver: SessionDriver;
  mode: LlmTransportMode;
  /** What the sessions will actually run on — rendered in the pre-flight. */
  model: string;
}

export interface SessionDriverOptions {
  /** A per-run `--llm-transport` flag; the saved selection answers otherwise. */
  transport?: LlmTransportFlag;
  /** Working directory for the claude-code subprocess (the repo). */
  cwd?: string;
  /**
   * Where the SDK driver mirrors provider session state (§3.3) — pass the run's
   * `<runDir>/provider`, so a parked session's context outlives the harness's
   * own retention window. Omitted, the SDK keeps it wherever it keeps it.
   */
  providerStateDir?: string;
}

/**
 * Build the session driver for this run. Throws `LlmApiConfigError` in api mode
 * when the API block is missing or unusable — the same one-liner
 * `createConfiguredApiTransport` throws, pointing at `truecourse config llm setup`.
 */
export function createConfiguredSessionDriver(
  opts: SessionDriverOptions = {},
): ConfiguredSessionDriver {
  const mode = effectiveLlmMode(opts.transport);
  if (mode === 'api') {
    const cfg = buildProviderConfig(readApiLlmConfig());
    return {
      driver: createApiSessionDriver(cfg, { pricing: priceCall }),
      mode,
      model: cfg.model,
    };
  }
  return {
    driver: createClaudeAgentSessionDriver({
      pathToClaudeCodeExecutable: resolveClaudeBinary(),
      model: SESSION_MODEL_CLAUDE_CODE,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.providerStateDir ? { sessionStore: providerSessionStore(opts.providerStateDir) } : {}),
    }),
    mode,
    model: SESSION_MODEL_CLAUDE_CODE,
  };
}

/**
 * Prove the session backend can actually start, ONCE, before a run spends
 * anything. In claude-code mode that means the Agent SDK wrapper is installed:
 * it is an optional peer behind a lazy import (its bundled platform binary is
 * ~300MB, so it is deliberately not a dependency), and without it EVERY session
 * of a run fails identically with the same install line. The `claude` login
 * probe the CLI already runs does not cover it — that checks the binary, this
 * checks the protocol layer.
 *
 * In api mode there is nothing to load: `createConfiguredSessionDriver` already
 * threw if the provider config was unusable.
 */
export async function assertSessionBackendReady(transport?: LlmTransportFlag): Promise<void> {
  if (effectiveLlmMode(transport) === 'api') return;
  await loadSdk();
}
