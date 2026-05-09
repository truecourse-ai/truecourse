import {
  Bug,
  Compass,
  Database,
  Gauge,
  Lock,
  Network,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Category = {
  icon: typeof Network;
  title: string;
  blurb: string;
  tag?: string;
};

const CATEGORIES: Category[] = [
  {
    icon: Compass,
    title: 'Drift',
    blurb:
      'Business-logic drift, hallucinated APIs, fabricated imports, intent mismatch — the things AI gets confidently wrong.',
    tag: 'Preview',
  },
  {
    icon: Network,
    title: 'Architecture',
    blurb:
      'Circular dependencies, layer violations, god modules, dead modules, tight coupling, cross-service imports.',
  },
  {
    icon: Lock,
    title: 'Security',
    blurb:
      'SQL injection, hardcoded secrets, eval usage, insecure random, XSS, path traversal, unsafe deserialization.',
  },
  {
    icon: Bug,
    title: 'Bugs',
    blurb:
      'Race conditions, type mismatches, mutable defaults, implicit optional, off-by-one, unchecked returns.',
  },
  {
    icon: Wrench,
    title: 'Code Quality',
    blurb:
      'Cognitive complexity, magic numbers, large functions, dead code, missing type hints, unused exports.',
  },
  {
    icon: Gauge,
    title: 'Performance',
    blurb:
      'N+1 queries, O(n²) loops, sync I/O in async paths, unnecessary allocations, missing pagination.',
  },
  {
    icon: ShieldCheck,
    title: 'Reliability',
    blurb:
      'Unhandled promises, resource leaks, missing timeouts, swallowed exceptions, unsafe error handling.',
  },
  {
    icon: Database,
    title: 'Database',
    blurb:
      'Missing indexes, missing transactions, lazy loading in loops, raw SQL bypassing the ORM, schema drift.',
  },
  {
    icon: Sparkles,
    title: 'Style',
    blurb:
      'Import ordering, naming conventions, docstring completeness, formatting preferences.',
  },
];

export function Capabilities() {
  return (
    <section id="capabilities" className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            What we catch
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The bugs your AI is shipping every day.
          </h2>
          <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Deterministic checks run in milliseconds. LLM-powered checks add the semantic
            depth pattern-matchers can&apos;t reach: intent matching, business-logic
            drift, reasoning about side effects. Whether the change came from a human
            or a model, TrueCourse holds it to the same standard.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((cat, i) => (
            <CategoryCard key={cat.title} cat={cat} delayMs={i * 60} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryCard({ cat, delayMs }: { cat: Category; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover group relative rounded-2xl border border-border bg-card/40 p-6 transition-colors hover:border-border-strong hover:bg-card',
        visible && 'visible',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-accent transition-transform group-hover:scale-110">
          <cat.icon className="h-4.5 w-4.5" />
        </span>
        {cat.tag && (
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">
            {cat.tag}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-base font-semibold">{cat.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{cat.blurb}</p>
    </div>
  );
}
