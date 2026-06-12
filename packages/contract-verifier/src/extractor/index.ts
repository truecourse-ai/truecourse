/**
 * Code-side extractors. Each artifact kind has its own extractor that
 * reads source files and produces typed contracts in the same shape the
 * spec-side lifter produces.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Tree } from 'web-tree-sitter';
import { initParsers, parseFile } from '@truecourse/analyzer';
import { loadTcIgnore } from '@truecourse/shared';
import { extractOperationsFromFile, extractPluginStyleRoutesFromFile, type ExtractedOperation } from './operation.js';
import {
  extractFastApiOperationsFromFile,
  extractStarletteRoutesFromFile,
} from './operation-fastapi.js';
import { eachParsedSource } from './source-walker.js';
import { extractFileBasedRoutesFromDir } from './file-based-routes.js';
import {
  analyzeRouterFile,
  buildMountGraph,
  rewriteOperationsWithMounts,
  type FileAnalysis,
} from './mount-graph.js';
export { detectAuthPresence } from './auth-presence.js';
export type { AuthPresenceResult } from './auth-presence.js';
export { detectIdempotencyPresence } from './idempotency-presence.js';
export type { IdempotencyPresenceResult } from './idempotency-presence.js';
export { extractFileBasedRoutesFromDir } from './file-based-routes.js';
export { extractQueriesFromDir } from './query/index.js';
export type { ExtractedQuery, QueryAdapterName } from './query/index.js';
export { extractEnumsFromDir } from './enum/index.js';
export type { ExtractedEnum, EnumShape } from './enum/index.js';
export {
  detectForbiddenFiles,
  detectForbiddenEnvVar,
  detectForbiddenDependency,
  detectForbiddenFeatureFlag,
} from './forbidden/index.js';
export type { ForbiddenMatch } from './forbidden/index.js';
export { extractConstantsFromDir } from './constant/index.js';
export type { ExtractedConstant, ConstantShape } from './constant/index.js';
export { extractEffectsFromDir } from './effect/index.js';
export type { ExtractedEffect } from './effect/index.js';
export { extractEmissionFacts } from './effect/emission-facts.js';
export type { EmissionFacts, OperationEmission, FailureEmitSite } from './effect/emission-facts.js';
export { extractEntitiesFromDir } from './entity-schema/index.js';
export type { ExtractedEntity, ExtractedEntityField, EntityFieldType } from './entity-schema/index.js';
export { extractComputedFieldsFromDir } from './computed-field/index.js';
export type { ExtractedComputedField } from './computed-field/index.js';
export { extractStateFieldsFromDir } from './state-field/index.js';
export type { ExtractedStateField } from './state-field/index.js';
export { extractStateMachineFacts } from './state-machine-facts/index.js';
export type { StateMachineFacts, TransitionMapFact, StateAssignmentFact, GuardClause } from './state-machine-facts/index.js';
export { extractFormulaFacts } from './formula-facts/index.js';
export type { FormulaImplFacts, FormulaParamFact } from './formula-facts/index.js';
export { extractEntityFacts } from './entity-facts/index.js';
export type { EntityFacts, EntityFileFacts, EntityAssignment } from './entity-facts/index.js';
export { extractCodeContracts } from './code-contracts.js';
export type { CodeContractSet } from './code-contracts.js';
export { buildCodebaseScan, getArchitectureDetector } from './architecture/index.js';
export type { CodebaseScan, DetectedArchitectureChoice, ArchitectureDetector } from './architecture/index.js';

export type { ExtractedOperation } from './operation.js';

const TS_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function isTestFile(filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1];
  if (/\.(test|spec)\.(t|j)sx?$/.test(fileName)) return true;
  if (parts.includes('__tests__')) return true;
  return false;
}

/**
 * Walk a directory recursively, parse each TS/JS file, and run the
 * Operation extractor over it. After the per-file pass, build a
 * cross-file mount graph (`app.use('/prefix', router)` chains) and
 * rewrite each route's URL to include every reachable mount prefix.
 *
 * Caller must `await initParsers()` once before use, OR rely on this
 * helper which awaits it implicitly (cached after first call).
 */
export async function extractOperationsFromDir(rootDir: string): Promise<ExtractedOperation[]> {
  await initParsers();
  const rawOps: ExtractedOperation[] = [];
  const fileAnalyses: FileAnalysis[] = [];
  const tcIgnore = loadTcIgnore(rootDir);

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (tcIgnore.ignores(full)) continue;
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!TS_EXT.has(ext)) continue;
      if (isTestFile(full)) continue;
      const source = fs.readFileSync(full, 'utf-8');
      const lang =
        ext === '.ts' || ext === '.tsx' ? (ext === '.tsx' ? 'tsx' : 'typescript') : 'javascript';
      let tree: Tree | undefined;
      try {
        tree = parseFile(full, source, lang);
        rawOps.push(...extractOperationsFromFile(full, source, tree));
        rawOps.push(...extractPluginStyleRoutesFromFile(full, source, tree));
        fileAnalyses.push(analyzeRouterFile(full, source, tree));
      } catch {
        // Parse failures are silent — the verifier flags them via a
        // separate diagnostic channel later. Don't crash the whole
        // extraction pass on one bad file.
      } finally {
        // Safe to dispose per-file: the eager handler-facts extraction
        // in operation.ts has already reduced any handler-body data we
        // need to plain Sets / Maps / arrays on the ExtractedOperation,
        // and FileAnalysis contains only strings.
        tree?.delete();
      }
    }
  };
  visit(rootDir);

  const graph = buildMountGraph(fileAnalyses);
  const expressOps = rewriteOperationsWithMounts(rawOps, fileAnalyses, graph);

  // File-based routing (Astro / Next.js Pages / Next.js App / SvelteKit).
  // Each framework's filesystem layout produces ExtractedOperation entries
  // in the same shape Express does — they slot into the comparator pipeline
  // without further normalization. Dedup by identity so a project with
  // both styles doesn't double-count.
  const fileOps = await extractFileBasedRoutesFromDir(rootDir);
  const seen = new Set(expressOps.map((o) => o.identity));
  for (const op of fileOps) {
    if (!seen.has(op.identity)) {
      expressOps.push(op);
      seen.add(op.identity);
    }
  }

  // Python (FastAPI) routes. The router prefix is resolved in-file
  // (`APIRouter(prefix=…)`), so no cross-file mount graph is needed.
  await eachParsedSource(rootDir, (s) => {
    if (s.lang !== 'python') return;
    const pythonOps = [
      ...extractFastApiOperationsFromFile(s.filePath, s.source, s.tree),
      ...extractStarletteRoutesFromFile(s.filePath, s.source, s.tree),
    ];
    for (const op of pythonOps) {
      if (!seen.has(op.identity)) {
        expressOps.push(op);
        seen.add(op.identity);
      }
    }
  });

  return expressOps;
}
