import { useEffect } from 'react';
import type { LinksFunction, MetaFunction } from 'react-router';
import { pageMeta } from '@/lib/seo';
import { registerProperties } from '@/lib/posthog';
import { Reveal } from '@/components/Reveal';
import { Clouds } from '@/components/Clouds';
import { Voyage } from '@/components/Voyage';
import { BookLink, BookingCalendar } from '@/builders/BookLink';
import { Header } from '@/builders/Header';
import { AskForm, CTO_NEED } from '@/builders/AskForm';
import { Compare } from '@/builders/Compare';
import { useSectionViews } from '@/builders/useSectionViews';
import { TrackRecord, TrackStats } from '@/builders/scenes/TrackRecord';
import stylesheet from '@/builders/builders.css?url';

/**
 * The page the "fractional CTO" ad lands on. It leaves what the visitor needs
 * from a CTO open and asks them, beside a human fractional CTO compared with
 * the AI CTO and the people behind it, with a call one tap away. Every
 * PostHog event from the visit carries `hero_variant: fractional-cto-need`,
 * and it records how far down each visitor reads.
 */

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export const meta: MetaFunction = () =>
  pageMeta({
    title: 'TrueCourse · Your fractional CTO starts today',
    description:
      'A fractional CTO that starts today. An AI CTO, backed by engineers who have run production for decades. Start free and tell us what you need.',
    path: '/fractional-cto',
  });

/** The sections whose reach is recorded, top to bottom. */
const SECTIONS = ['compare', 'behind', 'talk'];

export default function FractionalCtoPage() {
  useSectionViews(SECTIONS);
  useEffect(() => {
    registerProperties({ hero_variant: 'fractional-cto-need' });
  }, []);

  return (
    <div className="builders">
      <Header>
        <BookLink className="btn btn-primary btn-sm" placement="header">
          Book a free call
        </BookLink>
      </Header>
      <main>
        <section className="bs-hero" id="top">
          <Clouds className="hero-clouds" />
          <Clouds className="hero-clouds" layout="narrow" />
          <div className="wrap bs-hero-inner">
            <div className="bs-hero-text">
              <Reveal as="h1" delay={60} rise>
                Your fractional CTO starts today
              </Reveal>
              <Reveal as="p" className="sub" delay={140} rise>
                An AI CTO, backed by engineers who have run production for decades. Tell us what you need.
              </Reveal>
              <Reveal as="p" className="bs-backing" delay={220} rise>
                <span>Backed by</span>
                <img src="/skydeck.svg" alt="Berkeley SkyDeck" />
              </Reveal>
            </div>
            <Reveal className="bs-hero-scene" delay={300} rise>
              <AskForm question={CTO_NEED} />
            </Reveal>
          </div>
        </section>

        <Compare />

        <section className="band" id="behind">
          <div className="wrap bs-behind">
            <Reveal className="bs-behind-copy">
              <p className="kicker">Who is behind it</p>
              <h2 className="section-h">Built by tech leaders who have run production for decades</h2>
              <p className="section-sub">
                We have led engineering for enterprise platforms and consumer apps. What we learned as CTOs is what
                your AI CTO brings to your company.
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
            <h2>Rather talk it through?</h2>
            <p className="bs-cta-say">
              Book a free 30-minute call. Tell us what you need from a CTO, and we show you how your AI CTO would
              handle it.
            </p>
            <BookingCalendar className="bs-calendar" />
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
