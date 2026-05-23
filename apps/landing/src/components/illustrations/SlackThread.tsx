type Props = { className?: string };

/**
 * Slack-thread mockup for "Some lives in Slack". Shows an engineer message
 * with reactions, plus the Knowledge Bot reply card (accent-bordered) with
 * highlighted values and two pill action buttons.
 */
export function SlackThread({ className }: Props) {
  return (
    <div
      className={
        'rounded-2xl border border-border bg-gradient-to-b from-card/80 to-card/40 p-5 shadow-2xl shadow-black/40 backdrop-blur-md ' +
        (className ?? '')
      }
    >
      {/* Engineer message */}
      <div className="flex gap-3">
        <UserAvatar />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold text-foreground">Alex Rivera</span>
            <span className="text-[11px] text-muted-foreground">10:23 AM</span>
          </div>
          <p className="mt-0.5 text-[15px] leading-snug text-foreground/95">
            Let&apos;s bump retries to 5.
          </p>
          {/* reactions */}
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex h-6 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 text-[11px] font-semibold text-foreground"
            >
              <span aria-hidden="true">✅</span>
              <span className="text-accent">2</span>
            </button>
            <button
              type="button"
              aria-label="Add reaction"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card/60 text-muted-foreground hover:text-foreground"
            >
              <SmileIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Bot reply — accent-bordered card */}
      <div className="mt-4 rounded-xl border border-accent/40 bg-accent/[0.04] p-3 shadow-[0_0_0_1px_rgba(38,140,245,0.08)_inset]">
        <div className="flex gap-3">
          <BotAvatar />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[15px] font-bold text-foreground">Knowledge Bot</span>
              <span className="rounded bg-accent/20 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-accent">
                APP
              </span>
              <span className="text-[11px] text-muted-foreground">10:23 AM</span>
            </div>
            <p className="mt-0.5 text-[14px] leading-snug text-foreground/95">
              I noticed you decided to raise the retry limit from{' '}
              <span className="font-mono font-semibold text-accent">3</span> to{' '}
              <span className="font-mono font-semibold text-accent">5</span>.
            </p>
            <p className="mt-1 text-[14px] leading-snug text-foreground/95">
              Want me to open a PR updating{' '}
              <span className="font-mono font-semibold text-accent">ADR-12</span>?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-semibold text-background shadow-[0_2px_10px_rgba(38,140,245,0.35)]"
              >
                <PlusIcon />
                Yes, open PR
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/60 px-3 text-[12px] font-semibold text-foreground hover:bg-card"
              >
                <PencilIcon />
                Edit first
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-emerald-400/30 to-emerald-700/30 ring-1 ring-border">
      <svg viewBox="0 0 36 36" className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="ua-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1B2230" />
            <stop offset="100%" stopColor="#0F1726" />
          </linearGradient>
          <linearGradient id="ua-skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4A574" />
            <stop offset="100%" stopColor="#B8895A" />
          </linearGradient>
        </defs>
        <rect width="36" height="36" fill="url(#ua-bg)" />
        {/* shoulders */}
        <path d="M4,32 C4,24 32,24 32,32 L32,36 L4,36 Z" fill="#268CF5" opacity="0.5" />
        {/* head */}
        <circle cx="18" cy="15" r="7" fill="url(#ua-skin)" />
        {/* hair */}
        <path d="M11,13 C11,8 25,8 25,13 L25,11 C25,8 22,6 18,6 C14,6 11,8 11,11 Z" fill="#2D2018" />
      </svg>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-accent/50 bg-gradient-to-br from-accent/30 to-accent/10 shadow-[0_0_18px_rgba(38,140,245,0.35)]">
      <svg viewBox="0 0 28 28" className="h-6 w-6" aria-hidden="true">
        {/* antenna */}
        <line x1="14" y1="3" x2="14" y2="7" stroke="#268CF5" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="14" cy="3" r="1.4" fill="#268CF5" />
        {/* head */}
        <rect x="4" y="7" width="20" height="16" rx="4" fill="#0F1726" stroke="#268CF5" strokeWidth="1.2" />
        {/* eyes */}
        <circle cx="10" cy="14" r="1.8" fill="#268CF5" />
        <circle cx="18" cy="14" r="1.8" fill="#268CF5" />
        {/* mouth */}
        <path d="M10,19 L18,19" stroke="#268CF5" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 1.5l3 3-8 8H1.5v-3z" />
      <path d="M8.5 2.5l3 3" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M5 8.5c.6.7 1.3 1 2 1s1.4-.3 2-1" />
      <circle cx="5.2" cy="5.6" r=".5" fill="currentColor" />
      <circle cx="8.8" cy="5.6" r=".5" fill="currentColor" />
    </svg>
  );
}
