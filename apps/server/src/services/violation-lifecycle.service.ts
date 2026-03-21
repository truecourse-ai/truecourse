import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database.js';
import {
  violations,
  codeViolations,
  analyses,
  services,
  modules,
  methods,
  databases,
} from '../db/schema.js';
import type { DiffViolationItem } from './llm/provider.js';
import type { Violation } from '@truecourse/shared';

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
  deterministicViolationId: string | null;
  firstSeenAnalysisId: string | null;
  firstSeenAt: Date | null;
}

export interface ActiveCodeViolation {
  id: string;
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
  fixPrompt: string | null;
  firstSeenAnalysisId: string | null;
  firstSeenAt: Date | null;
}

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
      deterministicViolationId: violations.deterministicViolationId,
      firstSeenAnalysisId: violations.firstSeenAnalysisId,
      firstSeenAt: violations.firstSeenAt,
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
): Promise<ActiveCodeViolation[]> {
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
    .select()
    .from(codeViolations)
    .where(
      and(
        eq(codeViolations.analysisId, latestAnalysis.id),
        inArray(codeViolations.status, ['new', 'unchanged']),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    filePath: r.filePath,
    lineStart: r.lineStart,
    lineEnd: r.lineEnd,
    columnStart: r.columnStart,
    columnEnd: r.columnEnd,
    ruleKey: r.ruleKey,
    severity: r.severity,
    title: r.title,
    content: r.content,
    snippet: r.snippet,
    fixPrompt: r.fixPrompt,
    firstSeenAnalysisId: r.firstSeenAnalysisId,
    firstSeenAt: r.firstSeenAt,
  }));
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
        id: uuidv4(),
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
        id: uuidv4(),
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
      id: uuidv4(),
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
// Persist code violations with lifecycle (deterministic matching by ruleKey + filePath)
// ---------------------------------------------------------------------------

export interface PersistCodeViolationsParams {
  analysisId: string;
  currentCodeViolations: {
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
  previousActiveCodeViolations: ActiveCodeViolation[];
}

export async function persistCodeViolationsWithLifecycle(
  params: PersistCodeViolationsParams,
): Promise<void> {
  const { analysisId, currentCodeViolations, previousActiveCodeViolations } = params;
  const now = new Date();

  // Build lookup key: ruleKey + filePath
  const currentKeys = new Set(
    currentCodeViolations.map((v) => `${v.ruleKey}::${v.filePath}`),
  );
  const previousByKey = new Map<string, ActiveCodeViolation>();
  for (const prev of previousActiveCodeViolations) {
    previousByKey.set(`${prev.ruleKey}::${prev.filePath}`, prev);
  }

  // Previous code violations not in current → resolved
  for (const prev of previousActiveCodeViolations) {
    const key = `${prev.ruleKey}::${prev.filePath}`;
    if (!currentKeys.has(key)) {
      await db.insert(codeViolations).values({
        id: uuidv4(),
        analysisId,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey,
        severity: prev.severity,
        status: 'resolved',
        title: prev.title,
        content: prev.content,
        snippet: prev.snippet,
        fixPrompt: prev.fixPrompt,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousCodeViolationId: prev.id,
        resolvedAt: now,
      });
    }
  }

  // Current code violations
  for (const cv of currentCodeViolations) {
    const key = `${cv.ruleKey}::${cv.filePath}`;
    const prev = previousByKey.get(key);

    if (prev) {
      // Unchanged — carry lineage
      await db.insert(codeViolations).values({
        id: uuidv4(),
        analysisId,
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        lineEnd: cv.lineEnd,
        columnStart: cv.columnStart,
        columnEnd: cv.columnEnd,
        ruleKey: cv.ruleKey,
        severity: cv.severity,
        status: 'unchanged',
        title: cv.title,
        content: cv.content,
        snippet: cv.snippet,
        fixPrompt: cv.fixPrompt || null,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousCodeViolationId: prev.id,
      });
    } else {
      // New
      await db.insert(codeViolations).values({
        id: uuidv4(),
        analysisId,
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        lineEnd: cv.lineEnd,
        columnStart: cv.columnStart,
        columnEnd: cv.columnEnd,
        ruleKey: cv.ruleKey,
        severity: cv.severity,
        status: 'new',
        title: cv.title,
        content: cv.content,
        snippet: cv.snippet,
        fixPrompt: cv.fixPrompt || null,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
      });
    }
  }
}
