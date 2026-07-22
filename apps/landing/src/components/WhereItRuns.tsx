import { Reveal } from './Reveal';

type Line = { state: 'pass' | 'run'; text: string; dur: string };
type Sandbox = {
  id: string;
  status: 'running' | 'passed';
  area: string;
  lines: Line[];
  seed: string;
  delay?: number;
};

const TRACK = [
  { num: '01', name: 'Create sandbox', sub: 'fresh, isolated env' },
  { num: '02', name: 'Seed data', sub: 'fixtures + synthetic rows' },
  { num: '03', name: 'Run scenarios', sub: 'in parallel' },
  { num: '04', name: 'Gate the PR', sub: 'evidence attached' },
];

const SANDBOXES: Sandbox[] = [
  {
    id: 'sandbox-7f2a',
    status: 'running',
    area: 'payments',
    lines: [
      { state: 'pass', text: 'order total = sum of line items', dur: '1.2s' },
      { state: 'pass', text: 'tax applied to subtotal', dur: '0.8s' },
      { state: 'run', text: 'refund emits webhook', dur: '…' },
    ],
    seed: 'node:20 · postgres:16 · seeded: 3 users, 12 orders',
  },
  {
    id: 'sandbox-b910',
    status: 'passed',
    area: 'auth',
    lines: [
      { state: 'pass', text: 'auth blocks expired token', dur: '0.6s' },
      { state: 'pass', text: 'role gate on /admin', dur: '0.9s' },
      { state: 'pass', text: 'reset link is one-time use', dur: '1.4s' },
    ],
    seed: 'python:3.12 · seeded: fixtures/auth.sql',
    delay: 100,
  },
  {
    id: 'sandbox-c4d1',
    status: 'running',
    area: 'billing',
    lines: [
      { state: 'pass', text: 'invoice PDF fields present', dur: '2.1s' },
      { state: 'run', text: 'dunning retries 3× then stops', dur: '…' },
      { state: 'pass', text: 'currency rounds to 2dp', dur: '0.4s' },
    ],
    seed: 'node:20 · stripe-mock · seeded: 5 tenants',
    delay: 200,
  },
];

export function WhereItRuns() {
  return (
    <section className="band" id="run">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Where it runs
        </Reveal>
        <Reveal as="h2" className="section-title">
          <span className="dim">No runners to host.</span> Every PR runs in its own{' '}
          <span className="hl">sandbox.</span>
        </Reveal>
        <Reveal as="p" className="section-lead">
          TrueCourse creates a sandbox per PR, seeds test data, runs every scenario, and
          posts the gate back. Then it all gets torn down.
        </Reveal>

        <Reveal className="run-track">
          {TRACK.map((t) => (
            <div className="rt-step" key={t.num}>
              <span className="rt-node">{t.num}</span>
              <span className="rt-name">{t.name}</span>
              <span className="rt-sub">{t.sub}</span>
            </div>
          ))}
        </Reveal>

        <div className="sandbox-grid">
          {SANDBOXES.map((sb) => (
            <Reveal key={sb.id} className="sbx" delay={sb.delay}>
              <div className="sbx-bar">
                <span className={sb.status === 'running' ? 'dot busy' : 'dot'} />
                <span className="sbx-id">{sb.id}</span>
                <span className={sb.status === 'running' ? 'sbx-pill run' : 'sbx-pill ok'}>
                  {sb.status}
                </span>
              </div>
              <div className="sbx-term">
                <div className="cmd">
                  $ <b>truecourse guard run</b> --area {sb.area}
                </div>
                {sb.lines.map((ln, i) => (
                  <div className={ln.state === 'pass' ? 'tln pass' : 'tln runy'} key={i}>
                    <span className="tmk">
                      {ln.state === 'pass' ? '✓' : <span className="tspin" />}
                    </span>
                    {ln.text}
                    <span className="tdur">{ln.dur}</span>
                  </div>
                ))}
              </div>
              <div className="sbx-seed">
                <span className="mk">≡</span> {sb.seed}
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal as="p" className="fine">
          Spun up in parallel · seeded from your fixtures · torn down after the run.
        </Reveal>
      </div>
    </section>
  );
}
