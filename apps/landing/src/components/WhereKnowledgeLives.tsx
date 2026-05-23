import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';
import { SlackThread } from './illustrations/SlackThread';
import { InferredCards } from './illustrations/InferredCards';

const DOC_TOOLS = [
  { name: 'Notion', subtitle: 'product specs · OKRs' },
  { name: 'Confluence', subtitle: 'engineering wikis' },
  { name: 'GitHub READMEs', subtitle: 'in-repo notes' },
  { name: 'Google Docs', subtitle: 'design reviews' },
  { name: 'ADRs / RFCs', subtitle: 'architecture decisions' },
  { name: 'Internal wikis', subtitle: 'team knowledge' },
];

const ALSO_CONNECTS = [
  'Notion',
  'Confluence',
  'GitHub',
  'Google Docs',
  'Linear',
  'Jira',
];

export function WhereKnowledgeLives() {
  return (
    <section
      id="where-knowledge-lives"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Where knowledge lives
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">
              Your team&apos;s decisions are scattered.
            </span>
            <br />
            <span className="text-gradient-accent">TrueCourse pulls them together.</span>
          </h2>
        </div>

        <div className="mt-16 space-y-24">
          <DocsBlock />
          <SlackBlock />
          <CodeBlock />
        </div>
      </div>
    </section>
  );
}

function DocsBlock() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('reveal', visible && 'visible')}>
      <h3 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        Some lives in docs.
      </h3>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        Your team&apos;s decisions are written down — across 5+ different tools that
        don&apos;t talk to each other.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {DOC_TOOLS.map((t) => (
          <div
            key={t.name}
            className="surface-hover rounded-xl border border-border bg-card/40 p-4"
          >
            <div className="text-sm font-semibold text-foreground">{t.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t.subtitle}</div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-base text-foreground/80 sm:text-lg">
        <span className="text-foreground">
          Each tool holds a piece of the truth.
        </span>{' '}
        <span className="text-muted-foreground">None holds the whole truth.</span>
      </p>
    </div>
  );
}

function SlackBlock() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('reveal', visible && 'visible')}>
      <h3 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        Some lives in Slack.
      </h3>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        The fastest decisions in your org happen in Slack — and never get written down.
        Our Slack agent monitors decision channels, drafts spec updates, and opens PRs
        to your docs.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <SlackThread />

        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Also connects to
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {ALSO_CONNECTS.map((c) => (
              <li
                key={c}
                className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-foreground/80"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CodeBlock() {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={cn('reveal', visible && 'visible')}>
      <h3 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
        Some lives in code.
      </h3>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        Some decisions were made in code, never in a doc. TrueCourse scans your
        codebase for patterns with no spec entry — and surfaces them for your team to
        review and promote.
      </p>

      <div className="mt-8">
        <InferredCards />
      </div>

      <p className="mt-8 text-base text-foreground/80 sm:text-lg">
        <span className="text-foreground">
          Every implicit decision becomes explicit
        </span>{' '}
        <span className="text-muted-foreground">— and from then on, verified.</span>
      </p>
    </div>
  );
}
