/**
 * Architecture-detection dispatcher. Builds a single `CodebaseScan` per
 * code dir (package.json deps + characteristic imports + file index) and
 * exposes the per-category detector registry. The comparator/orchestrator
 * runs ONLY the detectors the spec's ArchitectureDecision artifacts ask
 * for, caching results per (category, scope) for one verify run.
 */

import { initParsers } from '@truecourse/analyzer';
import type { ArchitectureCategory } from '../../types/index.js';
import type { ArchitectureDetector, CodebaseScan } from './types.js';
import { collectDeclaredPackages } from './shared/dependencies.js';
import { collectImports } from './shared/characteristic-imports.js';
import { collectFileIndex } from './shared/config-files.js';
import { dataStoreDetector } from './data-store.js';
import { communicationPatternDetector } from './communication-pattern.js';
import { messagingDetector } from './messaging.js';
import { architectureStyleDetector } from './architecture-style.js';
import { authStrategyDetector } from './auth-strategy.js';
import { frontendFrameworkDetector } from './frontend-framework.js';
import { runtimeDetector } from './runtime.js';
import { deploymentPlatformDetector } from './deployment-platform.js';
import { packageManagerDetector } from './package-manager.js';
import { buildSystemDetector } from './build-system.js';

export type {
  ArchitectureDetector,
  CodebaseScan,
  DetectedArchitectureChoice,
  DetectionSignal,
  ObservedChoice,
} from './types.js';

const DETECTORS: Record<ArchitectureCategory, ArchitectureDetector> = {
  'data-store': dataStoreDetector,
  'communication-pattern': communicationPatternDetector,
  'messaging': messagingDetector,
  'architecture-style': architectureStyleDetector,
  'auth-strategy': authStrategyDetector,
  'frontend-framework': frontendFrameworkDetector,
  'runtime': runtimeDetector,
  'deployment-platform': deploymentPlatformDetector,
  'package-manager': packageManagerDetector,
  'build-system': buildSystemDetector,
};

export function getArchitectureDetector(category: ArchitectureCategory): ArchitectureDetector | undefined {
  return DETECTORS[category];
}

export async function buildCodebaseScan(codeDir: string): Promise<CodebaseScan> {
  await initParsers();
  const packages = collectDeclaredPackages(codeDir);
  const imports = await collectImports(codeDir);
  const { files, readFile } = collectFileIndex(codeDir);
  return { codeDir, packages, imports, files, readFile };
}
