import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../config/database.js';
import {
  services,
  violations,
} from '../db/schema.js';
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
  persistViolationsWithLifecycle,
  persistFileViolationsWithLifecycle,
} from './violation-lifecycle.service.js';
import { log } from '../lib/logger.js';

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
  result: AnalysisResult;
  serviceIdMap: Map<string, string>;
  moduleIdMap: Map<string, string>;
  methodIdMap: Map<string, string>;
  dbIdMap: Map<string, string>;
  /** Previous active violations for lifecycle tracking (both arch and code) */
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
    firstSeenAnalysisId: string | null;
    firstSeenAt: Date | null;
    filePath: string | null;
    lineStart: number | null;
    lineEnd: number | null;
    columnStart: number | null;
    columnEnd: number | null;
    snippet: string | null;
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
  /** Called with LLM estimate before running LLM rules. Return false to skip LLM. */
  onLlmEstimate?: (estimate: import('./llm/context-router.js').PreFlightEstimate) => Promise<boolean>;
}

export interface ViolationPipelineResult {
  serviceDescriptions: { id: string; description: string }[];
  /** For diff mode: new violations from LLM + deterministic */
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
 * 1. Deterministic: code-handled lifecycle (compare programmatically, persist new)
 * 2. LLM rules: LLM-handled lifecycle (only LLM-discovered previous violations)
 */
export async function runViolationPipeline(input: ViolationPipelineInput): Promise<ViolationPipelineResult> {
  const {
    repoPath, analysisId, result,
    serviceIdMap, moduleIdMap, methodIdMap, dbIdMap,
    previousActiveViolations,
    changedFileSet, onProgress, tracker,
    provider: externalProvider,
    enabledCategories,
    enableLlmRules,
    signal,
  } = input;

  // Derive code violations from the unified previousActiveViolations list
  const previousActiveCodeViolations = previousActiveViolations.filter(
    (v) => v.filePath != null,
  );

  // 1. Load rules (filter to enabled categories/domains, and filter out LLM rules if disabled)
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
  // 2. Scan files + build TypeQuery (always, once)
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

  // Build schema index from the analyzer's existing databaseResult.
  // Wraps Drizzle/Prisma/SQLAlchemy parser output in a fast lookup so visitors
  // (currently missing-unique-constraint) can answer "is users.email unique?"
  // with real schema data instead of name-based heuristics.
  let schemaIndex: SchemaIndex | undefined;
  if (hasSchemaAwareVisitors(enabledCodeKeys)) {
    schemaIndex = buildSchemaIndex(result.databaseResult);
  }

  if (hasLlm) tracker?.done('scan', `${fileContents.size} files`);

  // ---------------------------------------------------------------------------
  // 3. LLM estimate + confirmation (only when LLM enabled)
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
  // 4. Run deterministic checks per domain
  // ---------------------------------------------------------------------------
  onProgress?.({ step: 'analyzing', percent: 80, detail: 'Running deterministic checks...' });
  const serviceViolationResults: ServiceViolation[] = [];
  const moduleViolationResults: ModuleViolation[] = [];
  const methodViolationResults: ModuleViolation[] = [];

  for (const domain of DOMAIN_ORDER) {
    const stepKey = `${domain}`;
    const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
    if (domainRules.length === 0) {
      tracker?.done(stepKey);
      continue;
    }

    tracker?.start(stepKey);

    if (domain === 'architecture') {
      tracker?.detail(stepKey, 'Service checks...');
      serviceViolationResults.push(...runDeterministicServiceChecks(result, domainRules));
      tracker?.detail(stepKey, 'Module checks...');
      moduleViolationResults.push(...runDeterministicModuleChecks(result, domainRules));
      tracker?.detail(stepKey, 'Method checks...');
      methodViolationResults.push(...runDeterministicMethodChecks(result, domainRules));
      // Architecture count is finalized further down, after arch-domain
      // code rules are merged into moduleViolationResults. Logged there so
      // the numbers match the persisted total.
      tracker?.detail(stepKey, 'Deterministic checks done');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Run code-level deterministic rules (files already scanned)
  // ---------------------------------------------------------------------------
  let allCodeViolations: CodeViolation[] = [];

  if (enabledCodeRules.length > 0 && filesToScan.length > 0) {
    for (const domain of DOMAIN_ORDER) {
      if (domain === 'architecture') continue;
      const domainRules = enabledDeterministic.filter(r => (r.domain ?? '').startsWith(domain));
      if (domainRules.length > 0) {
        tracker?.start(`${domain}`);
      }
    }

    // Yield so socket events (domain step starts) flush before the sync scanning loop
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

  // Architecture-domain code violations (rules that fire from within
  // `checkCodeRules` but carry `architecture/*` ruleKey) stay as file-level
  // `code` violations — they have a filePath and should always be
  // persisted. When we can match the file back to a module/service we
  // enrich the violation with graph-node target IDs so it also shows up on
  // the architecture graph; unmatched ones persist with just filePath.
  let archEnrichedCount = 0;
  for (const cv of allCodeViolations) {
    if (!cv.ruleKey.startsWith('architecture/')) continue;
    const module = result.modules?.find(
      (m) => cv.filePath.endsWith(m.filePath) || m.filePath.endsWith(cv.filePath),
    );
    if (module) {
      const moduleId = moduleIdMap.get(module.name);
      const serviceId = serviceIdMap.get(module.serviceName);
      (cv as CodeViolation & { targetServiceId?: string; targetModuleId?: string }).targetServiceId =
        serviceId;
      (cv as CodeViolation & { targetServiceId?: string; targetModuleId?: string }).targetModuleId =
        moduleId;
      archEnrichedCount++;
    }
  }

  // Per-domain counts. Architecture splits across two sources:
  //   - AST-based checks (serviceViolationResults / moduleViolationResults /
  //     methodViolationResults) — run against the already-parsed graph.
  //   - File-scan rules that happen to live in the `architecture/` domain —
  //     counted directly from allCodeViolations ruleKey prefixes below.
  const violationsByDomain = new Map<string, number>();
  for (const v of allCodeViolations) {
    const domain = v.ruleKey.split('/')[0];
    violationsByDomain.set(domain, (violationsByDomain.get(domain) ?? 0) + 1);
  }
  const archAstCount =
    serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
  if (archAstCount > 0) {
    violationsByDomain.set(
      'architecture',
      (violationsByDomain.get('architecture') ?? 0) + archAstCount,
    );
  }

  // Count arch-code violations (from file scan) for the enrichment log line.
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

  // Mark every domain done with its deterministic count. If LLM runs it
  // will overwrite these entries with richer det+LLM totals (same pattern
  // for every domain — architecture is not special).
  for (const domain of DOMAIN_ORDER) {
    const count = violationsByDomain.get(domain) ?? 0;
    tracker?.done(domain, count > 0 ? `${count} violations` : 'Clean');
  }

  const totalDetections = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
  onProgress?.({ step: 'analyzing', percent: 84, detail: 'Code checks done' });

  // 4. Build LLM code violation batches using context-routed approach
  // Build a lookup of previous LLM code violations by file path
  const prevLlmCodeByFile = new Map<string, typeof previousActiveCodeViolations>();
  for (const cv of previousActiveCodeViolations) {
    // Only include LLM-generated code violations (not deterministic ones)
    if (!cv.ruleKey.includes('/llm/') || !cv.filePath) continue;
    if (!prevLlmCodeByFile.has(cv.filePath)) prevLlmCodeByFile.set(cv.filePath, []);
    prevLlmCodeByFile.get(cv.filePath)!.push(cv);
  }

  // Build per-domain LLM code batches
  const domainCodeBatches = new Map<string, CodeViolationContext[]>();

  if (enabledLlmCodeRules.length > 0 && fileContents.size > 0 && !llmSkipped) {
    // Build context-routed batches
    const contextBatches = routeContext(enabledLlmCodeRules, result.fileAnalyses || [], fileContents);

    // Split each batch by domain
    for (const batch of contextBatches) {
      // Collect previous violations for all files referenced in this batch content
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

      // Group rules by domain
      const rulesByDomain = new Map<string, typeof batch.rules>();
      for (const rule of batch.rules) {
        const domain = rule.key.split('/')[0];
        if (!rulesByDomain.has(domain)) rulesByDomain.set(domain, []);
        rulesByDomain.get(domain)!.push(rule);
      }

      // Create per-domain sub-batches
      // For full-file batches with real file paths, pass paths so CLI mode can use Read tool.
      // For metadata/targeted batches, content is pre-built (summaries/extracts) — send inline.
      const hasRealPaths = batch.filePaths && batch.filePaths.length > 0;
      const files = hasRealPaths
        ? batch.filePaths!.map((fp) => ({ path: fp, content: fileContents.get(fp)?.content ?? '' }))
        : [{ path: 'context', content: batch.content }];

      for (const [domain, rules] of rulesByDomain) {
        if (!domainCodeBatches.has(domain)) domainCodeBatches.set(domain, []);
        const domainExisting = existing.filter(v => v.ruleKey.startsWith(`${domain}/`));
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

  // =========================================================================
  // 5. FLOW 1: Deterministic lifecycle (code-handled)
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
    targetServiceId: string | null;
    targetModuleId: string | null;
    targetMethodId: string | null;
    relatedServiceId: string | null;
    relatedModuleId: string | null;
    violationType: string; // 'service' | 'module' | 'function'
    // Code location fields — populated from ModuleViolation.filePath.
    // Pre-Phase-4 these were dropped during conversion, causing all
    // architecture-checker violations to show filePath: null in the API.
    filePath?: string | null;
    lineStart?: number | null;
    lineEnd?: number | null;
    snippet?: string | null;
  }

  // Build a name-based lookup for modules (moduleName → moduleId)
  const moduleNameToId = new Map<string, string>();
  for (const [key, id] of moduleIdMap) {
    const parts = key.split('::');
    const modName = parts[1]; // serviceName::moduleName::filePath
    moduleNameToId.set(modName, id); // last one wins (fine for same-service lookups)
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
    });
  }

  // Build lookup: previous deterministic violations by comparison key
  // Deterministic violations have a non-LLM ruleKey (they don't contain '/llm/')
  const previousDetViolations = previousActiveViolations.filter(
    (v) => !v.ruleKey.includes('/llm/'),
  );
  // Map from comparison key to previous violation row
  const prevViolationByKey = new Map<string, typeof previousActiveViolations[0]>();
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
  const now = new Date();
  const allNewViolations: DiffViolationItem[] = [];
  const allResolvedViolationIds: string[] = [];

  // Re-activate domains that have LLM work
  const hasArchLlm = enableLlmRules !== false && !llmSkipped;
  if (hasArchLlm) {
    tracker?.start('architecture', 'Running LLM analysis...');
  }
  for (const [domain] of domainCodeBatches) {
    const detCount = violationsByDomain.get(domain) ?? 0;
    tracker?.start(domain, detCount > 0 ? `${detCount} det, running LLM...` : 'Running LLM...');
  }

  // Deterministic lifecycle tracking — persist new, carry forward unchanged, mark resolved
  // Compare current deterministic entries against previous violations (from the violations table)
  // using the same comparison key (ruleKey::serviceName::moduleName::methodName::title).
  const previousDetForComparison = previousDetViolations.map((v) => ({
    ruleKey: v.ruleKey,
    serviceName: v.targetServiceName || '',
    title: v.title,
    moduleName: v.targetModuleName || null,
    methodName: v.targetMethodName || null,
    _violationId: v.id, // carry the violation ID for lookup
  }));

  const deterministicPromise: Promise<{ newCount: number; unchangedCount: number; resolvedCount: number }> = (async () => {
    let newDetections: DetEntry[];
    let unchangedArchCount = 0;
    let resolvedArchCount = 0;

    if (previousDetForComparison.length > 0) {
      // 2nd+ run: compare programmatically
      const comparison = compareDeterministicViolations(allDetEntries, previousDetForComparison);
      newDetections = comparison.newDetections;
      unchangedArchCount = comparison.unchangedDetections.length;
      resolvedArchCount = comparison.resolvedDetections.length;

      // Carry forward unchanged deterministic violations
      for (const { current: curEntry, previous } of comparison.unchangedDetections) {
        const prevKey = getDetComparisonKey(previous);
        const prevViolation = prevViolationByKey.get(prevKey);
        if (!prevViolation) continue;

        await db.insert(violations).values({
          id: randomUUID(),
          analysisId,
          type: prevViolation.type,
          title: prevViolation.title,
          content: prevViolation.content,
          severity: prevViolation.severity,
          status: 'unchanged',
          targetServiceId: curEntry.targetServiceId,
          targetModuleId: curEntry.targetModuleId,
          targetMethodId: curEntry.targetMethodId,
          relatedServiceId: curEntry.relatedServiceId,
          relatedModuleId: curEntry.relatedModuleId,
          targetTable: prevViolation.targetTable,
          fixPrompt: prevViolation.fixPrompt,
          ruleKey: curEntry.ruleKey,
          firstSeenAnalysisId: prevViolation.firstSeenAnalysisId,
          firstSeenAt: prevViolation.firstSeenAt,
          previousViolationId: prevViolation.id,
        });
      }

      // Mark resolved deterministic violations
      for (const resolved of comparison.resolvedDetections) {
        const prevKey = getDetComparisonKey(resolved);
        const prevViolation = prevViolationByKey.get(prevKey);
        if (!prevViolation) continue;
        allResolvedViolationIds.push(prevViolation.id);

        await db.insert(violations).values({
          id: randomUUID(),
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
          firstSeenAnalysisId: prevViolation.firstSeenAnalysisId,
          firstSeenAt: prevViolation.firstSeenAt,
          previousViolationId: prevViolation.id,
          resolvedAt: now,
        });
      }

    } else {
      // 1st run: persist all
      newDetections = allDetEntries;
    }

    // Persist new deterministic violations
    for (const det of newDetections) {
      const violationId = randomUUID();
      await db.insert(violations).values({
        id: violationId,
        analysisId,
        type: det.violationType,
        title: det.title,
        content: det.description,
        severity: det.severity,
        status: 'new',
        targetServiceId: det.targetServiceId,
        targetModuleId: det.targetModuleId,
        targetMethodId: det.targetMethodId,
        relatedServiceId: det.relatedServiceId,
        relatedModuleId: det.relatedModuleId,
        fixPrompt: null,
        ruleKey: det.ruleKey,
        firstSeenAnalysisId: analysisId,
        firstSeenAt: now,
        filePath: det.filePath || null,
        lineStart: det.lineStart || null,
        lineEnd: det.lineEnd || null,
        snippet: det.snippet || null,
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
    return {
      newCount: newDetections.length,
      unchangedCount: unchangedArchCount,
      resolvedCount: resolvedArchCount,
    };
  })();

  // =========================================================================
  // 6. FLOW 2: LLM rule analysis (LLM-handled lifecycle)
  // =========================================================================

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

  // Filter previous violations to LLM-only (ruleKey contains '/llm/')
  const llmOnlyPreviousViolations = previousActiveViolations.filter((v) => v.ruleKey.includes('/llm/'));

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

  // Build database schema context for direct database LLM call
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

  // Architecture violation input (service + module only, no database)
  const violationInput = {
    architecture: result.architecture,
    services: analysisServices,
    dependencies: analysisDeps,
    databases: undefined, // database schema LLM handled separately in database domain
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
    existingDatabaseViolations: undefined, // database handled separately
    existingModuleViolations: hasLlmOnlyExistingViolations ? existingModuleViolations : undefined,
  };

  // Per-domain LLM code violation promises
  type DomainLlmResult = { domain: string; violations: CodeViolation[]; resolvedIds: string[]; unchangedIds: string[] };
  const domainLlmPromises: Promise<DomainLlmResult>[] = [];

  for (const [domain, batches] of domainCodeBatches) {
    domainLlmPromises.push((async (): Promise<DomainLlmResult> => {
      const detCount = violationsByDomain.get(domain) ?? 0;
      log.info(`[LLM] ${domain}: starting (${batches.length} code batches)`);
      const t0 = Date.now();

      const codeResults = await Promise.allSettled(
        batches.map(b => provider.generateCodeViolations(b))
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

  // Database schema LLM — runs as part of the database domain (separate from code batches)
  if (dbSchemaContext && !llmSkipped) {
    // If database domain wasn't already activated by code batches, activate it now
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

        // Persist database schema violations directly (they have targetDatabaseId, not filePath)
        for (const v of dbResult.violations) {
          await db.insert(violations).values({
            id: randomUUID(),
            analysisId,
            type: 'database',
            title: v.title,
            content: v.content,
            severity: v.severity,
            status: 'new',
            targetDatabaseId: v.targetDatabaseId || null,
            targetTable: v.targetTable || null,
            fixPrompt: v.fixPrompt || null,
            ruleKey: v.ruleKey || 'unknown',
            firstSeenAnalysisId: analysisId,
            firstSeenAt: now,
          });
        }

        // Don't mark database done here — let the code batches do it, or mark if no code batches
        if (!domainCodeBatches.has('database')) {
          const detCount = violationsByDomain.get('database') ?? 0;
          const total = detCount + dbResult.violations.length;
          tracker?.done('database', total > 0 ? `${total} violations` : 'Clean');
        }

        return { domain: 'database-schema', violations: [], resolvedIds: [], unchangedIds: [] };
      } catch (err) {
        const dur = Date.now() - t0;
        log.warn(`[LLM] database-schema: failed in ${dur}ms — ${err instanceof Error ? err.message : String(err)}`);
        if (!domainCodeBatches.has('database')) {
          tracker?.error('database', `Schema LLM failed`);
        }
        return { domain: 'database-schema', violations: [], resolvedIds: [], unchangedIds: [] };
      }
    })());
  }

  let serviceDescriptions: { id: string; description: string }[] = [];

  emitProgress(86, 'Analyzing architecture & modules...');

  // LLM rule analysis promise (runs in parallel with deterministic enrichment)
  let llmStepCount = 0;
  const llmRulePromise = (async () => {
    if (enableLlmRules === false || llmSkipped) return; // LLM disabled or skipped by user
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
          id: randomUUID(),
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

    // Mark architecture done with count — other LLM domains update after llmCodePromise
    const archCount = serviceViolationResults.length + moduleViolationResults.length + methodViolationResults.length;
    tracker?.done('architecture', archCount > 0 ? `${archCount} violations` : 'Clean');
  })();

  // Await all: deterministic lifecycle + architecture LLM + per-domain code LLM
  const [detResult, llmResult, ...domainLlmResults] = await Promise.allSettled([
    deterministicPromise,
    llmRulePromise,
    ...domainLlmPromises,
  ]);

  if (detResult.status === 'rejected') {
    const msg = detResult.reason instanceof Error ? detResult.reason.message : String(detResult.reason);
    log.error(`[Violations] Deterministic lifecycle tracking failed: ${msg}`);
  }
  // Arch det counts held here; combined with code det counts after code
  // persistence finishes (further down), then logged as a single line.
  const archDetCounts =
    detResult.status === 'fulfilled'
      ? detResult.value
      : { newCount: 0, unchangedCount: 0, resolvedCount: 0 };
  if (llmResult.status === 'rejected') {
    const msg = llmResult.reason instanceof Error ? llmResult.reason.message : String(llmResult.reason);
    log.error(`[Violations] LLM architecture analysis failed: ${msg}`);
    tracker?.error('architecture', `LLM failed: ${msg.slice(0, 80)}`);
  }
  // Per-domain errors are already handled inside each promise (tracker?.done with fallback count)

  throwIfAborted(signal);
  tracker?.start('persist');
  emitProgress(95, 'Analysis complete');

  // 7. Save service descriptions
  for (const desc of serviceDescriptions) {
    if (desc.id) {
      await db
        .update(services)
        .set({ description: desc.description })
        .where(eq(services.id, desc.id));
    }
  }

  // 8. Persist code violations with lifecycle tracking
  // Deterministic code violations are persisted now (groups b + c).
  // LLM code violations (group a) are processed after deterministic ones.

  const scannedFilePaths = new Set(fileContents.keys());
  let codeResolvedCount = 0;

  // b) Deterministic matching for code violations in scanned files
  // (No LLM lifecycle IDs yet — those will be handled in the background)
  const prevForDeterministicMatching = previousActiveCodeViolations.filter(
    (v) => v.filePath && scannedFilePaths.has(v.filePath) && !v.ruleKey.includes('/llm/'),
  );

  let codeDetCounts = { newCount: 0, unchangedCount: 0, resolvedCount: 0 };
  if (allCodeViolations.length > 0 || prevForDeterministicMatching.length > 0) {
    codeDetCounts = await persistFileViolationsWithLifecycle({
      analysisId,
      currentViolations: allCodeViolations,
      previousViolations: prevForDeterministicMatching,
    });

    const currentKeys = new Set(allCodeViolations.map((cv) =>
      `${cv.filePath}::${cv.ruleKey}::${cv.lineStart}::${cv.lineEnd}`
    ));
    for (const prev of prevForDeterministicMatching) {
      const key = `${prev.filePath}::${prev.ruleKey}::${prev.lineStart}::${prev.lineEnd}`;
      if (!currentKeys.has(key)) codeResolvedCount++;
    }
  }

  // Combined deterministic tally (architecture + code, which are just
  // separate domains of the same flow). Single line, real totals.
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

  // c) Auto carry forward violations for unchanged files (non-LLM only now)
  const prevInUnchangedFiles = previousActiveCodeViolations.filter(
    (v) => v.filePath && !scannedFilePaths.has(v.filePath) && !v.ruleKey.includes('/llm/'),
  );

  for (const prev of prevInUnchangedFiles) {
    await db.insert(violations).values({
      id: randomUUID(),
      analysisId,
      type: 'code',
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
      previousViolationId: prev.id,
    });
  }

  // Collect all per-domain LLM code violations
  const allLlmCodeViolations: CodeViolation[] = [];
  const allLlmResolvedIds: string[] = [];
  const allLlmUnchangedIds: string[] = [];

  for (const result of domainLlmResults) {
    if (result.status === 'fulfilled') {
      const r = result.value as DomainLlmResult;
      allLlmCodeViolations.push(...r.violations);
      allLlmResolvedIds.push(...r.resolvedIds);
      allLlmUnchangedIds.push(...r.unchangedIds);
    }
    // Failures already logged and tracker updated inside each domain promise
  }

  if (allLlmCodeViolations.length > 0 || allLlmResolvedIds.length > 0) {
    log.info(`[Pipeline] LLM code totals: ${allLlmCodeViolations.length} new, ${allLlmResolvedIds.length} resolved, ${allLlmUnchangedIds.length} unchanged`);

    // LLM lifecycle: carry forward unchanged, mark resolved
    for (const prevId of allLlmUnchangedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      await db.insert(violations).values({
        id: randomUUID(),
        analysisId, type: 'code',
        filePath: prev.filePath, lineStart: prev.lineStart, lineEnd: prev.lineEnd,
        columnStart: prev.columnStart, columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey, severity: prev.severity, status: 'unchanged',
        title: prev.title, content: prev.content, snippet: prev.snippet,
        fixPrompt: prev.fixPrompt, firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt, previousViolationId: prev.id,
      });
    }

    for (const prevId of allLlmResolvedIds) {
      const prev = previousActiveCodeViolations.find((v) => v.id === prevId);
      if (!prev) continue;
      await db.insert(violations).values({
        id: randomUUID(),
        analysisId, type: 'code',
        filePath: prev.filePath, lineStart: prev.lineStart, lineEnd: prev.lineEnd,
        columnStart: prev.columnStart, columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey, severity: prev.severity, status: 'resolved',
        title: prev.title, content: prev.content, snippet: prev.snippet,
        fixPrompt: prev.fixPrompt, firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt, previousViolationId: prev.id, resolvedAt: now,
      });
    }

    // Persist new LLM code violations
    const handledIds = new Set([...allLlmUnchangedIds, ...allLlmResolvedIds]);
    const llmPrevForMatching = previousActiveCodeViolations.filter(
      (v) => v.ruleKey.includes('/llm/') && v.filePath && scannedFilePaths.has(v.filePath)
        && !handledIds.has(v.id),
    );

    if (allLlmCodeViolations.length > 0 || llmPrevForMatching.length > 0) {
      const counts = await persistFileViolationsWithLifecycle({
        analysisId,
        currentViolations: allLlmCodeViolations,
        previousViolations: llmPrevForMatching,
      });
      log.info(
        `[Pipeline] Persisted code (LLM): ${counts.newCount} new, ${counts.unchangedCount} unchanged, ${counts.resolvedCount} resolved`,
      );
    }

    // Carry forward LLM violations for unchanged files
    const llmPrevUnchangedFiles = previousActiveCodeViolations.filter(
      (v) => v.ruleKey.includes('/llm/') && v.filePath && !scannedFilePaths.has(v.filePath),
    );

    for (const prev of llmPrevUnchangedFiles) {
      await db.insert(violations).values({
        id: randomUUID(),
        analysisId, type: 'code',
        filePath: prev.filePath, lineStart: prev.lineStart, lineEnd: prev.lineEnd,
        columnStart: prev.columnStart, columnEnd: prev.columnEnd,
        ruleKey: prev.ruleKey, severity: prev.severity, status: 'unchanged',
        title: prev.title, content: prev.content, snippet: prev.snippet,
        fixPrompt: prev.fixPrompt, firstSeenAnalysisId: prev.firstSeenAnalysisId,
        firstSeenAt: prev.firstSeenAt, previousViolationId: prev.id,
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
  repoPath: string,
) {
  if (codeResult.violations.length === 0) return;

  let skippedPaths = 0;
  for (const v of codeResult.violations) {
    // LLM may return relative or absolute paths — resolve to match validFilePaths
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
    const ruleKey = v.ruleKey;

    allCodeViolations.push({
      ruleKey,
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


