import { Langfuse } from 'langfuse';
import { config } from '../../config/index.js';
import type {
  ServiceSummaryContext,
  ServiceViolationContext,
  DatabaseViolationContext,
  ModuleViolationContext,
  DiffServiceContext,
  DiffDatabaseContext,
  DiffModuleContext,
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
{{llmRules}}

IMPORTANT: When referencing a service, use the exact id from the Services list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (service names, file paths) in fixPrompts — never include internal ids.

Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-database': {
    prompt: `Analyze the following database schemas and identify violations and issues that need to be fixed.

Databases:
{{databaseList}}
{{llmRules}}

IMPORTANT: When referencing a database, use the exact id from the Databases list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (table names, column names) in fixPrompts — never include internal ids.

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
{{llmRules}}

IMPORTANT: When referencing a module or method, use the exact id from the Modules or Methods list above. Do not fabricate or modify ids. Set targetServiceId, targetModuleId, and targetMethodId to link violations to the correct entities.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

If violations are listed above, generate a violation entry for each with a concrete fixPrompt that an AI coding assistant could use to fix the issue. The fixPrompt should be specific and actionable, using human-readable names (service names, module names, method names, file paths) — never include internal ids in fixPrompt. Example: "Split UserService into UserQueryService and UserCommandService by separating read and write methods".

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-diff-service': {
    prompt: `Analyze the following codebase architecture and compare it against the existing known violations listed below. Identify ONLY new violations that are NOT already covered by existing violations, and identify which existing violations are now resolved.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}

Current deterministic violations (layer violations detected by static analysis on the current code):
{{violations}}
{{baselineViolations}}
{{llmRules}}

Changed files (ONLY these files were modified):
{{changedFiles}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- ONLY report new violations that are DIRECTLY CAUSED BY or RELATED TO the changed files listed above. Do NOT report issues in parts of the architecture unaffected by the changes.
- Return ONLY genuinely new violations not already covered by an existing violation. If an existing violation already describes the same issue (even with slightly different wording or numbers), do NOT create a new one.
- Return IDs of existing violations that are now resolved (the issue no longer exists in the current code).
- ONLY mark a violation as resolved if the data above clearly shows the underlying issue is gone. Do NOT resolve violations for areas unaffected by the changed files.
- If a "Baseline deterministic violation" was present but is NOT listed under "Current deterministic violations", that means the issue has been fixed — mark the matching existing violation as resolved.
- If an existing violation mentions a specific count (e.g. "4 dependencies") and the current data shows a different count, the old violation is stale — mark it as resolved and create a new violation with the updated information.
- Use exact service names from the Services list. Do not fabricate ids.
- For each new violation, provide a fixPrompt that an AI coding assistant could use to fix it.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-diff-database': {
    prompt: `Analyze the following database schemas and compare against the existing known violations listed below. Identify ONLY new violations not already covered, and identify which existing violations are now resolved.

Databases:
{{databaseList}}
{{llmRules}}

Changed files (ONLY these files were modified):
{{changedFiles}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- ONLY report new violations that are DIRECTLY CAUSED BY or RELATED TO the changed files listed above. Do NOT report issues found in the broader schema that are unrelated to the changes. If a table, column, or relationship was not affected by the changed files, do NOT flag it.
- Return ONLY genuinely new violations not already covered by an existing violation. If an existing violation already describes the same issue (even with slightly different wording), do NOT create a new one.
- Return IDs of existing violations that are now resolved.
- ONLY mark a violation as resolved if the database schema data above clearly shows the underlying issue is fixed. Do NOT resolve violations for tables/columns unaffected by the changed files.
- Do NOT re-report violations that match existing ones.
- For each new violation, provide a fixPrompt using human-readable names.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-diff-module': {
    prompt: `Analyze the following modules and methods and compare against the existing known violations listed below. Identify ONLY new violations not already covered, and identify which existing violations are now resolved.

Modules:
{{moduleList}}

Methods:
{{methodList}}

Module Dependencies:
{{moduleDependencyList}}

Method Dependencies:
{{methodDependencyList}}
{{violations}}
{{llmRules}}

Changed files (ONLY these files were modified):
{{changedFiles}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- ONLY report new violations that are DIRECTLY CAUSED BY or RELATED TO the changed files listed above. Do NOT report issues in modules, methods, or dependencies unaffected by the changes.
- Return ONLY genuinely new violations not already covered by an existing violation. If an existing violation already describes the same issue (even with slightly different wording), do NOT create a new one.
- Return IDs of existing violations that are now resolved.
- ONLY mark a violation as resolved if the module/dependency data above clearly shows the underlying issue is gone (e.g., a circular dependency chain is broken because a dependency no longer exists). Do NOT resolve violations for modules unaffected by the changed files.
- When checking for circular dependencies, verify the FULL chain exists in the Module Dependencies list. If any link in the chain is missing, the cycle is broken and the violation should be resolved.
- Do NOT re-report violations that match existing ones.
- Use exact service/module/method names. Do not fabricate ids.
- For each new violation, provide a fixPrompt using human-readable names.

If deterministic violations are listed above that are NOT covered by existing violations, generate a new violation entry for each with a concrete fixPrompt.

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'violations-code': {
    prompt: `You are a senior code reviewer. Analyze the following source files and identify semantic code quality issues that AST-based linting cannot detect.

Rules to evaluate:
{{llmRules}}

Files to analyze:
{{fileList}}

IMPORTANT:
- Only report issues from the rules listed above. Do not invent new rule categories.
- For each violation, use the exact rule name from the rules list.
- filePath must exactly match one of the file paths provided above.
- Each line in the source files is prefixed with its line number (e.g. "46: const token = ..."). Use these numbers directly for lineStart and lineEnd — do NOT count lines yourself.
- Keep violations narrow and precise. Each violation should target the smallest relevant code range — typically a single function, statement, or block. Do NOT group multiple functions or unrelated code into one wide-spanning violation. If the same issue appears in multiple functions, report each as a separate violation with its own line range.
- lineStart and lineEnd should tightly wrap only the specific lines exhibiting the issue. For example, if a function on lines 10-20 has a problem on lines 14-16, use lineStart=14, lineEnd=16 — not the entire function.
- Only report genuine issues a senior developer would flag in code review. Do not flag trivial style preferences.
- Do NOT report issues that overlap with deterministic linting (empty catch, console.log, hardcoded secrets, TODO comments, magic numbers, explicit any, SQL injection).

Return your findings as structured data using the provided schema.`,
    labels: ['production'],
  },

  'service-summary': {
    prompt: `Provide a brief summary of the following codebase architecture. Be concise but informative.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}
{{violations}}
{{databases}}`,
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

/** Build template vars for service-summary prompt. */
export function buildTemplateVars(context: ServiceSummaryContext): Record<string, string> {
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
    ? `\nViolations detected:\n${context.violations.map((v) => `- ${v}`).join('\n')}`
    : '';

  const databases = context.databases?.length
    ? `\nDatabases:\n${context.databases.map((d) => {
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
      }).join('\n')}`
    : '';

  const llmRules = context.llmRules?.length
    ? `\nAnalysis Rules (evaluate the architecture against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  return { architecture: context.architecture, serviceList, depList, violations, databases, llmRules };
}

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
    ? `\nViolations detected:\n${context.violations.map((v) => `- ${v}`).join('\n')}`
    : '';

  const llmRules = context.llmRules.length
    ? `\nAnalysis Rules (evaluate the architecture against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  return { architecture: context.architecture, serviceList, depList, violations, llmRules };
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

  return { databaseList, llmRules };
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
    ? `\nDeterministic violations detected (generate a violation with fixPrompt for each, and link to the correct service/module/method using their ids):\n${context.violations.map(
        (v) => `- [${v.severity.toUpperCase()}] ${v.title}: ${v.description} (rule: ${v.ruleKey}, service: ${v.serviceName}${v.serviceId ? ` [serviceId: ${v.serviceId}]` : ''}${v.moduleName ? `, module: ${v.moduleName}` : ''}${v.moduleId ? ` [moduleId: ${v.moduleId}]` : ''}${v.methodName ? `, method: ${v.methodName}` : ''}${v.methodId ? ` [methodId: ${v.methodId}]` : ''})`
      ).join('\n')}`
    : '';

  const llmRules = context.llmRules.length
    ? `\nAnalysis Rules (evaluate the modules against these):\n${context.llmRules.map(
        (r) => `- [${r.severity.toUpperCase()}] ${r.name}: ${r.prompt}`
      ).join('\n')}`
    : '';

  return { moduleList, methodList, moduleDependencyList, methodDependencyList, violations, llmRules };
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

function formatChangedFiles(files: string[]): string {
  if (!files.length) return '(none)';
  return files.map((f) => `- ${f}`).join('\n');
}

/** Build template vars for violations-diff-service prompt. */
export function buildDiffServiceTemplateVars(context: DiffServiceContext): Record<string, string> {
  const base = buildServiceTemplateVars(context);

  const baselineViolations = context.baselineViolations?.length
    ? `\nBaseline deterministic violations (from the previous analysis — if an item here is NOT in "Current deterministic violations" above, the issue has been fixed):\n${context.baselineViolations.map((v) => `- ${v}`).join('\n')}`
    : '';

  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
    changedFiles: formatChangedFiles(context.changedFiles),
    baselineViolations,
  };
}

/** Build template vars for violations-diff-database prompt. */
export function buildDiffDatabaseTemplateVars(context: DiffDatabaseContext): Record<string, string> {
  const base = buildDatabaseTemplateVars(context);
  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
    changedFiles: formatChangedFiles(context.changedFiles),
  };
}

/** Build template vars for violations-diff-module prompt. */
export function buildDiffModuleTemplateVars(context: DiffModuleContext): Record<string, string> {
  const base = buildModuleTemplateVars(context);
  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
    changedFiles: formatChangedFiles(context.changedFiles),
  };
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

  return { llmRules, fileList };
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
