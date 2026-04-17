import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, withProjectDb } from '../config/database.js';
import { analyses, services, violations, modules, methods } from '../db/schema.js';
import { getGit } from '../lib/git.js';
import { readProjectConfig } from '../config/project-config.js';
import { touchProject } from '../config/registry.js';
import type { RegistryEntry } from '../config/registry.js';
import { runAnalysis, type AnalysisResult } from '../services/analyzer.service.js';
import { persistAnalysisResult } from '../services/analysis-persistence.service.js';
import { detectAndPersistFlows } from '../services/flow.service.js';
import { runViolationPipeline } from '../services/violation-pipeline.service.js';
import { createLLMProvider, type LLMProvider } from '../services/llm/provider.js';
import type { StepTracker } from '../socket/handlers.js';

const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

export interface LlmEstimate {
  totalEstimatedTokens: number;
  tiers: { tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }[];
  uniqueFileCount?: number;
  uniqueRuleCount?: number;
}

export interface AnalyzeInProcessOptions {
  /** If set, reuse an existing running analysis row instead of creating a new one. */
  existingAnalysisId?: string;
  branch?: string | null;
  commitHash?: string | null;
  /** Skip all git commands (branch detection, commit hash, diff). */
  skipGit?: boolean;
  enabledCategoriesOverride?: string[];
  enableLlmRulesOverride?: boolean;
  tracker?: StepTracker;
  onProgress?: (progress: { detail?: string }) => void;
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /** Called when the LLM estimate prompt is resolved (proceed or skip). */
  onLlmResolved?: (proceed: boolean) => void;
  /** Provider to use for LLM calls. Caller is responsible for `setAnalysisId` + abort wiring. */
  provider?: LLMProvider;
  signal?: AbortSignal;
}

export interface AnalyzeInProcessResult {
  analysisId: string;
  serviceCount: number;
  fileCount: number;
  architecture: string;
  durationMs: number;
  /** Counts of active (new + unchanged) violations for the completed analysis. */
  violationsSummary: { total: number; bySeverity: Record<string, number> };
}

/**
 * Core analyze pipeline used by both the `truecourse analyze` CLI command
 * and the server's UI-triggered `POST /analyze` route. Opens (or reuses) the
 * project's PGlite via `withProjectDb`, inserts the analysis row, runs the
 * analyzer + persistence + flows + violation pipeline.
 *
 * Callers are responsible for:
 *   - Translating `signal` aborts into UX (exit code, socket event).
 *   - Wiring the tracker to their own transport (stdout vs Socket.io).
 *   - Rendering the LLM-estimate prompt (interactive vs ui-roundtrip).
 */
export async function analyzeInProcess(
  project: RegistryEntry,
  options: AnalyzeInProcessOptions = {},
): Promise<AnalyzeInProcessResult> {
  return withProjectDb(project, async () => {
    const start = Date.now();
    const { skipGit, signal } = options;
    const projectConfig = readProjectConfig(project.path);

    let branch: string | null = options.branch ?? null;
    let commitHash: string | null = options.commitHash ?? null;
    if (!skipGit && (branch === null || commitHash === null)) {
      const git = await getGit(project.path);
      if (branch === null) branch = (await git.branch()).current || null;
      if (commitHash === null) commitHash = (await git.revparse(['HEAD'])).trim();
    }

    let runningAnalysisId = options.existingAnalysisId;
    if (!runningAnalysisId) {
      const [row] = await db
        .insert(analyses)
        .values({
          id: randomUUID(),
          branch,
          status: 'running',
          architecture: 'unknown',
          commitHash,
        })
        .returning();
      runningAnalysisId = row.id;
    }

    const effectiveCategories = options.enabledCategoriesOverride?.length
      ? options.enabledCategoriesOverride
      : projectConfig.enabledCategories ?? undefined;
    const effectiveLlmRules =
      projectConfig.enableLlmRules ?? options.enableLlmRulesOverride ?? true;

    try {
      options.tracker?.start('parse', 'Starting analysis...');
      const result: AnalysisResult = await runAnalysis(
        project.path,
        branch ?? undefined,
        (progress) => {
          options.tracker?.detail('parse', progress.detail ?? 'Analyzing...');
          options.onProgress?.({ detail: progress.detail });
        },
        { signal },
      );

      // Clean up stale diff analyses
      const oldDiffAnalyses = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS TRUE`);
      for (const da of oldDiffAnalyses) {
        await db.delete(analyses).where(eq(analyses.id, da.id));
      }

      if (signal?.aborted) {
        await db.update(analyses).set({ status: 'cancelled' }).where(eq(analyses.id, runningAnalysisId));
        throw new DOMException('Analysis cancelled', 'AbortError');
      }

      const { analysisId, serviceIdMap, moduleIdMap, methodIdMap, dbIdMap } =
        await persistAnalysisResult({
          branch,
          result,
          commitHash: commitHash ?? undefined,
          metadata: {},
          existingAnalysisId: runningAnalysisId,
        });

      // Previous active violations for lifecycle tracking
      const prevConditions = [notDiffAnalysis];
      if (branch) prevConditions.push(eq(analyses.branch, branch));
      const prevAnalyses = await db
        .select({ id: analyses.id })
        .from(analyses)
        .where(and(...prevConditions))
        .orderBy(desc(analyses.createdAt))
        .limit(2);
      const previousAnalysisId = prevAnalyses.length > 1 ? prevAnalyses[1].id : null;

      let previousActiveViolations: PreviousViolation[] = [];
      if (previousAnalysisId) {
        const rows = await db
          .select({
            id: violations.id,
            type: violations.type,
            title: violations.title,
            content: violations.content,
            severity: violations.severity,
            status: violations.status,
            targetServiceId: violations.targetServiceId,
            targetServiceName: services.name,
            targetDatabaseId: violations.targetDatabaseId,
            targetModuleId: violations.targetModuleId,
            targetModuleName: modules.name,
            targetMethodId: violations.targetMethodId,
            targetMethodName: methods.name,
            targetTable: violations.targetTable,
            fixPrompt: violations.fixPrompt,
            ruleKey: violations.ruleKey,
            firstSeenAnalysisId: violations.firstSeenAnalysisId,
            firstSeenAt: violations.firstSeenAt,
            filePath: violations.filePath,
            lineStart: violations.lineStart,
            lineEnd: violations.lineEnd,
            columnStart: violations.columnStart,
            columnEnd: violations.columnEnd,
            snippet: violations.snippet,
          })
          .from(violations)
          .leftJoin(services, eq(violations.targetServiceId, services.id))
          .leftJoin(modules, eq(violations.targetModuleId, modules.id))
          .leftJoin(methods, eq(violations.targetMethodId, methods.id))
          .where(eq(violations.analysisId, previousAnalysisId));

        previousActiveViolations = rows.filter(
          (v) => v.status === 'new' || v.status === 'unchanged',
        );
      }

      try {
        await detectAndPersistFlows(analysisId, result);
      } catch (flowError) {
        console.error(
          '[Flows] Detection failed:',
          flowError instanceof Error ? flowError.message : String(flowError),
        );
      }

      touchProject(project.slug);

      // Incremental file detection based on commit diff
      let changedFileSet: Set<string> | undefined;
      if (previousAnalysisId && !skipGit) {
        const [prevRow] = await db
          .select({ commitHash: analyses.commitHash })
          .from(analyses)
          .where(eq(analyses.id, previousAnalysisId))
          .limit(1);
        if (prevRow?.commitHash) {
          try {
            const git = await getGit(project.path);
            const diffOutput = await git.diff([prevRow.commitHash, 'HEAD', '--name-only']);
            const files = diffOutput.trim().split('\n').filter(Boolean);
            if (files.length > 0) changedFileSet = new Set(files);
          } catch {
            // diff unavailable — analyze all files
          }
        }
      }

      options.tracker?.done(
        'parse',
        `${result.services.length} services, ${result.fileAnalyses?.length ?? 0} files`,
      );

      const provider = options.provider ?? (effectiveLlmRules ? createLLMProvider() : undefined);
      if (provider) {
        provider.setAnalysisId(analysisId);
        provider.setRepoPath(project.path);
        if (signal) provider.setAbortSignal(signal);
      }

      try {
        await runViolationPipeline({
          repoPath: project.path,
          analysisId,
          result,
          serviceIdMap,
          moduleIdMap,
          methodIdMap,
          dbIdMap,
          previousActiveViolations,
          changedFileSet,
          tracker: options.tracker,
          enabledCategories: effectiveCategories,
          enableLlmRules: effectiveLlmRules,
          provider,
          signal,
          onLlmEstimate: options.onLlmEstimate
            ? async (estimate) => {
                const proceed = await options.onLlmEstimate!(estimate);
                options.onLlmResolved?.(proceed);
                return proceed;
              }
            : undefined,
        });
      } finally {
        try {
          await provider?.flushUsage();
        } catch {
          // best-effort
        }
      }

      const summaryRows = await db
        .select({
          severity: violations.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(violations)
        .where(
          sql`${violations.analysisId} = ${analysisId} AND ${violations.status} IN ('new', 'unchanged')`,
        )
        .groupBy(violations.severity);
      const bySeverity: Record<string, number> = {};
      let total = 0;
      for (const row of summaryRows) {
        const c = Number(row.count);
        bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + c;
        total += c;
      }

      return {
        analysisId,
        serviceCount: result.services.length,
        fileCount: result.fileAnalyses?.length ?? 0,
        architecture: result.architecture,
        durationMs: Date.now() - start,
        violationsSummary: { total, bySeverity },
      };
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        await db
          .update(analyses)
          .set({ status: 'failed' })
          .where(eq(analyses.id, runningAnalysisId));
      }
      throw err;
    }
  });
}

type PreviousViolation = Awaited<ReturnType<typeof loadPreviousViolations>>[number];
async function loadPreviousViolations(_analysisId: string) {
  // Type helper only — the real query lives inline above.
  return [] as {
    id: string;
    type: string;
    title: string;
    content: string;
    severity: string;
    status: string;
    targetServiceId: string | null;
    targetServiceName: string | null;
    targetDatabaseId: string | null;
    targetModuleId: string | null;
    targetModuleName: string | null;
    targetMethodId: string | null;
    targetMethodName: string | null;
    targetTable: string | null;
    fixPrompt: string | null;
    ruleKey: string;
    firstSeenAnalysisId: string | null;
    firstSeenAt: Date | null;
    filePath: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    columnStart: number | null;
    columnEnd: number | null;
    snippet: string | null;
  }[];
}
