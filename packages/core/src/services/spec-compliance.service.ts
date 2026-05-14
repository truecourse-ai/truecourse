import { createSpecExtractionManifest, extractCodeFacts } from '@truecourse/analyzer';
import {
  SpecComplianceConfigSchema,
  canonicalJson,
  type CodeFact,
  type ComplianceResult,
  type ComplianceSeverity,
  type ComplianceStatus,
  type Requirement,
  type SpecComplianceConfig,
  type SpecExtractionManifest,
} from '@truecourse/shared';
import { readProjectConfig } from '../config/project-config.js';
import type { LLMProvider } from './llm/provider.js';
import { extractRequirementsFromManifest, type RequirementExtractionError } from './spec-requirement-extraction.service.js';
import { evaluateSpecCompliance } from './spec-compliance-matchers.service.js';
import type { SpecComplianceFinding } from './spec-compliance-matchers/types.js';

type SpecComplianceFindingStatus = ComplianceStatus | 'unspecified';

export interface SpecComplianceArtifact {
  enabled: boolean;
  config: SpecComplianceConfig;
  manifest: SpecExtractionManifest;
  requirements: Requirement[];
  facts: CodeFact[];
  results: ComplianceResult[];
  visibleResults: ComplianceResult[];
  findings: SpecComplianceFinding[];
  errors: Array<RequirementExtractionError | { sourceFile: string; message: string }>;
  summary: {
    requirements: number;
    facts: number;
    results: number;
    visibleResults: number;
    findings: number;
    byStatus: Record<SpecComplianceFindingStatus, number>;
    bySeverity: Record<ComplianceSeverity, number>;
  };
}

export interface RunSpecComplianceOptions {
  enabled?: boolean;
  specs?: string[];
  showSatisfied?: boolean;
  noLlm?: boolean;
  provider?: Pick<LLMProvider, 'model' | 'extractProseRequirements'>;
}

const STATUS_ORDER: SpecComplianceFindingStatus[] = [
  'satisfied',
  'missing',
  'partial',
  'conflicting',
  'ambiguous',
  'unverifiable',
  'unspecified',
];

const SEVERITY_ORDER: ComplianceSeverity[] = ['info', 'warning', 'error'];

function emptyStatusCounts(): Record<SpecComplianceFindingStatus, number> {
  return {
    satisfied: 0,
    missing: 0,
    partial: 0,
    conflicting: 0,
    ambiguous: 0,
    unverifiable: 0,
    unspecified: 0,
  };
}

function emptySeverityCounts(): Record<ComplianceSeverity, number> {
  return { info: 0, warning: 0, error: 0 };
}

function artifactSummary(input: {
  requirements: Requirement[];
  facts: CodeFact[];
  results: ComplianceResult[];
  visibleResults: ComplianceResult[];
  findings: SpecComplianceFinding[];
}): SpecComplianceArtifact['summary'] {
  const byStatus = emptyStatusCounts();
  const bySeverity = emptySeverityCounts();
  for (const result of input.results) {
    byStatus[result.status]++;
    bySeverity[result.severity]++;
  }
  for (const finding of input.findings) {
    if (finding.status === 'unspecified') byStatus.unspecified++;
  }

  return {
    requirements: input.requirements.length,
    facts: input.facts.length,
    results: input.results.length,
    visibleResults: input.visibleResults.length,
    findings: input.findings.length,
    byStatus,
    bySeverity,
  };
}

function resolveConfig(repoPath: string, options: RunSpecComplianceOptions): SpecComplianceConfig {
  const projectConfig = readProjectConfig(repoPath).specCompliance ?? {};
  return SpecComplianceConfigSchema.parse({
    ...projectConfig,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    ...(options.specs?.length ? { specGlobs: options.specs } : {}),
    ...(options.showSatisfied !== undefined ? { includeSatisfiedResults: options.showSatisfied } : {}),
    ...(options.noLlm !== undefined ? { useLlm: !options.noLlm } : {}),
  });
}

export async function runSpecComplianceAnalysis(
  repoPath: string,
  options: RunSpecComplianceOptions = {},
): Promise<SpecComplianceArtifact> {
  const config = resolveConfig(repoPath, options);
  const manifest = createSpecExtractionManifest(repoPath, config);
  const provider = options.provider ?? {
    model: 'no-llm',
    extractProseRequirements: async () => {
      throw new Error('Prose requirement extraction is disabled.');
    },
  };

  const requirementResult = await extractRequirementsFromManifest(repoPath, manifest, provider, {
    useLlm: config.useLlm,
  });
  const factResult = await extractCodeFacts(repoPath);
  const evaluation = evaluateSpecCompliance({
    requirements: requirementResult.requirements,
    facts: factResult.facts,
    includeSatisfiedResults: config.includeSatisfiedResults,
    includeUnspecifiedFindings: true,
  });

  const artifact: SpecComplianceArtifact = {
    enabled: config.enabled,
    config,
    manifest,
    requirements: requirementResult.requirements,
    facts: factResult.facts,
    results: evaluation.results,
    visibleResults: evaluation.visibleResults,
    findings: evaluation.findings,
    errors: [...requirementResult.errors, ...factResult.errors],
    summary: artifactSummary({
      requirements: requirementResult.requirements,
      facts: factResult.facts,
      results: evaluation.results,
      visibleResults: evaluation.visibleResults,
      findings: evaluation.findings,
    }),
  };

  return sortArtifact(artifact);
}

function sortArtifact(artifact: SpecComplianceArtifact): SpecComplianceArtifact {
  const sort = <T>(values: T[]) => [...values].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return {
    ...artifact,
    requirements: sort(artifact.requirements),
    facts: sort(artifact.facts),
    results: sort(artifact.results),
    visibleResults: sort(artifact.visibleResults),
    findings: sort(artifact.findings),
    errors: sort(artifact.errors),
  };
}

export function orderedSpecStatusCounts(counts: Record<SpecComplianceFindingStatus, number>): Record<SpecComplianceFindingStatus, number> {
  const ordered = emptyStatusCounts();
  for (const key of STATUS_ORDER) ordered[key] = counts[key] ?? 0;
  return ordered;
}

export function orderedSpecSeverityCounts(counts: Record<ComplianceSeverity, number>): Record<ComplianceSeverity, number> {
  const ordered = emptySeverityCounts();
  for (const key of SEVERITY_ORDER) ordered[key] = counts[key] ?? 0;
  return ordered;
}
