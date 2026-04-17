import { randomUUID } from 'node:crypto';
import type { DiffViolationItem } from './llm/provider.js';
import type {
  ResolvedViolationRef,
  ViolationRecord,
  ViolationWithNames,
} from '../types/snapshot.js';

/**
 * Lifecycle computation for violations — pure functions.
 *
 * Takes the current run's detected violations + the prior LATEST's active
 * violations, returns `{added, unchanged, resolved}` ViolationRecord[]
 * arrays stamped with the correct lifecycle fields (status, firstSeenAt,
 * firstSeenAnalysisId, previousViolationId, resolvedAt).
 *
 * The orchestrator assembles these into `AnalysisSnapshot.violations`
 * (added + resolved) and `LatestSnapshot.violations` (added + unchanged).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * An active violation loaded from the previous LATEST snapshot. Target names
 * are already denormalized (that's how LATEST stores them).
 */
export type ActiveViolation = ViolationWithNames;

export interface LifecycleResult {
  added: ViolationRecord[];           // status='new'
  unchanged: ViolationRecord[];       // status='unchanged', carried forward
  resolved: ViolationRecord[];        // status='resolved' (full rows, for per-analysis file)
  resolvedRefs: ResolvedViolationRef[]; // {id, resolvedAt} only — stored in delta
  counts: { newCount: number; unchangedCount: number; resolvedCount: number };
}

// ---------------------------------------------------------------------------
// File-level violation lifecycle (deterministic match by ruleKey + filePath)
// ---------------------------------------------------------------------------

export interface FileViolationInput {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  columnStart: number;
  columnEnd: number;
  ruleKey: string;
  severity: string;
  title: string;
  content: string;
  snippet: string;
  fixPrompt?: string;
  /**
   * Optional graph-node links. Set when the code violation could be resolved
   * to a service/module in the architecture graph (e.g. `architecture/*` rule
   * firing in a file that belongs to a known module).
   */
  targetServiceId?: string | null;
  targetModuleId?: string | null;
  /** Denormalized names for LATEST.violations (resolved in the orchestrator). */
  targetServiceName?: string | null;
  targetModuleName?: string | null;
}

export interface FileLifecycleParams {
  analysisId: string;
  now: string;                         // ISO timestamp
  currentViolations: FileViolationInput[];
  previousViolations: ActiveViolation[];
}

export function computeFileViolationLifecycle(
  params: FileLifecycleParams,
): LifecycleResult {
  const { analysisId, now, currentViolations, previousViolations } = params;
  const added: ViolationRecord[] = [];
  const unchanged: ViolationRecord[] = [];
  const resolved: ViolationRecord[] = [];
  const resolvedRefs: ResolvedViolationRef[] = [];

  const currentKeys = new Set(currentViolations.map((v) => `${v.ruleKey}::${v.filePath}`));
  const previousByKey = new Map<string, ActiveViolation>();
  for (const prev of previousViolations) {
    if (prev.filePath) previousByKey.set(`${prev.ruleKey}::${prev.filePath}`, prev);
  }

  // Previous file-level violations not in current → resolved
  for (const prev of previousViolations) {
    if (!prev.filePath) continue;
    const key = `${prev.ruleKey}::${prev.filePath}`;
    if (!currentKeys.has(key)) {
      const row: ViolationRecord = {
        id: randomUUID(),
        type: 'code',
        title: prev.title,
        content: prev.content,
        severity: prev.severity as ViolationRecord['severity'],
        status: 'resolved',
        targetServiceId: null,
        targetDatabaseId: null,
        targetModuleId: null,
        targetMethodId: null,
        targetTable: null,
        relatedServiceId: null,
        relatedModuleId: null,
        fixPrompt: prev.fixPrompt,
        ruleKey: prev.ruleKey,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
        resolvedAt: now,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        snippet: prev.snippet,
        createdAt: now,
      };
      resolved.push(row);
      resolvedRefs.push({ id: prev.id, resolvedAt: now });
    }
  }

  // Current file-level violations
  for (const cv of currentViolations) {
    const key = `${cv.ruleKey}::${cv.filePath}`;
    const prev = previousByKey.get(key);

    const base: ViolationRecord = {
      id: randomUUID(),
      type: 'code',
      title: cv.title,
      content: cv.content,
      severity: cv.severity as ViolationRecord['severity'],
      status: prev ? 'unchanged' : 'new',
      targetServiceId: cv.targetServiceId ?? null,
      targetDatabaseId: null,
      targetModuleId: cv.targetModuleId ?? null,
      targetMethodId: null,
      targetTable: null,
      relatedServiceId: null,
      relatedModuleId: null,
      fixPrompt: cv.fixPrompt ?? null,
      ruleKey: cv.ruleKey,
      firstSeenAnalysisId: prev ? prev.firstSeenAnalysisId : analysisId,
      firstSeenAt: prev ? prev.firstSeenAt : now,
      previousViolationId: prev ? prev.id : null,
      resolvedAt: null,
      filePath: cv.filePath,
      lineStart: cv.lineStart,
      lineEnd: cv.lineEnd,
      columnStart: cv.columnStart,
      columnEnd: cv.columnEnd,
      snippet: cv.snippet,
      createdAt: now,
    };

    if (prev) unchanged.push(base);
    else added.push(base);
  }

  return {
    added,
    unchanged,
    resolved,
    resolvedRefs,
    counts: {
      newCount: added.length,
      unchangedCount: unchanged.length,
      resolvedCount: resolved.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Architecture / module / service violation lifecycle (LLM-style)
// ---------------------------------------------------------------------------

export interface ViolationLifecycleParams {
  analysisId: string;
  now: string;                         // ISO timestamp
  newViolations: DiffViolationItem[];
  resolvedViolationIds: string[];
  previousActiveViolations: ActiveViolation[];
  /** Maps for resolving names to IDs on new violations (targets in current graph) */
  serviceNameToId?: Map<string, string>;
  moduleNameToId?: Map<string, string>;
  methodNameToId?: Map<string, string>;
}

export function computeViolationLifecycle(
  params: ViolationLifecycleParams,
): LifecycleResult {
  const {
    analysisId,
    now,
    newViolations,
    resolvedViolationIds,
    previousActiveViolations,
    serviceNameToId,
    moduleNameToId,
    methodNameToId,
  } = params;

  const resolvedSet = new Set(resolvedViolationIds);
  const added: ViolationRecord[] = [];
  const unchanged: ViolationRecord[] = [];
  const resolved: ViolationRecord[] = [];
  const resolvedRefs: ResolvedViolationRef[] = [];

  // If a new violation has the same title as a previous one, treat the
  // previous as replaced (drop it from the carried-forward set).
  const newTitles = new Set(newViolations.map((v) => v.title.toLowerCase().trim()));

  // Carry forward or resolve previous violations
  for (const prev of previousActiveViolations) {
    const remapped = {
      targetServiceId:
        prev.targetServiceName && serviceNameToId
          ? serviceNameToId.get(prev.targetServiceName) ?? null
          : null,
      targetDatabaseId: null,            // databases get new IDs each run
      targetModuleId:
        prev.targetModuleName && moduleNameToId
          ? moduleNameToId.get(prev.targetModuleName) ?? null
          : null,
      targetMethodId:
        prev.targetMethodName && methodNameToId
          ? methodNameToId.get(prev.targetMethodName) ?? null
          : null,
    };

    if (resolvedSet.has(prev.id)) {
      resolved.push({
        id: randomUUID(),
        type: prev.type,
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
        status: 'resolved',
        targetServiceId: remapped.targetServiceId,
        targetDatabaseId: remapped.targetDatabaseId,
        targetModuleId: remapped.targetModuleId,
        targetMethodId: remapped.targetMethodId,
        targetTable: prev.targetTable,
        relatedServiceId: null,
        relatedModuleId: null,
        fixPrompt: prev.fixPrompt,
        ruleKey: prev.ruleKey,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
        resolvedAt: now,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        snippet: prev.snippet,
        createdAt: now,
      });
      resolvedRefs.push({ id: prev.id, resolvedAt: now });
    } else if (!newTitles.has(prev.title.toLowerCase().trim())) {
      unchanged.push({
        id: randomUUID(),
        type: prev.type,
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
        status: 'unchanged',
        targetServiceId: remapped.targetServiceId,
        targetDatabaseId: remapped.targetDatabaseId,
        targetModuleId: remapped.targetModuleId,
        targetMethodId: remapped.targetMethodId,
        targetTable: prev.targetTable,
        relatedServiceId: null,
        relatedModuleId: null,
        fixPrompt: prev.fixPrompt,
        ruleKey: prev.ruleKey,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
        resolvedAt: null,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        snippet: prev.snippet,
        createdAt: now,
      });
    }
  }

  // New violations this run
  for (const v of newViolations) {
    let targetServiceId = v.targetServiceId ?? null;
    let targetModuleId = v.targetModuleId ?? null;
    let targetMethodId = v.targetMethodId ?? null;

    if (!targetServiceId && v.targetServiceName && serviceNameToId) {
      targetServiceId = serviceNameToId.get(v.targetServiceName) ?? null;
    }
    if (!targetModuleId && v.targetModuleName && moduleNameToId) {
      targetModuleId = moduleNameToId.get(v.targetModuleName) ?? null;
    }
    if (!targetMethodId && v.targetMethodName && methodNameToId) {
      targetMethodId = methodNameToId.get(v.targetMethodName) ?? null;
    }

    added.push({
      id: randomUUID(),
      type: v.type,
      title: v.title,
      content: v.content,
      severity: v.severity as ViolationRecord['severity'],
      status: 'new',
      targetServiceId,
      targetDatabaseId: null,
      targetModuleId,
      targetMethodId,
      targetTable: null,
      relatedServiceId: null,
      relatedModuleId: null,
      fixPrompt: v.fixPrompt ?? null,
      ruleKey: v.ruleKey,
      firstSeenAnalysisId: analysisId,
      firstSeenAt: now,
      previousViolationId: null,
      resolvedAt: null,
      filePath: null,
      lineStart: null,
      lineEnd: null,
      columnStart: null,
      columnEnd: null,
      snippet: null,
      createdAt: now,
    });
  }

  return {
    added,
    unchanged,
    resolved,
    resolvedRefs,
    counts: {
      newCount: added.length,
      unchangedCount: unchanged.length,
      resolvedCount: resolved.length,
    },
  };
}
