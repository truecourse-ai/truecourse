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
import { Check } from '@/builders/icons';
import { BuiltWith } from '@/builders/BuiltWith';
import { Waitlist } from '@/builders/Waitlist';
import { useSectionViews } from '@/builders/useSectionViews';
import { MorningScene } from '@/builders/scenes/MorningScene';
import { JobsChecklist } from '@/builders/scenes/JobsChecklist';
import { EveningScene } from '@/builders/scenes/EveningScene';
import { ReviewScene } from '@/builders/scenes/ReviewScene';
import { WatchScene } from '@/builders/scenes/WatchScene';
import { ListenScene } from '@/builders/scenes/ListenScene';
import { TextScene } from '@/builders/scenes/TextScene';
import { TrackRecord, TrackStats } from '@/builders/scenes/TrackRecord';
import stylesheet from '@/builders/builders.css?url';

/**
 * The AI CTO page, for professionals who build their own apps with AI: a page of
 * its own, outside the main site's header and footer. Its ask is a paid app
 * checkup, with a waitlist for those not ready for one, and it records how
 * far down each visitor reads.
 */

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export const meta = () =>
  pageMeta({
    title: 'TrueCourse · Your AI CTO',
    description:
      'An AI CTO for professionals who build their own apps with AI, for $99 a month. Get your evenings and weekends back while it keeps your app working.',
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
    body: 'When something breaks, it spots it right away, finds the change that caused it, then tests a fix and puts it live, all without waking you.',
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
const SECTIONS = ['team', 'cto', 'text', 'pricing', 'who', 'behind', 'talk'];

/** A banner at the end of a section, offering the reader it has just won over an app checkup. */
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
        Book a $49 checkup
      </BookLink>
    </Reveal>
  );
}

/** What the monthly plan includes, as the pricing card lists it. */
const INCLUDED = [
  'Tests every change before it goes live',
  'Watches your app day and night, and fixes what breaks while you sleep',
  'Shows where people get stuck, ranked by how many it affects',
  'Reach it by text, any time',
];

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
          <a href="#pricing">Pricing</a>
          <a href="#who">Who it's for</a>
        </nav>
        <BookLink className="btn btn-primary btn-sm" placement="header">
          Book a $49 checkup
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
                Get your evenings and weekends back. It keeps your app working while you focus on your
                business and the people you care about.
              </Reveal>
              <Reveal className="bs-cta-row" delay={220} rise>
                <BookLink className="btn btn-primary" placement="hero">
                  Book a $49 app checkup
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
              <MorningScene />
            </Reveal>
          </div>
        </section>

        <BuiltWith />

        <section className="band" id="team">
          <div className="wrap">
            <Reveal className="bs-center">
              <p className="kicker">The problem</p>
              <h2 className="section-h">You hired yourself for one job. The app needs four</h2>
            </Reveal>
            <JobsChecklist />
            <EveningScene>
              <h3 className="bs-evening-lead">Meanwhile, on your phone</h3>
              <p>Reviews, outages, cancellations. None of it waits until you have time.</p>
            </EveningScene>
            <InlineAsk say="Sound familiar?" more="Start with a 30-minute app checkup. $49, credited to your first month." placement="after-evening" />
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
            <InlineAsk say="Want this for your app?" more="Book an app checkup and find out what your app actually needs." placement="after-jobs" />
          </div>
        </section>

        <section className="band" id="text">
          <div className="wrap bs-text-row">
            <Reveal className="bs-text-copy">
              <p className="kicker">By text, day and night</p>
              <h2 className="section-h">One text away, any time</h2>
              <p className="section-sub">
                The AI CTO texts you when something needs you, answers what you ask, and does what you tell it.
                The dashboard is there when you want the full picture.
              </p>
              <ul className="bs-text-kinds">
                <li>
                  <b>Updates</b>
                  <span>Checkout broke at 2 AM. I fixed and tested it, nothing for you to do.</span>
                </li>
                <li>
                  <b>Questions</b>
                  <span>What are users stuck on this week?</span>
                </li>
                <li>
                  <b>Commands</b>
                  <span>Fix the Export button, and put it live when it works.</span>
                </li>
              </ul>
            </Reveal>
            <Reveal className="bs-text-phone">
              <TextScene />
            </Reveal>
          </div>
        </section>

        <section className="band" id="pricing">
          <div className="wrap">
            <Reveal className="bs-center">
              <h2 className="section-h">One plan, everything included</h2>
            </Reveal>
            <Reveal className="bs-plan">
              <div className="bs-plan-head">
                <b>AI CTO</b>
                <p className="bs-plan-price">
                  $99<span>a month</span>
                </p>
                <p className="bs-muted">Less than one hour of a developer's time.</p>
              </div>
              <ul className="bs-plan-list">
                {INCLUDED.map((line) => (
                  <li key={line}>
                    <span className="bs-glyph">
                      <Check />
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
              <div className="bs-plan-start">
                <b>Start with a $49 app checkup</b>
                <p>
                  We look at your app and how you run it, then send you a plan for what you need. Credited to your
                  first month.
                </p>
                <BookLink className="btn btn-primary" placement="pricing">
                  Book a $49 checkup
                </BookLink>
                <span className="bs-muted">Cancel anytime.</span>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="band" id="who">
          <div className="wrap">
            <Reveal className="bs-center">
              <h2 className="section-h">Built for professionals who build with AI</h2>
              <p className="section-sub">
                Whatever your field and whatever you built with AI. An internal tool for the firm, a portal for
                clients, or a SaaS of your own. Keeping it working should not take an engineering team.
              </p>
            </Reveal>
          </div>
          <Reveal>
            <Who />
          </Reveal>
        </section>

        <section className="band" id="behind">
          <div className="wrap bs-behind">
            <Reveal className="bs-behind-copy">
              <p className="kicker">Who is behind it</p>
              <h2 className="section-h">Built by tech leaders who have run production for decades</h2>
              <p className="section-sub">
                We have led engineering for enterprise platforms and consumer apps. What we learned keeping them
                working is what your AI CTO does for you.
              </p>
              <TrackStats />
              <p className="bs-backing large">
                <span>Backed by</span>
                <img src="/skydeck.svg" alt="Berkeley SkyDeck" />
              </p>
            </Reveal>
            <TrackRecord />
          </div>
        </section>

        <section className="cta" id="talk">
          <div className="wrap">
            <h2>Hire your AI CTO</h2>
            <p className="bs-cta-say">
              Start with a 30-minute app checkup. We look at your app and how you run it, then send you a short
              plan for what you actually need. $49, credited to your first month. After that, $99 a month.
            </p>
            <div className="cta-row">
              <BookLink className="btn btn-primary" placement="cta">
                Book a $49 app checkup
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
