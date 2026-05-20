import { useEffect } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileCode2,
  GitMerge,
  Layers,
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

// ── Data ──────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: '01',
    icon: ScanSearch,
    label: 'Collect',
    body: 'Reads your existing docs — Notion, Confluence, ADRs, READMEs, RFCs — in any format, no migration required.',
    colorClass: 'text-accent border-accent/40 bg-accent/10',
  },
  {
    n: '02',
    icon: Layers,
    label: 'Consolidate',
    body: 'Extracts structured claims from every source: what each document says about each behavior.',
    colorClass: 'text-accent border-accent/40 bg-accent/10',
  },
  {
    n: '03',
    icon: GitMerge,
    label: 'Resolve',
    body: 'When two sources conflict, a human picks the authoritative answer. Everything else is automated.',
    colorClass: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
  },
  {
    n: '04',
    icon: FileCode2,
    label: 'Contracts',
    body: 'The resolved knowledge base is compiled into machine-readable .tc files, checked into version control.',
    colorClass: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
  },
  {
    n: '05',
    icon: ShieldCheck,
    label: 'Verify',
    body: 'Every commit is checked against the contracts. Mismatches are surfaced as drifts before they ship.',
    colorClass: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
  },
];

const DRIFT_EXAMPLES = [
  {
    field: 'SignatureDetection.score',
    kind: 'entity.field.type',
    detail:
      'Spec: float, range 0.0–1.0.  Code stores as integer 0–100.  All threshold comparisons produce wrong results.',
    severity: 'CRITICAL',
  },
  {
    field: 'DetectionStatus',
    kind: 'state-machine.transition',
    detail:
      'Spec: FAIL → FLAGGED is a valid transition.  Code raises an exception on this path, blocking manual review.',
    severity: 'CRITICAL',
  },
  {
    field: 'SignatureDetection.flaggedAt',
    kind: 'entity.field.mutability',
    detail:
      'Spec: server-assigned, immutable after creation.  Code allows clients to set this field on update requests.',
    severity: 'HIGH',
  },
];

const CONTRACT_LINES: { text: string; color: string }[] = [
  { text: '# compliance/signature_detection.tc', color: 'text-muted-foreground' },
  { text: '', color: '' },
  { text: 'entity SignatureDetection {', color: 'text-accent' },
  { text: '  field jobId:   uuid   { immutable }', color: 'text-emerald-400' },
  { text: '  field score:   float  { range 0.0..1.0 }', color: 'text-emerald-400' },
  { text: '  field status:  Enum:DetectionStatus {', color: 'text-emerald-400' },
  { text: '    bound-to StateMachine:DetectionStatus', color: 'text-muted-foreground' },
  { text: '  }', color: 'text-muted-foreground' },
  { text: '}', color: 'text-muted-foreground' },
  { text: '', color: '' },
  { text: 'state-machine DetectionStatus {', color: 'text-accent' },
  { text: '  states [ PENDING, IN_REVIEW, PASS, FAIL, FLAGGED ]', color: 'text-emerald-400' },
  { text: '  PENDING -> IN_REVIEW -> PASS | FAIL', color: 'text-amber-400' },
  { text: '  FAIL -> FLAGGED -> IN_REVIEW', color: 'text-amber-400' },
  { text: '}', color: 'text-muted-foreground' },
];

const INFERRED_EXAMPLES = [
  {
    field: 'DetectionJob.retryLimit',
    kind: 'entity.field.default',
    detail: 'Default of 3 set in constructor and config loader. Not mentioned in any spec or ADR.',
  },
  {
    field: 'DetectionJob.timeoutSeconds',
    kind: 'entity.field.default',
    detail: 'Hardcoded to 30 s in the job processor. No spec entry defines the expected timeout.',
  },
  {
    field: 'AuditLog.retentionDays',
    kind: 'entity.field.policy',
    detail: 'Cleanup job purges records after 90 days. No spec or policy doc references this value.',
  },
];

// ── Sub-components (each gets its own useReveal call) ─────────────────────────

type StepData = (typeof STEPS)[number];

function PipelineStep({ step, delayMs }: { step: StepData; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ '--delay': `${delayMs}ms` } as React.CSSProperties}
      className={cn('reveal flex-1 rounded-2xl border border-border bg-card/40 p-6', visible && 'visible')}
    >
      <div className="flex items-center justify-between">
        <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg border', step.colorClass)}>
          <step.icon className="h-4.5 w-4.5" />
        </span>
        <span className="font-mono text-xs text-muted-foreground">{step.n}</span>
      </div>
      <h3 className="mt-4 text-base font-semibold">{step.label}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
    </div>
  );
}

type DriftData = (typeof DRIFT_EXAMPLES)[number];

function DriftRow({ drift: d, delayMs }: { drift: DriftData; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ '--delay': `${delayMs}ms` } as React.CSSProperties}
      className={cn(
        'reveal flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-5 sm:flex-row sm:items-start',
        visible && 'visible',
      )}
    >
      <div className="shrink-0">
        <span
          className={cn(
            'inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
            SEVERITY_STYLES[d.severity],
          )}
        >
          {d.severity}
        </span>
      </div>
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold text-foreground">{d.field}</p>
        <p className="mt-0.5 font-mono text-xs italic text-accent">{d.kind}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.detail}</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'TrueCourse · Knowledge Infrastructure';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <>
      <Hero />
      <ProblemSection />
      <PipelineSection />
      <ConflictsSection />
      <ContractsSection />
      <DriftsSection />
      <InferredSection />
      <CtaSection />
    </>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-border pt-32 pb-16 sm:pt-40 sm:pb-24">
      <div className="bg-radial-glow absolute inset-0 -z-10" />
      <div className="bg-grid absolute inset-0 -z-10" />

      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <div
          style={{ '--delay': '0ms' } as React.CSSProperties}
          className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent backdrop-blur-md"
        >
          <Sparkles className="h-3 w-3" />
          Business Logic Drift
        </div>

        <h1
          style={{ '--delay': '80ms' } as React.CSSProperties}
          className="animate-fade-up mt-6 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl"
        >
          <span className="text-gradient">Your engineering knowledge base,</span>
          <br />
          <span className="text-gradient-accent">structured and always current.</span>
        </h1>

        <p
          style={{ '--delay': '200ms' } as React.CSSProperties}
          className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl"
        >
          TrueCourse reads your existing specs, resolves conflicts with human judgment,
          generates machine-readable contracts, and verifies your code on every commit.
        </p>

        <div
          style={{ '--delay': '320ms' } as React.CSSProperties}
          className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            to="/teams"
            className="group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-5 text-sm font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
          >
            Get early access
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Problem ───────────────────────────────────────────────────────────────────

function ProblemSection() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">The problem</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Engineering knowledge lives everywhere and nowhere.
          </h2>
        </div>

        <div
          ref={ref}
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          {[
            {
              icon: AlertTriangle,
              title: 'Re-litigated decisions',
              body: 'Teams debate choices that were already made, with no record of why the first decision was taken.',
              delay: 0,
            },
            {
              icon: AlertTriangle,
              title: 'Silent code drift',
              body: 'Code contradicts specs for months before anyone notices — usually after it has already shipped.',
              delay: 80,
            },
            {
              icon: AlertTriangle,
              title: 'AI amplifies the damage',
              body: 'Agents commit changes that undo architectural decisions that were never formally documented.',
              delay: 160,
            },
          ].map(({ icon: Icon, title, body, delay }) => (
            <div
              key={title}
              style={{ '--delay': `${delay}ms` } as React.CSSProperties}
              className={cn(
                'reveal rounded-2xl border border-border bg-card/40 p-6',
                visible && 'visible',
              )}
            >
              <Icon className="h-5 w-5 text-amber-400" />
              <h3 className="mt-4 text-base font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

function PipelineSection() {
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">How it works</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            From scattered docs to verified code.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Human judgment only where requirements conflict. Everything else is automated.
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-4 lg:flex-row">
          {STEPS.map((step, i) => (
            <PipelineStep key={step.label} step={step} delayMs={i * 80} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Conflicts ─────────────────────────────────────────────────────────────────

function ConflictsSection() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-amber-400">
              Step 2 — Resolve
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              When two sources disagree, a human picks the truth.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              The engine extracts every behavioral claim from your docs and groups them by topic.
              When two sources make competing claims about the same behavior, it surfaces the
              conflict — with provenance — and waits for a human decision. Once resolved, the
              answer is stable and reused on every re-scan.
            </p>
            <ul className="mt-6 space-y-2">
              {[
                'Stable conflict IDs persist across re-scans',
                'Pick a candidate or write a custom answer',
                'Resolved decisions feed directly into contracts',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div
            ref={ref}
            className={cn('reveal rounded-2xl border border-amber-400/20 bg-card/40 p-6', visible && 'visible')}
          >
            <div className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-amber-400">
              Conflict · SignatureDetection / status values
            </div>
            <div className="mb-3 text-xs text-muted-foreground">3 candidates · topic: data</div>
            <div className="space-y-3">
              {[
                {
                  src: 'docs/data-model-v1/README.md  line 31',
                  text: '"Signature status may be one of: PENDING, APPROVED, REJECTED."',
                  selected: false,
                },
                {
                  src: 'PRD_DATA_COMPLIANCE.md  line 88',
                  text: '"DetectionStatus values: PENDING, IN_REVIEW, PASS, FAIL, FLAGGED. FLAGGED requires manual reviewer assignment."',
                  selected: true,
                },
              ].map((c) => (
                <div
                  key={c.src}
                  className={cn(
                    'rounded-xl border p-4',
                    c.selected
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border bg-background/40',
                  )}
                >
                  <p className="mb-2 font-mono text-[10px] text-muted-foreground">{c.src}</p>
                  <p className="text-sm italic leading-relaxed text-muted-foreground">{c.text}</p>
                  {c.selected && (
                    <p className="mt-2 text-xs font-medium text-emerald-400">
                      Selected — engine default: most recent doc
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="rounded-lg bg-accent/15 border border-accent/40 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25">
                Pick this candidate
              </button>
              <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong">
                Write custom answer
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Contracts ─────────────────────────────────────────────────────────────────

function ContractsSection() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div
            ref={ref}
            className={cn('reveal order-2 lg:order-1', visible && 'visible')}
          >
            <div className="overflow-hidden rounded-2xl border border-border bg-[oklch(0.085_0.025_258)]">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                <span className="ml-3 font-mono text-xs text-muted-foreground">
                  compliance/signature_detection.tc
                </span>
              </div>
              <div className="p-4">
                {CONTRACT_LINES.map((line, i) => (
                  <div key={i} className={cn('font-mono text-xs leading-6', line.color || 'text-transparent')}>
                    {line.text || ' '}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">
              Step 3 — Contracts
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Resolved knowledge compiled into machine-readable contracts.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              TC contracts express entity definitions, state machines, field constraints, and auth
              requirements in a structured format your toolchain can read. They live in version
              control alongside your code, travel with branches and worktrees.
            </p>
            <ul className="mt-6 space-y-2">
              {[
                'Entities, state machines, formulas, auth rules',
                'Checked into version control — git-diffable',
                'New engineers inherit the full context on clone',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Drifts ────────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'text-red-400 border-red-400/30 bg-red-400/10',
  HIGH: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
};

function DriftsSection() {
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-red-400">
            Step 4 — Verify
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Contracts are checked against the actual code.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Every commit is verified. Each mismatch between a contract and the code is a drift —
            surfaced by severity before it reaches production.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          {DRIFT_EXAMPLES.map((d, i) => (
            <DriftRow key={d.field} drift={d} delayMs={i * 80} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Inferred ──────────────────────────────────────────────────────────────────

function InferredSection() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <section className="border-b border-border py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-violet-400">
              Undocumented decisions
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Some decisions were made in code, never in a doc.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              TrueCourse scans your codebase for patterns with no corresponding spec entry and
              surfaces them as <span className="font-mono text-violet-400">[INFERRED]</span> claims.
              Your team reviews, promotes what&apos;s accurate, and discards the rest. Promoted
              claims become contracts — protected going forward.
            </p>
          </div>

          <div ref={ref} className={cn('reveal space-y-3', visible && 'visible')}>
            {INFERRED_EXAMPLES.map((ex, i) => (
              <div
                key={ex.field}
                style={{ '--delay': `${i * 80}ms` } as React.CSSProperties}
                className="flex flex-col gap-3 rounded-2xl border border-violet-400/20 bg-card/40 p-5 sm:flex-row sm:items-start"
              >
                <div className="shrink-0">
                  <span className="inline-block rounded-md border border-violet-400/30 bg-violet-400/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-violet-400">
                    INFERRED
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-foreground">{ex.field}</p>
                  <p className="mt-0.5 font-mono text-xs italic text-violet-400">{ex.kind}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{ex.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          <span className="text-gradient">Ready to close the loop?</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
          TrueCourse is in closed beta for engineering teams. Join the waitlist and get early access.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/teams"
            className="group inline-flex h-12 items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-5 text-sm font-medium text-foreground backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:bg-accent/25"
          >
            Request early access
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/"
            className="inline-flex h-12 items-center rounded-xl border border-border bg-card/60 px-5 text-sm font-medium backdrop-blur-md transition-colors hover:border-border-strong"
          >
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
