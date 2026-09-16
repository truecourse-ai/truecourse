import { Box, FileClock, KeyRound, Server } from 'lucide-react';

type Card = { Icon: typeof Server; title: string; body: string };

const CARDS: Card[] = [
  { Icon: Server, title: 'Self-hosted', body: 'Runs in your VPC. Code and docs stay with you.' },
  { Icon: KeyRound, title: 'SSO', body: 'Okta, Azure AD and Google Workspace.' },
  { Icon: FileClock, title: 'Audit trail', body: 'Every run and decision, timestamped and attributed.' },
  { Icon: Box, title: 'Isolated sandboxes', body: 'Each check runs in a fresh sandbox, destroyed after.' },
];

export function Enterprise() {
  return (
    <section className="band" id="enterprise">
      <div className="wrap">
        <h2 className="eyebrow">Enterprise</h2>
        <div className="grid cols-4" style={{ marginTop: 28 }}>
          {CARDS.map((c) => (
            <div key={c.title} className="card">
              <span className="ico">
                <c.Icon />
              </span>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
