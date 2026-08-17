/**
 * `@truecourse/interface-mapper` — the code side of guard: turn the app's own
 * surfaces into INTERFACES (entry-rooted interaction paths). Pure derivation, zero
 * LLM, no dependency on a prior `truecourse analyze` run — it consumes analyzer
 * artifacts directly and, for a cli whose framework no extractor reads, the
 * program's own help output.
 *
 * Maps the cli surface (tree-first, probe fallback) and the api surface (route
 * registrations ∪ OpenAPI operations); web lands additively behind the same
 * `InterfaceStep` envelope.
 */

export { deriveCliInterfaces } from './derive.js'
export type { DeriveCliInterfacesOptions, CliInterfaceCatalog } from './derive.js'

export { deriveCliInterfacesFromTree } from './cli-tree.js'

export {
  deriveCliInterfacesFromProbes,
  createSandboxProbeExec,
  parseCliHelp,
  MAX_CLI_PROBES,
  CLI_PROBE_TIMEOUT_MS,
} from './cli-probes.js'
export type {
  CliProbeOptions,
  CliProbeExec,
  CliProbeCapture,
  ParsedCliHelp,
} from './cli-probes.js'

export { buildCliInterfaces, buildRootCliInterface } from './cli-interfaces.js'
export type { CliInterfaceSeed } from './cli-interfaces.js'

export { deriveApiInterfacesFromTree } from './api-tree.js'
export type { ApiSpecOperation } from './api-tree.js'

export { collectApiRequestContracts } from './api-contracts.js'

export { buildApiInterfaces } from './api-interfaces.js'
export type { ApiInterfaceSeed } from './api-interfaces.js'

export { deriveWebPlacesFromTree } from './web-tree.js'
export type { WebPlace, WebPlaceIdiom } from './web-tree.js'

export { formCliResources, formApiResources, formWebResources } from './resources.js'
export type { ResourceFormation } from './resources.js'
