import { randomUUID } from 'node:crypto';
import { SPEC_COMPLIANCE_MATCHER_VERSION, type ComplianceSeverity } from '@truecourse/shared';
import type { SpecComplianceFinding } from './spec-compliance-matchers/types.js';
import type { ResolvedViolationRef, ViolationRecord, ViolationWithNames } from '../types/snapshot.js';

export interface SpecComplianceLifecycleResult {
  added: ViolationRecord[];
  unchanged: ViolationRecord[];
  resolved: ViolationRecord[];
  resolvedRefs: ResolvedViolationRef[];
}

function severityToViolationSeverity(severity: ComplianceSeverity): ViolationRecord['severity'] {
  if (severity === 'error') return 'high';
  if (severity === 'warning') return 'medium';
  return 'info';
}

function contentForFinding(finding: SpecComplianceFinding): string {
  const implementation = finding.implementationSources.length > 0
    ? finding.implementationSources
        .map((source) => `${source.filePath}${source.range ? `:${source.range.startLine}-${source.range.endLine}` : ''}`)
        .join(', ')
    : 'No implementation evidence found.';
  return `${finding.message}\n\nImplementation evidence: ${implementation}`;
}

function ruleKeyForFinding(finding: SpecComplianceFinding): string {
  const matcher = finding.matcher?.name ?? 'implementation';
  return `spec-compliance/${finding.status}/${matcher}`;
}

export function specComplianceFindingToViolation(
  finding: SpecComplianceFinding,
  analysisId: string,
  now: string,
  previous?: ViolationWithNames,
): ViolationRecord {
  return {
    id: randomUUID(),
    type: 'spec-compliance',
    title: finding.title,
    content: contentForFinding(finding),
    severity: severityToViolationSeverity(finding.severity),
    status: previous ? 'unchanged' : 'new',
    targetServiceId: null,
    targetDatabaseId: null,
    targetModuleId: null,
    targetMethodId: null,
    targetTable: null,
    relatedServiceId: null,
    relatedModuleId: null,
    fixPrompt: null,
    ruleKey: ruleKeyForFinding(finding),
    firstSeenAnalysisId: previous ? previous.firstSeenAnalysisId : analysisId,
    firstSeenAt: previous ? previous.firstSeenAt : now,
    previousViolationId: previous ? previous.id : null,
    resolvedAt: null,
    filePath: finding.specSource?.filePath ?? finding.implementationSources[0]?.filePath ?? null,
    lineStart: finding.specSource?.range.startLine ?? finding.implementationSources[0]?.range?.startLine ?? null,
    lineEnd: finding.specSource?.range.endLine ?? finding.implementationSources[0]?.range?.endLine ?? null,
    columnStart: null,
    columnEnd: null,
    snippet: JSON.stringify({
      specComplianceFindingId: finding.id,
      requirementId: finding.requirementId ?? null,
      factId: finding.factId ?? null,
      matcher: finding.matcher ?? { name: 'implementation', version: SPEC_COMPLIANCE_MATCHER_VERSION },
      status: finding.status,
      confidence: finding.confidence,
    }),
    createdAt: now,
  };
}

function findingKeyFromViolation(violation: ViolationWithNames): string | null {
  if (violation.type !== 'spec-compliance') return null;
  if (!violation.snippet) return null;
  try {
    const parsed = JSON.parse(violation.snippet) as { specComplianceFindingId?: unknown };
    return typeof parsed.specComplianceFindingId === 'string' ? parsed.specComplianceFindingId : null;
  } catch {
    return null;
  }
}

export function computeSpecComplianceViolationLifecycle(input: {
  analysisId: string;
  now: string;
  findings: SpecComplianceFinding[];
  previousActiveViolations: ViolationWithNames[];
}): SpecComplianceLifecycleResult {
  const added: ViolationRecord[] = [];
  const unchanged: ViolationRecord[] = [];
  const resolved: ViolationRecord[] = [];
  const resolvedRefs: ResolvedViolationRef[] = [];
  const previousByFindingId = new Map<string, ViolationWithNames>();
  const currentIds = new Set(input.findings.map((finding) => finding.id));

  for (const previous of input.previousActiveViolations) {
    const key = findingKeyFromViolation(previous);
    if (key) previousByFindingId.set(key, previous);
  }

  for (const previous of input.previousActiveViolations) {
    const key = findingKeyFromViolation(previous);
    if (!key || currentIds.has(key)) continue;
    resolved.push({
      ...previous,
      id: randomUUID(),
      status: 'resolved',
      previousViolationId: previous.id,
      resolvedAt: input.now,
      createdAt: input.now,
      targetServiceId: null,
      targetDatabaseId: null,
      targetModuleId: null,
      targetMethodId: null,
      relatedServiceId: null,
      relatedModuleId: null,
    });
    resolvedRefs.push({ id: previous.id, resolvedAt: input.now });
  }

  const sortedFindings = [...input.findings].sort((a, b) => a.id.localeCompare(b.id));
  for (const finding of sortedFindings) {
    const previous = previousByFindingId.get(finding.id);
    const row = specComplianceFindingToViolation(finding, input.analysisId, input.now, previous);
    if (previous) unchanged.push(row);
    else added.push(row);
  }

  return { added, unchanged, resolved, resolvedRefs };
}
