import type { IconType } from 'react-icons';
import {
  SiAsana,
  SiBitbucket,
  SiClickup,
  SiConfluence,
  SiDiscord,
  SiDropbox,
  SiGitea,
  SiGithub,
  SiGitlab,
  SiGoogledocs,
  SiJira,
  SiLinear,
  SiNotion,
  SiSlack,
  SiTrello,
} from 'react-icons/si';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Tool = {
  Icon: IconType;
  name: string;
  hint?: string;
};

const KB_TOOLS: Tool[] = [
  { Icon: SiNotion, name: 'Notion', hint: 'specs, OKRs' },
  { Icon: SiConfluence, name: 'Confluence', hint: 'engineering wikis' },
  { Icon: SiSlack, name: 'Slack', hint: 'decision threads' },
  { Icon: SiGithub, name: 'GitHub', hint: 'READMEs, ADRs' },
  { Icon: SiGoogledocs, name: 'Google Docs', hint: 'design reviews' },
  { Icon: SiLinear, name: 'Linear', hint: 'tickets' },
  { Icon: SiJira, name: 'Jira', hint: 'tickets' },
  { Icon: SiAsana, name: 'Asana', hint: 'projects' },
];

const KB_MORE: IconType[] = [
  SiClickup,
  SiTrello,
  SiDropbox,
  SiDiscord,
];

const PR_GATES: Tool[] = [
  { Icon: SiGithub, name: 'GitHub', hint: 'cloud + Enterprise Server' },
  { Icon: SiGitlab, name: 'GitLab', hint: 'cloud + self-managed' },
  { Icon: SiBitbucket, name: 'Bitbucket', hint: 'cloud + Data Center' },
  { Icon: SiGitea, name: 'Gitea', hint: 'self-hosted' },
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
            <span className="text-gradient">We plug into the tools</span>{' '}
            <span className="text-gradient-accent">your team already uses.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            No new workflow to adopt. We capture decisions from where your team
            writes them and gate every PR on the platform you already host code
            on.
          </p>
        </div>

        <SubsectionHeading
          eyebrow="Knowledge sources"
          title="Where decisions live"
          subtitle="Capture from the sources your team already uses."
        />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {KB_TOOLS.map((t, i) => (
            <ToolCard key={t.name} tool={t} delayMs={i * 50} />
          ))}
          <MoreCard icons={KB_MORE} delayMs={KB_TOOLS.length * 50} />
        </div>

        <SubsectionHeading
          eyebrow="PR gates"
          title="Where we gate PRs"
          subtitle="Verify every change on the platform you already host code on."
          className="mt-20"
        />
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PR_GATES.map((t, i) => (
            <ToolCard key={t.name} tool={t} delayMs={i * 60} />
          ))}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Azure DevOps and other platforms on request.
        </p>
      </div>
    </section>
  );
}

function SubsectionHeading({
  eyebrow,
  title,
  subtitle,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div className={cn('mt-14', className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {title}
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {subtitle}
      </p>
    </div>
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
        {tool.hint ? (
          <div className="truncate text-xs text-muted-foreground">{tool.hint}</div>
        ) : null}
      </div>
    </div>
  );
}

function MoreCard({ icons, delayMs }: { icons: IconType[]; delayMs: number }) {
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
      <div
        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-background/60 px-2.5 py-2"
        aria-hidden
      >
        {icons.slice(0, 4).map((Icon, i) => (
          <Icon
            key={i}
            className="h-4 w-4 text-muted-foreground/80"
          />
        ))}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">
          and more
        </div>
        <div className="truncate text-xs text-muted-foreground">
          on request
        </div>
      </div>
    </div>
  );
}
