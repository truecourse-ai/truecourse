import { Link } from 'react-router-dom';
import { Reveal } from './Reveal';

export function CTASection() {
  return (
    <section className="cta" id="cta">
      <div className="hero-glow" />
      <div className="wrap cta-inner">
        <Reveal as="h2">
          Verify at <span className="hl">AI speed.</span>
        </Reveal>
        <Reveal as="p" delay={80}>
          AI made writing code fast. Review is the bottleneck. We check every change
          against what your team decided — deterministically.
        </Reveal>
        <Reveal className="cta-row" delay={160}>
          <Link className="btn btn-primary" to="/request-access">
            Request access <span className="arr">→</span>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
