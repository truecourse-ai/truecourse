import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LinksFunction } from 'react-router';
import { pageMeta } from '@/lib/seo';
import { cn } from '@/lib/cn';
import { Reveal } from '@/components/Reveal';
import { Clouds } from '@/components/Clouds';
import { Voyage } from '@/components/Voyage';
import { BookLink } from '@/builders/BookLink';
import type { BookPlacement } from '@/builders/BookLink';
import { Who } from '@/builders/Who';
import { Waitlist } from '@/builders/Waitlist';
import { useSectionViews } from '@/builders/useSectionViews';
import { MorningReport } from '@/builders/scenes/MorningReport';
import { WholeTeam } from '@/builders/scenes/WholeTeam';
import { WeekScene } from '@/builders/scenes/WeekScene';
import { ReviewScene } from '@/builders/scenes/ReviewScene';
import { WatchScene } from '@/builders/scenes/WatchScene';
import { ListenScene } from '@/builders/scenes/ListenScene';
import { SetupScene } from '@/builders/scenes/SetupScene';
import stylesheet from '@/builders/builders.css?url';

/**
 * The AI CTO page, for professionals who build their own apps with AI: a page of
 * its own, outside the main site's header and footer. Its ask is a booked
 * call, with a waitlist for those not ready for one, and it
 * records how far down each visitor reads.
 */

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export const meta = () =>
  pageMeta({
    title: 'TrueCourse · Your AI CTO',
    description:
      'For professionals who build their own apps with AI. TrueCourse tests every change like a real user, watches the app overnight, and finds where people struggle.',
    path: '/builders',
  });

const JOBS: { id: string; kicker: string; title: string; body: string; scene: ReactNode }[] = [
  {
    id: 'ships',
    kicker: 'Before it goes live',
    title: 'Tests every change like a real user',
    body: 'Before a change goes live, it tries the app in a real browser the way a customer would, inviting a teammate, paying an invoice, uploading a document. If the app stops doing what it should, the problem comes back in plain words with a fix to apply.',
    scene: <ReviewScene />,
  },
  {
    id: 'production',
    kicker: 'While it runs',
    title: 'Watches the app overnight',
    body: 'When something breaks, it spots it right away, finds the change that caused it and suggests a fix, all on one dashboard in plain words.',
    scene: <WatchScene />,
  },
  {
    id: 'users',
    kicker: 'From real users',
    title: 'Knows where users struggle',
    body: 'It watches how people really use the app. Where they get stuck, which buttons they tap again and again, which steps they give up on. Then it ranks what it finds by how many people each problem hurts.',
    scene: <ListenScene />,
  },
];

/** The sections whose reach is recorded, top to bottom. */
const SECTIONS = ['team', 'cto', 'setup', 'who', 'talk'];

/** A banner at the end of a section, asking the reader it has just won over for a call. */
function InlineAsk({ say, more, placement }: { say: string; more: string; placement: BookPlacement }) {
  return (
    <Reveal className="bs-ask">
      <span className="bs-ask-mark" aria-hidden="true">
        <img src="/truecourse-mark-twin-light.svg" alt="" />
      </span>
      <div className="bs-ask-text">
        <p className="bs-ask-say">{say}</p>
        <p className="bs-ask-more">{more}</p>
      </div>
      <BookLink className="btn btn-primary" placement={placement}>
        Talk to us
      </BookLink>
    </Reveal>
  );
}

function BuildersHeader() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('site', scrolled && 'scrolled')}>
      <div className="wrap nav">
        <a href="#top" className="brand">
          <span className="mark" aria-hidden />
          TrueCourse
        </a>
        <nav className="nav-links">
          <a href="#cto">What it does</a>
          <a href="#setup">Setup</a>
          <a href="#who">Who it's for</a>
        </nav>
        <BookLink className="btn btn-primary btn-sm" placement="header">
          Talk to us
        </BookLink>
      </div>
    </header>
  );
}

export default function BuildersPage() {
  useSectionViews(SECTIONS);
  return (
    <div className="builders">
      <BuildersHeader />
      <main>
        <section className="bs-hero" id="top">
          <Clouds className="hero-clouds" />
          <Clouds className="hero-clouds" layout="narrow" />
          <div className="wrap bs-hero-inner">
            <div className="bs-hero-text">
              <Reveal as="p" className="kicker" delay={20} rise>
                For professionals who build their own apps with AI
              </Reveal>
              <Reveal as="h1" delay={60} rise>
                Your AI CTO
              </Reveal>
              <Reveal as="p" className="sub" delay={140} rise>
                You build the product. It catches bugs before users do, watches the app overnight, and finds
                where people struggle.
              </Reveal>
              <Reveal className="bs-cta-row" delay={220} rise>
                <BookLink className="btn btn-primary" placement="hero">
                  Talk to us
                </BookLink>
                <a className="btn" href="#cto">
                  See what it does
                </a>
              </Reveal>
              <Reveal as="p" className="bs-backing" delay={260} rise>
                <span>Backed by</span>
                <img src="/skydeck.svg" alt="Berkeley SkyDeck" />
              </Reveal>
            </div>
            <Reveal className="bs-hero-scene" delay={300} rise>
              <MorningReport />
            </Reveal>
          </div>
        </section>

        <section className="band" id="team">
          <div className="wrap">
            <Reveal className="bs-center">
              <p className="kicker">The problem</p>
              <h2 className="section-h">Building alone, some jobs never get done</h2>
              <p className="section-sub">
                One person builds the app and puts it live. Nobody else tests it, watches it at night or hears
                from its users.
              </p>
            </Reveal>
            <Reveal className="bs-team-scene">
              <WholeTeam />
            </Reveal>
            <WeekScene>
              <p className="bs-week-lead">A normal week, building alone</p>
            </WeekScene>
            <InlineAsk say="Sound like your week?" more="Tell us about your app. 15 minutes, no slides." placement="after-week" />
          </div>
        </section>

        <section className="band" id="cto">
          <div className="wrap">
            <Reveal className="bs-center">
              <h2 className="section-h">An AI CTO takes those three jobs</h2>
            </Reveal>
            <div className="bs-jobs">
              {JOBS.map((job, i) => (
                <div className={cn('bs-job', i % 2 === 1 && 'flip')} id={job.id} key={job.id}>
                  <Reveal className="bs-job-text">
                    <p className="kicker">{job.kicker}</p>
                    <h3>{job.title}</h3>
                    <p>{job.body}</p>
                  </Reveal>
                  <Reveal className="bs-job-scene">{job.scene}</Reveal>
                </div>
              ))}
            </div>
            <InlineAsk say="Want this watching your app?" more="See it on your own app in a 15-minute call." placement="after-jobs" />
          </div>
        </section>

        <section className="band" id="setup">
          <div className="wrap">
            <SetupScene>
              <div className="bs-center">
                <h2 className="section-h">Up and running in minutes</h2>
                <p className="section-sub">It starts working right away.</p>
              </div>
            </SetupScene>
            <InlineAsk say="Ready to try it on your app?" more="Book 15 minutes and we connect it together." placement="after-setup" />
          </div>
        </section>

        <section className="band" id="who">
          <div className="wrap">
            <Reveal className="bs-center">
              <h2 className="section-h">Built for professionals who build with AI</h2>
              <p className="section-sub">
                Accountants, lawyers, consultants and more, with code written by AI. An internal tool for the firm, a portal for
                clients, or a SaaS of their own. Keeping it working should not take an engineering team.
              </p>
            </Reveal>
          </div>
          <Reveal>
            <Who />
          </Reveal>
        </section>

        <section className="cta" id="talk">
          <div className="wrap">
            <h2>Hire your AI CTO</h2>
            <p className="bs-cta-say">
              A 15-minute call. We look at the app together and say honestly whether this fits.
            </p>
            <div className="cta-row">
              <BookLink className="btn btn-primary" placement="cta">
                Talk to us
              </BookLink>
            </div>
            <Waitlist />
          </div>
          <Voyage />
        </section>
      </main>
      <footer className="site bs-foot">
        <div className="wrap foot-bottom">
          <span>© {new Date().getFullYear()} TrueCourse AI, Inc.</span>
          <span>2261 Market Street STE 88087, San Francisco, CA 94114</span>
        </div>
      </footer>
    </div>
  );
}
