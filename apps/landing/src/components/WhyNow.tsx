import { Bot, Clock, TrendingUp, Zap } from 'lucide-react';
import { Reveal } from './Reveal';

const BULLETS = [
  { Icon: Bot, text: 'AI agents ship a growing share of production code.' },
  { Icon: TrendingUp, text: 'PRs arrive faster than reviewers can keep up.' },
  {
    Icon: Clock,
    text: 'Senior engineers spend their days reviewing AI output, not building.',
  },
  { Icon: Zap, text: "Slowing AI down isn't the answer. Faster verification is." },
];

export function WhyNow() {
  return (
    <section className="band" id="why-now">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          Why now
        </Reveal>
        <Reveal as="h2" className="section-title">
          <span className="dim">AI made writing code fast.</span> Review is the new{' '}
          <span className="hl">bottleneck.</span>
        </Reveal>

        <div className="grid cols-2" style={{ marginTop: 52 }}>
          {BULLETS.map((b, i) => (
            <Reveal key={b.text} className="bullet" delay={i * 80}>
              <span className="ico">
                <b.Icon />
              </span>
              <p>{b.text}</p>
            </Reveal>
          ))}
        </div>

        <Reveal as="p" className="big-claim">
          The next <span className="hl">10×</span> in engineering comes from verifying code
          at <span className="hl">AI speed.</span>
        </Reveal>
      </div>
    </section>
  );
}
