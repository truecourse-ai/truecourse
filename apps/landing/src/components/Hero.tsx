import { AppLink } from './AppLink';
import { Reveal } from './Reveal';
import { useReveal } from '@/lib/useReveal';
import { HomeScreen } from '@/screens/HomeScreen';

const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

export function Hero() {
  // The baseline sits at the bottom of the hero, often below the fold, so it
  // draws when it comes into view rather than on load.
  const line = useReveal<SVGSVGElement>({ threshold: 0.5, rootMargin: '0px' });
  // The screen's own motion (the chart, the counts, the sections) runs on the
  // same signal as its settle-in.
  const stage = useReveal<HTMLDivElement>();
  return (
    <section className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-glow" />
      <svg
        ref={line.ref}
        className={`hero-line${line.visible ? ' visible' : ''}`}
        viewBox="0 0 1440 160"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 98 C 380 98, 600 58, 840 82 S 1240 132, 1440 108" pathLength={1} />
      </svg>
      <div className="wrap hero-inner">
        <Reveal as="h1" delay={60} rise>
          Know which of your requirements hold.
        </Reveal>
        <Reveal as="p" className="sub" delay={140} rise>
          Every requirement you wrote, proven against the running product and kept current as it
          changes.
        </Reveal>
        <Reveal className="cta-row" delay={220} rise>
          <AppLink className="btn btn-primary" placement="hero">
            Get started <span className="arr">→</span>
          </AppLink>
          <a className="btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </Reveal>
        <div
          ref={stage.ref}
          className={`reveal rise hero-stage${stage.visible ? ' visible' : ''}`}
          style={{ ['--delay' as string]: '300ms' }}
        >
          <HomeScreen visible={stage.visible} />
        </div>
      </div>
    </section>
  );
}
