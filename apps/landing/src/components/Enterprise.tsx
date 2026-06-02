import {
  ClipboardCheck,
  FileClock,
  KeyRound,
  Server,
  Users,
  WifiOff,
} from 'lucide-react';
import { Reveal } from './Reveal';

type Card = { Icon: typeof Server; title: string; body: string };

const CARDS: Card[] = [
  {
    Icon: Server,
    title: 'Self-hosted',
    body: 'Deploy in your VPC or on-prem. Code and specs stay between your infrastructure and your own LLM provider — they never touch TrueCourse.',
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
    body: 'The verifier is deterministic and runs entirely in your CI with no LLM calls. Optional telemetry, off with one flag.',
  },
  {
    Icon: ClipboardCheck,
    title: 'Compliance-ready',
    body: 'Designed for regulated industries — fintech, healthtech, defense. Documentation that satisfies auditors.',
  },
];

export function Enterprise() {
  return (
    <section className="band" id="enterprise">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Enterprise &amp; data
        </Reveal>
        <Reveal as="h2" className="section-title">
          <span className="dim">Built for teams where</span> data security{' '}
          <span className="hl">is not optional.</span>
        </Reveal>

        <div className="grid cols-3" style={{ marginTop: 48 }}>
          {CARDS.map((c, i) => (
            <Reveal key={c.title} className="card hover" delay={i * 60}>
              <span className="ico">
                <c.Icon />
              </span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
