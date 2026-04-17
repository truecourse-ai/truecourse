import { Langfuse } from 'langfuse';
import { config } from '../../config/index.js';
import type {
  ServiceViolationContext,
  DatabaseViolationContext,
  ModuleViolationContext,
  CodeViolationContext,
} from './provider.js';

// ---------------------------------------------------------------------------
// Prompt definitions — single source of truth
// ---------------------------------------------------------------------------

export const PROMPT_DEFINITIONS = {
  // --- Service prompts ---
  'violations-service': {
    prompt: `Analyze the following codebase architecture and identify violations and issues that need to be fixed.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a service, use the exact id from the Services list above. Do not fabricate or modify ids. Set targetServiceId to link violations to the correct service.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

The fixPrompt should be specific and actionable, using human-readable names (service names, file paths) — never include internal ids in fixPrompt.

Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-service-lifecycle': {
    prompt: `Analyze the following codebase architecture and identify violations and issues that need to be fixed.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}

Previous LLM violations (final violations from the PREVIOUS analysis):
{{existingViolations}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a service, use the exact id from the Services list above. Do not fabricate or modify ids. Set targetServiceId to link violations to the correct service.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous LLM violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous LLM violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the current data clearly shows the underlying issue no longer exists.

For previous LLM violations:
- Re-evaluate them against the current services and dependency data.
- Mark them resolved only if the current data clearly shows the issue no longer exists.
- If the current data is insufficient to prove the issue is gone, keep them in unchangedViolationIds.

ID population rules:
- Set targetServiceId whenever the corresponding service is identifiable from the input.
- Use null only when the relevant target cannot be determined from the provided data.
- Every ID copied into the output must exactly match an ID from the input.

The fixPrompt should be specific and actionable, using human-readable names (service names, file paths) — never include internal ids in fixPrompt.

Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

Before returning the final answer, perform a completeness check:
- Verify that every previous LLM violation ID appears exactly once in either resolvedViolationIds or unchangedViolationIds.
- Verify that every ID copied into the output exactly matches an ID from the input.
- Verify that no issue is represented in both unchangedViolationIds/resolvedViolationIds and newViolations.
- If any item is missing, duplicated, or uses an invalid ID, correct it before returning.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  // --- Database prompts ---
  'violations-database': {
    prompt: `Analyze the following database schemas and identify violations and issues that need to be fixed.

Databases:
{{databaseList}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a database, use the exact id from the Databases list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (table names, column names) in fixPrompts — never include internal ids.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-database-lifecycle': {
    prompt: `Analyze the following database schemas and identify violations and issues that need to be fixed.

Databases:
{{databaseList}}

Previous LLM violations (final violations from the PREVIOUS analysis):
{{existingViolations}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a database, use the exact id from the Databases list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous LLM violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous LLM violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the database schema data clearly shows the underlying issue no longer exists.

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (table names, column names) in fixPrompts — never include internal ids.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  // --- Module prompts ---
  'violations-module': {
    prompt: `Analyze the following modules and methods and identify violations and issues that need to be fixed.

Modules:
{{moduleList}}

Methods:
{{methodList}}

Module Dependencies:
{{moduleDependencyList}}

Method Dependencies:
{{methodDependencyList}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a module or method, use the exact id from the Modules or Methods list above. Do not fabricate or modify ids. Set targetModuleId and targetMethodId to link violations to the correct entities.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

The fixPrompt should be specific and actionable, using human-readable names (service names, module names, method names, file paths) — never include internal ids in fixPrompt.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-module-lifecycle': {
    prompt: `Analyze the following modules and methods and identify violations and issues that need to be fixed.

Modules:
{{moduleList}}

Methods:
{{methodList}}

Module Dependencies:
{{moduleDependencyList}}

Method Dependencies:
{{methodDependencyList}}

Previous LLM violations (final violations from the PREVIOUS analysis):
{{existingViolations}}

Analysis Rules:
{{llmRules}}

IMPORTANT: When referencing a module or method, use the exact id from the Modules or Methods list above. Do not fabricate or modify ids. Set targetModuleId and targetMethodId to link violations to the correct entities.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Only report violations that match one of the Analysis Rules listed above. Do NOT invent new rule categories or report issues outside the provided rules. For each violation, set ruleKey to the exact key from the matching rule. Every violation MUST have a ruleKey.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous LLM violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous LLM violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the current data clearly shows the underlying issue no longer exists.

For previous LLM violations:
- Re-evaluate them against the current modules, methods, and dependency data.
- Mark them resolved only if the current data clearly shows the issue no longer exists.
- If the current data is insufficient to prove the issue is gone, keep them in unchangedViolationIds.

ID population rules:
- Set targetServiceId, targetModuleId, and targetMethodId whenever the corresponding entity is identifiable from the input.
- Use null only when the relevant target cannot be determined from the provided data.
- Do not leave targetServiceId null when the service is explicitly given in the module or detection data.
- Every ID copied into the output must exactly match an ID from the input.

The fixPrompt should be specific and actionable, using human-readable names (service names, module names, method names, file paths) — never include internal ids in fixPrompt.

Before returning the final answer, perform a completeness check:
- Verify that every previous LLM violation ID appears exactly once in either resolvedViolationIds or unchangedViolationIds.
- Verify that every ID copied into the output exactly matches an ID from the input.
- Verify that no issue is represented in both unchangedViolationIds/resolvedViolationIds and newViolations.
- If any item is missing, duplicated, or uses an invalid ID, correct it before returning.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  // --- Code prompts (context-routed) ---
  'violations-code-metadata': {
    prompt: `You are analyzing codebase metadata summaries. You can see function signatures, imports, call patterns, and route registrations — but NOT full source code. Identify structural issues detectable from this metadata.

Rules to evaluate:
{{llmRules}}

Metadata summaries:
{{fileList}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Since you only see metadata (signatures, imports, calls), focus on structural patterns — missing capabilities, dependency issues, and configuration problems detectable without reading function bodies.
- Only report genuine issues. Do not flag trivial style preferences.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code-targeted': {
    prompt: `You are analyzing specific function implementations extracted from the codebase. Each function was selected because it matches criteria relevant to the rules below. Analyze the function bodies for the specified issues.

Rules to evaluate:
{{llmRules}}

Extracted functions:
{{fileList}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Each line in the source is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue.
- Only report genuine issues. Do not flag trivial style preferences.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code-metadata-lifecycle': {
    prompt: `You are analyzing codebase metadata summaries. You can see function signatures, imports, call patterns, and route registrations — but NOT full source code. Identify structural issues detectable from this metadata.

Rules to evaluate:
{{llmRules}}

Metadata summaries:
{{fileList}}

Previous code violations (from the PREVIOUS analysis):
{{existingViolations}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Since you only see metadata (signatures, imports, calls), focus on structural patterns — missing capabilities, dependency issues, and configuration problems detectable without reading function bodies.
- Only report genuine issues. Do not flag trivial style preferences.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous code violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous code violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the code clearly shows the underlying issue is fixed.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code-targeted-lifecycle': {
    prompt: `You are analyzing specific function implementations extracted from the codebase. Each function was selected because it matches criteria relevant to the rules below. Analyze the function bodies for the specified issues.

Rules to evaluate:
{{llmRules}}

Extracted functions:
{{fileList}}

Previous code violations (from the PREVIOUS analysis):
{{existingViolations}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Each line in the source is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue.
- Only report genuine issues. Do not flag trivial style preferences.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous code violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous code violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the code clearly shows the underlying issue is fixed.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  // --- Code prompts (full-file, Tier 3) ---
  'violations-code': {
    prompt: `You are analyzing full source files for specific code issues. Each file was selected because it is relevant to the rules below. Analyze the complete file content and identify violations matching the specified rules.

Rules to evaluate:
{{llmRules}}

Files to analyze:
{{fileList}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Each line in the source files is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range — typically a single function, statement, or block.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue.
- Only report genuine issues. Do not flag trivial style preferences.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code-lifecycle': {
    prompt: `You are analyzing full source files for specific code issues. Each file was selected because it is relevant to the rules below. Analyze the complete file content and identify violations matching the specified rules.

Rules to evaluate:
{{llmRules}}

Files to analyze:
{{fileList}}

Previous code violations (from the PREVIOUS analysis):
{{existingViolations}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories or report issues outside the provided rules.
- For each violation, set ruleKey to the exact key from the rules list. Every violation MUST have a ruleKey.
- filePath must exactly match one of the file paths provided above.
- Each line in the source files is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range — typically a single function, statement, or block.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue.
- Only report genuine issues. Do not flag trivial style preferences.

DE-DUPLICATION AND LIFECYCLE RULES:
- Every previous code violation ID must appear in exactly one of resolvedViolationIds or unchangedViolationIds.
- Create a newViolations item only when the current issue is not already covered by any previous code violation.
- Never represent the same issue in both unchangedViolationIds/resolvedViolationIds and newViolations.
- Only mark a previous violation as resolved when the code clearly shows the underlying issue is fixed.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'flow-enrichment': {
    prompt: `You are analyzing an execution flow through a codebase. Generate human-readable names and descriptions.

Flow: {{flowName}}
Entry: {{entryService}}.{{entryMethod}} (trigger: {{trigger}})

Steps:
{{stepList}}

For each step, describe what data flows between the source and target methods.
Return a human-readable flow name, a description of the overall flow purpose, and a data description for each step.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

} as const;

export type PromptName = keyof typeof PROMPT_DEFINITIONS;

// ---------------------------------------------------------------------------
// Prompt ID mapping — short IDs for LLM prompts instead of UUIDs
// ---------------------------------------------------------------------------

/** Maps short prompt IDs (e.g. svc-0) back to real UUIDs */
export type PromptIdMap = Map<string, string>;

function assignId(prefix: string, index: number, realId: string, idMap: PromptIdMap): string {
  const shortId = `${prefix}-${index}`;
  idMap.set(shortId, realId);
  return shortId;
}

/** Resolve a short ID back to a real UUID. Returns the original if not found. */
export function resolveId(shortId: string | null | undefined, idMap: PromptIdMap): string | null {
  if (!shortId) return null;
  return idMap.get(shortId) ?? shortId;
}

/** Resolve an array of short IDs back to real UUIDs. */
export function resolveIds(shortIds: string[], idMap: PromptIdMap): string[] {
  return shortIds.map((id) => idMap.get(id) ?? id);
}

export interface TemplateVarsResult {
  vars: Record<string, string>;
  idMap: PromptIdMap;
}

// ---------------------------------------------------------------------------
// Template variable helpers
// ---------------------------------------------------------------------------

/** Build template vars for violations-service prompt. */
export function buildServiceTemplateVars(context: ServiceViolationContext): TemplateVarsResult {
  const idMap: PromptIdMap = new Map();

  const serviceList = context.services
    .map(
      (s, i) =>
        `- ${s.name} [id: ${assignId('svc', i, s.id, idMap)}] (type: ${s.type}, framework: ${s.framework || 'none'}, files: ${s.fileCount}, layers: ${s.layers.join(', ') || 'none'})`
    )
    .join('\n');

  const depList = context.dependencies
    .map(
      (d) =>
        `- ${d.source} -> ${d.target} (count: ${d.count}, type: ${d.type || 'import'})`
    )
    .join('\n') || '(none)';

  const llmRules = context.llmRules.length
    ? context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] [key: ${r.key}] ${r.name}: ${r.prompt}`
      ).join('\n')
    : '(none)';

  const existingViolations = context.existingViolations?.length
    ? formatExistingViolations(context.existingViolations, 'prev', idMap)
    : '(none)';

  return { vars: { architecture: context.architecture, serviceList, depList, llmRules, existingViolations }, idMap };
}

/** Build template vars for violations-database prompt. */
export function buildDatabaseTemplateVars(context: DatabaseViolationContext): TemplateVarsResult {
  const idMap: PromptIdMap = new Map();

  const databaseList = context.databases.map((d, i) => {
    const shortId = assignId('db', i, d.id, idMap);
    let dbStr = `- ${d.name} [id: ${shortId}] (${d.type}, driver: ${d.driver}, tables: ${d.tableCount}, used by: ${d.connectedServices.join(', ') || 'none'})`;
    if (d.tables?.length) {
      dbStr += '\n  Schema:';
      for (const t of d.tables) {
        const cols = t.columns.map((c) => {
          let col = `${c.name}: ${c.type}`;
          if (c.isPrimaryKey) col += ' [PK]';
          if (c.isForeignKey) col += ` [FK → ${c.referencesTable}]`;
          if (c.isNullable) col += ' [nullable]';
          return col;
        }).join(', ');
        dbStr += `\n    ${t.name} (${cols})`;
      }
    }
    if (d.relations?.length) {
      dbStr += '\n  Relations:';
      for (const r of d.relations) {
        dbStr += `\n    ${r.sourceTable}.${r.foreignKeyColumn} → ${r.targetTable}`;
      }
    }
    return dbStr;
  }).join('\n');

  const llmRules = context.llmRules.length
    ? context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] [key: ${r.key}] ${r.name}: ${r.prompt}`
      ).join('\n')
    : '(none)';

  const existingViolations = context.existingViolations?.length
    ? formatExistingViolations(context.existingViolations, 'prev', idMap)
    : '(none)';

  return { vars: { databaseList, llmRules, existingViolations }, idMap };
}

/** Build template vars for violations-module prompt. */
export function buildModuleTemplateVars(context: ModuleViolationContext): TemplateVarsResult {
  const idMap: PromptIdMap = new Map();

  const moduleList = context.modules
    .map(
      (m, i) =>
        `- ${m.name} [id: ${assignId('mod', i, m.id, idMap)}] (kind: ${m.kind}, service: ${m.serviceName}, layer: ${m.layerName}, methods: ${m.methodCount}, properties: ${m.propertyCount}, imports: ${m.importCount}, exports: ${m.exportCount}${m.superClass ? `, extends: ${m.superClass}` : ''}${m.lineCount ? `, lines: ${m.lineCount}` : ''})`
    )
    .join('\n') || '(none)';

  let methodIndex = 0;
  const methodList = context.methods
    .map(
      (m) =>
        `- ${m.moduleName}.${m.name}${m.id ? ` [id: ${assignId('mth', methodIndex++, m.id, idMap)}]` : ''}: ${m.signature} (params: ${m.paramCount}${m.returnType ? `, returns: ${m.returnType}` : ''}${m.isAsync ? ', async' : ''}${m.lineCount ? `, lines: ${m.lineCount}` : ''}${m.statementCount ? `, statements: ${m.statementCount}` : ''}${m.maxNestingDepth ? `, nesting: ${m.maxNestingDepth}` : ''})`
    )
    .join('\n') || '(none)';

  const moduleDependencyList = context.moduleDependencies
    .map(
      (d) => `- ${d.sourceModule} -> ${d.targetModule} (imports: ${d.importedNames.join(', ')})`
    )
    .join('\n') || '(none)';

  const methodDependencyList = context.methodDependencies
    .map(
      (d) => `- ${d.callerModule}.${d.callerMethod} -> ${d.calleeModule}.${d.calleeMethod} (calls: ${d.callCount})`
    )
    .join('\n') || '(none)';

  const llmRules = context.llmRules.length
    ? context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] [key: ${r.key}] ${r.name}: ${r.prompt}`
      ).join('\n')
    : '(none)';

  const existingViolations = context.existingViolations?.length
    ? formatExistingViolations(context.existingViolations, 'prev', idMap)
    : '(none)';

  return { vars: { moduleList, methodList, moduleDependencyList, methodDependencyList, llmRules, existingViolations }, idMap };
}

// ---------------------------------------------------------------------------
// Deterministic enrichment template variable helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Diff template variable helpers
// ---------------------------------------------------------------------------

function formatExistingViolations(
  violations: { id: string; type: string; title: string; content: string; severity: string }[],
  prefix: string,
  idMap: PromptIdMap,
): string {
  if (!violations.length) return '(none)';
  return violations.map(
    (v, i) => `- [id: ${assignId(prefix, i, v.id, idMap)}] [${v.severity.toUpperCase()}] ${v.title}: ${v.content}`
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Code violation template variable helpers
// ---------------------------------------------------------------------------

/** Build template vars for violations-code prompt. */
export function buildCodeTemplateVars(
  context: CodeViolationContext,
  options?: { useFilePaths?: boolean },
): TemplateVarsResult {
  const idMap: PromptIdMap = new Map();

  const llmRules = context.llmRules
    .map((r) => `- [${r.severity.toUpperCase()}] [key: ${r.key}] ${r.name}: ${r.prompt}`)
    .join('\n');

  let fileList: string;
  if (options?.useFilePaths) {
    // CLI mode: pass file paths only — Claude reads them via Read tool
    fileList = context.files
      .map((f) => `=== ${f.path} ===\nRead this file using the Read tool before analyzing.`)
      .join('\n\n');
  } else {
    // API mode: inline file content with line numbers
    fileList = context.files
      .map((f) => {
        const numbered = f.content
          .split('\n')
          .map((line, i) => `${i + 1}: ${line}`)
          .join('\n');
        return `=== ${f.path} ===\n${numbered}`;
      })
      .join('\n\n');
  }

  const existingViolations = context.existingViolations?.length
    ? context.existingViolations.map(
        (v, i) => `- [id: ${assignId('cv', i, v.id, idMap)}] [${v.severity.toUpperCase()}] ${v.title}: ${v.content} (rule: ${v.ruleKey}, file: ${v.filePath}, lines: ${v.lineStart}-${v.lineEnd})`
      ).join('\n')
    : '(none)';

  return { vars: { llmRules, fileList, existingViolations }, idMap };
}

// ---------------------------------------------------------------------------
// Flow enrichment template variable helpers
// ---------------------------------------------------------------------------

export interface FlowEnrichmentContext {
  flowName: string;
  entryService: string;
  entryMethod: string;
  trigger: string;
  steps: {
    stepOrder: number;
    sourceService: string;
    sourceModule: string;
    sourceMethod: string;
    targetService: string;
    targetModule: string;
    targetMethod: string;
    stepType: string;
    isAsync: boolean;
  }[];
}

/** Build template vars for flow-enrichment prompt. */
export function buildFlowTemplateVars(context: FlowEnrichmentContext): Record<string, string> {
  const stepList = context.steps
    .map(
      (s) =>
        `${s.stepOrder}. ${s.sourceService}::${s.sourceModule}.${s.sourceMethod} → ${s.targetService}::${s.targetModule}.${s.targetMethod} (${s.stepType}${s.isAsync ? ', async' : ''})`
    )
    .join('\n');

  return {
    flowName: context.flowName,
    entryService: context.entryService,
    entryMethod: context.entryMethod,
    trigger: context.trigger,
    stepList,
  };
}

// ---------------------------------------------------------------------------
// Langfuse prompt fetching (with local fallback)
// ---------------------------------------------------------------------------

let langfuseInstance: Langfuse | null = null;
let langfuseChecked = false;
let langfuseAvailable = false;

async function getLangfuse(): Promise<Langfuse | null> {
  if (!(config.langfuse.publicKey && config.langfuse.secretKey)) {
    return null;
  }

  // Check connectivity once per session to avoid noisy SDK error logs
  if (!langfuseChecked) {
    langfuseChecked = true;
    try {
      const res = await fetch(`${config.langfuse.baseUrl || 'http://localhost:3001'}/api/public/health`, {
        signal: AbortSignal.timeout(3000),
      });
      langfuseAvailable = res.ok;
    } catch {
      langfuseAvailable = false;
    }
    if (!langfuseAvailable) {
      console.log('[Langfuse] Unavailable — using local prompts for this session.');
      return null;
    }
  }

  if (!langfuseAvailable) return null;

  if (!langfuseInstance) {
    langfuseInstance = new Langfuse({
      publicKey: config.langfuse.publicKey,
      secretKey: config.langfuse.secretKey,
      baseUrl: config.langfuse.baseUrl,
    });
  }
  return langfuseInstance;
}

export interface PromptResult {
  text: string;
  /** Langfuse prompt JSON string for telemetry linkage (null when using local fallback). */
  langfusePrompt: string | null;
}

/**
 * Get a compiled prompt string from Langfuse (falls back to local definition).
 * Returns the compiled text and optional Langfuse prompt metadata for trace linkage.
 */
export async function getPrompt(
  name: PromptName,
  variables?: Record<string, string>
): Promise<PromptResult> {
  const langfuse = await getLangfuse();
  const localDef = PROMPT_DEFINITIONS[name];

  if (langfuse) {
    try {
      const prompt = await langfuse.getPrompt(name, undefined, {
        type: 'text',
      });
      const compiled = prompt.compile(variables || {});
      return { text: compiled, langfusePrompt: prompt.toJSON() };
    } catch {
      // Prompt fetch failed — fall through to local definition
    }
  }

  // Local fallback: manually replace {{var}} placeholders
  let text = localDef.prompt as string;
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
  }
  return { text, langfusePrompt: null };
}
