import type { Plugin } from './types.js'
import { restContractPlugin } from './rest-contract/index.js'
import { stateMachinePlugin } from './state-machine/index.js'

export type {
  Plugin,
  PluginMetadata,
  InvariantEnforceEstimate,
  EstimateContext,
  DiscoverContext,
  EnforceContext,
  DiscoverDiff,
  LLMRunner,
  SpecBundle,
  SpecSection,
  SuggestMode,
  ProgressEvent,
  ProgressReporter,
} from './types.js'
export { TOKEN_ESTIMATE } from './types.js'

// ---------------------------------------------------------------------------
// Plugin registry
// ---------------------------------------------------------------------------
//
// Plugins ship as part of the analyzer package. New plugin types are added by
// importing them here and appending to `PLUGINS`. The registry is an array of
// any-typed plugins because each plugin owns its own declaration shape; the
// generic envelope (`Invariant`) is uniform across the registry.
// ---------------------------------------------------------------------------

export const PLUGINS: Plugin[] = [restContractPlugin, stateMachinePlugin]

export function getPlugin(type: string): Plugin | undefined {
  return PLUGINS.find((p) => p.type === type)
}

export function listPluginTypes(): string[] {
  return PLUGINS.map((p) => p.type)
}
