import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../config/database.js';
import {
  services,
  deterministicViolations,
  violations,
  codeViolations,
} from '../db/schema.js';
import { checkCodeRules, parseFile, detectLanguage, buildScopedCompilerOptions, createTypeQueryService, hasTypeAwareVisitors, type TypeQueryService } from '@truecourse/analyzer';
import type { CodeViolation } from '@truecourse/shared';
import type { ModuleViolation, ServiceViolation } from '@truecourse/analyzer';
import { runDeterministicModuleChecks, runDeterministicMethodChecks, runDeterministicServiceChecks, type AnalysisResult } from './analyzer.service.js';
import { DOMAIN_ORDER, DOMAIN_LABELS, LLM_DOMAINS } from '../socket/handlers.js';
import { getEnabledRules } from './rules.service.js';
import { createLLMProvider, type LLMProvider, type CodeViolationContext, type CodeViolationsResult, type CodeViolationRaw, type DiffViolationItem } from './llm/provider.js';
import { routeContext, estimateContext } from './llm/context-router.js';
import { generateViolations, generateViolationsWithLifecycle } from './violation.service.js';
import {
  persistViolationsWithLifecycle,
  persistCodeViolationsWithLifecycle,
} from './violation-lifecycle.service.js';

// Clear spinner line before logging so messages don't collide with clack spinner
function log(msg: string) {
  process.stderr.write(`${msg}\n`);
}

/** Throw if the abort signal has been triggered. */
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViolationPipelineInput {
  repoId: string;
  repoPath: string;
  analysisId: string;
  result: AnalysisResult;
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  dbIdMap: Map<string, string>;
  /** Previous active violations for lifecycle tracking */
  previousActiveViolations: {
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
  }[];
  /** Previous active code violations for lifecycle tracking */
  previousActiveCodeViolations: {
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
  }[];
  /** Previous deterministic violations for lifecycle comparison */
  previousDeterministicViolations: {
    id: string;
    ruleKey: string;
    category: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    moduleName: string | null;
    methodName: string | null;
  }[];
  /** If set, only run code rules on these files (for diff mode performance) */
  changedFileSet?: Set<string>;
  /** Progress callback (legacy — prefer tracker) */
  onProgress?: (progress: { step: string; percent: number; detail?: string }) => void;
  /** Step tracker for checklist UI */
  tracker?: import('../socket/handlers.js').StepTracker;
  /** Rule categories to include (undefined = all) */
  enabledCategories?: string[];
  /** Enable LLM-powered rules (default true) */
  enableLlmRules?: boolean;
  /** Optional pre-created provider (for usage tracking) */
  provider?: LLMProvider;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface ViolationPipelineResult {
  serviceDescriptions: { id: string; description: string }[];
  /** For diff mode: new violations from LLM + enriched deterministic */
  newViolations?: DiffViolationItem[];
  /** For diff mode: resolved violation IDs */
  resolvedViolationIds?: string[];
  /** All new code violations (deterministic + LLM) */
  codeViolations: CodeViolation[];
  /** Number of resolved code violations (for badge counts) */
  codeResolvedCount: number;
}

// ---------------------------------------------------------------------------
// Deterministic comparison
// ---------------------------------------------------------------------------

function getDetComparisonKey(v: { ruleKey: string; serviceName: string; title: string; moduleName?: string | null; methodName?: string | null }): string {
  return `${v.ruleKey}::${v.serviceName}::${v.moduleName || ''}::${v.methodName || ''}::${v.title}`;
}

export function compareDeterministicViolations<
  T extends { ruleKey: string; serviceName: string; title: string; moduleName?: string | null; methodName?: string | null },
  P extends { ruleKey: string; serviceName: string; title: string; moduleName?: string | null; methodName?: string | null },
>(
  current: T[],
  previous: P[],
): {
  newDetections: T[];
  unchangedDetections: { current: T; previous: P }[];
  resolvedDetections: P[];
} {
  const currentByKey = new Map<string, T>();
  for (const v of current) currentByKey.set(getDetComparisonKey(v), v);

  const previousByKey = new Map<string, P>();
  for (const v of previous) previousByKey.set(getDetComparisonKey(v), v);

  const newDetections: T[] = [];
  const unchangedDetections: { current: T; previous: P }[] = [];
  const resolvedDetections: P[] = [];

  for (const [key, cur] of currentByKey) {
    const prev = previousByKey.get(key);
    if (prev) {
      unchangedDetections.push({ current: cur, previous: prev });
    } else {
      newDetections.push(cur);
    }
  }

  for (const [key, prev] of previousByKey) {
    if (!currentByKey.has(key)) {
      resolvedDetections.push(prev);
    }
  }

  return { newDetections, unchangedDetections, resolvedDetections };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Shared violation pipeline used by both normal and diff analysis routes.
 * Two separate flows:
 * 1. Deterministic: code-handled lifecycle (compare programmatically, enrich new only)
 * 2. LLM rules: LLM-handled lifecycle (only LLM-discovered previous violations)
 */
export async function runViolationPipeline(input: ViolationPipelineInput): Promise<ViolationPipelineResult> {
  const {
    repoId, repoPath, analysisId, result,
    serviceIdMap, moduleIdMap, methodIdMap, dbIdMap,
    previousActiveViolations, previousActiveCodeViolations, previousDeterministicViolations,
    changedFileSet, onProgress, tracker,
    provider: externalProvider,
    enabledCategories,
    enableLlmRules,
    signal,
  } = input;

  // 1. Load rules (filter to enabled categories/domains, and filter out LLM rules if disabled)
  const allRules = (await getEnabledRules())
    .filter((r) => !enabledCategories || enabledCategories.includes(r.domain ?? r.category))
    .filter((r) => enableLlmRules !== false || r.type !== 'llm');

  throwIfAborted(signal);
  onProgress?.({ step: 'analyzing', percent: 80, detail: 'Running deterministic checks...' });

  // 2. Run deterministic checks per domain with individual tracker steps
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const serviceViolationResults: ServiceViolation[] = [];
  const moduleViolationResults: ModuleViolation[] = [];
  const methodViolationResults: ModuleViolation[] = [];

  for (const domain of DOMAIN_ORDER) {
    const stepKey = `${domain}`;
    const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
    if (domainRules.length === 0) {
      tracker?.done(stepKey); // skip silently
      continue;
    }

    tracker?.start(stepKey);

    if (domain === 'architecture') {
      serviceViolationResults.push(...runDeterministicServiceChecks(result, domainRules));
      moduleViolationResults.push(...runDeterministicModuleChecks(result, domainRules));
      methodViolationResults.push(...runDeterministicMethodChecks(result, domainRules));
      const archCount = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
      tracker?.done(stepKey, archCount > 0 ? `${archCount} violations` : 'Clean');
    } else {
      // Non-architecture domains: their code-level checks run in the file scanning loop below.
      // We'll mark them done after the scan completes.
    }
  }

  // 3. Persist deterministic violations to deterministic_violations table
  const detViolationIdMap = new Map<string, string>();
  for (const v of serviceViolationResults) {
    const [row] = await db.insert(deterministicViolations).values({
      analysisId,
      ruleKey: v.ruleKey,
      category: 'service',
      title: v.title,
      description: v.description,
      severity: v.severity,
      serviceName: v.serviceName,
      relatedServiceName: v.relatedServiceName || null,
      isDependencyViolation: v.relatedServiceName != null,
    }).returning({ id: deterministicViolations.id });
    detViolationIdMap.set(`service::${v.ruleKey}::${v.serviceName}::${v.title}`, row.id);
  }
  for (const v of [...moduleViolationResults, ...methodViolationResults]) {
    const category = v.methodName ? 'method' : 'module';
    const [row] = await db.insert(deterministicViolations).values({
      analysisId,
      ruleKey: v.ruleKey,
      category,
      title: v.title,
      description: v.description,
      severity: v.severity,
      serviceName: v.serviceName,
      moduleName: v.moduleName || null,
      methodName: v.methodName || null,
      filePath: v.filePath || null,
      relatedModuleName: v.relatedModuleName || null,
      isDependencyViolation: v.relatedModuleName != null,
    }).returning({ id: deterministicViolations.id });
    detViolationIdMap.set(`${category}::${v.ruleKey}::${v.serviceName}::${v.title}`, row.id);
  }

  // 4. Run code-level rules and collect file contents for LLM code rules
  const codeDomains = new Set(['security', 'bugs', 'code-quality'])
  // Include security/bugs/code-quality rules, plus architecture rules that operate at the
  // code/file level (category === 'code') — those are AST-visitor rules that produce
  // CodeViolation objects and will be converted to ModuleViolations below.
  const enabledCodeRules = allRules.filter((r) => (r.domain ? (codeDomains.has(r.domain) || (r.domain === 'architecture' && r.category === 'code')) : r.category === 'code') && r.type === 'deterministic');
  const enabledLlmCodeRules = enableLlmRules !== false
    ? allRules.filter((r) => (r.domain ? codeDomains.has(r.domain) : r.category === 'code') && r.type === 'llm' && r.prompt)
    : [];
  let allCodeViolations: CodeViolation[] = [];
  const fileContents: Map<string, { content: string; lineCount: number }> = new Map();

  // Determine which files to scan
  const filesToScan = changedFileSet
    ? [...changedFileSet].map((relPath) => ({ filePath: relPath, resolve: true }))
    : (result.fileAnalyses || []).map((fa) => ({ filePath: fa.filePath, resolve: !path.isAbsolute(fa.filePath) }));

  if ((enabledCodeRules.length > 0 || enabledLlmCodeRules.length > 0) && filesToScan.length > 0) {
    // Start code-level domain steps (they'll be completed after the scan loop)
    for (const domain of DOMAIN_ORDER) {
      if (domain === 'architecture') continue;
      const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
      if (domainRules.length > 0) {
        tracker?.start(`${domain}`);
      }
    }
    onProgress?.({ step: 'analyzing', percent: 82, detail: 'Running code checks...' });

    // Build TypeQueryService once if any enabled visitors need type information
    let typeQuery: TypeQueryService | undefined;
    const enabledCodeKeys = new Set(enabledCodeRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key));
    if (hasTypeAwareVisitors(enabledCodeKeys)) {
      const tsFiles = filesToScan
        .filter(({ filePath: fp }) => /\.(ts|tsx|js|jsx)$/.test(fp))
        .map(({ filePath: fp, resolve: res }) =>
          res ? path.resolve(repoPath, fp) : (path.isAbsolute(fp) ? fp : path.join(repoPath, fp)),
        );
      if (tsFiles.length > 0) {
        const scoped = buildScopedCompilerOptions(repoPath);
        typeQuery = createTypeQueryService(tsFiles, scoped);
      }
    }

    for (const { filePath, resolve } of filesToScan) {
      try {
        const lang = detectLanguage(filePath);
        if (!lang) continue;
        const absPath = resolve ? path.resolve(repoPath, filePath) : (path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath));
        if (!fs.existsSync(absPath)) continue;
        const content = fs.readFileSync(absPath, 'utf-8');
        const lineCount = content.split('\n').length;
        fileContents.set(changedFileSet ? absPath : filePath, { content, lineCount });

        if (enabledCodeRules.length > 0) {
          const scanPath = changedFileSet ? filePath : filePath;
          const tree = parseFile(scanPath, content, lang);
          const codeRuleViolations = checkCodeRules(tree, changedFileSet ? absPath : filePath, content, enabledCodeRules, lang, typeQuery);
          allCodeViolations.push(...codeRuleViolations);
        }
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  // Check pyproject.toml if the rule is enabled
  if (enabledCodeRules.some(r => r.key === 'bugs/deterministic/invalid-pyproject-toml')) {
    const pyprojectPath = path.join(repoPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      try {
        const { checkPyprojectToml } = await import('@truecourse/analyzer');
        const content = fs.readFileSync(pyprojectPath, 'utf-8');
        const tomlViolations = checkPyprojectToml(pyprojectPath, content);
        allCodeViolations.push(...tomlViolations);
      } catch {
        // smol-toml not available or import failed — skip
      }
    }
  }

  throwIfAborted(signal);

  // Convert architecture-domain code violations into ModuleViolation format so they
  // get persisted to the violations table with targetServiceId/targetModuleId context.
  const archCodeViolations = allCodeViolations.filter((v) => v.ruleKey.startsWith('architecture/'));
  if (archCodeViolations.length > 0) {
    const convertedArchViolations: ModuleViolation[] = [];
    for (const cv of archCodeViolations) {
      const module = result.modules?.find(
        (m) => cv.filePath.endsWith(m.filePath) || m.filePath.endsWith(cv.filePath),
      );
      if (module) {
        convertedArchViolations.push({
          ruleKey: cv.ruleKey,
          title: cv.title,
          description: cv.content,
          severity: cv.severity,
          serviceName: module.serviceName,
          moduleName: module.name,
          filePath: cv.filePath,
        });
      }
    }

    // Persist converted arch violations to deterministic_violations (step 3 ran before the scan).
    for (const v of convertedArchViolations) {
      const [row] = await db.insert(deterministicViolations).values({
        analysisId,
        ruleKey: v.ruleKey,
        category: 'module',
        title: v.title,
        description: v.description,
        severity: v.severity,
        serviceName: v.serviceName,
        moduleName: v.moduleName || null,
        filePath: v.filePath || null,
      }).returning({ id: deterministicViolations.id });
      detViolationIdMap.set(`module::${v.ruleKey}::${v.serviceName}::${v.title}`, row.id);
    }

    // Add to moduleViolationResults so they flow into allDetEntries with proper target IDs.
    moduleViolationResults.push(...convertedArchViolations);

    // Remove arch violations from code violations — they now flow through the
    // deterministic_violations → violations path with proper target IDs.
    allCodeViolations = allCodeViolations.filter((v) => !v.ruleKey.startsWith('architecture/'));
  }

  // Mark non-architecture domain steps done with per-domain violation counts
  const codeViolationsByDomain = new Map<string, number>();
  for (const v of allCodeViolations) {
    const domain = v.ruleKey.split('/')[0];
    codeViolationsByDomain.set(domain, (codeViolationsByDomain.get(domain) ?? 0) + 1);
  }

  for (const domain of DOMAIN_ORDER) {
    if (domain === 'architecture') continue; // already done above
    const stepKey = `${domain}`;
    const count = codeViolationsByDomain.get(domain) ?? 0;
    tracker?.done(stepKey, count > 0 ? `${count} violations` : 'Clean');
  }

  const totalDetections = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
  onProgress?.({ step: 'analyzing', percent: 84, detail: 'Code checks done' });

  // 5. Build LLM code violation batches using context-routed approach
  const llmCodeBatches: CodeViolationContext[] = [];

  // Build a lookup of previous LLM code violations by file path
  const prevLlmCodeByFile = new Map<string, typeof previousActiveCodeViolations>();
  for (const cv of previousActiveCodeViolations) {
    // Only include LLM-generated code violations (not deterministic ones)
    if (!cv.ruleKey.includes('/llm/')) continue;
    if (!prevLlmCodeByFile.has(cv.filePath)) prevLlmCodeByFile.set(cv.filePath, []);
    prevLlmCodeByFile.get(cv.filePath)!.push(cv);
  }

  if (enabledLlmCodeRules.length > 0 && fileContents.size > 0) {
    // Pre-flight estimation
    const estimate = estimateContext(enabledLlmCodeRules, result.fileAnalyses || [], fileContents);
    log(`[LLM] Pre-flight: ${estimate.totalEstimatedTokens} estimated tokens across ${estimate.tiers.length} tiers`);
    for (const t of estimate.tiers) {
      log(`[LLM]   ${t.tier}: ${t.ruleCount} rules × ${t.fileCount} files${t.functionCount ? ` (${t.functionCount} functions)` : ''} → ~${t.estimatedTokens} tokens`);
    }

    // Build context-routed batches
    const contextBatches = routeContext(enabledLlmCodeRules, result.fileAnalyses || [], fileContents);

    // Convert ContextBatch format to CodeViolationContext format for the provider
    for (const batch of contextBatches) {
      // Collect previous violations for all files referenced in this batch content
      const existing = [...prevLlmCodeByFile.entries()]
        .filter(([fp]) => batch.content.includes(fp))
        .flatMap(([, violations]) => violations);

      llmCodeBatches.push({
        files: [{ path: 'context', content: batch.content }],
        llmRules: batch.rules,
        tier: batch.tier,
        existingViolations: existing.length > 0 ? existing : undefined,
      });
    }

    log(`[LLM] Context router produced ${llmCodeBatches.length} batch(es) from ${contextBatches.length} context group(s)`);
  }

  const validFilePaths = new Set(fileContents.keys());

  // =========================================================================
  // 6. FLOW 1: Deterministic enrichment (code-handled lifecycle)
  // =========================================================================

  // Monotonic progress: parallel tasks can finish in any order, so we
  // track the highest percent emitted and never go backwards.
  let highWaterMark = 84;
  const emitProgress = (percent: number, detail: string) => {
    const prev = highWaterMark;
    if (percent > highWaterMark) highWaterMark = percent;
    const emitted = highWaterMark;
    onProgress?.({ step: 'analyzing', percent: emitted, detail });
  };

  throwIfAborted(signal);
  emitProgress(85, 'Enriching & analyzing violations...');

  // Build flat list of all current deterministic violations with resolved target IDs
  interface DetEntry {
    ruleKey: string;
    category: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    moduleName?: string;
    methodName?: string;
    detViolationId: string;
    targetServiceId: string | null;
    targetModuleId: string | null;
    targetMethodId: string | null;
    violationType: string; // 'service' | 'module' | 'function'
  }

  const allDetEntries: DetEntry[] = [];
  for (const v of serviceViolationResults) {
    const detKey = `service::${v.ruleKey}::${v.serviceName}::${v.title}`;
    allDetEntries.push({
      ruleKey: v.ruleKey, category: 'service', title: v.title, description: v.description,
      severity: v.severity, serviceName: v.serviceName,
      detViolationId: detViolationIdMap.get(detKey)!,
      targetServiceId: serviceIdMap.get(v.serviceName) || null,
      targetModuleId: null, targetMethodId: null,
      violationType: 'service',
    });
  }
  for (const v of [...moduleViolationResults, ...methodViolationResults]) {
    const category = v.methodName ? 'method' : 'module';
    const detKey = `${category}::${v.ruleKey}::${v.serviceName}::${v.title}`;
    const moduleKey = v.moduleName ? `${v.serviceName}::${v.moduleName}::${v.filePath}` : undefined;
    const methodKey = v.methodName && v.moduleName
      ? `${v.serviceName}::${v.moduleName}::${v.methodName}::${v.filePath}` : undefined;
    allDetEntries.push({
      ruleKey: v.ruleKey, category, title: v.title, description: v.description,
      severity: v.severity, serviceName: v.serviceName,
      moduleName: v.moduleName || undefined, methodName: v.methodName || undefined,
      detViolationId: detViolationIdMap.get(detKey)!,
      targetServiceId: serviceIdMap.get(v.serviceName) || null,
      targetModuleId: moduleKey ? (moduleIdMap.get(moduleKey) || null) : null,
      targetMethodId: methodKey ? (methodIdMap.get(methodKey) || null) : null,
      violationType: v.methodName ? 'function' : 'module',
    });
  }

  // Build lookup: previous det violation ID → previous violation row
  const prevViolationByDetId = new Map<string, typeof previousActiveViolations[0]>();
  for (const v of previousActiveViolations) {
    if (v.deterministicViolationId) {
      prevViolationByDetId.set(v.deterministicViolationId, v);
    }
  }

  const provider = externalProvider ?? createLLMProvider();
  const now = new Date();
  const allNewViolations: DiffViolationItem[] = [];
  const allResolvedViolationIds: string[] = [];

  // Re-activate domain steps for LLM phase (same step, updated detail)
  if (enableLlmRules !== false) {
    const activeDomains = DOMAIN_ORDER.filter(d => !enabledCategories || enabledCategories.includes(d));
    for (const domain of LLM_DOMAINS) {
      if (activeDomains.includes(domain)) {
        tracker?.start(domain, 'Running LLM analysis...');
      }
    }
  }

  // Deterministic enrichment promise
  const deterministicPromise = (async () => {
    let detectionsToEnrich: DetEntry[];

    if (previousDeterministicViolations.length > 0) {
      // 2nd+ run: compare programmatically
      const comparison = compareDeterministicViolations(allDetEntries, previousDeterministicViolations);
      detectionsToEnrich = comparison.newDetections;

      // Carry forward unchanged deterministic violations
      for (const { previous } of comparison.unchangedDetections) {
        const prevViolation = prevViolationByDetId.get(previous.id);
        if (!prevViolation) continue;
        // Find matching current entry to get current det violation ID
        const curEntry = allDetEntries.find((e) => getDetComparisonKey(e) === getDetComparisonKey(previous));
        if (!curEntry) continue;

        await db.insert(violations).values({
          id: uuidv4(),
          repoId,
          analysisId,
          type: prevViolation.type,
          title: prevViolation.title,
          content: prevViolation.content,
          severity: prevViolation.severity,
          status: 'unchanged',
          targetServiceId: curEntry.targetServiceId,
          targetModuleId: curEntry.targetModuleId,
          targetMethodId: curEntry.targetMethodId,
          targetTable: prevViolation.targetTable,
          fixPrompt: prevViolation.fixPrompt,
          ruleKey: curEntry.ruleKey,
          deterministicViolationId: curEntry.detViolationId,
          firstSeenAnalysisId: prevViolation.firstSeenAnalysisId,
          firstSeenAt: prevViolation.firstSeenAt,
          previousViolationId: prevViolation.id,
        });
      }

      // Mark resolved deterministic violations
      for (const resolved of comparison.resolvedDetections) {
        const prevViolation = prevViolationByDetId.get(resolved.id);
        if (!prevViolation) continue;
        allResolvedViolationIds.push(prevViolation.id);

        await db.insert(violations).values({
          id: uuidv4(),
          repoId,
          analysisId,
          type: prevViolation.type,
          title: prevViolation.title,
          content: prevViolation.content,
          severity: prevViolation.severity,
          status: 'resolved',
          targetServiceId: prevViolation.targetServiceId,
          targetModuleId: prevViolation.targetModuleId,
          targetMethodId: prevViolation.targetMethodId,
          targetTable: prevViolation.targetTable,
          fixPrompt: prevViolation.fixPrompt,
          ruleKey: prevViolation.ruleKey,
          deterministicViolationId: null,
          firstSeenAnalysisId: prevViolation.firstSeenAnalysisId,
          firstSeenAt: prevViolation.firstSeenAt,
          previousViolationId: prevViolation.id,
          resolvedAt: now,
        });
      }

      console.log(`[Pipeline] Deterministic comparison: ${comparison.newDetections.length} new, ${comparison.unchangedDetections.length} unchanged, ${comparison.resolvedDetections.length} resolved`);
    } else {
      // 1st run: enrich all
      detectionsToEnrich = allDetEntries;
    }

    // Enrich new/all detections via LLM (or persist raw when enrichment disabled)
    // Persist violations using raw detection data
    for (const det of detectionsToEnrich) {
      const violationId = uuidv4();
      await db.insert(violations).values({
        id: violationId,
        repoId,
        analysisId,
        type: det.violationType,
        title: det.title,
        content: det.description,
        severity: det.severity,
        status: 'new',
        targetServiceId: det.targetServiceId,
        targetModuleId: det.targetModuleId,
        targetMethodId: det.targetMethodId,
        fixPrompt: null,
        ruleKey: det.ruleKey,
        deterministicViolationId: det.detViolationId,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
      });

      allNewViolations.push({
        type: det.violationType,
        title: det.title,
        content: det.description,
        severity: det.severity,
        targetServiceId: det.targetServiceId,
        targetModuleId: det.targetModuleId,
        targetMethodId: det.targetMethodId,
        targetServiceName: det.serviceName || null,
        targetModuleName: det.moduleName || null,
        targetMethodName: det.methodName || null,
        fixPrompt: null,
        ruleKey: det.ruleKey,
      });
    }
    if (detectionsToEnrich.length > 0) {
      emitProgress(88, 'Deterministic violations persisted');
    }
  })();

  // =========================================================================
  // 7. FLOW 2: LLM rule analysis (LLM-handled lifecycle)
  // =========================================================================

  const archAndDbDomains = new Set(['architecture', 'database'])
  const enabledLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt && (r.domain ? archAndDbDomains.has(r.domain) : r.category !== 'code'))
    .map((r) => ({ key: r.key, name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const analysisServices = result.services.map((s) => ({
    id: serviceIdMap.get(s.name)!,
    name: s.name,
    type: s.type,
    framework: s.framework || undefined,
    fileCount: s.fileCount,
    layerSummary: s.layers,
  }));

  const analysisDeps = result.dependencies.map((d) => ({
    sourceServiceName: d.source,
    targetServiceName: d.target,
    dependencyCount: d.dependencies.length + (d.httpCalls?.length || 0),
    dependencyType: d.httpCalls && d.httpCalls.length > 0 ? 'http' : 'import',
  }));

  const violationModules = result.modules?.map((m) => ({
    id: moduleIdMap.get(`${m.serviceName}::${m.name}::${m.filePath}`) || '',
    name: m.name,
    kind: m.kind,
    serviceName: m.serviceName,
    layerName: m.layerName,
    methodCount: m.methodCount,
    propertyCount: m.propertyCount,
    importCount: m.importCount,
    exportCount: m.exportCount,
    superClass: m.superClass || undefined,
    lineCount: m.lineCount || undefined,
  })).filter((m) => m.id);

  const violationMethods = result.methods?.map((m) => ({
    id: methodIdMap.get(`${m.serviceName}::${m.moduleName}::${m.name}::${m.filePath}`) || undefined,
    moduleName: m.moduleName,
    name: m.name,
    signature: m.signature,
    paramCount: m.paramCount,
    returnType: m.returnType || undefined,
    isAsync: m.isAsync,
    lineCount: m.lineCount || undefined,
    statementCount: m.statementCount || undefined,
    maxNestingDepth: m.maxNestingDepth || undefined,
  }));

  const violationModuleDeps = result.moduleLevelDependencies?.map((d) => {
    const srcName = result.modules?.find((m) => m.serviceName === d.sourceService && m.name === d.sourceModule)?.name;
    const tgtName = result.modules?.find((m) => m.serviceName === d.targetService && m.name === d.targetModule)?.name;
    return {
      sourceModule: srcName || d.sourceModule,
      targetModule: tgtName || d.targetModule,
      importedNames: d.importedNames,
    };
  });

  // Filter previous violations to LLM-only (deterministicViolationId IS NULL)
  const llmOnlyPreviousViolations = previousActiveViolations.filter((v) => !v.deterministicViolationId);

  // Partition LLM-only existing violations by category
  const existingServiceViolations = llmOnlyPreviousViolations
    .filter((v) => v.type === 'service')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));
  const existingDatabaseViolations = llmOnlyPreviousViolations
    .filter((v) => v.type === 'database')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));
  const existingModuleViolations = llmOnlyPreviousViolations
    .filter((v) => v.type === 'module' || v.type === 'function')
    .map((v) => ({ id: v.id, type: v.type, title: v.title, content: v.content, severity: v.severity }));

  const hasLlmOnlyExistingViolations = llmOnlyPreviousViolations.length > 0;

  const violationInput = {
    architecture: result.architecture,
    services: analysisServices,
    dependencies: analysisDeps,
    databases: result.databaseResult?.databases.map((d) => ({
      id: dbIdMap.get(d.name)!,
      name: d.name,
      type: d.type,
      driver: d.driver,
      tableCount: d.tables.length,
      connectedServices: d.connectedServices,
      tables: d.tables.map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isNullable: c.isNullable,
          isPrimaryKey: c.isPrimaryKey,
          isForeignKey: c.isForeignKey,
          referencesTable: c.referencesTable,
        })),
      })),
      relations: d.relations.map((r) => ({
        sourceTable: r.sourceTable,
        targetTable: r.targetTable,
        foreignKeyColumn: r.foreignKeyColumn,
      })),
    })),
    llmRules: enabledLlmRules,
    modules: violationModules,
    methods: violationMethods,
    moduleDependencies: violationModuleDeps,
    methodDependencies: (result.methodLevelDependencies || []).map((d) => ({
      callerMethod: d.callerMethod,
      callerModule: d.callerModule,
      calleeMethod: d.calleeMethod,
      calleeModule: d.calleeModule,
      callCount: d.callCount,
    })),
    existingServiceViolations: hasLlmOnlyExistingViolations ? existingServiceViolations : undefined,
    existingDatabaseViolations: hasLlmOnlyExistingViolations ? existingDatabaseViolations : undefined,
    existingModuleViolations: hasLlmOnlyExistingViolations ? existingModuleViolations : undefined,
  };

  // LLM code violations promise
  const llmCodePromise = (llmCodeBatches.length > 0)
    ? provider.generateAllCodeViolations(llmCodeBatches)
    : Promise.resolve({ violations: [] } as CodeViolationsResult);

  let serviceDescriptions: { id: string; description: string }[] = [];
  let llmCodeResolvedIds: string[] = [];
  let llmCodeUnchangedIds: string[] = [];

  emitProgress(86, 'Analyzing architecture & modules...');

  // LLM rule analysis promise (runs in parallel with deterministic enrichment)
  let llmStepCount = 0;
  const llmRulePromise = (async () => {
    if (hasLlmOnlyExistingViolations) {
      const archResult = await generateViolationsWithLifecycle(violationInput, (step) => {
        llmStepCount++;
        tracker?.detail('architecture', step);
        emitProgress(87 + llmStepCount * 2, step);
      }, provider);
      serviceDescriptions = archResult.serviceDescriptions;
      allResolvedViolationIds.push(...archResult.resolvedViolationIds);
      allNewViolations.push(...archResult.newViolations);

      const serviceNameToId = new Map(result.services.map((s) => [s.name, serviceIdMap.get(s.name)!]));
      const moduleNameToId = new Map([...moduleIdMap.entries()].map(([key, mid]) => {
        const parts = key.split('::');
        return [parts[1], mid] as [string, string];
      }));
      const methodNameToId = new Map([...methodIdMap.entries()].map(([key, mid]) => {
        const parts = key.split('::');
        return [parts[2], mid] as [string, string];
      }));

      await persistViolationsWithLifecycle({
        analysisId,
        repoId,
        newViolations: archResult.newViolations,
        resolvedViolationIds: archResult.resolvedViolationIds,
        previousActiveViolations: llmOnlyPreviousViolations,
        serviceNameToId,
        moduleNameToId,
        methodNameToId,
      });
    } else {
      const archResult = await generateViolations(violationInput, (step) => {
        llmStepCount++;
        tracker?.detail('architecture', step);
        emitProgress(87 + llmStepCount * 2, step);
      }, provider);
      serviceDescriptions = archResult.serviceDescriptions;

      // LLM first-run violations
      for (const violation of archResult.violations) {
        await db.insert(violations).values({
          id: uuidv4(),
          repoId,
          analysisId,
          type: violation.type,
          title: violation.title,
          content: violation.content,
          severity: violation.severity,
          status: 'new',
          targetServiceId: violation.targetServiceId || null,
          targetDatabaseId: violation.targetDatabaseId || null,
          targetModuleId: violation.targetModuleId || null,
          targetMethodId: violation.targetMethodId || null,
          targetTable: violation.targetTable || null,
          fixPrompt: violation.fixPrompt || null,
          ruleKey: violation.ruleKey || 'unknown',
          firstSeenAnalysisId: analysisId,
          firstSeenAt: now,
        });

        allNewViolations.push({
          type: violation.type,
          title: violation.title,
          content: violation.content,
          severity: violation.severity,
          targetServiceId: violation.targetServiceId ?? null,
          targetModuleId: violation.targetModuleId ?? null,
          targetMethodId: violation.targetMethodId ?? null,
          targetServiceName: null,
          targetModuleName: null,
          targetMethodName: null,
          fixPrompt: violation.fixPrompt ?? null,
          ruleKey: violation.ruleKey || 'unknown',
        });
      }
    }

    // Mark all LLM domain steps done
    for (const domain of LLM_DOMAINS) {
      tracker?.done(domain);
    }
  })();

  // codePromise runs in background — no progress emit here to avoid
  // re-triggering the progress bar after analysis:complete clears it
  const codePromise = llmCodePromise;

  const [detResult, llmResult] = await Promise.allSettled([deterministicPromise, llmRulePromise]);

  if (detResult.status === 'rejected') {
    const msg = detResult.reason instanceof Error ? detResult.reason.message : String(detResult.reason);
    log(`[Violations] Deterministic enrichment failed: ${msg}`);
    tracker?.error('enrich', `Failed: ${msg.slice(0, 80)}`);
  }
  if (llmResult.status === 'rejected') {
    const msg = llmResult.reason instanceof Error ? llmResult.reason.message : String(llmResult.reason);
    log(`[Violations] LLM rule analysis failed: ${msg}`);
    // Mark all LLM domain steps as errored
    for (const domain of LLM_DOMAINS) {
      tracker?.error(domain, `LLM failed: ${msg.slice(0, 80)}`);
    }
  }
  // LLM steps are marked done inside the llmRulePromise itself

  throwIfAborted(signal);
  tracker?.start('persist', 'Saving results...');
  emitProgress(95, 'Analysis complete');

  // 8. Save service descriptions
  for (const desc of serviceDescriptions) {
    if (desc.id) {
      await db
        .update(services)
        .set({ description: desc.description })
        .where(eq(services.id, desc.id));
    }
  }

  emitProgress(97, 'Persisting violations...');

  // 9. Persist code violations with lifecycle tracking
  // Deterministic code violations are persisted now (groups b + c).
  // LLM code violations (group a) are processed after deterministic ones.

  const scannedFilePaths = new Set(fileContents.keys());
  let codeResolvedCount = 0;

  // b) Deterministic matching for code violations in scanned files
  // (No LLM lifecycle IDs yet — those will be handled in the background)
  const prevForDeterministicMatching = previousActiveCodeViolations.filter(
    (v) => scannedFilePaths.has(v.filePath) && !v.ruleKey.includes('/llm/'),
  );

  if (allCodeViolations.length > 0 || prevForDeterministicMatching.length > 0) {
    await persistCodeViolationsWithLifecycle({
      analysisId,
      currentCodeViolations: allCodeViolations,
      previousActiveCodeViolations: prevForDeterministicMatching,
    });

    const currentKeys = new Set(allCodeViolations.map((cv) =>
      `${cv.filePath}::${cv.ruleKey}::${cv.lineStart}::${cv.lineEnd}`
    ));
    for (const prev of prevForDeterministicMatching) {
      const key = `${prev.filePath}::${prev.ruleKey}::${prev.lineStart}::${prev.lineEnd}`;
      if (!currentKeys.has(key)) codeResolvedCount++;
    }
  }

  // c) Auto carry forward violations for unchanged files (non-LLM only now)
  const prevInUnchangedFiles = previousActiveCodeViolations.filter(
    (v) => !scannedFilePaths.has(v.filePath) && !v.ruleKey.includes('/llm/'),
  );

  for (const prev of prevInUnchangedFiles) {
    await db.insert(codeViolations).values({
      analysisId,
      filePath: prev.filePath,
      lineStart: prev.lineStart,
      lineEnd: prev.lineEnd,
      columnStart: prev.columnStart,
      columnEnd: prev.columnEnd,
      ruleKey: prev.ruleKey,
      severity: prev.severity,
      status: 'unchanged',
      title: prev.title,
      content: prev.content,
      snippet: prev.snippet,
      fixPrompt: prev.fixPrompt,
      firstSeenAnalysisId: prev.firstSeenAnalysisId,
      firstSeenAt: prev.firstSeenAt,
      previousCodeViolationId: prev.id,
    });
  }

  // Process LLM code violations inline (group a)
  if (llmCodeBatches.length > 0) {
    const codeSettled = await codePromise.then(
      (r) => ({ status: 'fulfilled' as const, value: r }),
      (err) => ({ status: 'rejected' as const, reason: err }),
    );

    if (codeSettled.status === 'rejected') {
      log(`[Violations] Code analysis failed: ${codeSettled.reason instanceof Error ? codeSettled.reason.message : String(codeSettled.reason)}`);
    }

    throwIfAborted(signal);

    const codeResult = codeSettled.status === 'fulfilled' ? codeSettled.value : { violations: [] as CodeViolationRaw[] };
    const llmCodeViolations: CodeViolation[] = [];
    processLlmCodeViolations(codeResult, validFilePaths, fileContents, llmCodeViolations);
    llmCodeResolvedIds = codeResult.resolvedViolationIds || [];
    llmCodeUnchangedIds = codeResult.unchangedViolationIds || [];

    // a) LLM lifecycle: carry forward unchanged, mark resolved
    for (const prevId of llmCodeUnchangedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      await db.insert(codeViolations).values({
        analysisId,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey,
        severity: prev.severity,
        status: 'unchanged',
        title: prev.title,
        content: prev.content,
        snippet: prev.snippet,
        fixPrompt: prev.fixPrompt,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousCodeViolationId: prev.id,
      });
    }

    for (const prevId of llmCodeResolvedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      await db.insert(codeViolations).values({
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

    // Persist new LLM code violations via deterministic matching
    const llmPrevForMatching = previousActiveCodeViolations.filter(
      (v) => v.ruleKey.includes('/llm/') && scannedFilePaths.has(v.filePath)
        && !llmCodeUnchangedIds.includes(v.id) && !llmCodeResolvedIds.includes(v.id),
    );

    if (llmCodeViolations.length > 0 || llmPrevForMatching.length > 0) {
      await persistCodeViolationsWithLifecycle({
        analysisId,
        currentCodeViolations: llmCodeViolations,
        previousActiveCodeViolations: llmPrevForMatching,
      });
    }

    // Carry forward LLM violations for unchanged files
    const llmPrevUnchangedFiles = previousActiveCodeViolations.filter(
      (v) => v.ruleKey.includes('/llm/') && !scannedFilePaths.has(v.filePath),
    );

    for (const prev of llmPrevUnchangedFiles) {
      await db.insert(codeViolations).values({
        analysisId,
        filePath: prev.filePath,
        lineStart: prev.lineStart,
        lineEnd: prev.lineEnd,
        columnStart: prev.columnStart,
        columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey,
        severity: prev.severity,
        status: 'unchanged',
        title: prev.title,
        content: prev.content,
        snippet: prev.snippet,
        fixPrompt: prev.fixPrompt,
        firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt,
        previousCodeViolationId: prev.id,
      });
    }
  }

  tracker?.done('persist', 'Done');

  return {
    serviceDescriptions,
    newViolations: allNewViolations,
    resolvedViolationIds: allResolvedViolationIds,
    codeViolations: allCodeViolations,
    codeResolvedCount,
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function processLlmCodeViolations(
  codeResult: { violations: { ruleKey: string; filePath: string; lineStart: number; lineEnd: number; severity: string; title: string; content: string; fixPrompt: string | null }[] },
  validFilePaths: Set<string>,
  fileContents: Map<string, { content: string; lineCount: number }>,
  allCodeViolations: CodeViolation[],
) {
  if (codeResult.violations.length === 0) return;

  for (const v of codeResult.violations) {
    if (!validFilePaths.has(v.filePath)) continue;
    const fileInfo = fileContents.get(v.filePath)!;
    const lineStart = Math.max(1, Math.min(v.lineStart, fileInfo.lineCount));
    const lineEnd = Math.max(lineStart, Math.min(v.lineEnd, fileInfo.lineCount));
    const lines = fileInfo.content.split('\n');
    const snippet = lines.slice(lineStart - 1, lineEnd).join('\n');
    const ruleKey = v.ruleKey;

    allCodeViolations.push({
      ruleKey,
      filePath: v.filePath,
      lineStart,
      lineEnd,
      columnStart: 0,
      columnEnd: 0,
      severity: v.severity,
      title: v.title,
      content: v.content,
      snippet,
      fixPrompt: v.fixPrompt ?? undefined,
    });
  }
}


