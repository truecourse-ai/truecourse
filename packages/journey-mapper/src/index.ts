/**
 * `@truecourse/journey-mapper` — the code side of guard: turn the app's own
 * surfaces into JOURNEYS (entry-rooted interaction paths). Pure derivation, zero
 * LLM, no dependency on a prior `truecourse analyze` run — it consumes analyzer
 * artifacts directly and, for a cli whose framework no extractor reads, the
 * program's own help output.
 *
 * Maps the cli surface (tree-first, probe fallback) and the api surface (route
 * registrations ∪ OpenAPI operations); web lands additively behind the same
 * `JourneyStep` envelope.
 */

export { deriveCliJourneys } from './derive.js'
export type { DeriveCliJourneysOptions, CliJourneyCatalog } from './derive.js'

export { deriveCliJourneysFromTree, cliTreeSurface, buildJourneysFromSurface } from './cli-tree.js'
export type { CliTreeSurface, CliTreeRoot, DeriveCliJourneysFromTreeOptions } from './cli-tree.js'

export { unionCliSurfaces } from './cli-union.js'
export type { CliUnionResult } from './cli-union.js'

export {
  deriveCliJourneysFromProbes,
  probeCliSurface,
  createSandboxProbeExec,
  parseCliHelp,
  programNameOf,
  MAX_CLI_PROBES,
  CLI_PROBE_TIMEOUT_MS,
} from './cli-probes.js'
export type {
  CliProbeOptions,
  CliProbeExec,
  CliProbeCapture,
  ParsedCliHelp,
  ProbedCliSurface,
} from './cli-probes.js'

export { buildCliJourneys, buildRootCliJourney } from './cli-journeys.js'
export type { CliJourneySeed } from './cli-journeys.js'

export { deriveApiJourneysFromTree } from './api-tree.js'
export type { ApiSpecOperation } from './api-tree.js'

export { collectApiRequestContracts } from './api-contracts.js'

export { buildApiJourneys } from './api-journeys.js'
export type { ApiJourneySeed } from './api-journeys.js'
