/**
 * `@truecourse/journey-mapper` — the code side of guard: turn the app's own
 * surfaces into JOURNEYS (entry-rooted interaction paths). Pure derivation, zero
 * LLM, no dependency on a prior `truecourse analyze` run — it consumes analyzer
 * artifacts directly and, for a cli whose framework no extractor reads, the
 * program's own help output.
 *
 * v1 maps the cli surface; api and web land additively behind the same
 * `JourneyStep` envelope.
 */

export { deriveCliJourneys } from './derive.js'
export type { DeriveCliJourneysOptions, CliJourneyCatalog } from './derive.js'

export { deriveCliJourneysFromTree } from './cli-tree.js'

export {
  deriveCliJourneysFromProbes,
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

export { buildCliJourneys, buildRootCliJourney } from './cli-journeys.js'
export type { CliJourneySeed } from './cli-journeys.js'
