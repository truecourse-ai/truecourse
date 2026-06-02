import { Reveal } from './Reveal';

type Card = {
  num: string;
  title: string;
  body: string;
  accent?: boolean;
};

const CARDS: Card[] = [
  {
    num: '1',
    title: 'Tests verify what was written',
    body: 'Engineer or AI agent, the test inherits the same understanding of the spec. If that’s wrong, it passes against the wrong implementation.',
  },
  {
    num: '2',
    title: 'AI reviewers share the hallucinations',
    body: 'CodeRabbit, Gitar, Qodo all use LLMs to read the PR — the same kind of model that wrote the code. Same blind spots, no access to your decisions.',
  },
  {
    num: '3',
    title: 'Deterministic ground truth',
    body: 'We turn your decisions into contracts, then a deterministic engine — no LLM — checks every change against them. Same input, same result, every time.',
    accent: true,
  },
];

export function WhyTestsCantCatch() {
  return (
    <section className="band" id="why-us">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Why the existing tools can&apos;t catch this
        </Reveal>
        <Reveal as="h2" className="section-title" style={{ maxWidth: '30ch' }}>
          <span className="dim">Tests inherit the writer&apos;s understanding.</span> AI
          reviewers inherit the <span className="hl">blind spots.</span>
        </Reveal>

        <div className="grid cols-3" style={{ marginTop: 48 }}>
          {CARDS.map((c, i) => (
            <Reveal key={c.num} className={c.accent ? 'card accent' : 'card'} delay={i * 100}>
              <div className="kbig" style={c.accent ? undefined : { color: 'var(--muted)' }}>
                {c.num}
              </div>
              <h3 style={{ marginTop: 16, ...(c.accent ? { color: 'var(--accent)' } : {}) }}>
                {c.title}
              </h3>
              <p>{c.body}</p>
            </Reveal>
          ))}
        </div>

        <Reveal as="p" className="closing">
          Tests check code against what you <b>wrote</b>. AI review checks AI&apos;s code
          with more AI.{' '}
          <span className="hl">We check code against what you actually decided.</span>
        </Reveal>
      </div>
    </section>
  );
}
