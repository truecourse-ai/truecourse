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

export async function runAnalysis(
  repoPath: string,
  _branch: string | undefined,
  onProgress: AnalysisProgressCallback
): Promise<AnalysisResult> {
  const git = simpleGit(repoPath);

  // Detect current branch (we never checkout — analyze whatever is checked out)
  const currentBranch = (await git.branch()).current;

  onProgress({ step: 'discover', percent: 10, detail: 'Discovering files...' });

  // Dynamic import of the analyzer package
  // The analyzer package exports these functions
  const analyzer = await import('@truecourse/analyzer');

  // Discover files in the repository
  const files = await analyzer.discoverFiles(repoPath);
  onProgress({
    step: 'discover',
    percent: 15,
    detail: `Found ${files.length} files`,
  });

  // Analyze each file
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

    // Emit progress every 10 files or on the last file
    if (i % 10 === 0 || i === totalFiles - 1) {
      const analyzePercent = 20 + Math.round(((i + 1) / totalFiles) * 40);
      onProgress({
        step: 'analyze',
        percent: analyzePercent,
        detail: `Analyzed ${i + 1}/${totalFiles} files`,
      });
    }
  }

  // Build dependency graph
  onProgress({
    step: 'dependencies',
    percent: 65,
    detail: 'Building dependency graph...',
  });
  const moduleDependencies = analyzer.buildDependencyGraph(fileAnalyses, repoPath);

  // Detect services (split analysis)
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
}
