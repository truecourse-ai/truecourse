import { Reveal } from './Reveal';

type Step = {
  num: string;
  label: string;
  title: string;
  body: string;
  accent?: boolean;
};

const STEPS: Step[] = [
  {
    num: '01',
    label: 'Curate',
    title: 'From your docs',
    body: 'PRDs, ADRs, RFCs, design docs, pulled from Confluence, Jira, Notion, wherever they live. Noise dropped, the rest grouped into areas, disagreements flagged.',
  },
  {
    num: '02',
    label: 'Generate',
    title: 'Into scenario tests',
    body: 'Each spec section gets declarative scenarios: authored once, proven by running them on the spot.',
  },
  {
    num: '03',
    label: 'Run',
    title: 'On every PR',
    body: 'Every PR runs them in a fresh sandbox and gates on the result. A failure means spec and code disagree.',
    accent: true,
  },
];

export function OurApproach() {
  return (
    <section className="band" id="approach">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Our approach
        </Reveal>
        <Reveal as="h2" className="section-title" style={{ maxWidth: '28ch' }}>
          <span className="dim">
            Your docs become scenario tests, bound to each spec section.
          </span>{' '}
          Every change is checked against them.
        </Reveal>

        <div className="flow" style={{ marginTop: 52 }}>
          {STEPS.map((s, i) => (
            <Reveal key={s.num} className="fstep" delay={i * 120}>
              <div className={s.accent ? 'card accent' : 'card'}>
                <div className="fhead">
                  <span className="kbig">{s.num}</span>
                  <span
                    className="knum"
                    style={s.accent ? { color: 'var(--accent)' } : undefined}
                  >
                    {s.label}
                  </span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="bind" delay={60}>
          <div className="doc-real">
            <h4>Refund policy</h4>
            <div className="doc-meta">
              <span className="doc-ava" />
              Sarah Lin · Payments · updated 2d ago
            </div>
            <p>
              When a customer requests a refund on a completed order,{' '}
              <mark>refunds must return to the original payment method</mark> used at
              checkout.
            </p>
            <p>Partial refunds are allowed within 90 days of purchase…</p>
          </div>

          <div className="bind-mid" aria-hidden="true">
            <svg viewBox="0 0 160 120" preserveAspectRatio="none">
              <path className="p-gen" d="M0 38 L160 38" />
              <path className="p-drift" d="M160 86 L0 86" />
            </svg>
            <span className="bm-label top">generates →</span>
            <span className="bm-label bot">← fails the PR</span>
          </div>

          <div className="editor">
            <div className="ed-bar">
              <span className="tl r" />
              <span className="tl y" />
              <span className="tl g" />
              <span className="ed-name">refund-original-method.yaml</span>
            </div>
            <div className="ed-body">
              <div className="ln">
                <span className="no">1</span>
                <span className="cd">
                  <i className="yk2">scenario:</i> refund-original-method
                </span>
              </div>
              <div className="ln">
                <span className="no">2</span>
                <span className="cd">
                  <i className="yk2">given:</i>
                </span>
              </div>
              <div className="ln">
                <span className="no">3</span>
                <span className="cd">
                  {'  '}
                  <i className="yk2">order:</i> <i className="ys">paid_by_card</i>
                </span>
              </div>
              <div className="ln">
                <span className="no">4</span>
                <span className="cd">
                  <i className="yk2">when:</i> <i className="ys">refund_issued</i>
                </span>
              </div>
              <div className="ln">
                <span className="no">5</span>
                <span className="cd">
                  <i className="yk2">expect:</i>
                </span>
              </div>
              <div className="ln">
                <span className="no">6</span>
                <span className="cd">
                  {'  '}
                  <i className="yk2">refund.method:</i> <i className="ys">original_card</i>
                </span>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="drift-line" delay={120}>
          <b>Drift surfaces both ways:</b>
          <span className="dtag">code changed → scenarios fail</span>
          <span className="dtag">spec edited → scenarios go stale</span>
        </Reveal>
      </div>
    </section>
  );
}
