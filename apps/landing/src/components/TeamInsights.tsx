import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Github,
  Minus,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Trend = 'up' | 'down' | 'flat';

type Engineer = {
  handle: string;
  prs: number;
  caught: number;
  escaped: number;
  aiPct: number;
  trend: Trend;
};

const ENGINEERS: Engineer[] = [
  { handle: 'jhonny.l', prs: 31, caught: 19, escaped: 2, aiPct: 81, trend: 'up' },
  { handle: 'ari.k', prs: 24, caught: 12, escaped: 0, aiPct: 68, trend: 'up' },
  { handle: 'maya.r', prs: 18, caught: 7, escaped: 1, aiPct: 52, trend: 'flat' },
  { handle: 'sam.p', prs: 14, caught: 4, escaped: 0, aiPct: 41, trend: 'down' },
  { handle: 'priya.v', prs: 22, caught: 9, escaped: 1, aiPct: 58, trend: 'up' },
  { handle: 'tom.w', prs: 11, caught: 3, escaped: 0, aiPct: 47, trend: 'flat' },
];

const REPOS = [
  { name: 'web-app', prs: 48, caught: 22 },
  { name: 'api-gateway', prs: 31, caught: 14 },
  { name: 'billing-service', prs: 19, caught: 8 },
  { name: 'data-pipeline', prs: 24, caught: 11 },
  { name: 'mobile', prs: 16, caught: 5 },
  { name: 'docs', prs: 4, caught: 0 },
];

export function TeamInsights() {
  const left = useReveal<HTMLDivElement>();
  const right = useReveal<HTMLDivElement>();

  return (
    <section className="relative border-b border-border py-24 sm:py-32">
      <div className="bg-radial-glow absolute inset-x-0 top-0 -z-10 h-72 opacity-30" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          {/* Left: pitch */}
          <div ref={left.ref} className={cn('reveal', left.visible && 'visible')}>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Team visibility
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              See who&apos;s shipping. What&apos;s drifting.
              <span className="block text-muted-foreground">Where to focus.</span>
            </h2>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Install the GitHub App, point it at your org, and TrueCourse starts
              reviewing every PR in every repo. The dashboard rolls the findings into
              views your engineering leads actually use: by team, by repo, and by engineer.
            </p>

            <ul className="mt-8 space-y-4">
              <Bullet
                icon={Github}
                title="Native GitHub App"
                body="Reviews every PR. Posts inline comments on hallucinated APIs, fabricated calls, and business-logic drift. Optional merge-blocking on critical findings."
              />
              <Bullet
                icon={Users}
                title="Per-engineer insights"
                body="See AI-generated ratio, drift caught at PR, and findings escaped to main, per engineer. Surface who needs support, not who to blame."
              />
              <Bullet
                icon={Activity}
                title="Org &amp; team trends"
                body="Track AI usage and drift rate over time. Spot regressions early, ship safer."
              />
            </ul>
          </div>

          {/* Right: dashboard mock */}
          <div
            ref={right.ref}
            style={{ ['--delay' as string]: '120ms' }}
            className={cn('reveal', right.visible && 'visible')}
          >
            <DashboardMock />
          </div>
        </div>
      </div>
    </section>
  );
}

function Bullet({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Github;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h3
          className="text-sm font-semibold"
          dangerouslySetInnerHTML={{ __html: title }}
        />
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function DashboardMock() {
  return (
    <div className="glow-border surface overflow-hidden rounded-2xl border border-border shadow-2xl shadow-black/40">
      {/* Window chrome */}
      <div className="flex items-center justify-between border-b border-border bg-background/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Github className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">
            acme-corp · TrueCourse
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            live
          </span>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <Metric label="Repos" value="8" />
        <Metric label="Engineers" value="24" />
        <Metric label="PRs / wk" value="142" trend="up" trendValue="+18%" />
        <Metric label="Block rate" value="96%" trend="up" trendValue="+2 pp" />
      </div>

      {/* Engineer leaderboard */}
      <div className="border-b border-border p-5">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold">Engineers</h4>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            last 30 days
          </span>
        </div>

        {/* Header row */}
        <div className="mt-3 grid grid-cols-[1.4fr_repeat(4,1fr)_28px] gap-3 px-2 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div>Engineer</div>
          <div className="text-right">PRs</div>
          <div className="text-right">Caught</div>
          <div className="text-right">Escaped</div>
          <div className="text-right">AI ratio</div>
          <div />
        </div>

        <ul className="space-y-1">
          {ENGINEERS.map((e) => (
            <li
              key={e.handle}
              className="grid grid-cols-[1.4fr_repeat(4,1fr)_28px] items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] font-medium text-accent ring-1 ring-inset ring-accent/30"
                  aria-hidden
                >
                  {e.handle[0]?.toUpperCase()}
                </span>
                <span className="truncate font-mono text-[12.5px]">{e.handle}</span>
              </div>
              <div className="text-right font-mono text-[12.5px] tabular-nums">
                {e.prs}
              </div>
              <div className="text-right font-mono text-[12.5px] tabular-nums text-emerald-300">
                {e.caught}
              </div>
              <div
                className={cn(
                  'text-right font-mono text-[12.5px] tabular-nums',
                  e.escaped === 0 ? 'text-muted-foreground' : 'text-rose-300',
                )}
              >
                {e.escaped}
              </div>
              <div className="flex items-center justify-end gap-1.5 font-mono text-[12.5px] tabular-nums">
                <span>{e.aiPct}%</span>
                <span className="relative inline-block h-1.5 w-10 overflow-hidden rounded-full bg-muted/50">
                  <span
                    className="absolute inset-y-0 left-0 bg-accent"
                    style={{ width: `${e.aiPct}%` }}
                  />
                </span>
              </div>
              <div className="flex justify-end">
                <TrendArrow trend={e.trend} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Repos strip */}
      <div className="p-5">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-semibold">Repos</h4>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            this week
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {REPOS.map((r) => (
            <div
              key={r.name}
              className="rounded-md border border-border bg-background/40 px-3 py-2"
            >
              <div className="font-mono text-[12.5px]">{r.name}</div>
              <div className="mt-1 flex items-baseline justify-between text-[10.5px] text-muted-foreground">
                <span>
                  <span className="text-foreground">{r.prs}</span> PRs
                </span>
                <span className="text-emerald-300">{r.caught} caught</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  trend,
  trendValue,
}: {
  label: string;
  value: string;
  trend?: Trend;
  trendValue?: string;
}) {
  return (
    <div className="bg-background/30 px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-medium tabular-nums">{value}</span>
        {trend && trendValue && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-mono text-[11px]',
              trend === 'up' && 'text-emerald-300',
              trend === 'down' && 'text-rose-300',
              trend === 'flat' && 'text-muted-foreground',
            )}
          >
            <TrendArrow trend={trend} small />
            {trendValue}
          </span>
        )}
      </div>
    </div>
  );
}

function TrendArrow({ trend, small }: { trend: Trend; small?: boolean }) {
  const cls = small ? 'h-3 w-3' : 'h-3.5 w-3.5';
  if (trend === 'up')
    return <ArrowUpRight className={cn(cls, 'text-emerald-400')} aria-label="up" />;
  if (trend === 'down')
    return <ArrowDownRight className={cn(cls, 'text-rose-400')} aria-label="down" />;
  return <Minus className={cn(cls, 'text-muted-foreground')} aria-label="flat" />;
}

