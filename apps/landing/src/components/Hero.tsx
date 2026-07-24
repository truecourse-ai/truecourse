import { Link } from 'react-router';
import { SiConfluence, SiGithub } from 'react-icons/si';
import { Reveal } from './Reveal';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-glow" />
      <svg
        className="hero-baseline"
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <line
          className="bline"
          x1="0"
          y1="150"
          x2="1440"
          y2="150"
          style={{ stroke: 'var(--accent)' }}
          strokeWidth="1.5"
          opacity="0.5"
        />
        <path
          className="bdrift"
          d="M0 150 C 760 150, 920 150, 1440 210"
          fill="none"
          style={{ stroke: 'var(--warn)' }}
          strokeWidth="1.5"
          strokeDasharray="2 9"
          opacity="0.55"
        />
      </svg>

      <div className="wrap hero-inner hero-grid">
        <div className="hero-copy">
          <Reveal as="h1" delay={80}>
            AI ships your code. We keep it <span className="hl">on course.</span>
          </Reveal>

          <Reveal as="p" className="sub" delay={160}>
            Every change, checked against what your team actually decided.
          </Reveal>

          <Reveal className="cta-row" delay={300}>
            <Link className="btn btn-primary" to="/request-access">
              Request access <span className="arr">→</span>
            </Link>
            <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </Reveal>
        </div>

        <Reveal className="hero-visual" delay={260}>
          <div className="hv-comp">
            <div className="checks">
              <div className="ck-head">
                <span className="glyph ckg">
                  <SiGithub />
                </span>
                Some checks failed <span className="ck-sub">1 failing · 2 successful</span>
              </div>
              <div className="ck-row">
                <span className="ck-ico ok">✓</span>
                <span className="ck-name">ci / build</span>
                <span className="ck-time">2m 14s</span>
              </div>
              <div className="ck-row">
                <span className="ck-ico ok">✓</span>
                <span className="ck-name">ci / tests</span>
                <span className="ck-time">4m 02s</span>
              </div>
              <div className="ck-row nb">
                <span className="ck-ico bad">✕</span>
                <span className="ck-name">TrueCourse / guard</span>
                <span className="ck-note">1 drift detected</span>
                <span className="ck-link">Details</span>
              </div>
              <div className="ck-detail">
                <div className="ckd-quote">
                  <p>“Refunds must return to the original payment method.”</p>
                  <span className="ckd-src">
                    <span className="glyph">
                      <SiConfluence />
                    </span>
                    Refund policy · Payments
                  </span>
                </div>
                <div className="ckd-obs">
                  <span className="ck-ico bad sm">✕</span>
                  <span>
                    <b>Observed:</b> refund issued as store credit
                  </span>
                </div>
              </div>
              <div className="ck-foot">
                <span className="ck-ico bad sm">✕</span> Merging is blocked{' '}
                <span className="ck-btn">Merge</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
