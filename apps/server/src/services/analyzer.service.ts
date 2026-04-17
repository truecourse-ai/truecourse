import path from 'node:path';
import { getGit } from '../lib/git.js';
import { log } from '../lib/logger.js';
import type {
  FileAnalysis,
  ModuleDependency,
  ServiceInfo,
  ServiceDependencyInfo,
  Architecture,
  LayerDetail,
  ModuleInfo,
  MethodInfo,
  ModuleLevelDependency,
  MethodLevelDependency,
} from '@truecourse/shared';
import { checkModuleRules, checkMethodRules, checkServiceRules, findEntryPoints, buildScopedCompilerOptions, analyzeSemantics, LspClient, getLspServerConfig, type ModuleViolation, type ServiceViolation } from '@truecourse/analyzer';
import type { AnalysisRule } from '@truecourse/shared';

export interface AnalysisProgressCallback {
  (progress: { step: string; percent: number; detail?: string }): void;
}

export interface AnalysisResult {
  architecture: Architecture;
  services: ServiceInfo[];
  dependencies: ServiceDependencyInfo[];
  layerDetails: LayerDetail[];
  databaseResult: import('@truecourse/shared').DatabaseDetectionResult;
  modules: ModuleInfo[];
  methods: MethodInfo[];
  moduleLevelDependencies: ModuleLevelDependency[];
  methodLevelDependencies: MethodLevelDependency[];
  fileAnalyses: FileAnalysis[];
  moduleDependencies: ModuleDependency[];
  /** Files that are not imported by anyone — framework entry points, scripts, etc. */
  entryPointFiles: Set<string>;
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

  // Build set of library service names so cross-service import check skips them
  const libraryServiceNames = new Set(
    result.services.filter((s) => s.type === 'library').map((s) => s.name),
  );

  return checkModuleRules(
    result.modules,
    result.methods,
    result.moduleDependencies || [],
    enabledDeterministic,
    result.moduleLevelDependencies || [],
    dbConnectedModuleKeys,
    result.fileAnalyses,
    libraryServiceNames,
    result.entryPointFiles,
    result.methodLevelDependencies || [],
  );
}

/**
 * Run deterministic method-level checks on an AnalysisResult.
 */
export function runDeterministicMethodChecks(
  result: AnalysisResult,
  enabledDeterministic: AnalysisRule[],
): ModuleViolation[] {
  if (!result.methods) return [];
  return checkMethodRules(
    result.methods,
    enabledDeterministic,
    result.methodLevelDependencies || [],
    result.entryPointFiles,
    result.fileAnalyses,
  );
}

/**
 * Run deterministic service-level checks on an AnalysisResult.
 */
export function runDeterministicServiceChecks(
  result: AnalysisResult,
  enabledDeterministic: AnalysisRule[],
): ServiceViolation[] {
  return checkServiceRules(
    result.services,
    result.dependencies,
    enabledDeterministic,
  );
}

export async function runAnalysis(
  repoPath: string,
  _branch: string | undefined,
  onProgress: AnalysisProgressCallback,
  options?: { skipStash?: boolean; skipGit?: boolean; signal?: AbortSignal },
): Promise<AnalysisResult> {
  let currentBranch = 'unknown';
  let didStash = false;
  let isSubdirectory = false;
  let hasChanges = false;
  let git: Awaited<ReturnType<typeof getGit>> | undefined;

  if (!options?.skipGit) {
    git = await getGit(repoPath);

    // Detect current branch (we never checkout — analyze whatever is checked out)
    currentBranch = (await git.branch()).current;

    // Stash pending changes so the baseline reflects the committed state
    const statusResult = await git.status();
    hasChanges = !statusResult.isClean();

    // Skip stashing when the repo path is a subdirectory of a larger repo
    // (e.g., test fixtures inside the main repo). Stashing there would affect
    // unrelated files and cause ENOENT errors in concurrent operations.
    const gitRoot = (await git.revparse(['--show-toplevel'])).trim();
    isSubdirectory = path.resolve(repoPath) !== path.resolve(gitRoot);
  }

  if (hasChanges && !options?.skipStash && !isSubdirectory && git) {
    onProgress({ step: 'stash', percent: 2, detail: 'Stashing pending changes to analyze committed state...' });
    try {
      const stashResult = await git.stash(['push', '--include-untracked', '-m', 'truecourse-analysis-stash']);
      // git stash push prints "No local changes to save" if nothing to stash
      didStash = !stashResult.includes('No local changes');
    } catch (error) {
      log.warn(`[Analyzer] Failed to stash changes, analyzing current state: ${error instanceof Error ? error.message : String(error)}`);
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
      if (options?.signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');

      const file = files[i];
      try {
        const analysis = await analyzer.analyzeFile(file);
        if (analysis) {
          fileAnalyses.push(analysis);
        }
      } catch (error) {
        log.warn(`[Analyzer] Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`);
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

    // Use TS compiler for accurate export detection — corrects isExported flags
    // set by tree-sitter which can't handle grouped exports, re-exports, or barrels
    const scopedOptions = buildScopedCompilerOptions(repoPath);
    if (scopedOptions.length > 0) {
      const filePaths = fileAnalyses.map((fa) => fa.filePath);
      const { exportMap } = analyzeSemantics(filePaths, scopedOptions);

      // Correct isExported flags on functions using the compiler's definitive export list.
      // The compiler reports default exports as 'default', so we also check if the function
      // is the default export by matching against the file's export statements.
      for (const fa of fileAnalyses) {
        const fileExports = exportMap.get(fa.filePath);
        if (!fileExports) continue;

        // Find the default-exported function name (if any) from the file's export list
        const defaultExportedFn = fa.exports.find((e) => e.isDefault)?.name;

        for (const fn of fa.functions) {
          fn.isExported = fileExports.has(fn.name)
            || (fileExports.has('default') && fn.name === defaultExportedFn);
        }
      }
    }

    // Use LSP servers for accurate export detection on non-JS/TS languages.
    // Each language with a registered LSP server gets the same treatment as
    // the TS compiler above — correct isExported flags from the server's
    // definitive export list.
    const filesByLanguage = new Map<string, FileAnalysis[]>();
    for (const fa of fileAnalyses) {
      const list = filesByLanguage.get(fa.language) || [];
      list.push(fa);
      filesByLanguage.set(fa.language, list);
    }

    for (const [language, files] of filesByLanguage) {
      const serverConfig = getLspServerConfig(language as any);
      if (!serverConfig) continue; // JS/TS uses TS compiler, not LSP

      try {
        const lspClient = new LspClient(serverConfig);
        await lspClient.start(repoPath);

        const filePaths = files.map((fa) => fa.filePath);
        const { exportMap } = await lspClient.analyzeSemantics(
          filePaths.map((fp) => fp.startsWith(repoPath) ? fp.slice(repoPath.length + 1) : fp)
        );

        for (const fa of files) {
          const fileExports = exportMap.get(fa.filePath);
          if (!fileExports) continue;
          for (const fn of fa.functions) {
            fn.isExported = fileExports.has(fn.name);
          }
        }

        await lspClient.stop();
      } catch (error) {
        log.warn(`[Analyzer] ${serverConfig.name} LSP analysis failed, using tree-sitter heuristics: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

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
      databaseResult: splitResult.databaseResult,
      modules: splitResult.modules,
      methods: splitResult.methods,
      moduleLevelDependencies: splitResult.moduleLevelDependencies,
      methodLevelDependencies: splitResult.methodLevelDependencies,
      fileAnalyses,
      moduleDependencies,
      entryPointFiles: new Set(findEntryPoints(fileAnalyses, moduleDependencies)),
      metadata: {
        totalFiles: files.length,
        analyzedFiles: fileAnalyses.length,
        branch: currentBranch || 'HEAD',
        analyzedAt: new Date().toISOString(),
      },
    };
  } finally {
    // Always restore stashed changes
    if (didStash && git) {
      onProgress({ step: 'unstash', percent: 80, detail: 'Restoring pending changes...' });
      try {
        await git.stash(['pop']);
      } catch (error) {
        log.error(`[Analyzer] Failed to restore stashed changes. Run "git stash pop" manually. ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export interface DiffAnalysisInput {
  repoPath: string;
  branch: string | undefined;
  onProgress: AnalysisProgressCallback;
}

export interface DiffAnalysisOutput {
  analysisResult: AnalysisResult;
  changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }>;
}

/**
 * Run analysis on dirty tree + get changed files.
 * No LLM calls — persistence happens after this.
 */
export async function runDiffAnalysis(input: DiffAnalysisInput): Promise<DiffAnalysisOutput> {
  const { repoPath, branch, onProgress } = input;

  onProgress({ step: 'analyzing', percent: 10, detail: 'Analyzing dirty working tree...' });
  const result = await runAnalysis(repoPath, branch, onProgress, { skipStash: true });

  const git = await getGit(repoPath);
  const statusResult = await git.status();

  const changedFiles: Array<{ path: string; status: 'new' | 'modified' | 'deleted' }> = [];
  for (const f of statusResult.not_added) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.created) changedFiles.push({ path: f, status: 'new' });
  for (const f of statusResult.modified) changedFiles.push({ path: f, status: 'modified' });
  for (const f of statusResult.staged) {
    if (!changedFiles.some((cf) => cf.path === f)) changedFiles.push({ path: f, status: 'modified' });
  }
  for (const f of statusResult.deleted) changedFiles.push({ path: f, status: 'deleted' });

  return { analysisResult: result, changedFiles };
}
