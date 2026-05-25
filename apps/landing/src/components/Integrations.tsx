import type { IconType } from 'react-icons';
import {
  SiConfluence,
  SiGithub,
  SiGoogledocs,
  SiLinear,
  SiNotion,
  SiSlack,
} from 'react-icons/si';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Tool = {
  Icon: IconType;
  name: string;
  hint: string;
};

const TOOLS: Tool[] = [
  { Icon: SiNotion, name: 'Notion', hint: 'product specs, OKRs' },
  { Icon: SiConfluence, name: 'Confluence', hint: 'engineering wikis' },
  { Icon: SiSlack, name: 'Slack', hint: 'decision threads' },
  { Icon: SiGithub, name: 'GitHub', hint: 'READMEs, ADRs' },
  { Icon: SiGoogledocs, name: 'Google Docs', hint: 'design reviews' },
  { Icon: SiLinear, name: 'Linear', hint: 'tickets' },
];

export function Integrations() {
  return (
    <section
      id="integrations"
      className="relative border-b border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Integrations
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">We scan where your team</span>{' '}
            <span className="text-gradient-accent">
              already writes things down.
            </span>
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            TrueCourse plugs into the tools your team already uses. No new
            workflow to adopt. We meet decisions where they happen.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TOOLS.map((t, i) => (
            <ToolCard key={t.name} tool={t} delayMs={i * 60} />
          ))}
          <MoreCard delayMs={TOOLS.length * 60} />
        </div>
      </div>
    </section>
  );
}

function ToolCard({ tool, delayMs }: { tool: Tool; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { Icon } = tool;
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover flex items-center gap-4 rounded-2xl border border-border bg-card/40 p-5 transition-colors hover:border-border-strong hover:bg-card',
        visible && 'visible',
      )}
    >
      <span
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background/60 text-foreground/90"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          {tool.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">{tool.hint}</div>
      </div>
    </div>
  );
}

function MoreCard({ delayMs }: { delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal flex items-center gap-4 rounded-2xl border border-dashed border-border bg-card/20 p-5 transition-colors hover:border-accent/40',
        visible && 'visible',
      )}
    >
      <span
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-accent"
        aria-hidden
      >
        <Plus className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          and more
        </div>
        <div className="truncate text-xs text-muted-foreground">Jira, Glean, ADRs</div>
      </div>
    </div>
  );
}
