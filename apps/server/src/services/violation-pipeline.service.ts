import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkCodeRules, parseFile, detectLanguage, buildScopedCompilerOptions, createTypeQueryService, hasTypeAwareVisitors, hasSchemaAwareVisitors, buildSchemaIndex, type TypeQueryService, type SchemaIndex } from '@truecourse/analyzer';
import type { CodeViolation } from '@truecourse/shared';
import type { ModuleViolation, ServiceViolation } from '@truecourse/analyzer';
import { runDeterministicModuleChecks, runDeterministicMethodChecks, runDeterministicServiceChecks, type AnalysisResult } from './analyzer.service.js';
import { DOMAIN_ORDER, CODE_DOMAINS } from '../socket/handlers.js';
import { getEnabledRules } from './rules.service.js';
import { createLLMProvider, type LLMProvider, type CodeViolationContext, type CodeViolationRaw, type DiffViolationItem } from './llm/provider.js';
import { routeContext, estimateContext } from './llm/context-router.js';
import { generateViolations, generateViolationsWithLifecycle } from './violation.service.js';
import {
  computeFileViolationLifecycle,
  computeViolationLifecycle,
  type ActiveViolation,
} from './violation-lifecycle.service.js';
import { log } from '../lib/logger.js';
import type { ResolvedViolationRef, ViolationRecord } from '../types/snapshot.js';

/** Throw if the abort signal has been triggered. */
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViolationPipelineInput {
  repoPath: string;
  analysisId: string;
  /** ISO timestamp to stamp on every violation created this run. */
  now: string;
  result: AnalysisResult;
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  dbIdMap: Map<string, string>;
  /** Previous active violations loaded from the prior LATEST snapshot. */
  previousActiveViolations: ActiveViolation[];
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
  /** Called with LLM estimate before running LLM rules. Return false to skip LLM. */
  onLlmEstimate?: (estimate: import('./llm/context-router.js').PreFlightEstimate) => Promise<boolean>;
}

export interface ViolationPipelineResult {
  /** Descriptions generated for services — orchestrator applies these to graph.services. */
  serviceDescriptions: { id: string; description: string }[];
  /** Full violation rows to go into AnalysisSnapshot.violations.added + LATEST.violations. */
  added: ViolationRecord[];
  /** Full violation rows to go into AnalysisSnapshot.violations.resolved (for per-analysis history). */
  resolved: ViolationRecord[];
  /** Carried-forward rows — go into LATEST.violations only (not the per-analysis delta). */
  unchanged: ViolationRecord[];
  /** Compact refs for AnalysisSnapshot.violations.resolved (saves space in delta). */
  resolvedRefs: ResolvedViolationRef[];
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
    if (prev) unchangedDetections.push({ current: cur, previous: prev });
    else newDetections.push(cur);
  }

  for (const [key, prev] of previousByKey) {
    if (!currentByKey.has(key)) resolvedDetections.push(prev);
  }

  return { newDetections, unchangedDetections, resolvedDetections };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runViolationPipeline(input: ViolationPipelineInput): Promise<ViolationPipelineResult> {
  const {
    repoPath, analysisId, now, result,
    serviceIdMap, moduleIdMap, methodIdMap, dbIdMap,
    previousActiveViolations,
    changedFileSet, onProgress, tracker,
    provider: externalProvider,
    enabledCategories,
    enableLlmRules,
    signal,
  } = input;

  const added: ViolationRecord[] = [];
  const unchanged: ViolationRecord[] = [];
  const resolved: ViolationRecord[] = [];
  const resolvedRefs: ResolvedViolationRef[] = [];

  // Accumulate names alongside the target IDs — the orchestrator needs them
  // to write LATEST.violations (denormalized) and they help downstream
  // debugging.
  const serviceIdToName = new Map<string, string>();
  const moduleIdToName = new Map<string, string>();
  const methodIdToName = new Map<string, string>();
  const databaseIdToName = new Map<string, string>();
  for (const [name, id] of serviceIdMap) serviceIdToName.set(id, name);
  for (const [key, id] of moduleIdMap) moduleIdToName.set(id, key.split('::')[1]);
  for (const [key, id] of methodIdMap) methodIdToName.set(id, key.split('::')[2]);
  for (const [name, id] of dbIdMap) databaseIdToName.set(id, name);

  const previousActiveCodeViolations = previousActiveViolations.filter((v) => v.filePath != null);

  // ---------------------------------------------------------------------------
  // 1. Load rules
  // ---------------------------------------------------------------------------
  let allRules = (await getEnabledRules())
    .filter((r) => !enabledCategories || enabledCategories.includes(r.domain ?? r.category))
    .filter((r) => enableLlmRules !== false || r.type !== 'llm');

  let llmSkipped = false;
  const enabledDeterministic = allRules.filter((r) => r.type === 'deterministic');
  const enabledLlm = allRules.filter((r) => r.type === 'llm');
  log.info(`[Pipeline] ${allRules.length} rules loaded (${enabledDeterministic.length} det, ${enabledLlm.length} LLM)`);

  const codeDomains = new Set<string>(CODE_DOMAINS);
  const enabledCodeRules = allRules.filter((r) => (r.domain ? (codeDomains.has(r.domain) || (r.domain === 'architecture' && r.category === 'code')) : r.category === 'code') && r.type === 'deterministic');
  const enabledLlmCodeRules = enableLlmRules !== false
    ? allRules.filter((r) => (r.domain ? codeDomains.has(r.domain) : r.category === 'code') && r.type === 'llm' && r.prompt)
    : [];
  const archLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt && r.domain === 'architecture')
    .map((r) => ({ key: r.key, name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));
  const dbSchemaLlmRules = allRules
    .filter((r) => r.type === 'llm' && r.prompt && r.domain === 'database' && r.category === 'database')
    .map((r) => ({ key: r.key, name: r.name, severity: r.severity, prompt: r.prompt!, category: r.category }));

  const filesToScan = changedFileSet
    ? [...changedFileSet].map((relPath) => ({ filePath: relPath, resolve: true }))
    : (result.fileAnalyses || []).map((fa) => ({ filePath: fa.filePath, resolve: !path.isAbsolute(fa.filePath) }));

  // ---------------------------------------------------------------------------
  // 2. Scan files + build TypeQuery
  // ---------------------------------------------------------------------------
  const hasLlm = enabledLlm.length > 0;
  if (hasLlm) tracker?.start('scan', 'Reading files...');

  const fileContents: Map<string, { content: string; lineCount: number }> = new Map();
  for (const { filePath, resolve } of filesToScan) {
    try {
      const lang = detectLanguage(filePath);
      if (!lang) continue;
      const absPath = resolve ? path.resolve(repoPath, filePath) : (path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath));
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, 'utf-8');
      const lineCount = content.split('\n').length;
      fileContents.set(changedFileSet ? absPath : filePath, { content, lineCount });
    } catch {
      // skip
    }
  }

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

  let schemaIndex: SchemaIndex | undefined;
  if (hasSchemaAwareVisitors(enabledCodeKeys)) {
    schemaIndex = buildSchemaIndex(result.databaseResult);
  }

  if (hasLlm) tracker?.done('scan', `${fileContents.size} files`);

  // ---------------------------------------------------------------------------
  // 3. LLM estimate + confirmation
  // ---------------------------------------------------------------------------
  if (hasLlm && input.onLlmEstimate) {
    const codeEstimate = enabledLlmCodeRules.length > 0 && fileContents.size > 0
      ? estimateContext(enabledLlmCodeRules, result.fileAnalyses || [], fileContents, { useFilePaths: true })
      : { tiers: [], totalEstimatedTokens: 0 };

    const archRuleCount = archLlmRules.length;
    const serviceCount = result.services?.length ?? 0;
    const moduleCount = result.modules?.length ?? 0;
    const dbCount = result.databaseResult?.databases.length ?? 0;
    const archTokens = archRuleCount > 0
      ? (serviceCount * 200 + moduleCount * 150 + dbCount * 300) + (3 * 500) + (archRuleCount * 50)
      : 0;
    const dbSchemaRuleCount = dbSchemaLlmRules.length;
    const dbSchemaTokens = dbSchemaRuleCount > 0 && dbCount > 0
      ? (dbCount * 300) + 500 + (dbSchemaRuleCount * 50)
      : 0;

    const totalEstimated = codeEstimate.totalEstimatedTokens + archTokens + dbSchemaTokens;
    const allTiers = [...codeEstimate.tiers];
    if (archTokens > 0) allTiers.push({ tier: 'architecture', ruleCount: archRuleCount, fileCount: serviceCount + moduleCount, estimatedTokens: archTokens });
    if (dbSchemaTokens > 0) allTiers.push({ tier: 'database-schema', ruleCount: dbSchemaRuleCount, fileCount: dbCount, estimatedTokens: dbSchemaTokens });

    const uniqueFileCount = 'uniqueFileCount' in codeEstimate ? codeEstimate.uniqueFileCount : fileContents.size;
    const uniqueRuleCount = ('uniqueRuleCount' in codeEstimate ? codeEstimate.uniqueRuleCount : 0) + archRuleCount + dbSchemaRuleCount;
    const estimate = { tiers: allTiers, totalEstimatedTokens: totalEstimated, uniqueFileCount, uniqueRuleCount };
    log.info(`[LLM] Pre-flight: ${estimate.totalEstimatedTokens} estimated tokens across ${estimate.tiers.length} tiers`);
    for (const t of estimate.tiers) {
      log.info(`[LLM]   ${t.tier}: ${t.ruleCount} rules × ${t.fileCount} files → ~${t.estimatedTokens} tokens`);
    }
    const proceed = await input.onLlmEstimate(estimate);
    if (!proceed) {
      log.info(`[LLM] Skipped by user`);
      llmSkipped = true;
      allRules = allRules.filter((r) => r.type !== 'llm');
    }
  }

  throwIfAborted(signal);

  // ---------------------------------------------------------------------------
  // 4. Deterministic checks per domain
  // ---------------------------------------------------------------------------
  onProgress?.({ step: 'analyzing', percent: 80, detail: 'Running deterministic checks...' });
  const serviceViolationResults: ServiceViolation[] = [];
  const moduleViolationResults: ModuleViolation[] = [];
  const methodViolationResults: ModuleViolation[] = [];

  for (const domain of DOMAIN_ORDER) {
    const stepKey = `${domain}`;
    const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
    if (domainRules.length === 0) { tracker?.done(stepKey); continue; }

    tracker?.start(stepKey);

    if (domain === 'architecture') {
      tracker?.detail(stepKey, 'Service checks...');
      serviceViolationResults.push(...runDeterministicServiceChecks(result, domainRules));
      tracker?.detail(stepKey, 'Module checks...');
      moduleViolationResults.push(...runDeterministicModuleChecks(result, domainRules));
      tracker?.detail(stepKey, 'Method checks...');
      methodViolationResults.push(...runDeterministicMethodChecks(result, domainRules));
      tracker?.detail(stepKey, 'Deterministic checks done');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Code-level deterministic rules
  // ---------------------------------------------------------------------------
  const allCodeViolations: CodeViolation[] = [];

  if (enabledCodeRules.length > 0 && filesToScan.length > 0) {
    for (const domain of DOMAIN_ORDER) {
      if (domain === 'architecture') continue;
      const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
      if (domainRules.length > 0) tracker?.start(`${domain}`);
    }

    await new Promise((r) => setImmediate(r));

    for (const { filePath, resolve } of filesToScan) {
      try {
        const lang = detectLanguage(filePath);
        if (!lang) continue;
        const absPath = resolve ? path.resolve(repoPath, filePath) : (path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath));
        const key = changedFileSet ? absPath : filePath;
        const fc = fileContents.get(key);
        if (!fc) continue;

        const tree = parseFile(changedFileSet ? filePath : filePath, fc.content, lang);
        const codeRuleViolations = checkCodeRules(tree, changedFileSet ? absPath : filePath, fc.content, enabledCodeRules, lang, typeQuery, schemaIndex);
        allCodeViolations.push(...codeRuleViolations);
      } catch {
        // Skip files that fail to parse
      }
    }
  }

  log.info(`[Pipeline] Code scan: ${allCodeViolations.length} violations from ${filesToScan.length} files (${enabledCodeRules.length} det rules, ${enabledLlmCodeRules.length} LLM rules)`);

  if (enabledCodeRules.some(r => r.key === 'bugs/deterministic/invalid-pyproject-toml')) {
    const pyprojectPath = path.join(repoPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      try {
        const { checkPyprojectToml } = await import('@truecourse/analyzer');
        const content = fs.readFileSync(pyprojectPath, 'utf-8');
        const tomlViolations = checkPyprojectToml(pyprojectPath, content);
        allCodeViolations.push(...tomlViolations);
      } catch {
        // smol-toml not available or import failed
      }
    }
  }

  throwIfAborted(signal);

  // Enrich arch-code violations with graph-node target IDs when we can
  // match the file back to a module/service.
  let archEnrichedCount = 0;
  for (const cv of allCodeViolations) {
    if (!cv.ruleKey.startsWith('architecture/')) continue;
    const module = result.modules?.find(
      (m) => cv.filePath.endsWith(m.filePath) || m.filePath.endsWith(cv.filePath),
    );
    if (module) {
      const moduleKey = `${module.serviceName}::${module.name}::${module.filePath}`;
      const moduleId = moduleIdMap.get(moduleKey);
      const serviceId = serviceIdMap.get(module.serviceName);
      (cv as CodeViolation & { targetServiceId?: string; targetModuleId?: string }).targetServiceId = serviceId;
      (cv as CodeViolation & { targetServiceId?: string; targetModuleId?: string }).targetModuleId = moduleId;
      archEnrichedCount++;
    }
  }

  // Per-domain counts
  const violationsByDomain = new Map<string, number>();
  for (const v of allCodeViolations) {
    const domain = v.ruleKey.split('/')[0];
    violationsByDomain.set(domain, (violationsByDomain.get(domain) ?? 0) + 1);
  }
  const archAstCount = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
  if (archAstCount > 0) {
    violationsByDomain.set('architecture', (violationsByDomain.get('architecture') ?? 0) + archAstCount);
  }

  const archFileScanCount = (violationsByDomain.get('architecture') ?? 0) - archAstCount;
  const archTotal = violationsByDomain.get('architecture') ?? 0;
  log.info(
    `[Pipeline] Architecture det: ${archAstCount} (service=${serviceViolationResults.length}, module=${moduleViolationResults.length}, method=${methodViolationResults.length})`,
  );
  if (archFileScanCount > 0) {
    log.info(
      `[Pipeline] Enriched ${archEnrichedCount} arch-code rules with module link (${archFileScanCount - archEnrichedCount} unmatched, persisted as file-only) → architecture=${archTotal}`,
    );
  }

  const totalDet = [...violationsByDomain.values()].reduce((a, b) => a + b, 0);
  log.info(
    `[Pipeline] Totals: ${DOMAIN_ORDER
      .filter((d) => violationsByDomain.has(d))
      .map((d) => `${d}=${violationsByDomain.get(d)}`)
      .join(', ')} (${totalDet})`,
  );

  for (const domain of DOMAIN_ORDER) {
    const count = violationsByDomain.get(domain) ?? 0;
    tracker?.done(domain, count > 0 ? `${count} violations` : 'Clean');
  }

  onProgress?.({ step: 'analyzing', percent: 84, detail: 'Code checks done' });

  // ---------------------------------------------------------------------------
  // 6. Build LLM code batches
  // ---------------------------------------------------------------------------
  const prevLlmCodeByFile = new Map<string, typeof previousActiveCodeViolations>();
  for (const cv of previousActiveCodeViolations) {
    if (!cv.ruleKey.includes('/llm/') || !cv.filePath) continue;
    if (!prevLlmCodeByFile.has(cv.filePath)) prevLlmCodeByFile.set(cv.filePath, []);
    prevLlmCodeByFile.get(cv.filePath)!.push(cv);
  }

  const domainCodeBatches = new Map<string, CodeViolationContext[]>();

  if (enabledLlmCodeRules.length > 0 && fileContents.size > 0 && !llmSkipped) {
    const contextBatches = routeContext(enabledLlmCodeRules, result.fileAnalyses || [], fileContents);

    for (const batch of contextBatches) {
      const existing = [...prevLlmCodeByFile.entries()]
        .filter(([fp]) => batch.content.includes(fp))
        .flatMap(([, violations]) => violations)
        .map((v) => ({
          id: v.id,
          filePath: v.filePath!,
          lineStart: v.lineStart!,
          lineEnd: v.lineEnd!,
          ruleKey: v.ruleKey,
          severity: v.severity,
          title: v.title,
          content: v.content,
        }));

      const rulesByDomain = new Map<string, typeof batch.rules>();
      for (const rule of batch.rules) {
        const domain = rule.key.split('/')[0];
        if (!rulesByDomain.has(domain)) rulesByDomain.set(domain, []);
        rulesByDomain.get(domain)!.push(rule);
      }

      const hasRealPaths = batch.filePaths && batch.filePaths.length > 0;
      const files = hasRealPaths
        ? batch.filePaths!.map((fp) => ({ path: fp, content: fileContents.get(fp)?.content ?? '' }))
        : [{ path: 'context', content: batch.content }];

      for (const [domain, rules] of rulesByDomain) {
        if (!domainCodeBatches.has(domain)) domainCodeBatches.set(domain, []);
        const domainExisting = existing.filter((v) => v.ruleKey.startsWith(`${domain}/`));
        domainCodeBatches.get(domain)!.push({
          files,
          llmRules: rules,
          tier: batch.tier,
          existingViolations: domainExisting.length > 0 ? domainExisting : undefined,
        });
      }
    }

    const totalBatches = [...domainCodeBatches.values()].reduce((s, b) => s + b.length, 0);
    log.info(`[LLM] Context router: ${totalBatches} batches across ${domainCodeBatches.size} domains (from ${contextBatches.length} context groups)`);
    for (const [domain, batches] of domainCodeBatches) {
      log.info(`[LLM]   ${domain}: ${batches.length} batch(es)`);
    }
  }

  const validFilePaths = new Set(fileContents.keys());

  // ---------------------------------------------------------------------------
  // 7. Deterministic violation lifecycle (arch/service/module/method)
  // ---------------------------------------------------------------------------
  interface DetEntry {
    ruleKey: string;
    category: string;
    title: string;
    description: string;
    severity: string;
    serviceName: string;
    moduleName?: string;
    methodName?: string;
    targetServiceId: string | null;
    targetModuleId: string | null;
    targetMethodId: string | null;
    relatedServiceId: string | null;
    relatedModuleId: string | null;
    violationType: string;
    filePath?: string | null;
    lineStart?: number | null;
    lineEnd?: number | null;
    snippet?: string | null;
  }

  const moduleNameToId = new Map<string, string>();
  for (const [key, id] of moduleIdMap) {
    const parts = key.split('::');
    moduleNameToId.set(parts[1], id);
  }

  const allDetEntries: DetEntry[] = [];
  for (const v of serviceViolationResults) {
    allDetEntries.push({
      ruleKey: v.ruleKey, category: 'service', title: v.title, description: v.description,
      severity: v.severity, serviceName: v.serviceName,
      targetServiceId: serviceIdMap.get(v.serviceName) || null,
      targetModuleId: null, targetMethodId: null,
      relatedServiceId: v.relatedServiceName ? serviceIdMap.get(v.relatedServiceName) || null : null,
      relatedModuleId: null,
      violationType: 'service',
    });
  }
  for (const v of [...moduleViolationResults, ...methodViolationResults]) {
    const category = v.methodName ? 'method' : 'module';
    const moduleKey = v.moduleName ? `${v.serviceName}::${v.moduleName}::${v.filePath}` : undefined;
    const methodKey = v.methodName && v.moduleName
      ? `${v.serviceName}::${v.moduleName}::${v.methodName}::${v.filePath}` : undefined;
    allDetEntries.push({
      ruleKey: v.ruleKey, category, title: v.title, description: v.description,
      severity: v.severity, serviceName: v.serviceName,
      moduleName: v.moduleName || undefined, methodName: v.methodName || undefined,
      targetServiceId: serviceIdMap.get(v.serviceName) || null,
      targetModuleId: moduleKey ? (moduleIdMap.get(moduleKey) || null) : null,
      targetMethodId: methodKey ? (methodIdMap.get(methodKey) || null) : null,
      relatedServiceId: null,
      relatedModuleId: v.relatedModuleName ? moduleNameToId.get(v.relatedModuleName) || null : null,
      violationType: v.methodName ? 'function' : 'module',
      filePath: v.filePath || null,
      lineStart: v.lineStart ?? null,
      lineEnd: v.lineEnd ?? null,
    });
  }

  // Scope: arch-AST lifecycle compares service/module/function type violations
  // only. File-level violations ('code' type) go through the separate
  // `computeFileViolationLifecycle` pass below — including them here would
  // double-resolve them (no match in `allDetEntries` → marked resolved here +
  // marked unchanged in the file pass).
  const previousDetViolations = previousActiveViolations.filter(
    (v) => !v.ruleKey.includes('/llm/') && v.type !== 'code',
  );
  const prevViolationByKey = new Map<string, ActiveViolation>();
  for (const v of previousDetViolations) {
    const key = getDetComparisonKey({
      ruleKey: v.ruleKey,
      serviceName: v.targetServiceName || '',
      title: v.title,
      moduleName: v.targetModuleName || null,
      methodName: v.targetMethodName || null,
    });
    prevViolationByKey.set(key, v);
  }

  const provider = externalProvider ?? createLLMProvider();
  provider.setRepoPath(repoPath);
  const allNewLlmItems: DiffViolationItem[] = [];
  const allResolvedLlmIds: string[] = [];

  const hasArchLlm = enableLlmRules !== false && !llmSkipped;
  if (hasArchLlm) tracker?.start('architecture', 'Running LLM analysis...');
  for (const [domain] of domainCodeBatches) {
    const detCount = violationsByDomain.get(domain) ?? 0;
    tracker?.start(domain, detCount > 0 ? `${detCount} det, running LLM...` : 'Running LLM...');
  }

  const previousDetForComparison = previousDetViolations.map((v) => ({
    ruleKey: v.ruleKey,
    serviceName: v.targetServiceName || '',
    title: v.title,
    moduleName: v.targetModuleName || null,
    methodName: v.targetMethodName || null,
    _violationId: v.id,
  }));

  // Run deterministic lifecycle — produces added + unchanged + resolved
  // ViolationRecord[] rather than db inserts.
  const archDetCounts = (() => {
    let newDetections: DetEntry[];
    let unchangedArchCount = 0;
    let resolvedArchCount = 0;

    if (previousDetForComparison.length > 0) {
      const comparison = compareDeterministicViolations(allDetEntries, previousDetForComparison);
      newDetections = comparison.newDetections;
      unchangedArchCount = comparison.unchangedDetections.length;
      resolvedArchCount = comparison.resolvedDetections.length;

      for (const { current: curEntry, previous } of comparison.unchangedDetections) {
        const prevKey = getDetComparisonKey(previous);
        const prev = prevViolationByKey.get(prevKey);
        if (!prev) continue;
        unchanged.push({
          id: randomUUID(),
          type: prev.type,
          title: prev.title,
          content: prev.content,
          severity: prev.severity,
          status: 'unchanged',
          targetServiceId: curEntry.targetServiceId,
          targetDatabaseId: null,
          targetModuleId: curEntry.targetModuleId,
          targetMethodId: curEntry.targetMethodId,
          targetTable: prev.targetTable,
          relatedServiceId: curEntry.relatedServiceId,
          relatedModuleId: curEntry.relatedModuleId,
          fixPrompt: prev.fixPrompt,
          ruleKey: curEntry.ruleKey,
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

      for (const r of comparison.resolvedDetections) {
        const prevKey = getDetComparisonKey(r);
        const prev = prevViolationByKey.get(prevKey);
        if (!prev) continue;
        resolved.push({
          id: randomUUID(),
          type: prev.type,
          title: prev.title,
          content: prev.content,
          severity: prev.severity,
          status: 'resolved',
          targetServiceId: prev.targetServiceId,
          targetDatabaseId: null,
          targetModuleId: prev.targetModuleId,
          targetMethodId: prev.targetMethodId,
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
      }
    } else {
      newDetections = allDetEntries;
    }

    for (const det of newDetections) {
      added.push({
        id: randomUUID(),
        type: det.violationType,
        title: det.title,
        content: det.description,
        severity: det.severity as ViolationRecord['severity'],
        status: 'new',
        targetServiceId: det.targetServiceId,
        targetDatabaseId: null,
        targetModuleId: det.targetModuleId,
        targetMethodId: det.targetMethodId,
        targetTable: null,
        relatedServiceId: det.relatedServiceId,
        relatedModuleId: det.relatedModuleId,
        fixPrompt: null,
        ruleKey: det.ruleKey,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
        previousViolationId: null,
        resolvedAt: null,
        filePath: det.filePath ?? null,
        lineStart: det.lineStart ?? null,
        lineEnd: det.lineEnd ?? null,
        columnStart: null,
        columnEnd: null,
        snippet: det.snippet ?? null,
        createdAt: now,
      });
    }

    return {
      newCount: newDetections.length,
      unchangedCount: unchangedArchCount,
      resolvedCount: resolvedArchCount,
    };
  })();

  // ---------------------------------------------------------------------------
  // 8. LLM architecture / database / module rules
  // ---------------------------------------------------------------------------
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

  const llmOnlyPreviousViolations = previousActiveViolations.filter((v) => v.ruleKey.includes('/llm/'));
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

  const dbSchemaContext = (dbSchemaLlmRules.length > 0 && result.databaseResult?.databases.length)
    ? {
        databases: result.databaseResult.databases.map((d) => ({
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
        llmRules: dbSchemaLlmRules,
        existingViolations: hasLlmOnlyExistingViolations ? existingDatabaseViolations : undefined,
      }
    : undefined;

  const violationInput = {
    architecture: result.architecture,
    services: analysisServices,
    dependencies: analysisDeps,
    databases: undefined,
    llmRules: archLlmRules,
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
    existingDatabaseViolations: undefined,
    existingModuleViolations: hasLlmOnlyExistingViolations ? existingModuleViolations : undefined,
  };

  type DomainLlmResult = { domain: string; violations: CodeViolation[]; resolvedIds: string[]; unchangedIds: string[] };
  const domainLlmPromises: Promise<DomainLlmResult>[] = [];

  for (const [domain, batches] of domainCodeBatches) {
    domainLlmPromises.push((async (): Promise<DomainLlmResult> => {
      const detCount = violationsByDomain.get(domain) ?? 0;
      log.info(`[LLM] ${domain}: starting (${batches.length} code batches)`);
      const t0 = Date.now();

      const codeResults = await Promise.allSettled(
        batches.map((b) => provider.generateCodeViolations(b)),
      );

      const rawViolations: CodeViolationRaw[] = [];
      const resolvedIds: string[] = [];
      const unchangedIds: string[] = [];
      for (const r of codeResults) {
        if (r.status === 'fulfilled') {
          rawViolations.push(...r.value.violations);
          if (r.value.resolvedViolationIds) resolvedIds.push(...r.value.resolvedViolationIds);
          if (r.value.unchangedViolationIds) unchangedIds.push(...r.value.unchangedViolationIds);
        } else {
          log.warn(`[LLM] ${domain}: batch failed — ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }

      const dur = Date.now() - t0;
      const processed: CodeViolation[] = [];
      processLlmCodeViolations({ violations: rawViolations }, validFilePaths, fileContents, processed, repoPath);
      const total = detCount + processed.length;
      log.info(`[LLM] ${domain}: done in ${dur}ms — ${processed.length} LLM violations (${total} total)`);
      tracker?.done(domain, total > 0 ? `${total} violations` : 'Clean');

      return { domain, violations: processed, resolvedIds, unchangedIds };
    })());
  }

  // Database schema LLM (separate from code batches)
  let dbSchemaViolations: ViolationRecord[] = [];
  if (dbSchemaContext && !llmSkipped) {
    if (!domainCodeBatches.has('database')) {
      const detCount = violationsByDomain.get('database') ?? 0;
      tracker?.start('database', detCount > 0 ? `${detCount} det, running LLM...` : 'Running LLM...');
    }

    domainLlmPromises.push((async (): Promise<DomainLlmResult> => {
      log.info(`[LLM] database-schema: starting`);
      const t0 = Date.now();
      try {
        const dbResult = await provider.generateDatabaseViolations(dbSchemaContext);
        const dur = Date.now() - t0;
        log.info(`[LLM] database-schema: done in ${dur}ms — ${dbResult.violations.length} violations`);

        for (const v of dbResult.violations) {
          dbSchemaViolations.push({
            id: randomUUID(),
            type: 'database',
            title: v.title,
            content: v.content,
            severity: v.severity as ViolationRecord['severity'],
            status: 'new',
            targetServiceId: null,
            targetDatabaseId: v.targetDatabaseId || null,
            targetModuleId: null,
            targetMethodId: null,
            targetTable: v.targetTable || null,
            relatedServiceId: null,
            relatedModuleId: null,
            fixPrompt: v.fixPrompt || null,
            ruleKey: v.ruleKey || 'unknown',
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

        if (!domainCodeBatches.has('database')) {
          const detCount = violationsByDomain.get('database') ?? 0;
          const total = detCount + dbResult.violations.length;
          tracker?.done('database', total > 0 ? `${total} violations` : 'Clean');
        }

        return { domain: 'database-schema', violations: [], resolvedIds: [], unchangedIds: [] };
      } catch (err) {
        const dur = Date.now() - t0;
        log.warn(`[LLM] database-schema: failed in ${dur}ms — ${err instanceof Error ? err.message : String(err)}`);
        if (!domainCodeBatches.has('database')) tracker?.error('database', `Schema LLM failed`);
        return { domain: 'database-schema', violations: [], resolvedIds: [], unchangedIds: [] };
      }
    })());
  }

  let serviceDescriptions: { id: string; description: string }[] = [];

  onProgress?.({ step: 'analyzing', percent: 86, detail: 'Analyzing architecture & modules...' });

  const llmRulePromise = (async () => {
    if (enableLlmRules === false || llmSkipped) return;
    if (hasLlmOnlyExistingViolations) {
      const archResult = await generateViolationsWithLifecycle(
        violationInput,
        (step) => tracker?.detail('architecture', step),
        provider,
      );
      serviceDescriptions = archResult.serviceDescriptions;
      allResolvedLlmIds.push(...archResult.resolvedViolationIds);
      allNewLlmItems.push(...archResult.newViolations);

      const serviceNameToId = new Map(result.services.map((s) => [s.name, serviceIdMap.get(s.name)!]));
      const moduleNameToIdLocal = new Map(
        [...moduleIdMap.entries()].map(([key, mid]) => [key.split('::')[1], mid] as [string, string]),
      );
      const methodNameToId = new Map(
        [...methodIdMap.entries()].map(([key, mid]) => [key.split('::')[2], mid] as [string, string]),
      );

      const lifecycle = computeViolationLifecycle({
        analysisId,
        now,
        newViolations: archResult.newViolations,
        resolvedViolationIds: archResult.resolvedViolationIds,
        previousActiveViolations: llmOnlyPreviousViolations,
        serviceNameToId,
        moduleNameToId: moduleNameToIdLocal,
        methodNameToId,
      });
      added.push(...lifecycle.added);
      unchanged.push(...lifecycle.unchanged);
      resolved.push(...lifecycle.resolved);
      resolvedRefs.push(...lifecycle.resolvedRefs);
    } else {
      const archResult = await generateViolations(
        violationInput,
        (step) => tracker?.detail('architecture', step),
        provider,
      );
      serviceDescriptions = archResult.serviceDescriptions;

      for (const v of archResult.violations) {
        added.push({
          id: randomUUID(),
          type: v.type,
          title: v.title,
          content: v.content,
          severity: v.severity as ViolationRecord['severity'],
          status: 'new',
          targetServiceId: v.targetServiceId || null,
          targetDatabaseId: v.targetDatabaseId || null,
          targetModuleId: v.targetModuleId || null,
          targetMethodId: v.targetMethodId || null,
          targetTable: v.targetTable || null,
          relatedServiceId: null,
          relatedModuleId: null,
          fixPrompt: v.fixPrompt || null,
          ruleKey: v.ruleKey || 'unknown',
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
    }

    const archCount = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
    tracker?.done('architecture', archCount > 0 ? `${archCount} violations` : 'Clean');
  })();

  const [detResult, llmResult, ...domainLlmResults] = await Promise.allSettled([
    Promise.resolve(archDetCounts),
    llmRulePromise,
    ...domainLlmPromises,
  ]);

  if (detResult.status === 'rejected') {
    log.error(`[Violations] Deterministic lifecycle tracking failed: ${detResult.reason instanceof Error ? detResult.reason.message : String(detResult.reason)}`);
  }
  if (llmResult.status === 'rejected') {
    const msg = llmResult.reason instanceof Error ? llmResult.reason.message : String(llmResult.reason);
    log.error(`[Violations] LLM architecture analysis failed: ${msg}`);
    tracker?.error('architecture', `LLM failed: ${msg.slice(0, 80)}`);
  }

  // Merge database schema LLM violations into the main lists.
  added.push(...dbSchemaViolations);

  throwIfAborted(signal);
  tracker?.start('persist');
  onProgress?.({ step: 'analyzing', percent: 95, detail: 'Analysis complete' });

  // ---------------------------------------------------------------------------
  // 9. File-level (code) violation lifecycle
  // ---------------------------------------------------------------------------
  const scannedFilePaths = new Set(fileContents.keys());

  // Deterministic code violations — match by ruleKey+filePath against scanned files.
  // Only `type: 'code'` entries came from the file-scan pass; arch-AST-detected
  // rules (type: 'module' / 'function' / 'service') also carry a filePath but
  // they're handled by the arch-AST lifecycle above — including them here
  // would mark them resolved a second time.
  const prevForDeterministicMatching = previousActiveCodeViolations.filter(
    (v) =>
      v.type === 'code' &&
      v.filePath &&
      scannedFilePaths.has(v.filePath) &&
      !v.ruleKey.includes('/llm/'),
  );

  let codeDetCounts = { newCount: 0, unchangedCount: 0, resolvedCount: 0 };
  if (allCodeViolations.length > 0 || prevForDeterministicMatching.length > 0) {
    const lifecycle = computeFileViolationLifecycle({
      analysisId,
      now,
      currentViolations: allCodeViolations.map((cv) => ({
        filePath: cv.filePath,
        lineStart: cv.lineStart,
        lineEnd: cv.lineEnd,
        columnStart: cv.columnStart,
        columnEnd: cv.columnEnd,
        ruleKey: cv.ruleKey,
        severity: cv.severity,
        title: cv.title,
        content: cv.content,
        snippet: cv.snippet,
        fixPrompt: cv.fixPrompt,
        targetServiceId: (cv as CodeViolation & { targetServiceId?: string }).targetServiceId ?? null,
        targetModuleId: (cv as CodeViolation & { targetModuleId?: string }).targetModuleId ?? null,
      })),
      previousViolations: prevForDeterministicMatching,
    });
    added.push(...lifecycle.added);
    unchanged.push(...lifecycle.unchanged);
    resolved.push(...lifecycle.resolved);
    resolvedRefs.push(...lifecycle.resolvedRefs);
    codeDetCounts = lifecycle.counts;
  }

  // Auto carry forward code violations for unchanged files (non-LLM).
  // Scope to type: 'code' for the same reason as the deterministic matching
  // filter above — arch-AST entries are handled elsewhere.
  const prevInUnchangedFiles = previousActiveCodeViolations.filter(
    (v) =>
      v.type === 'code' &&
      v.filePath &&
      !scannedFilePaths.has(v.filePath) &&
      !v.ruleKey.includes('/llm/'),
  );
  for (const prev of prevInUnchangedFiles) {
    unchanged.push({
      id: randomUUID(),
      type: 'code',
      title: prev.title,
      content: prev.content,
      severity: prev.severity,
      status: 'unchanged',
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

  // Combined deterministic tally
  {
    const totalNew = archDetCounts.newCount + codeDetCounts.newCount;
    const totalUnchanged = archDetCounts.unchangedCount + codeDetCounts.unchangedCount;
    const totalResolved = archDetCounts.resolvedCount + codeDetCounts.resolvedCount;
    if (totalNew + totalUnchanged + totalResolved > 0) {
      log.info(
        `[Pipeline] Persisted deterministic violations: ${totalNew} new, ${totalUnchanged} unchanged, ${totalResolved} resolved`,
      );
    }
  }

  // LLM code violations
  const allLlmCodeViolations: CodeViolation[] = [];
  const allLlmResolvedIds: string[] = [];
  const allLlmUnchangedIds: string[] = [];
  for (const r of domainLlmResults) {
    if (r.status === 'fulfilled') {
      const v = r.value as DomainLlmResult;
      allLlmCodeViolations.push(...v.violations);
      allLlmResolvedIds.push(...v.resolvedIds);
      allLlmUnchangedIds.push(...v.unchangedIds);
    }
  }

  if (allLlmCodeViolations.length > 0 || allLlmResolvedIds.length > 0) {
    log.info(`[Pipeline] LLM code totals: ${allLlmCodeViolations.length} new, ${allLlmResolvedIds.length} resolved, ${allLlmUnchangedIds.length} unchanged`);

    for (const prevId of allLlmUnchangedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      unchanged.push({
        id: randomUUID(),
        type: 'code',
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
        status: 'unchanged',
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

    for (const prevId of allLlmResolvedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      resolved.push({
        id: randomUUID(),
        type: 'code',
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
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
      });
      resolvedRefs.push({ id: prev.id, resolvedAt: now });
    }

    // New LLM code violations (already-handled IDs excluded)
    const handledIds = new Set([...allLlmUnchangedIds, ...allLlmResolvedIds]);
    const llmPrevForMatching = previousActiveCodeViolations.filter(
      (v) =>
        v.ruleKey.includes('/llm/') &&
        v.filePath &&
        scannedFilePaths.has(v.filePath) &&
        !handledIds.has(v.id),
    );

    if (allLlmCodeViolations.length > 0 || llmPrevForMatching.length > 0) {
      const lifecycle = computeFileViolationLifecycle({
        analysisId,
        now,
        currentViolations: allLlmCodeViolations.map((cv) => ({
          filePath: cv.filePath,
          lineStart: cv.lineStart,
          lineEnd: cv.lineEnd,
          columnStart: cv.columnStart,
          columnEnd: cv.columnEnd,
          ruleKey: cv.ruleKey,
          severity: cv.severity,
          title: cv.title,
          content: cv.content,
          snippet: cv.snippet,
          fixPrompt: cv.fixPrompt,
        })),
        previousViolations: llmPrevForMatching,
      });
      added.push(...lifecycle.added);
      unchanged.push(...lifecycle.unchanged);
      resolved.push(...lifecycle.resolved);
      resolvedRefs.push(...lifecycle.resolvedRefs);
      log.info(
        `[Pipeline] Persisted code (LLM): ${lifecycle.counts.newCount} new, ${lifecycle.counts.unchangedCount} unchanged, ${lifecycle.counts.resolvedCount} resolved`,
      );
    }

    // Carry forward LLM violations for unchanged files
    const llmPrevUnchangedFiles = previousActiveCodeViolations.filter(
      (v) => v.ruleKey.includes('/llm/') && v.filePath && !scannedFilePaths.has(v.filePath),
    );
    for (const prev of llmPrevUnchangedFiles) {
      unchanged.push({
        id: randomUUID(),
        type: 'code',
        title: prev.title,
        content: prev.content,
        severity: prev.severity,
        status: 'unchanged',
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

  tracker?.done('persist', 'Done');

  return {
    serviceDescriptions,
    added,
    unchanged,
    resolved,
    resolvedRefs,
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
  repoPath: string,
) {
  if (codeResult.violations.length === 0) return;

  let skippedPaths = 0;
  for (const v of codeResult.violations) {
    let filePath = v.filePath;
    if (!validFilePaths.has(filePath)) {
      const resolved = path.resolve(repoPath, filePath);
      if (validFilePaths.has(resolved)) {
        filePath = resolved;
      } else {
        skippedPaths++;
        if (skippedPaths <= 3) {
          log.info(`[LLM] Skipping violation: path "${v.filePath}" not in validFilePaths (sample: ${[...validFilePaths].slice(0, 2).join(', ')})`);
        }
        continue;
      }
    }
    const fileInfo = fileContents.get(filePath)!;
    const lineStart = Math.max(1, Math.min(v.lineStart, fileInfo.lineCount));
    const lineEnd = Math.max(lineStart, Math.min(v.lineEnd, fileInfo.lineCount));
    const lines = fileInfo.content.split('\n');
    const snippet = lines.slice(lineStart - 1, lineEnd).join('\n');
    allCodeViolations.push({
      ruleKey: v.ruleKey,
      filePath,
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
