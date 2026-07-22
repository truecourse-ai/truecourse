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
    body: 'Deploy in your VPC or on-prem. Code and specs never touch TrueCourse.',
  },
  {
    Icon: KeyRound,
    title: 'SSO',
    body: 'Okta, Azure AD, Google Workspace. No separate credentials to manage.',
  },
  {
    Icon: Users,
    title: 'RBAC',
    body: 'Viewer, Contributor, Admin, Auditor. Control who resolves conflicts and promotes scenarios.',
  },
  {
    Icon: FileClock,
    title: 'Full audit trail',
    body: 'Every scenario change, conflict resolution, and drift event is timestamped and attributed.',
  },
  {
    Icon: WifiOff,
    title: 'Isolated by default',
    body: 'Every check runs in an ephemeral sandbox, destroyed on finish. Telemetry off with one flag.',
  },
  {
    Icon: ClipboardCheck,
    title: 'Compliance-ready',
    body: 'Built for regulated industries: fintech, healthtech, defense. Documentation auditors accept.',
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
