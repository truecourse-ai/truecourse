/**
 * Per-file source facts — the tree-sitter pass the interface catalog is derived
 * from. One file in, one {@link FileAnalysis} out: its imports and exports, the
 * routes and CLI commands it registers, the HTTP it makes, the credentials and
 * datastore URLs it names. Nothing here judges the code; it only states what the
 * source says, which is what `mapInterfaces` and the web authoring context read.
 */

export { analyzeFile, analyzeFileContent } from './file-analyzer.js';
export { discoverFiles } from './file-discovery.js';
export { initParsers, parseCode, parseFile, withParsedTree, getParser } from './parser.js';
export { buildDependencyGraph, findEntryPoints } from './dependency-graph.js';
export { detectServices, type Service } from './service-detector.js';
export {
  detectExternalServices,
  deriveOwnHosts,
  usesRawHttpClient,
  registrableDomain,
  serviceNameFromDomain,
  type DetectExternalServicesOptions,
  type DeriveOwnHostsOptions,
} from './external-services.js';
export { collectDatastoreUrls } from './datastore-endpoints.js';
export { collectOutboundRequests } from './outbound-requests.js';
export { resolveRequestContracts } from './request-contract-resolution.js';
export { detectDatabases, databaseFromManifest, parseDockerCompose } from './database-detector.js';
export {
  detectLanguage,
  getLanguageConfig,
  getAllFileExtensions,
  getAllIgnorePatterns,
  getAllTestPatterns,
  type LanguageConfig,
} from './language-config.js';
export { DATABASE_IMPORT_MAP, CONNECTION_ENV_VARS, DOCKER_IMAGE_MAP } from './patterns/index.js';
