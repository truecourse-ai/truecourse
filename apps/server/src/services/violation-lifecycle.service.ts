import { eq, and, inArray, desc, sql, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../config/database.js';
import {
  violations,
  analyses,
  services,
  modules,
  methods,
} from '../db/schema.js';
import type { DiffViolationItem } from './llm/provider.js';

/** SQL filter to exclude diff analyses */
const notDiffAnalysis = sql`(${analyses.metadata}->>'isDiffAnalysis')::boolean IS NOT TRUE`;

// ---------------------------------------------------------------------------
// Active violation types
// ---------------------------------------------------------------------------

export interface ActiveViolation {
  id: string;
  type: string;
  title: string;
  content: string;
  severity: string;
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
  /** Code violation fields (filled when type = 'code') */
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  columnStart: number | null;
  columnEnd: number | null;
  snippet: string | null;
}

/** @deprecated Use ActiveViolation with filePath fields instead */
export type ActiveCodeViolation = ActiveViolation;

// ---------------------------------------------------------------------------
// Load active violations from latest non-diff analysis
// ---------------------------------------------------------------------------

export async function loadActiveViolations(
  repoId: string,
  branch?: string | null,
): Promise<ActiveViolation[]> {
  // Find latest non-diff analysis
  const conditions = [eq(analyses.repoId, repoId), notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  const [latestAnalysis] = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!latestAnalysis) return [];

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
    .where(
      and(
        eq(violations.analysisId, latestAnalysis.id),
        inArray(violations.status, ['new', 'unchanged']),
      ),
    );

  return rows;
}

export async function loadActiveCodeViolations(
  repoId: string,
  branch?: string | null,
): Promise<ActiveViolation[]> {
  const conditions = [eq(analyses.repoId, repoId), notDiffAnalysis];
  if (branch) conditions.push(eq(analyses.branch, branch));

  const [latestAnalysis] = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(1);

  if (!latestAnalysis) return [];

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
    .where(
      and(
        eq(violations.analysisId, latestAnalysis.id),
        inArray(violations.status, ['new', 'unchanged']),
        isNotNull(violations.filePath),
      ),
    );

  return rows;
}

// ---------------------------------------------------------------------------
// Persist violations with lifecycle tracking
// ---------------------------------------------------------------------------

export interface PersistViolationsParams {
  analysisId: string;
  repoId: string;
  newViolations: DiffViolationItem[];
  resolvedViolationIds: string[];
  previousActiveViolations: ActiveViolation[];
  /** Maps for resolving names to DB IDs on new violations */
  serviceNameToId?: Map<string, string>;
  moduleNameToId?: Map<string, string>;
  methodNameToId?: Map<string, string>;
}

export async function persistViolationsWithLifecycle(
  params: PersistViolationsParams,
): Promise<void> {
  const {
    analysisId,
    repoId,
    newViolations,
    resolvedViolationIds,
    previousActiveViolations,
    serviceNameToId,
    moduleNameToId,
    methodNameToId,
  } = params;

  const resolvedSet = new Set(resolvedViolationIds);
  const now = new Date();




  // Build a set of new violation titles to avoid marking a replaced violation as 'unchanged'
  const newTitles = new Set(newViolations.map((v) => v.title.toLowerCase().trim()));

  // Helper: remap target IDs from previous analysis to current analysis using name maps
  function remapTargetIds(prev: ActiveViolation) {
    return {
      targetServiceId: prev.targetServiceName && serviceNameToId
        ? (serviceNameToId.get(prev.targetServiceName) ?? null)
        : null,
      targetDatabaseId: null, // databases get new IDs each analysis; cleared for carried-forward violations
      targetModuleId: prev.targetModuleName && moduleNameToId
        ? (moduleNameToId.get(prev.targetModuleName) ?? null)
        : null,
      targetMethodId: prev.targetMethodName && methodNameToId
        ? (methodNameToId.get(prev.targetMethodName) ?? null)
        : null,
    };
  }

  // Process previous active violations
  for (const prev of previousActiveViolations) {
    const remapped = remapTargetIds(prev);
    if (resolvedSet.has(prev.id)) {
      // Resolved
      await db.insert(violations).values({
        id: randomUUID(),
        repoId,
        analysisId,
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
        fixPrompt: prev.fixPrompt,
        ruleKey: prev.ruleKey,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
        resolvedAt: now,
      });
    } else if (!newTitles.has(prev.title.toLowerCase().trim())) {
      // Unchanged — carry forward
      await db.insert(violations).values({
        id: randomUUID(),
        repoId,
        analysisId,
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
        fixPrompt: prev.fixPrompt,
        ruleKey: prev.ruleKey,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
      });
    }
    // If the title matches a new violation, skip (it's being replaced by the new one)
  }

  // Insert new violations
  for (const v of newViolations) {
    // Resolve IDs from names if maps provided
    let targetServiceId = v.targetServiceId;
    let targetModuleId = v.targetModuleId;
    let targetMethodId = v.targetMethodId;

    if (!targetServiceId && v.targetServiceName && serviceNameToId) {
      targetServiceId = serviceNameToId.get(v.targetServiceName) ?? null;
    }
    if (!targetModuleId && v.targetModuleName && moduleNameToId) {
      targetModuleId = moduleNameToId.get(v.targetModuleName) ?? null;
    }
    if (!targetMethodId && v.targetMethodName && methodNameToId) {
      targetMethodId = methodNameToId.get(v.targetMethodName) ?? null;
    }

    await db.insert(violations).values({
      id: randomUUID(),
      repoId,
      analysisId,
      type: v.type,
      title: v.title,
      content: v.content,
      severity: v.severity,
      status: 'new',
      targetServiceId,
      targetModuleId,
      targetMethodId,
      fixPrompt: v.fixPrompt,
      ruleKey: v.ruleKey,
      firstSeenAnalysisId: analysisId,
      firstSeenAt: now,
    });
  }
}

// ---------------------------------------------------------------------------
// Persist file-level violations with lifecycle (deterministic matching by ruleKey + filePath)
// ---------------------------------------------------------------------------

export interface PersistFileViolationsParams {
  analysisId: string;
  repoId: string;
  currentViolations: {
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
  }[];
  previousViolations: ActiveViolation[];
}

export async function persistFileViolationsWithLifecycle(
  params: PersistFileViolationsParams,
): Promise<void> {
  const { analysisId, repoId, currentViolations, previousViolations } = params;
  const now = new Date();

  // Build lookup key: ruleKey + filePath
  const currentKeys = new Set(
    currentViolations.map((v) => `${v.ruleKey}::${v.filePath}`),
  );
  const previousByKey = new Map<string, ActiveViolation>();
  for (const prev of previousViolations) {
    if (prev.filePath) {
      previousByKey.set(`${prev.ruleKey}::${prev.filePath}`, prev);
    }
  }

  // Previous file-level violations not in current → resolved
  for (const prev of previousViolations) {
    if (!prev.filePath) continue;
    const key = `${prev.ruleKey}::${prev.filePath}`;
    if (!currentKeys.has(key)) {
      await db.insert(violations).values({
        id: randomUUID(),
        repoId,
        analysisId,
        type: 'code',
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
        status: 'resolved',
        ruleKey: prev.ruleKey,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        snippet: prev.snippet,
        fixPrompt: prev.fixPrompt,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
        resolvedAt: now,
      });
    }
  }

  // Current file-level violations
  for (const cv of currentViolations) {
    const key = `${cv.ruleKey}::${cv.filePath}`;
    const prev = previousByKey.get(key);

    if (prev) {
      // Unchanged — carry lineage
      await db.insert(violations).values({
        id: randomUUID(),
        repoId,
        analysisId,
        type: 'code',
        title: cv.title,
        content: cv.content,
        severity: cv.severity,
        status: 'unchanged',
        ruleKey: cv.ruleKey,
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        lineEnd: cv.lineEnd,
        columnStart: cv.columnStart,
        columnEnd: cv.columnEnd,
        snippet: cv.snippet,
        fixPrompt: cv.fixPrompt || null,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousViolationId: prev.id,
      });
    } else {
      // New
      await db.insert(violations).values({
        id: randomUUID(),
        repoId,
        analysisId,
        type: 'code',
        title: cv.title,
        content: cv.content,
        severity: cv.severity,
        status: 'new',
        ruleKey: cv.ruleKey,
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        lineEnd: cv.lineEnd,
        columnStart: cv.columnStart,
        columnEnd: cv.columnEnd,
        snippet: cv.snippet,
        fixPrompt: cv.fixPrompt || null,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
      });
    }
  }
}
