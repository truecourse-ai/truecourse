// Aggregates audit log entries into per-user summaries. Iterates through
// each user's records and bucketizes them by severity and weight. The
// hand-written loop nest pre-dates the helper extraction work and still
// uses straight-line if/for/while/if/if branching instead of early
// returns, which is exactly the shape the deeply-nested-logic visitor
// surfaces (nesting depth = 5, threshold = 4).

export interface AuditRecord {
  readonly kind: 'login' | 'logout' | 'mutation';
  readonly entries: ReadonlyArray<{ weight: number; severity: 'low' | 'high' }>;
}

export function classifyAuditRecord(record: AuditRecord): string {
  if (record.kind === 'mutation') {
    for (const entry of record.entries) {
      if (entry.weight > 0) {
        let remaining = entry.weight;
        while (remaining > 1) {
          if (entry.severity === 'high') {
            if (remaining % 2 === 0) {
              return 'high-even';
            }
          }
          remaining = remaining - 1;
        }
      }
    }
  }
  return 'low';
}
