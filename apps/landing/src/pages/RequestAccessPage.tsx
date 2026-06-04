import { useEffect } from 'react';
import { AccessForm } from '@/components/AccessForm';
import { Reveal } from '@/components/Reveal';

export default function RequestAccessPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'TrueCourse · Request access';
    return () => {
      document.title = prev;
    };
  }, []);

  return (
    <section className="access-wrap">
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

      <div className="access-card-wrap">
        <Reveal className="access-head">
          <span className="beta-badge">
            <span className="spark">✦</span> Closed beta
          </span>
          <h1>Request early access</h1>
          <p>
            We&apos;re onboarding teams in waves. Drop your details and we&apos;ll be in
            touch when the next batch opens.
          </p>
        </Reveal>

        <Reveal className="form-card" delay={100}>
          <AccessForm />
        </Reveal>
      </div>
    </section>
  );
}
