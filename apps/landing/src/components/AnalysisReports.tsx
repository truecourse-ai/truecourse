import { useMemo, useState } from 'react';
import { ArrowUpRight, FileText, Github, Star } from 'lucide-react';
import { ANALYSIS_REPORTS, type AnalysisReport, type Severity } from '@/data/analyses';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

const FILTERS = ['All', 'TypeScript', 'JavaScript', 'Python'] as const;
type Filter = (typeof FILTERS)[number];

export function AnalysisReports() {
  const [filter, setFilter] = useState<Filter>('All');

  const reports = useMemo(() => {
    if (filter === 'All') return ANALYSIS_REPORTS;
    return ANALYSIS_REPORTS.filter((r) => r.language === filter);
  }, [filter]);

  return (
    <section id="reports" className="relative border-b border-border py-24 sm:py-32">
      <div className="bg-radial-glow absolute inset-x-0 top-0 -z-10 h-96 opacity-40" />

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
              Field reports
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              We pointed TrueCourse at the OSS world.
              <span className="block text-muted-foreground">Here&apos;s what it found.</span>
            </h2>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Real codebases. No synthetic fixtures, no cherry-picked snippets. The same
              checks we run on AI-generated changes, run end-to-end against repositories
              you already know.
            </p>
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-card/60 p-1 backdrop-blur-md">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === f
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report, i) => (
            <ReportCard key={report.slug} report={report} delayMs={(i % 3) * 80} />
          ))}
        </div>

        <div className="mt-10 flex items-center justify-center">
          <a
            href="https://github.com/truecourse-ai/truecourse"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            Want us to analyze your favorite OSS repo? Open an issue
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}

function ReportCard({ report, delayMs }: { report: AnalysisReport; delayMs: number }) {
  const total =
    report.totals.critical + report.totals.high + report.totals.medium + report.totals.low;
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <article
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface surface-hover group relative flex flex-col rounded-2xl border border-border p-5',
        report.featured && 'glow-border',
        visible && 'visible',
      )}
    >
      {report.featured && (
        <span className="absolute right-4 top-4 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
          Featured
        </span>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60">
          <Github className="h-4.5 w-4.5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <a
            href={report.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-sm font-medium hover:text-accent"
          >
            {report.repo}
          </a>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {report.description}
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
        <Meta icon={Star}>{report.stars}</Meta>
        <Dot />
        <span>{report.language}</span>
        <Dot />
        <span>{report.files.toLocaleString()} files</span>
        <Dot />
        <span>{report.loc} LOC</span>
      </div>

      {/* Severity bar */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Findings
          </span>
          <span className="font-mono text-sm">
            {total.toLocaleString()}
            <span className="ml-1 text-muted-foreground">total</span>
          </span>
        </div>
        <SeverityBar totals={report.totals} animateIn={visible} />
        <div className="mt-2 grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
          <Tally tone="rose" label="critical" value={report.totals.critical} />
          <Tally tone="amber" label="high" value={report.totals.high} />
          <Tally tone="sky" label="medium" value={report.totals.medium} />
          <Tally tone="slate" label="low" value={report.totals.low} />
        </div>
      </div>

      {/* Top findings */}
      <div className="mt-5 flex-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Top findings
        </p>
        <ul className="mt-2 space-y-1.5">
          {report.topFindings.slice(0, 4).map((f) => (
            <li
              key={f.rule}
              className="flex items-center justify-between rounded-md border border-border bg-background/40 px-2.5 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SeverityDot severity={f.severity} />
                <span className="truncate font-mono text-xs">{f.rule}</span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{f.count}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Summary */}
      <p className="mt-5 text-pretty text-sm leading-relaxed text-muted-foreground">
        {report.summary}
      </p>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="text-[11px] text-muted-foreground">
          Analyzed{' '}
          {new Date(report.analyzedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}{' '}
          · {report.duration}
        </span>
        <a
          href={report.reportUrl ?? report.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground transition-colors hover:text-accent"
        >
          <FileText className="h-3.5 w-3.5" />
          View report
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

function Meta({ icon: Icon, children }: { icon: typeof Star; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function Dot() {
  return <span className="text-muted-foreground/60">·</span>;
}

function SeverityBar({
  totals,
  animateIn,
}: {
  totals: AnalysisReport['totals'];
  animateIn: boolean;
}) {
  const total = totals.critical + totals.high + totals.medium + totals.low || 1;
  const pct = (n: number) => (n / total) * 100;
  const segments = [
    { color: 'bg-rose-500', value: totals.critical },
    { color: 'bg-amber-500', value: totals.high },
    { color: 'bg-sky-500', value: totals.medium },
    { color: 'bg-slate-500', value: totals.low },
  ].filter((s) => s.value > 0);

  return (
    <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
      {segments.map((seg, i) => (
        <span
          key={i}
          className={cn('severity-fill h-full', seg.color)}
          style={{
            width: animateIn ? `${pct(seg.value)}%` : '0%',
            ['--delay' as string]: `${250 + i * 110}ms`,
          }}
        />
      ))}
    </div>
  );
}

function Tally({
  tone,
  label,
  value,
}: {
  tone: 'rose' | 'amber' | 'sky' | 'slate';
  label: string;
  value: number;
}) {
  const dot = {
    rose: 'bg-rose-500',
    amber: 'bg-amber-500',
    sky: 'bg-sky-500',
    slate: 'bg-slate-500',
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 truncate">
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      <span className="truncate">
        <span className="font-mono text-foreground">{value}</span> {label}
      </span>
    </span>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const tone =
    severity === 'critical'
      ? 'bg-rose-500 ring-rose-500/30'
      : severity === 'high'
        ? 'bg-amber-500 ring-amber-500/30'
        : severity === 'medium'
          ? 'bg-sky-500 ring-sky-500/30'
          : 'bg-slate-500 ring-slate-500/30';
  return <span className={cn('h-1.5 w-1.5 rounded-full ring-2', tone)} />;
}
