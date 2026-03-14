import { Langfuse } from 'langfuse';
import { config } from '../../config/index.js';
import type { ArchitectureContext } from './provider.js';

// ---------------------------------------------------------------------------
// Prompt definitions — single source of truth
// ---------------------------------------------------------------------------

export const PROMPT_DEFINITIONS = {
  'insights-generation': {
    prompt: `Analyze the following codebase architecture and provide actionable insights.

Architecture: {{architecture}}

Services:
{{serviceList}}

Dependencies:
{{depList}}
{{violations}}
{{databases}}
{{llmRules}}

Focus on:
1. Architecture patterns and anti-patterns
2. Dependency issues (circular dependencies, tight coupling)
3. Layer violations
4. Database usage patterns (connection sharing, ORM choices, missing indices hints)
5. Suggestions for improvement
6. Potential risks or code smells

Also provide a concise 1-2 sentence description for each service explaining what it does and its role in the architecture.

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
