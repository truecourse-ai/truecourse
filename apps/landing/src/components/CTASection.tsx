import { AppLink } from './AppLink';

export function CTASection() {
  return (
    <section className="cta" id="cta">
      <div className="hero-glow" />
      <div className="wrap">
        <h2>
          Put your docs <span className="hl">to the test.</span>
        </h2>
        <div className="cta-row">
          <AppLink className="btn btn-primary" placement="cta">
            Get started <span className="arr">→</span>
          </AppLink>
        </div>
      </div>
    </section>
  );
}
