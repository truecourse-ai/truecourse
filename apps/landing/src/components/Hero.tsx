import { Link } from 'react-router-dom';
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

      <div className="wrap hero-inner">
        <Reveal as="h1">
          AI ships your code. We keep it <span className="hl">on course.</span>
        </Reveal>

        <Reveal as="p" className="sub" delay={80}>
          Every change, checked against what your team actually decided.
        </Reveal>

        <Reveal className="cta-row" delay={160}>
          <Link className="btn btn-primary" to="/request-access">
            Request access <span className="arr">→</span>
          </Link>
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </Reveal>
      </div>
    </section>
  );
}
