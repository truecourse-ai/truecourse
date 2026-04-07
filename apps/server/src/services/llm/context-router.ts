import type { AnalysisRule, FileAnalysis, ContextRequirement, ContextTier, FileFilter, FunctionFilter } from '@truecourse/shared';
import { DATABASE_IMPORT_MAP, getAllTestPatterns } from '@truecourse/analyzer';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContextBatch {
  tier: ContextTier;
  rules: { key: string; name: string; severity: string; prompt: string }[];
  content: string;
  fileCount: number;
  functionCount?: number;
  estimatedTokens: number;
  /** Real file paths included in this batch (full-file/legacy tiers only). */
  filePaths?: string[];
}

export interface PreFlightEstimate {
  tiers: Array<{
    tier: string;
    ruleCount: number;
    fileCount: number;
    functionCount?: number;
    estimatedTokens: number;
  }>;
  totalEstimatedTokens: number;
  uniqueFileCount: number;
  uniqueRuleCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_PACKAGES = new Set(Object.keys(DATABASE_IMPORT_MAP));

const TEST_PATTERNS = getAllTestPatterns();

const CHARS_PER_TOKEN = 4; // rough estimate for token counting
const PROMPT_OVERHEAD_TOKENS = 500; // prompt template + instructions per LLM call
const TOKENS_PER_RULE = 50; // rule key + name + prompt line in the system message
const TOKENS_PER_FILE_PATH = 25; // "=== /path/to/file.ts ===\nRead this file..." per file in CLI mode
const MAX_CHARS_PER_BATCH = 100_000;

// ---------------------------------------------------------------------------
// File filter matching
// ---------------------------------------------------------------------------

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => filePath.includes(p));
}

function matchesFileFilter(
  fa: FileAnalysis,
  filter: FileFilter,
  fileContent?: string,
): boolean {
  if (filter.hasAsyncFunctions !== undefined) {
    const hasAsync = fa.functions.some((f) => f.isAsync) ||
      fa.classes.some((c) => c.methods.some((m) => m.isAsync));
    if (filter.hasAsyncFunctions !== hasAsync) return false;
  }

  if (filter.hasRouteHandlers !== undefined) {
    const hasRoutes = (fa.routeRegistrations?.length ?? 0) > 0;
    if (filter.hasRouteHandlers !== hasRoutes) return false;
  }

  if (filter.hasDbCalls !== undefined) {
    const hasDb = fa.imports.some((i) => DB_PACKAGES.has(i.source));
    if (filter.hasDbCalls !== hasDb) return false;
  }

  if (filter.hasCatchBlocks !== undefined) {
    // Simple heuristic: check if source contains 'catch' keyword
    const hasCatch = fileContent ? /\bcatch\s*\(/.test(fileContent) : false;
    if (filter.hasCatchBlocks !== hasCatch) return false;
  }

  if (filter.hasImportsFrom) {
    const hasImport = fa.imports.some((i) =>
      filter.hasImportsFrom!.some((s) => i.source.includes(s)),
    );
    if (!hasImport) return false;
  }

  if (filter.hasCallsTo) {
    const hasCall = fa.calls.some((c) =>
      filter.hasCallsTo!.some((t) => c.callee.includes(t)),
    );
    if (!hasCall) return false;
  }

  if (filter.isTestFile !== undefined) {
    if (filter.isTestFile !== isTestFile(fa.filePath)) return false;
  }

  if (filter.languages) {
    if (!filter.languages.includes(fa.language)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Function filter matching & extraction
// ---------------------------------------------------------------------------

interface ExtractedFunction {
  name: string;
  body: string;
  startLine: number;
  endLine: number;
}

function matchesFunctionFilter(
  fn: { name: string; isAsync: boolean; params: { name: string; type?: string }[]; location: { startLine: number; endLine: number } },
  filter: FunctionFilter,
  fa: FileAnalysis,
  contentLines?: string[],
): boolean {
  if (filter.isAsync !== undefined && filter.isAsync !== fn.isAsync) return false;

  if (filter.isRouteHandler) {
    const handlerNames = new Set(
      (fa.routeRegistrations || []).map((r) => r.handlerName),
    );
    if (!handlerNames.has(fn.name)) return false;
  }

  if (filter.containsCatchBlock && contentLines) {
    const fnLines = contentLines.slice(fn.location.startLine - 1, fn.location.endLine);
    const fnBody = fnLines.join('\n');
    if (!/\bcatch\s*\(/.test(fnBody)) return false;
  }

  if (filter.callsAny) {
    const fnCalls = fa.calls.filter(
      (c) =>
        c.callerFunction === fn.name ||
        (c.location.startLine >= fn.location.startLine &&
          c.location.endLine <= fn.location.endLine),
    );
    const hasMatchingCall = fnCalls.some((c) =>
      filter.callsAny!.some((t) => c.callee.includes(t)),
    );
    if (!hasMatchingCall) return false;
  }

  return true;
}

function extractTargetedFunctions(
  content: string,
  fa: FileAnalysis,
  filter: FunctionFilter,
): ExtractedFunction[] {
  const contentLines = content.split('\n');
  const results: ExtractedFunction[] = [];

  // Collect all functions: top-level + class methods
  const allFunctions: typeof fa.functions = [
    ...fa.functions,
    ...fa.classes.flatMap((c) => c.methods),
  ];

  for (const fn of allFunctions) {
    if (matchesFunctionFilter(fn, filter, fa, contentLines)) {
      const startIdx = Math.max(0, fn.location.startLine - 1);
      const endIdx = Math.min(contentLines.length, fn.location.endLine);
      const body = contentLines.slice(startIdx, endIdx).join('\n');
      results.push({
        name: fn.name,
        body,
        startLine: fn.location.startLine,
        endLine: fn.location.endLine,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Metadata summary builder
// ---------------------------------------------------------------------------

type MetadataField = NonNullable<ContextRequirement['metadataFields']>[number];

function buildMetadataSummary(fa: FileAnalysis, fields: MetadataField[]): string {
  const parts: string[] = [`=== ${fa.filePath} ===`];

  for (const field of fields) {
    switch (field) {
      case 'functions': {
        const fns = fa.functions.map((f) => {
          const tags: string[] = [];
          if (f.isAsync) tags.push('async');
          if (f.isExported) tags.push('exported');
          const params = f.params.map((p) => `${p.name}${p.type ? ': ' + p.type : ''}`).join(', ');
          const ret = f.returnType ? `: ${f.returnType}` : '';
          return `${f.name}(${params})${ret}${tags.length ? ' [' + tags.join(', ') + ']' : ''}`;
        });
        if (fns.length) parts.push(`Functions: ${fns.join(', ')}`);
        break;
      }
      case 'classes': {
        const cls = fa.classes.map((c) => {
          const methods = c.methods.map((m) => m.name).join(', ');
          return `${c.name}${c.superClass ? ' extends ' + c.superClass : ''} { ${methods} }`;
        });
        if (cls.length) parts.push(`Classes: ${cls.join(', ')}`);
        break;
      }
      case 'imports': {
        const imps = fa.imports.map((i) => i.source);
        if (imps.length) parts.push(`Imports: ${imps.join(', ')}`);
        break;
      }
      case 'exports': {
        const exps = fa.exports.map((e) => (e.isDefault ? `default ${e.name}` : e.name));
        if (exps.length) parts.push(`Exports: ${exps.join(', ')}`);
        break;
      }
      case 'calls': {
        const uniqueCallees = [...new Set(fa.calls.map((c) => c.callee))];
        if (uniqueCallees.length) parts.push(`Calls: ${uniqueCallees.slice(0, 30).join(', ')}${uniqueCallees.length > 30 ? ` (+${uniqueCallees.length - 30} more)` : ''}`);
        break;
      }
      case 'httpCalls': {
        const http = fa.httpCalls.map((h) => `${h.method} ${h.url}`);
        if (http.length) parts.push(`HTTP calls: ${http.join(', ')}`);
        break;
      }
      case 'routeRegistrations': {
        const routes = (fa.routeRegistrations || []).map((r) => `${r.httpMethod} ${r.path}`);
        if (routes.length) parts.push(`Routes: ${routes.join(', ')}`);
        break;
      }
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Rule grouping
// ---------------------------------------------------------------------------

interface RuleDto {
  key: string;
  name: string;
  severity: string;
  prompt: string;
}

interface GroupedRules {
  metadata: { rules: RuleDto[]; requirement: ContextRequirement }[];
  targeted: { rules: RuleDto[]; requirement: ContextRequirement }[];
  fullFile: { rules: RuleDto[]; requirement: ContextRequirement }[];
}

function contextKey(req: ContextRequirement): string {
  return JSON.stringify({
    tier: req.tier,
    ff: req.fileFilter || {},
    fnf: req.functionFilter || {},
    mf: req.metadataFields || [],
  });
}

function groupRulesByContext(rules: AnalysisRule[]): GroupedRules {
  const result: GroupedRules = { metadata: [], targeted: [], fullFile: [] };
  const groups = new Map<string, { rules: RuleDto[]; requirement: ContextRequirement }>();

  for (const rule of rules) {
    if (!rule.contextRequirement) continue;

    const dto: RuleDto = { key: rule.key, name: rule.name, severity: rule.severity, prompt: rule.prompt! };
    const key = contextKey(rule.contextRequirement);
    let group = groups.get(key);
    if (!group) {
      group = { rules: [], requirement: rule.contextRequirement };
      groups.set(key, group);
    }
    group.rules.push(dto);
  }

  for (const group of groups.values()) {
    switch (group.requirement.tier) {
      case 'metadata':
        result.metadata.push(group);
        break;
      case 'targeted':
        result.targeted.push(group);
        break;
      case 'full-file':
        result.fullFile.push(group);
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

function buildMetadataContent(
  group: { rules: RuleDto[]; requirement: ContextRequirement },
  fileAnalyses: FileAnalysis[],
  fileContents: Map<string, { content: string; lineCount: number }>,
): { content: string; fileCount: number } {
  const matching = fileAnalyses.filter((fa) => {
    if (!group.requirement.fileFilter) return true;
    const fc = fileContents.get(fa.filePath);
    return matchesFileFilter(fa, group.requirement.fileFilter, fc?.content);
  });

  const fields = (group.requirement.metadataFields || ['functions', 'imports', 'exports']) as MetadataField[];
  const summaries = matching.map((fa) => buildMetadataSummary(fa, fields));

  return { content: summaries.join('\n\n'), fileCount: matching.length };
}

function buildTargetedContent(
  group: { rules: RuleDto[]; requirement: ContextRequirement },
  fileAnalyses: FileAnalysis[],
  fileContents: Map<string, { content: string; lineCount: number }>,
): { content: string; fileCount: number; functionCount: number } {
  const filter = group.requirement.functionFilter || {};
  let totalFunctions = 0;
  const parts: string[] = [];

  for (const fa of fileAnalyses) {
    const fc = fileContents.get(fa.filePath);
    if (!fc) continue;

    if (group.requirement.fileFilter && !matchesFileFilter(fa, group.requirement.fileFilter, fc.content)) {
      continue;
    }

    const extracted = extractTargetedFunctions(fc.content, fa, filter);
    if (extracted.length === 0) continue;

    totalFunctions += extracted.length;
    const fileParts = [`=== ${fa.filePath} ===`];
    for (const fn of extracted) {
      const numbered = fn.body
        .split('\n')
        .map((line, i) => `${fn.startLine + i}: ${line}`)
        .join('\n');
      fileParts.push(`--- ${fn.name} (lines ${fn.startLine}-${fn.endLine}) ---\n${numbered}`);
    }
    parts.push(fileParts.join('\n'));
  }

  return { content: parts.join('\n\n'), fileCount: parts.length, functionCount: totalFunctions };
}

function buildFullFileContent(
  group: { rules: RuleDto[]; requirement: ContextRequirement },
  fileAnalyses: FileAnalysis[],
  fileContents: Map<string, { content: string; lineCount: number }>,
): { content: string; fileCount: number; filePaths: string[] } {
  const parts: string[] = [];
  const filePaths: string[] = [];

  for (const fa of fileAnalyses) {
    const fc = fileContents.get(fa.filePath);
    if (!fc) continue;

    if (group.requirement.fileFilter && !matchesFileFilter(fa, group.requirement.fileFilter, fc.content)) {
      continue;
    }

    const numbered = fc.content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
    parts.push(`=== ${fa.filePath} ===\n${numbered}`);
    filePaths.push(fa.filePath);
  }

  return { content: parts.join('\n\n'), fileCount: parts.length, filePaths };
}

// ---------------------------------------------------------------------------
// Batch splitting — ensures no single batch exceeds MAX_CHARS_PER_BATCH
// ---------------------------------------------------------------------------

function splitIntoBatches(
  tier: ContextTier,
  rules: RuleDto[],
  content: string,
  fileCount: number,
  functionCount?: number,
  filePaths?: string[],
): ContextBatch[] {
  if (content.length === 0) return [];

  const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

  if (content.length <= MAX_CHARS_PER_BATCH) {
    return [{
      tier,
      rules,
      content,
      fileCount,
      functionCount,
      estimatedTokens,
      filePaths,
    }];
  }

  // Split content by file sections (=== delimiter)
  const sections = content.split(/(?=^=== )/m);
  const batches: ContextBatch[] = [];
  let currentContent = '';
  let currentFileCount = 0;
  let currentFilePaths: string[] = [];

  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    if (currentContent.length + section.length > MAX_CHARS_PER_BATCH && currentContent.length > 0) {
      batches.push({
        tier,
        rules,
        content: currentContent,
        fileCount: currentFileCount,
        estimatedTokens: Math.ceil(currentContent.length / CHARS_PER_TOKEN),
        filePaths: currentFilePaths.length > 0 ? currentFilePaths : undefined,
      });
      currentContent = '';
      currentFileCount = 0;
      currentFilePaths = [];
    }
    currentContent += (currentContent ? '\n\n' : '') + section;
    currentFileCount++;
    if (filePaths && filePaths[si]) currentFilePaths.push(filePaths[si]);
  }

  if (currentContent.length > 0) {
    batches.push({
      tier,
      rules,
      content: currentContent,
      fileCount: currentFileCount,
      estimatedTokens: Math.ceil(currentContent.length / CHARS_PER_TOKEN),
      filePaths: currentFilePaths.length > 0 ? currentFilePaths : undefined,
    });
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function estimateContext(
  rules: AnalysisRule[],
  fileAnalyses: FileAnalysis[],
  fileContents: Map<string, { content: string; lineCount: number }>,
  options?: { useFilePaths?: boolean },
): PreFlightEstimate {
  const grouped = groupRulesByContext(rules);
  const tiers: PreFlightEstimate['tiers'] = [];
  const useFilePaths = options?.useFilePaths ?? false;

  // Helper: each context group's rules may span N domains.
  // The pipeline splits each group into N separate LLM calls (one per domain),
  // each getting the same content but only that domain's rules.
  // So overhead = domainCount × PROMPT_OVERHEAD, content is shared but sent N times.
  function estimateGroupTokens(contentTokens: number, rulesList: RuleDto[]): number {
    const domains = new Set(rulesList.map((r) => r.key.split('/')[0]));
    const domainCount = domains.size;
    return (contentTokens + PROMPT_OVERHEAD_TOKENS) * domainCount + (rulesList.length * TOKENS_PER_RULE);
  }

  // Metadata tiers — always inline content (summaries)
  for (const group of grouped.metadata) {
    const { content, fileCount } = buildMetadataContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      const contentTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
      tiers.push({
        tier: 'metadata',
        ruleCount: group.rules.length,
        fileCount,
        estimatedTokens: estimateGroupTokens(contentTokens, group.rules),
      });
    }
  }

  // Targeted tiers — always inline content (function extracts)
  for (const group of grouped.targeted) {
    const { content, fileCount, functionCount } = buildTargetedContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      const contentTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
      tiers.push({
        tier: 'targeted',
        ruleCount: group.rules.length,
        fileCount,
        functionCount,
        estimatedTokens: estimateGroupTokens(contentTokens, group.rules),
      });
    }
  }

  // Full-file tiers — CLI mode sends file paths only, API mode inlines content
  for (const group of grouped.fullFile) {
    const { content, fileCount } = buildFullFileContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      const contentTokens = useFilePaths
        ? fileCount * TOKENS_PER_FILE_PATH
        : Math.ceil(content.length / CHARS_PER_TOKEN);
      tiers.push({
        tier: 'full-file',
        ruleCount: group.rules.length,
        fileCount,
        estimatedTokens: estimateGroupTokens(contentTokens, group.rules),
      });
    }
  }

  const uniqueRules = new Set<string>();
  for (const group of [...grouped.metadata, ...grouped.targeted, ...grouped.fullFile]) {
    for (const r of group.rules) uniqueRules.add(r.key);
  }

  return {
    tiers,
    totalEstimatedTokens: tiers.reduce((sum, t) => sum + t.estimatedTokens, 0),
    uniqueFileCount: fileContents.size,
    uniqueRuleCount: uniqueRules.size,
  };
}

export function routeContext(
  rules: AnalysisRule[],
  fileAnalyses: FileAnalysis[],
  fileContents: Map<string, { content: string; lineCount: number }>,
): ContextBatch[] {
  const grouped = groupRulesByContext(rules);
  const batches: ContextBatch[] = [];

  // Build file analysis lookup by path
  const faByPath = new Map<string, FileAnalysis>();
  for (const fa of fileAnalyses) {
    faByPath.set(fa.filePath, fa);
  }

  // Metadata batches
  for (const group of grouped.metadata) {
    const { content, fileCount } = buildMetadataContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      batches.push(...splitIntoBatches('metadata', group.rules, content, fileCount));
    }
  }

  // Targeted batches
  for (const group of grouped.targeted) {
    const { content, fileCount, functionCount } = buildTargetedContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      batches.push(...splitIntoBatches('targeted', group.rules, content, fileCount, functionCount));
    }
  }

  // Full-file batches
  for (const group of grouped.fullFile) {
    const { content, fileCount, filePaths } = buildFullFileContent(group, fileAnalyses, fileContents);
    if (fileCount > 0) {
      batches.push(...splitIntoBatches('full-file', group.rules, content, fileCount, undefined, filePaths));
    }
  }

  return batches;
}
