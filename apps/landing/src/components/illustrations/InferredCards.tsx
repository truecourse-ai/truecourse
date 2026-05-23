type Props = { className?: string };

const CARDS = [
  {
    name: 'DetectionJob.retryLimit',
    desc: 'Found in code: retry loop with hardcoded limit of 3. No matching spec entry.',
  },
  {
    name: 'DetectionJob.timeoutSeconds',
    desc: 'Found in code: 30s timeout used across 4 services. Never documented.',
  },
  {
    name: 'AuditLog.retentionDays',
    desc: 'Found in code: 90-day retention enforced in cleanup job. No team decision logged.',
  },
];

export function InferredCards({ className }: Props) {
  return (
    <div className={'space-y-3 ' + (className ?? '')}>
      {CARDS.map((c) => (
        <div
          key={c.name}
          className="surface-hover flex flex-col gap-3 rounded-xl border border-border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-accent">
                [INFERRED]
              </span>
              <span className="truncate font-mono text-sm text-foreground">
                {c.name}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{c.desc}</p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center rounded-full border border-accent/40 bg-accent/15 px-3 text-xs font-medium text-foreground transition-colors hover:border-accent/60 hover:bg-accent/25"
          >
            Promote to spec
          </button>
        </div>
      ))}
    </div>
  );
}
