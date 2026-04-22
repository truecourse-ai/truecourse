/**
 * Mode-specific persistence for `analyzeCore` results.
 *
 * Full analyze writes `analyses/*.json` (delta) + `LATEST.json` (materialized
 * view) + appends `history.json` + deletes any stale `diff.json` + bumps
 * `lastAnalyzed`. Diff writes only `diff.json` with hydrated resolved rows
 * and affected-node keys for the dashboard.
 *
 * Keeping persistence separate from computation means `analyze-core.ts` stays
 * free of disk IO (easy to test) and both modes share the exact same
 * up-to-the-point-of-write semantics.
 */

import path from 'node:path';
import { log } from '../lib/logger.js';
import { setLastAnalyzed } from '../config/registry.js';
import type { RegistryEntry } from '../config/registry.js';
import {
  appendHistory,
  buildAnalysisFilename,
  deleteDiff,
  writeAnalysis,
  writeDiff,
  writeLatest,
} from '../lib/analysis-store.js';
import { refreshAdrStaleness } from '../lib/adr-store.js';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  Graph,
  HistoryEntry,
  LatestSnapshot,
  ViolationRecord,
  ViolationSeverity,
  ViolationWithNames,
} from '../types/snapshot.js';
import type { runViolationPipeline } from '../services/violation-pipeline.service.js';
import type { AnalyzeCoreResult } from './analyze-core.js';

// ---------------------------------------------------------------------------
// Full analyze — writes analyses/*.json, LATEST.json, history.json; clears diff.json
// ---------------------------------------------------------------------------

export interface PersistFullResult {
  analysisId: string;
  filename: string;
  serviceCount: number;
  fileCount: number;
  architecture: string;
  durationMs: number;
  violationsSummary: { total: number; bySeverity: Record<string, number> };
}

export function persistFullAnalysis(
  project: RegistryEntry,
  core: AnalyzeCoreResult,
  startedAt: number,
): PersistFullResult {
  const filename = buildAnalysisFilename(core.analysisId, core.now);

  const snapshot: AnalysisSnapshot = {
    id: core.analysisId,
    createdAt: core.now,
    branch: core.branch,
    commitHash: core.commitHash,
    architecture: core.architecture,
    status: 'completed',
    metadata: core.metadata,
    graph: core.graph,
    violations: {
      added: core.pipelineResult.added,
      resolved: core.pipelineResult.resolvedRefs,
      previousAnalysisId: core.previousAnalysisId,
    },
    usage: core.usage,
  };

  const latest = buildLatestSnapshot(
    snapshot,
    filename,
    core.pipelineResult.unchanged,
    core.pipelineResult.added,
  );

  const { bySeverity, total } = summarizeActiveViolations(latest.violations);

  writeAnalysis(project.path, snapshot);
  writeLatest(project.path, latest);
  appendHistory(project.path, buildHistoryEntry(snapshot, filename, core.pipelineResult));

  // ADR corpus staleness — cheap, idempotent, writes only when a corpus
  // already exists. Runs after LATEST so the staleness flags reflect the
  // same graph the dashboard is about to read.
  refreshAdrStaleness(project.path, core.graph);

  // Baseline moved — any prior diff is obsolete.
  deleteDiff(project.path);
  setLastAnalyzed(project.slug, core.now);

  return {
    analysisId: core.analysisId,
    filename,
    serviceCount: core.graph.services.length,
    fileCount: core.analysisResult.fileAnalyses?.length ?? 0,
    architecture: core.architecture,
    durationMs: Date.now() - startedAt,
    violationsSummary: { total, bySeverity },
  };
}

// ---------------------------------------------------------------------------
// Diff analyze — writes diff.json
// ---------------------------------------------------------------------------

export interface PersistDiffResult {
  diff: DiffSnapshot;
  isStale: boolean;
}

export function persistDiffAnalysis(
  project: RegistryEntry,
  core: AnalyzeCoreResult,
): PersistDiffResult {
  if (!core.latestBaseline) {
    throw new Error('Diff persist requires a latestBaseline — analyzeCore should have enforced this.');
  }

  const diff = buildDiffSnapshot(project.path, core, core.latestBaseline);

  writeDiff(project.path, diff);
  log.info(
    `[Diff] Done — ${diff.summary.newCount} new, ${diff.summary.unchangedCount} unchanged, ${diff.summary.resolvedCount} resolved across ${diff.changedFiles.length} changed files`,
  );

  return { diff, isStale: false };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLatestSnapshot(
  snapshot: AnalysisSnapshot,
  filename: string,
  unchanged: ViolationRecord[],
  added: ViolationRecord[],
): LatestSnapshot {
  const denormalize = makeDenormalizer(snapshot.graph);
  return {
    head: filename,
    analysis: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      branch: snapshot.branch,
      commitHash: snapshot.commitHash,
      architecture: snapshot.architecture,
      metadata: snapshot.metadata,
      status: 'completed',
    },
    graph: snapshot.graph,
    violations: [...added.map(denormalize), ...unchanged.map(denormalize)],
  };
}

function summarizeActiveViolations(
  violations: ViolationWithNames[],
): { total: number; bySeverity: Record<string, number> } {
  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const v of violations) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    total++;
  }
  return { total, bySeverity };
}

function buildHistoryEntry(
  snapshot: AnalysisSnapshot,
  filename: string,
  pipeline: Awaited<ReturnType<typeof runViolationPipeline>>,
): HistoryEntry {
  const bySeverity: Record<ViolationSeverity, number> = {
    info: 0, low: 0, medium: 0, high: 0, critical: 0,
  };
  for (const v of [...pipeline.added, ...pipeline.unchanged]) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
  }

  const totalTokens = snapshot.usage.reduce((s, u) => s + u.totalTokens, 0);
  const totalDurationMs = snapshot.usage.reduce((s, u) => s + u.durationMs, 0);
  let totalCostSum = 0;
  let anyCost = false;
  for (const u of snapshot.usage) {
    if (u.costUsd) {
      const n = Number(u.costUsd);
      if (!Number.isNaN(n)) { totalCostSum += n; anyCost = true; }
    }
  }
  const provider = snapshot.usage.length > 0 ? snapshot.usage[0].provider : '';

  return {
    id: snapshot.id,
    filename,
    createdAt: snapshot.createdAt,
    branch: snapshot.branch,
    commitHash: snapshot.commitHash,
    metadata: snapshot.metadata,
    counts: {
      services: snapshot.graph.services.length,
      modules: snapshot.graph.modules.length,
      methods: snapshot.graph.methods.length,
      violations: {
        new: pipeline.added.length,
        unchanged: pipeline.unchanged.length,
        resolved: pipeline.resolved.length,
        bySeverity,
      },
    },
    usage: {
      totalTokens,
      totalCostUsd: anyCost ? totalCostSum.toFixed(6) : '0',
      durationMs: totalDurationMs,
      provider,
    },
  };
}

function buildDiffSnapshot(
  repoPath: string,
  core: AnalyzeCoreResult,
  baseline: LatestSnapshot,
): DiffSnapshot {
  const { graph, changedFiles, pipelineResult } = core;
  const denormalize = makeDenormalizer(graph);

  const newViolations = pipelineResult.added.map(denormalize);

  // Resolved rows: hydrate full rows from baseline LATEST using the ids we got back.
  const latestById = new Map(baseline.violations.map((v) => [v.id, v]));
  const resolvedViolations = pipelineResult.resolvedRefs
    .map((r) => latestById.get(r.id))
    .filter((v): v is ViolationWithNames => !!v);

  // Compute affected node IDs as NAME-based keys (the dashboard looks them up
  // by name, not UUID — UUIDs regenerate every analysis). Module filePaths
  // are absolute inside the target repo.
  const changedAbs = new Set(changedFiles.map((c) => path.resolve(repoPath, c.path)));
  const matchesChanged = (p: string | null | undefined) =>
    !!p && (changedAbs.has(p) || changedAbs.has(path.resolve(repoPath, p)));

  const affectedModules = graph.modules.filter((m) => matchesChanged(m.filePath));
  const affectedModuleIdSet = new Set(affectedModules.map((m) => m.id));

  const serviceNameById = new Map(graph.services.map((s) => [s.id, s.name]));
  const layerKeyById = new Map(
    graph.layers.map((l) => [l.id, `${l.serviceName}::${l.layer}`]),
  );

  const affectedServices = new Set<string>();
  const affectedLayers = new Set<string>();
  const affectedModuleKeys = new Set<string>();
  for (const mod of affectedModules) {
    const svcName = serviceNameById.get(mod.serviceId);
    if (svcName) {
      affectedServices.add(svcName);
      affectedModuleKeys.add(`${svcName}::${mod.name}`);
    }
    const layerKey = layerKeyById.get(mod.layerId);
    if (layerKey) affectedLayers.add(layerKey);
  }

  const moduleNameById = new Map(graph.modules.map((m) => [m.id, m.name]));
  const affectedMethodKeys: string[] = [];
  for (const method of graph.methods) {
    if (!affectedModuleIdSet.has(method.moduleId)) continue;
    const modName = moduleNameById.get(method.moduleId);
    const mod = graph.modules.find((m) => m.id === method.moduleId);
    const svcName = mod ? serviceNameById.get(mod.serviceId) : undefined;
    if (svcName && modName) affectedMethodKeys.push(`${svcName}::${modName}::${method.name}`);
  }

  return {
    id: core.analysisId,
    baseAnalysisId: baseline.analysis.id,
    createdAt: core.now,
    branch: core.branch,
    commitHash: core.commitHash,
    graph,
    changedFiles,
    newViolations,
    resolvedViolations,
    affectedNodeIds: {
      services: [...affectedServices],
      layers: [...affectedLayers],
      modules: [...affectedModuleKeys],
      methods: affectedMethodKeys,
    },
    summary: {
      newCount: newViolations.length,
      unchangedCount: pipelineResult.unchanged.length,
      resolvedCount: resolvedViolations.length,
    },
    usage: core.usage,
  };
}

/** Denormalize a violation row against a graph — shared by full and diff. */
function makeDenormalizer(graph: Graph): (v: ViolationRecord) => ViolationWithNames {
  const serviceById = new Map(graph.services.map((s) => [s.id, s.name]));
  const moduleById = new Map(graph.modules.map((m) => [m.id, m.name]));
  const methodById = new Map(graph.methods.map((m) => [m.id, m.name]));
  const databaseById = new Map(graph.databases.map((d) => [d.id, d.name]));
  return (v) => ({
    ...v,
    targetServiceName: v.targetServiceId ? serviceById.get(v.targetServiceId) ?? null : null,
    targetModuleName: v.targetModuleId ? moduleById.get(v.targetModuleId) ?? null : null,
    targetMethodName: v.targetMethodId ? methodById.get(v.targetMethodId) ?? null : null,
    targetDatabaseName: v.targetDatabaseId ? databaseById.get(v.targetDatabaseId) ?? null : null,
  });
}
