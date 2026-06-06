import { describe, expect, it } from 'vitest';
import type { ValidationIssue } from '../../packages/contract-extractor/src/validator';
import { partitionValidationIssues } from '../../tools/cli/src/commands/contracts';

describe('contracts generate validation issues', () => {
  it('keeps soft validation issues non-blocking and de-duplicated', () => {
    const issues: ValidationIssue[] = [
      {
        artifactKey: 'ErrorEnvelope:error.envelope.standard',
        message: "cross-reference ErrorEnvelope:error.envelope.standard doesn't resolve",
        severity: 'soft',
      },
      {
        artifactKey: 'ErrorEnvelope:error.envelope.standard',
        message: "cross-reference ErrorEnvelope:error.envelope.standard doesn't resolve",
        severity: 'soft',
      },
    ];

    const { hardIssues, softIssues } = partitionValidationIssues(issues);

    expect(hardIssues).toEqual([]);
    expect(softIssues).toHaveLength(1);
    expect(softIssues[0].severity).toBe('soft');
  });

  it('keeps hard validation issues blocking', () => {
    const issues: ValidationIssue[] = [
      {
        artifactKey: 'resolver',
        message: 'duplicate identity Operation:GET /api/orders',
        severity: 'hard',
      },
      {
        artifactKey: 'ErrorEnvelope:error.envelope.standard',
        message: "cross-reference ErrorEnvelope:error.envelope.standard doesn't resolve",
        severity: 'soft',
      },
    ];

    const { hardIssues, softIssues } = partitionValidationIssues(issues);

    expect(hardIssues).toHaveLength(1);
    expect(hardIssues[0].artifactKey).toBe('resolver');
    expect(softIssues).toHaveLength(1);
  });
});
