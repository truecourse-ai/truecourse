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
    label: 'Capture',
    title: 'From every source',
    body: 'Scan docs, ADRs, READMEs, and Slack threads. Extract every decision your team made — with provenance back to the source.',
  },
  {
    num: '02',
    label: 'Compile',
    title: 'Into contracts',
    body: 'Decisions become machine-readable contracts. Versioned, reviewable, living alongside your code.',
  },
  {
    num: '03',
    label: 'Verify',
    title: 'Deterministically',
    body: 'A deterministic engine — no LLM in the loop — checks every change against the contracts. Same input, same result, every time.',
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
          <span className="dim">We compile your team&apos;s decisions into contracts.</span>{' '}
          A deterministic engine checks every change against them.
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

        <Reveal className="drift-line" delay={120}>
          <b>Every kind of drift surfaced:</b>
          <span className="dtag">mechanical</span>
          <span className="dtag">behavioral</span>
          <span className="dtag">architectural</span>
        </Reveal>
      </div>
    </section>
  );
}
