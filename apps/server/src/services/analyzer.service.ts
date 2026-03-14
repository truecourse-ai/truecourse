import { simpleGit } from 'simple-git';
import type {
  FileAnalysis,
  ModuleDependency,
  ServiceInfo,
  ServiceDependencyInfo,
  Architecture,
} from '@truecourse/shared';

export interface AnalysisProgressCallback {
  (progress: { step: string; percent: number; detail?: string }): void;
}

export interface AnalysisResult {
  architecture: Architecture;
  services: ServiceInfo[];
  dependencies: ServiceDependencyInfo[];
  fileAnalyses: FileAnalysis[];
  moduleDependencies: ModuleDependency[];
  metadata: Record<string, unknown>;
}

export async function runAnalysis(
  repoPath: string,
  branch: string | undefined,
  onProgress: AnalysisProgressCallback
): Promise<AnalysisResult> {
  const git = simpleGit(repoPath);

  // Checkout branch if specified
  if (branch) {
    onProgress({ step: 'checkout', percent: 5, detail: `Checking out branch: ${branch}` });
    await git.checkout(branch);
  }

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
    step: 'complete',
    percent: 100,
    detail: `Analysis complete: ${splitResult.services.length} services detected`,
  });

  return {
    architecture: splitResult.architecture,
    services: splitResult.services,
    dependencies: splitResult.dependencies,
    fileAnalyses,
    moduleDependencies,
    metadata: {
      totalFiles: files.length,
      analyzedFiles: fileAnalyses.length,
      branch: branch || 'HEAD',
      analyzedAt: new Date().toISOString(),
    },
  };
}
