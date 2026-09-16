import { AppLink } from './AppLink';
import { Reveal } from './Reveal';

export function CTASection() {
  return (
    <section className="cta" id="cta">
      <div className="hero-glow" />
      <div className="wrap">
        <Reveal as="h2">
          Verify at <span className="hl">AI speed.</span>
        </Reveal>
        <Reveal as="p" delay={80}>
          AI made writing fast; review is the bottleneck. Every change checked against what
          your team decided, before it ships.
        </Reveal>
        <Reveal className="cta-row" delay={160}>
          <AppLink className="btn btn-primary" placement="cta">
            Get started <span className="arr">→</span>
          </AppLink>
        </Reveal>
      </div>
    </section>
  );
}
