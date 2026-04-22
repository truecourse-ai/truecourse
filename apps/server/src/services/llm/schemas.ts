import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas — scoped per call to prevent ID mixing
// Shared between AISDKProvider and CLIProvider
// ---------------------------------------------------------------------------

export const ServiceViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.literal('service'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      fixPrompt: z.string().nullable(),
      ruleKey: z.string().describe('The exact key from the Analysis Rules list that triggered this violation — must match one of the rule keys.'),
    })
  ),
  serviceDescriptions: z.array(
    z.object({
      id: z.string().describe('The service id, must be an exact id from the Services list'),
      description: z.string().describe('A concise 1-2 sentence description of what this service does'),
    })
  ),
});

export const DatabaseViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.literal('database'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetDatabaseId: z.string().nullable().describe('The id of the database this violation applies to, must be an exact id from the Databases list'),
      targetTable: z.string().nullable().describe('The exact table name this violation applies to'),
      fixPrompt: z.string().nullable(),
      ruleKey: z.string().describe('The exact key from the Analysis Rules list that triggered this violation — must match one of the rule keys.'),
    })
  ),
});

export const ModuleViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      type: z.enum(['module', 'function']).describe('Use "function" when the violation targets a specific function/method, use "module" when it targets the module/class itself'),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      fixPrompt: z.string().nullable(),
      ruleKey: z.string().describe('The exact key from the Analysis Rules list that triggered this violation — must match one of the rule keys.'),
    })
  ),
});

export const DiffViolationOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous violations that are now resolved — the issue no longer exists'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      type: z.enum(['service', 'database', 'module', 'function']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      targetServiceName: z.string().nullable(),
      targetModuleName: z.string().nullable(),
      targetMethodName: z.string().nullable(),
      fixPrompt: z.string().nullable(),
      ruleKey: z.string().describe('The exact key from the Analysis Rules list that triggered this violation — must match one of the rule keys.'),
    })
  ),
});

export const LifecycleServiceOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous violations that are now resolved — the issue no longer exists'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      type: z.enum(['service', 'database', 'module', 'function']),
      title: z.string(),
      content: z.string(),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      targetServiceId: z.string().nullable().describe('The id of the service this violation applies to, must be an exact id from the Services list'),
      targetModuleId: z.string().nullable().describe('The id of the module this violation applies to, must be an exact id from the Modules list'),
      targetMethodId: z.string().nullable().describe('The id of the method this violation applies to, must be an exact id from the Methods list'),
      targetServiceName: z.string().nullable(),
      targetModuleName: z.string().nullable(),
      targetMethodName: z.string().nullable(),
      fixPrompt: z.string().nullable(),
      ruleKey: z.string().describe('The exact key from the Analysis Rules list that triggered this violation — must match one of the rule keys.'),
    })
  ),
  serviceDescriptions: z.array(
    z.object({
      id: z.string().describe('The service id, must be an exact id from the Services list'),
      description: z.string().describe('A concise 1-2 sentence description of what this service does'),
    })
  ),
});

export const EnrichmentOutputSchema = z.object({
  enrichedViolations: z.array(
    z.object({
      id: z.string().describe('The exact id from the input detection — must match one of the detection ids'),
      title: z.string().describe('A clear, concise title for the violation'),
      content: z.string().describe('A detailed description of what is wrong and why it matters'),
      fixPrompt: z.string().describe('A specific, actionable prompt for an AI coding assistant to fix the issue'),
    })
  ),
});

export const CodeViolationOutputSchema = z.object({
  violations: z.array(
    z.object({
      ruleKey: z.string().describe('The exact key from the rules list'),
      filePath: z.string().describe('The exact file path from the files list'),
      lineStart: z.number().describe('The starting line number of the violation'),
      lineEnd: z.number().describe('The ending line number of the violation'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      title: z.string().describe('A concise title for the violation'),
      content: z.string().describe('A detailed description of the issue and why it matters'),
      fixPrompt: z.string().nullable().describe('A prompt an AI coding assistant could use to fix this issue'),
    })
  ),
});

export const CodeViolationLifecycleOutputSchema = z.object({
  resolvedViolationIds: z.array(z.string()).describe('IDs of previous code violations that are now resolved — the issue no longer exists in the current code'),
  unchangedViolationIds: z.array(z.string()).describe('IDs of previous code violations that still exist unchanged — every previous violation ID must appear in either resolvedViolationIds or unchangedViolationIds'),
  newViolations: z.array(
    z.object({
      ruleKey: z.string().describe('The exact key from the rules list'),
      filePath: z.string().describe('The exact file path from the files list'),
      lineStart: z.number().describe('The starting line number of the violation'),
      lineEnd: z.number().describe('The ending line number of the violation'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      title: z.string().describe('A concise title for the violation'),
      content: z.string().describe('A detailed description of the issue and why it matters'),
      fixPrompt: z.string().nullable().describe('A prompt an AI coding assistant could use to fix this issue'),
    })
  ),
});

export const FlowEnrichmentOutputSchema = z.object({
  name: z.string().describe('A human-readable name for this flow (e.g. "User Registration")'),
  description: z.string().describe('A concise description of what this flow does'),
  stepDescriptions: z.array(
    z.object({
      stepOrder: z.number().describe('The step number'),
      dataDescription: z.string().describe('What data flows in this step'),
    })
  ),
});

// ---------------------------------------------------------------------------
// ADR Suggest (Phase 19.1) — survey + draft output schemas
// ---------------------------------------------------------------------------
//
// Two schemas feed the two-pass suggest loop:
//
//   Pass 1 (survey) → AdrSurveyOutput  — list of topic candidates
//   Pass 2 (draft)  → AdrDraftOutput   — one MADR draft for one candidate
//
// `topic` is validated as a string here (not an enum) because the LLM may
// occasionally pick from outside the vocab — the suggester filters invalid
// topics AFTER Zod parse and logs them as "dropped" instead of throwing at
// the CLI parse boundary.

export const AdrSurveyCandidateSchema = z.object({
  topic: z.string(),
  entities: z.array(z.string()),
  rationale: z.string(),
});

export const AdrSurveyOutputSchema = z.object({
  candidates: z.array(AdrSurveyCandidateSchema).max(20),
});

export const AdrDraftOutputSchema = z.object({
  title: z.string(),
  madrBody: z.string(),
  topic: z.string(),
  entities: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
