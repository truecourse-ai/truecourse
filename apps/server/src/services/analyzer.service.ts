import { simpleGit } from 'simple-git';
import type {
  FileAnalysis,
  ModuleDependency,
  ServiceInfo,
  ServiceDependencyInfo,
  Architecture,
  LayerDetail,
  LayerDependencyInfo,
  ModuleInfo,
  MethodInfo,
  ModuleLevelDependency,
  MethodLevelDependency,
} from '@truecourse/shared';
import { checkModuleRules, type ModuleViolation } from '@truecourse/analyzer';
import type { AnalysisRule } from '@truecourse/shared';

export interface AnalysisProgressCallback {
  (progress: { step: string; percent: number; detail?: string }): void;
}

export interface AnalysisResult {
  architecture: Architecture;
  services: ServiceInfo[];
  dependencies: ServiceDependencyInfo[];
  layerDetails: LayerDetail[];
  layerDependencies: LayerDependencyInfo[];
  databaseResult: import('@truecourse/shared').DatabaseDetectionResult;
  modules: ModuleInfo[];
  methods: MethodInfo[];
  moduleLevelDependencies: ModuleLevelDependency[];
  methodLevelDependencies: MethodLevelDependency[];
  fileAnalyses: FileAnalysis[];
  moduleDependencies: ModuleDependency[];
  metadata: Record<string, unknown>;
}

/**
 * Run deterministic module-level checks on an AnalysisResult.
 * Shared by normal analysis and diff-check so the logic stays in one place.
 */
export function runDeterministicModuleChecks(
  result: AnalysisResult,
  enabledDeterministic: AnalysisRule[],
): ModuleViolation[] {
  if (!result.modules || !result.methods) return [];

  // Build set of module keys connected to databases so they aren't flagged as dead
  const dbConnectedModuleKeys = new Set<string>();
  if (result.databaseResult) {
    for (const conn of result.databaseResult.connections) {
      const driverLower = conn.driver.toLowerCase();
      const dbNameLower = conn.databaseName.toLowerCase();
      const dataModules = result.modules.filter(
        (m) => m.serviceName === conn.serviceName && m.layerName === 'data',
      );
      if (dataModules.length > 0) {
        const matched = dataModules.find((m) => {
          const nameLower = m.name.toLowerCase();
          return nameLower.includes(driverLower) || driverLower.includes(nameLower)
            || nameLower.includes(dbNameLower) || dbNameLower.includes(nameLower);
        });
        const mod = matched || dataModules[0];
        dbConnectedModuleKeys.add(`${mod.serviceName}::${mod.name}`);
      }
    }
  }

  return checkModuleRules(
    result.modules,
    result.methods,
    result.moduleDependencies || [],
    enabledDeterministic,
    result.moduleLevelDependencies || [],
    dbConnectedModuleKeys,
    result.methodLevelDependencies || [],
    result.fileAnalyses,
  );
}

export async function runAnalysis(
  repoPath: string,
  _branch: string | undefined,
  onProgress: AnalysisProgressCallback,
  options?: { skipStash?: boolean },
): Promise<AnalysisResult> {
  const git = simpleGit(repoPath);

  // Detect current branch (we never checkout — analyze whatever is checked out)
  const currentBranch = (await git.branch()).current;

  // Stash pending changes so the baseline reflects the committed state
  let didStash = false;
  const statusResult = await git.status();
  const hasChanges = !statusResult.isClean();

  if (hasChanges && !options?.skipStash) {
    onProgress({ step: 'stash', percent: 2, detail: 'Stashing pending changes to analyze committed state...' });
    try {
      const stashResult = await git.stash(['push', '--include-untracked', '-m', 'truecourse-analysis-stash']);
      // git stash push prints "No local changes to save" if nothing to stash
      didStash = !stashResult.includes('No local changes');
    } catch (error) {
      console.warn('[Analyzer] Failed to stash changes, analyzing current state:', error instanceof Error ? error.message : String(error));
    }
  }

  try {
    onProgress({ step: 'discover', percent: 10, detail: 'Discovering files...' });

    const analyzer = await import('@truecourse/analyzer');

    const files = await analyzer.discoverFiles(repoPath);
    onProgress({
      step: 'discover',
      percent: 15,
      detail: `Found ${files.length} files`,
    });

    onProgress({ step: 'analyze', percent: 20, detail: 'Analyzing files...' });
    const fileAnalyses: FileAnalysis[] = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      try {
        const analysis = await analyzer.analyzeFile(file);
        if (analysis) {
          fileAnalyses.push(analysis);
        }
      } catch (error) {
        console.warn(
          `[Analyzer] Failed to analyze ${file}:`,
          error instanceof Error ? error.message : String(error)
        );
      }

      if (i % 10 === 0 || i === totalFiles - 1) {
        const analyzePercent = 20 + Math.round(((i + 1) / totalFiles) * 40);
        onProgress({
          step: 'analyze',
          percent: analyzePercent,
          detail: `Analyzed ${i + 1}/${totalFiles} files`,
        });
      }
    }

    onProgress({
      step: 'dependencies',
      percent: 65,
      detail: 'Building dependency graph...',
    });
    const moduleDependencies = analyzer.buildDependencyGraph(fileAnalyses, repoPath);

    onProgress({
      step: 'services',
      percent: 75,
      detail: 'Detecting services...',
    });
    const splitResult = analyzer.performSplitAnalysis(
      repoPath,
      fileAnalyses,
      moduleDependencies
    );

    onProgress({
      step: 'saving',
      percent: 80,
      detail: `Saving results: ${splitResult.services.length} services detected`,
    });

    return {
      architecture: splitResult.architecture,
      services: splitResult.services,
      dependencies: splitResult.dependencies,
      layerDetails: splitResult.layerDetails,
      layerDependencies: splitResult.layerDependencies,
      databaseResult: splitResult.databaseResult,
      modules: splitResult.modules,
      methods: splitResult.methods,
      moduleLevelDependencies: splitResult.moduleLevelDependencies,
      methodLevelDependencies: splitResult.methodLevelDependencies,
      fileAnalyses,
      moduleDependencies,
      metadata: {
        totalFiles: files.length,
        analyzedFiles: fileAnalyses.length,
        branch: currentBranch || 'HEAD',
        analyzedAt: new Date().toISOString(),
      },
    };
  } finally {
    // Always restore stashed changes
    if (didStash) {
      onProgress({ step: 'unstash', percent: 82, detail: 'Restoring pending changes...' });
      try {
        await git.stash(['pop']);
      } catch (error) {
        console.error('[Analyzer] Failed to restore stashed changes. Run "git stash pop" manually.', error instanceof Error ? error.message : String(error));
      }
    }
  }
}
