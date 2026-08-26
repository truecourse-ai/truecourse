/**
 * The agent loop of the agentic pipeline:
 * ONE package defines the loop — the session contract (transcript events,
 * session definitions, the driver seam, the sessions-store shapes) and the
 * policy shell `runAgentLoop` — and one package per backend implements it
 * (`@truecourse/llm-api`, `@truecourse/llm-claude-agent`).
 *
 * Driver-agnostic by construction: this package imports neither `ai` nor
 * the Agent SDK nor node builtins; persistence is injected.
 */
export * from './session-presentation.js';
export * from './session-events.js';
export * from './session-def.js';
export * from './session-driver.js';
export * from './session-store.js';
export * from './agent-loop.js';
