import {
  ClipboardCheck,
  FileClock,
  KeyRound,
  Server,
  Users,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useReveal } from '@/lib/useReveal';

type Card = {
  Icon: typeof Server;
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    Icon: Server,
    title: 'Self-hosted',
    body: 'Deploy in your VPC or on-premises. Code and specs stay between your infrastructure and the LLM provider your team already uses. They never touch TrueCourse.',
  },
  {
    Icon: KeyRound,
    title: 'SSO',
    body: 'Integrates with Okta, Azure AD, and Google Workspace. No separate credentials to manage or rotate.',
  },
  {
    Icon: Users,
    title: 'RBAC',
    body: 'Viewer, Contributor, Admin, and Auditor roles. Granular control over who resolves and promotes contracts.',
  },
  {
    Icon: FileClock,
    title: 'Full audit trail',
    body: 'Every contract change, conflict resolution, and drift event is timestamped and attributed.',
  },
  {
    Icon: WifiOff,
    title: 'Verify stays local',
    body: 'The verifier is deterministic and runs entirely in your CI with no LLM calls. Optional anonymous telemetry helps us improve the engine, off with one flag.',
  },
  {
    Icon: ClipboardCheck,
    title: 'Compliance-ready',
    body: 'Designed for regulated industries: fintech, healthtech, defense. Documentation that satisfies auditors.',
  },
];

export function Enterprise() {
  return (
    <section id="enterprise" className="relative border-b border-border py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
            Enterprise &amp; data
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            <span className="text-gradient">Built for teams where</span>{' '}
            <span className="text-gradient-accent">
              data security is not optional.
            </span>
          </h2>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c, i) => (
            <EnterpriseCard key={c.title} card={c} delayMs={i * 60} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EnterpriseCard({ card, delayMs }: { card: Card; delayMs: number }) {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const { Icon } = card;
  return (
    <div
      ref={ref}
      style={{ ['--delay' as string]: `${delayMs}ms` }}
      className={cn(
        'reveal surface-hover rounded-2xl border border-border bg-card/40 p-6 transition-colors hover:border-border-strong hover:bg-card',
        visible && 'visible',
      )}
    >
      <span
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 text-accent shadow-[0_0_20px_-6px] shadow-accent/30"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 text-base font-semibold text-accent">{card.title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
    </div>
  );
}
