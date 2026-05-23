type Props = { className?: string };

/**
 * Slack-thread mockup for the "Some lives in Slack" sub-section. Shows an
 * engineer message and the TrueCourse bot reply with action buttons.
 */
export function SlackThread({ className }: Props) {
  return (
    <div
      className={
        'rounded-2xl border border-border bg-card/60 p-5 shadow-2xl shadow-black/40 backdrop-blur-md ' +
        (className ?? '')
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-accent/15 font-mono text-[10px] text-accent">
            #
          </span>
          <span className="font-mono">#decisions-platform</span>
        </div>
        <span className="text-[10px] text-muted-foreground">today · 2:14 PM</span>
      </div>

      {/* Engineer message */}
      <div className="mt-4 flex gap-3">
        <div className="h-8 w-8 shrink-0 rounded-md bg-gradient-to-br from-emerald-500/60 to-emerald-700/60" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">Priya</span>
            <span className="text-[10px] text-muted-foreground">2:14 PM</span>
          </div>
          <p className="mt-0.5 text-sm text-foreground/90">
            Let&apos;s bump retries to 5.
          </p>
        </div>
      </div>

      {/* Bot reply */}
      <div className="mt-4 flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/40 bg-accent/15 text-accent">
          <BotIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">TrueCourse</span>
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent">
              APP
            </span>
            <span className="text-[10px] text-muted-foreground">2:14 PM</span>
          </div>
          <div className="mt-1 rounded-lg border border-border bg-background/40 p-3 text-sm text-foreground/90">
            <p>
              I noticed you decided to raise the retry limit from{' '}
              <span className="font-mono text-foreground">3</span> to{' '}
              <span className="font-mono text-foreground">5</span>. Want me to open a PR
              updating <span className="font-mono text-accent">ADR-12</span>?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md bg-accent/90 px-3 text-xs font-medium text-background"
              >
                Yes, open PR
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground"
              >
                Edit first
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="8" width="18" height="12" rx="3" />
      <path d="M12 8V4" />
      <circle cx="12" cy="3" r="1" />
      <path d="M8 14h.01M16 14h.01" />
    </svg>
  );
}
