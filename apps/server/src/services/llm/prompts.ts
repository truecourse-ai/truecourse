import { Langfuse } from 'langfuse';
import { config } from '../../config/index.js';
import type {
  ArchitectureContext,
  ArchitectureInsightContext,
  DatabaseInsightContext,
  ModuleInsightContext,
  DiffArchitectureContext,
  DiffDatabaseContext,
  DiffModuleContext,
} from './provider.js';

// ---------------------------------------------------------------------------
// Prompt definitions — single source of truth
// ---------------------------------------------------------------------------

export const PROMPT_DEFINITIONS = {
  'violations-architecture': {
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

Focus on:
1. Architecture anti-patterns
2. Dependency issues (circular dependencies, tight coupling)
3. Layer violations
4. Potential risks or code smells

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (service names, file paths) in fixPrompts — never include internal ids.

Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
    labels: ['production'],
  },

  'violations-database': {
    prompt: `Analyze the following database schemas and identify violations and issues that need to be fixed.

Databases:
{{databaseList}}
{{llmRules}}

IMPORTANT: When referencing a database, use the exact id from the Databases list above. Do not fabricate or modify ids.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Focus on:
1. Schema design issues (missing foreign keys, missing indexes)
2. Naming convention inconsistencies
3. Missing audit columns (created_at, updated_at)
4. Overly nullable schemas
5. Referential integrity concerns

For each issue, provide a fixPrompt that an external AI coding assistant could use to fix it. Use human-readable names (table names, column names) in fixPrompts — never include internal ids.

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
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
{{violations}}
{{llmRules}}

IMPORTANT: When referencing a module or method, use the exact id from the Modules or Methods list above. Do not fabricate or modify ids. Set targetServiceId, targetModuleId, and targetMethodId to link violations to the correct entities.

Only report actionable issues — do NOT include positive observations, compliments, or informational notes. Every item must describe a problem that needs fixing.

Focus on:
1. Circular module dependencies
2. Deep inheritance chains
3. Excessive fan-out or fan-in
4. Mixed abstraction levels in methods
5. Code organization issues

If violations are listed above, generate a violation entry for each with a concrete fixPrompt that an AI coding assistant could use to fix the issue. The fixPrompt should be specific and actionable, using human-readable names (service names, module names, method names, file paths) — never include internal ids in fixPrompt. Example: "Split UserService into UserQueryService and UserCommandService by separating read and write methods".

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
    labels: ['production'],
  },

  'violations-diff-architecture': {
    prompt: `Analyze the following codebase architecture and compare it against the existing known violations listed below. Identify ONLY new violations that are NOT already covered by existing violations, and identify which existing violations are now resolved.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}
{{violations}}
{{llmRules}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- Return ONLY genuinely new violations not already covered by an existing violation.
- Return IDs of existing violations that are now resolved (the issue no longer exists in the current code).
- Do NOT re-report violations that match existing ones.
- Use exact service names from the Services list. Do not fabricate ids.
- For each new violation, provide a fixPrompt that an AI coding assistant could use to fix it.

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
    labels: ['production'],
  },

  'violations-diff-database': {
    prompt: `Analyze the following database schemas and compare against the existing known violations listed below. Identify ONLY new violations not already covered, and identify which existing violations are now resolved.

Databases:
{{databaseList}}
{{llmRules}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- Return ONLY genuinely new violations not already covered by an existing violation.
- Return IDs of existing violations that are now resolved.
- Do NOT re-report violations that match existing ones.
- For each new violation, provide a fixPrompt using human-readable names.

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
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
{{violations}}
{{llmRules}}

Existing violations (with IDs — reference these when marking resolved):
{{existingViolations}}

IMPORTANT:
- Return ONLY genuinely new violations not already covered by an existing violation.
- Return IDs of existing violations that are now resolved.
- Do NOT re-report violations that match existing ones.
- Use exact service/module/method names. Do not fabricate ids.
- For each new violation, provide a fixPrompt using human-readable names.

If deterministic violations are listed above that are NOT covered by existing violations, generate a new violation entry for each with a concrete fixPrompt.

Return your findings as structured data using the provided schema.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
    labels: ['production'],
  },

  'architecture-summary': {
    prompt: `Provide a brief summary of the following codebase architecture. Be concise but informative.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}
{{violations}}
{{databases}}`,
    config: {
      model: 'gpt-4o',
      max_tokens: 2048,
    },
    labels: ['production'],
  },

  'chat-system': {
    prompt: `You are TrueCourse, an AI assistant that helps developers understand their codebase architecture.

You have deep knowledge about the project's architecture, services, dependencies, and layers.
When a user asks about a specific service or node, use the context provided to give detailed, accurate answers.

Be concise but thorough. Reference specific services, dependencies, and architectural patterns when relevant.
If you notice potential issues (circular dependencies, layer violations, tight coupling), proactively mention them.
When suggesting improvements, provide actionable advice that could be passed to an AI coding assistant.`,
    config: {
      model: 'gpt-4o',
      max_tokens: 4096,
    },
    labels: ['production'],
  },
} as const;

export type PromptName = keyof typeof PROMPT_DEFINITIONS;

// ---------------------------------------------------------------------------
// Template variable helpers
// ---------------------------------------------------------------------------

/** Build template vars for architecture-summary prompt (unchanged). */
export function buildTemplateVars(context: ArchitectureContext): Record<string, string> {
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

/** Build template vars for violations-architecture prompt. */
export function buildArchitectureTemplateVars(context: ArchitectureInsightContext): Record<string, string> {
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
export function buildDatabaseTemplateVars(context: DatabaseInsightContext): Record<string, string> {
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
export function buildModuleTemplateVars(context: ModuleInsightContext): Record<string, string> {
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

  return { moduleList, methodList, moduleDependencyList, violations, llmRules };
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

/** Build template vars for violations-diff-architecture prompt. */
export function buildDiffArchitectureTemplateVars(context: DiffArchitectureContext): Record<string, string> {
  const base = buildArchitectureTemplateVars(context);
  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
  };
}

/** Build template vars for violations-diff-database prompt. */
export function buildDiffDatabaseTemplateVars(context: DiffDatabaseContext): Record<string, string> {
  const base = buildDatabaseTemplateVars(context);
  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
  };
}

/** Build template vars for violations-diff-module prompt. */
export function buildDiffModuleTemplateVars(context: DiffModuleContext): Record<string, string> {
  const base = buildModuleTemplateVars(context);
  return {
    ...base,
    existingViolations: formatExistingViolations(context.existingViolations),
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

/**
 * Get a compiled prompt string from Langfuse (falls back to local definition).
 */
export async function getPrompt(
  name: PromptName,
  variables?: Record<string, string>
): Promise<string> {
  const langfuse = getLangfuse();
  const localDef = PROMPT_DEFINITIONS[name];

  if (langfuse) {
    try {
      const prompt = await langfuse.getPrompt(name, undefined, {
        type: 'text',
      });
      const compiled = prompt.compile(variables || {});
      return compiled;
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
  return text;
}
