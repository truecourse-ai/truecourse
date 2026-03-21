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
  'violations-service': {
    prompt: `Analyze the following codebase architecture and identify violations and issues that need to be fixed.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}
{{violations}}
{{lifecycleContext}}
{{llmRules}}

IMPORTANT: When referencing a service, use the exact id from the Services list above. Do not fabricate or modify ids. Set targetServiceId to link violations to the correct service.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

For each "Current deterministic detection", produce a final violation with proper wording and a concrete fixPrompt. Set deterministicViolationId to the detId from the detection. If a previous LLM violation already covers the same deterministic detection (same issue, same target), put that previous violation's ID in unchangedViolationIds instead of creating a duplicate.

The fixPrompt should be specific and actionable, using human-readable names (service names, file paths) — never include internal ids in fixPrompt.
{{lifecycleInstructions}}
Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-database': {
    prompt: `Analyze the following database schemas and identify violations and issues that need to be fixed.

Databases:
{{databaseList}}
{{lifecycleContext}}
{{llmRules}}

IMPORTANT: When referencing a database, use the exact id from the Databases list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (table names, column names) in fixPrompts — never include internal ids.
{{lifecycleInstructions}}
Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

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
{{violations}}
{{lifecycleContext}}
{{llmRules}}

IMPORTANT: When referencing a module or method, use the exact id from the Modules or Methods list above. Do not fabricate or modify ids. Set targetModuleId and targetMethodId to link violations to the correct entities.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

For each "Current deterministic detection", produce a final violation with proper wording and a concrete fixPrompt. Set deterministicViolationId to the detId from the detection. If a previous LLM violation already covers the same deterministic detection (same issue, same target), put that previous violation's ID in unchangedViolationIds instead of creating a duplicate.

The fixPrompt should be specific and actionable, using human-readable names (service names, module names, method names, file paths) — never include internal ids in fixPrompt.
{{lifecycleInstructions}}
Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code': {
    prompt: `You are a senior code reviewer. Analyze the following source files and identify semantic code quality issues that AST-based linting cannot detect.

Rules to evaluate:
{{llmRules}}

Files to analyze:
{{fileList}}
{{lifecycleContext}}
IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories.
- For each violation, use the exact rule name from the rules list.
- filePath must exactly match one of the file paths provided above.
- Each line in the source files is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range — typically a single function, statement, or block. Do NOT group multiple functions or unrelated code into one wide-spanning violation. If the same issue appears in multiple functions, report each as a separate violation with its own line range.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue. For example, if a function on lines 10-20 has a problem on lines 14-16, use lineStart=14, lineEnd=16 — not the entire function.
- Only report genuine issues a senior developer would flag in code review. Do not flag trivial style preferences.
- Do NOT report issues that overlap with deterministic linting (empty catch, console.log, hardcoded secrets, TODO comments, magic numbers, explicit any, SQL injection).
{{lifecycleInstructions}}
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

  'chat-system': {
    prompt: `You are TrueCourse, an AI assistant that helps developers understand their codebase architecture.

You have deep knowledge about the project's architecture, services, dependencies, and layers.
When a user asks about a specific service, module, function, or layer, use the context provided to give detailed, accurate answers.
Messages may include a [Node Context] block with structured data about the node being discussed (signature, parameters, complexity metrics, parent module/service, dependencies, violations, etc.). Use this data to give specific, grounded answers rather than generic ones.

Be concise but thorough. Reference specific services, dependencies, and architectural patterns when relevant.
If you notice potential issues (circular dependencies, layer violations, tight coupling, high complexity), proactively mention them.
When suggesting improvements, provide actionable advice that could be passed to an AI coding assistant.`,
    labels: ['production'],
  },
} as const;

export type PromptName = keyof typeof PROMPT_DEFINITIONS;

// ---------------------------------------------------------------------------
// Template variable helpers
// ---------------------------------------------------------------------------

/** Build template vars for violations-service prompt. */
export function buildServiceTemplateVars(context: ServiceViolationContext): Record<string, string> {
  const serviceList = context.services
    .map(
      (s) =>
        `- ${s.name} [id: ${s.id}] (type: ${s.type}, framework: ${s.framework || 'none'}, files: ${s.fileCount}, layers: ${s.layers.join(', ') || 'none'})`
    )
    .join('\n');

  const depList = context.dependencies
    .map(
      (d) =>
        `- ${d.source} -> ${d.target} (count: ${d.count}, type: ${d.type || 'import'})`
    )
    .join('\n') || '(none)';

  const violations = context.violations?.length
    ? `\nCurrent deterministic detections (raw signals from static analysis on the CURRENT code — you must produce a final violation for each):\n${context.violations.map(
        (v) => `- ${v.deterministicViolationId ? `[detId: ${v.deterministicViolationId}] ` : ''}[${v.severity.toUpperCase()}] ${v.title}: ${v.description} (rule: ${v.ruleKey}, service: ${v.serviceName})`
      ).join('\n')}`
    : '';

  const llmRules = context.llmRules.length
    ? `\nAnalysis Rules (evaluate the architecture against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  // Lifecycle context: only present on 2nd+ analysis
  let lifecycleContext = '';
  let lifecycleInstructions = '';

  if (context.existingViolations?.length) {
    const parts: string[] = [];

    if (context.baselineViolations?.length) {
      parts.push(`\nPrevious deterministic detections (raw signals from the PREVIOUS analysis — each one already has a corresponding final violation in "Previous LLM violations" below. If an item here is missing from "Current deterministic detections" above, the issue has been fixed and its corresponding previous violation should be marked resolved):\n${context.baselineViolations.join('\n')}`);
    }

    parts.push(`\nPrevious LLM violations (final violations from the PREVIOUS analysis — includes both deterministic-based and LLM-discovered violations):\n${formatExistingViolations(context.existingViolations)}`);

    lifecycleContext = parts.join('\n');

    lifecycleInstructions = `
LIFECYCLE RULES (comparing against previous analysis):
- For each previous LLM violation, decide: is it RESOLVED (issue no longer exists in current data) or UNCHANGED (issue still exists)?
- Return the ID of each previous violation in EITHER resolvedViolationIds OR unchangedViolationIds. Every previous violation ID must appear in exactly one of these lists.
- Only add to "newViolations" issues that are genuinely new — not already described by any previous LLM violation.
- ONLY mark a violation as resolved if the data clearly shows the underlying issue is gone.
`;
  }

  return { architecture: context.architecture, serviceList, depList, violations, llmRules, lifecycleContext, lifecycleInstructions };
}

/** Build template vars for violations-database prompt. */
export function buildDatabaseTemplateVars(context: DatabaseViolationContext): Record<string, string> {
  const databaseList = context.databases.map((d) => {
    let dbStr = `- ${d.name} [id: ${d.id}] (${d.type}, driver: ${d.driver}, tables: ${d.tableCount}, used by: ${d.connectedServices.join(', ') || 'none'})`;
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
    ? `\nAnalysis Rules (evaluate the databases against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  let lifecycleContext = '';
  let lifecycleInstructions = '';

  if (context.existingViolations?.length) {
    lifecycleContext = `\nPrevious LLM violations (final violations from the PREVIOUS analysis — includes both deterministic-based and LLM-discovered violations):\n${formatExistingViolations(context.existingViolations)}`;

    lifecycleInstructions = `
LIFECYCLE RULES (comparing against previous analysis):
- For each previous LLM violation, decide: is it RESOLVED (issue no longer exists in current data) or UNCHANGED (issue still exists)?
- Return the ID of each previous violation in EITHER resolvedViolationIds OR unchangedViolationIds. Every previous violation ID must appear in exactly one of these lists.
- Only add to "newViolations" issues that are genuinely new — not already described by any previous LLM violation.
- ONLY mark a violation as resolved if the database schema data clearly shows the underlying issue is fixed.
`;
  }

  return { databaseList, llmRules, lifecycleContext, lifecycleInstructions };
}

/** Build template vars for violations-module prompt. */
export function buildModuleTemplateVars(context: ModuleViolationContext): Record<string, string> {
  const moduleList = context.modules
    .map(
      (m) =>
        `- ${m.name} [id: ${m.id}] (kind: ${m.kind}, service: ${m.serviceName}, layer: ${m.layerName}, methods: ${m.methodCount}, properties: ${m.propertyCount}, imports: ${m.importCount}, exports: ${m.exportCount}${m.superClass ? `, extends: ${m.superClass}` : ''}${m.lineCount ? `, lines: ${m.lineCount}` : ''})`
    )
    .join('\n') || '(none)';

  const methodList = context.methods
    .map(
      (m) =>
        `- ${m.moduleName}.${m.name}${m.id ? ` [id: ${m.id}]` : ''}: ${m.signature} (params: ${m.paramCount}${m.returnType ? `, returns: ${m.returnType}` : ''}${m.isAsync ? ', async' : ''}${m.lineCount ? `, lines: ${m.lineCount}` : ''}${m.statementCount ? `, statements: ${m.statementCount}` : ''}${m.maxNestingDepth ? `, nesting: ${m.maxNestingDepth}` : ''})`
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

  const violations = context.violations?.length
    ? `\nCurrent deterministic detections (raw signals from static analysis on the CURRENT code — you must produce a final violation for each):\n${context.violations.map(
        (v) => `- ${v.deterministicViolationId ? `[detId: ${v.deterministicViolationId}] ` : ''}[${v.severity.toUpperCase()}] ${v.title}: ${v.description} (rule: ${v.ruleKey}, service: ${v.serviceName}${v.serviceId ? ` [serviceId: ${v.serviceId}]` : ''}${v.moduleName ? `, module: ${v.moduleName}` : ''}${v.moduleId ? ` [moduleId: ${v.moduleId}]` : ''}${v.methodName ? `, method: ${v.methodName}` : ''}${v.methodId ? ` [methodId: ${v.methodId}]` : ''})`
      ).join('\n')}`
    : '';

  const llmRules = context.llmRules.length
    ? `\nAnalysis Rules (evaluate the modules against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  let lifecycleContext = '';
  let lifecycleInstructions = '';

  if (context.existingViolations?.length) {
    const parts: string[] = [];

    if (context.baselineViolations?.length) {
      parts.push(`\nPrevious deterministic detections (raw signals from the PREVIOUS analysis — each one already has a corresponding final violation in "Previous LLM violations" below. If an item here is missing from "Current deterministic detections" above, the issue has been fixed and its corresponding previous violation should be marked resolved):\n${context.baselineViolations.join('\n')}`);
    }

    parts.push(`\nPrevious LLM violations (final violations from the PREVIOUS analysis — includes both deterministic-based and LLM-discovered violations):\n${formatExistingViolations(context.existingViolations)}`);

    lifecycleContext = parts.join('\n');

    lifecycleInstructions = `
LIFECYCLE RULES (comparing against previous analysis):
- For each previous LLM violation, decide: is it RESOLVED (issue no longer exists in current data) or UNCHANGED (issue still exists)?
- Return the ID of each previous violation in EITHER resolvedViolationIds OR unchangedViolationIds. Every previous violation ID must appear in exactly one of these lists.
- Only add to "newViolations" issues that are genuinely new — not already described by any previous LLM violation.
- ONLY mark a violation as resolved if the data clearly shows the underlying issue is gone.
`;
  }

  return { moduleList, methodList, moduleDependencyList, methodDependencyList, violations, llmRules, lifecycleContext, lifecycleInstructions };
}

// ---------------------------------------------------------------------------
// Diff template variable helpers
// ---------------------------------------------------------------------------

function formatExistingViolations(violations: { id: string; type: string; title: string; content: string; severity: string }[]): string {
  if (!violations.length) return '(none)';
  return violations.map(
    (v) => `- [id: ${v.id}] [${v.severity.toUpperCase()}] ${v.title}: ${v.content}`
  ).join('\n');
}

// ---------------------------------------------------------------------------
// Code violation template variable helpers
// ---------------------------------------------------------------------------

/** Build template vars for violations-code prompt. */
export function buildCodeTemplateVars(context: CodeViolationContext): Record<string, string> {
  const llmRules = context.llmRules
    .map((r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`)
    .join('\n');

  const fileList = context.files
    .map((f) => {
      const numbered = f.content
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');
      return `=== ${f.path} ===\n${numbered}`;
    })
    .join('\n\n');

  let lifecycleContext = '';
  let lifecycleInstructions = '';

  if (context.existingViolations?.length) {
    lifecycleContext = `\nPrevious code violations (from the PREVIOUS analysis — for lifecycle comparison only):\n${context.existingViolations.map(
      (v) => `- [id: ${v.id}] [${v.severity.toUpperCase()}] ${v.title}: ${v.content} (rule: ${v.ruleKey}, file: ${v.filePath}, lines: ${v.lineStart}-${v.lineEnd})`
    ).join('\n')}`;

    lifecycleInstructions = `
LIFECYCLE RULES (comparing against previous analysis):
- For each previous code violation, decide: is it RESOLVED (issue no longer exists in the current code) or UNCHANGED (issue still exists)?
- Return the ID of each previous violation in EITHER resolvedViolationIds OR unchangedViolationIds. Every previous violation ID must appear in exactly one of these lists.
- Only add to "newViolations" issues that are genuinely new — not already described by any previous code violation.
- ONLY mark a violation as resolved if the code clearly shows the underlying issue is fixed.
`;
  }

  return { llmRules, fileList, lifecycleContext, lifecycleInstructions };
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

function getLangfuse(): Langfuse | null {
  if (!(config.langfuse.publicKey && config.langfuse.secretKey)) {
    return null;
  }
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
  const langfuse = getLangfuse();
  const localDef = PROMPT_DEFINITIONS[name];

  if (langfuse) {
    try {
      const prompt = await langfuse.getPrompt(name, undefined, {
        type: 'text',
      });
      const compiled = prompt.compile(variables || {});
      return { text: compiled, langfusePrompt: prompt.toJSON() };
    } catch {
      // Fallback to local definition
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
