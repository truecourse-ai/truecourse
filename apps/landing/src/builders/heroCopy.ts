import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { registerProperties } from '@/lib/posthog';

/**
 * The hero's headline, matched to the search an ad answered. Each ad group
 * links to its own path, which serves the one builders page with its own
 * headline, title and description, prerendered so the HTML already says what
 * was searched. Every PostHog event from the visit carries `hero_variant` so
 * the variants can be compared.
 */

export type HeroCopy = {
  variant: string;
  path: string;
  title: string;
  sub: string;
  long?: boolean;
  pageTitle: string;
  description: string;
};

const AD_SUB = 'Built your app with AI? Your AI CTO tests every change and fixes what breaks while you sleep.';

export const HEROES: HeroCopy[] = [
  {
    variant: 'default',
    path: '/builders',
    title: 'Your AI CTO',
    sub: 'Get your evenings and weekends back. It keeps your app working while you focus on your business and the people you care about.',
    pageTitle: 'TrueCourse · Your AI CTO',
    description:
      'An AI CTO for professionals who build their own apps with AI, for $49 a month for early adopters. Get your evenings and weekends back while it keeps your app working.',
  },
  {
    variant: 'fractional-cto',
    path: '/fractional-cto',
    title: 'Fractional CTO work, done by AI',
    sub: AD_SUB,
    long: true,
    pageTitle: 'TrueCourse · Fractional CTO work, done by AI',
    description:
      'Fractional CTO work for apps built with AI. Your AI CTO tests every change and fixes what breaks while you sleep, for $49 a month for early adopters.',
  },
  {
    variant: 'part-time-cto',
    path: '/part-time-cto',
    title: 'Why a part-time CTO? AI never clocks out.',
    sub: AD_SUB,
    long: true,
    pageTitle: 'TrueCourse · Why a part-time CTO? AI never clocks out.',
    description:
      'An AI CTO instead of a part-time one, for apps built with AI. It tests every change and fixes what breaks while you sleep, for $49 a month for early adopters.',
  },
];

/** The hero a path serves, ignoring a trailing slash. */
export function heroFor(pathname: string): HeroCopy {
  const path = pathname.replace(/\/+$/, '') || '/';
  return HEROES.find((h) => h.path === path) ?? HEROES[0]!;
}

/** The hero copy for this page, recorded on every PostHog event as `hero_variant`. */
export function useHeroCopy(): HeroCopy {
  const hero = heroFor(useLocation().pathname);
  useEffect(() => {
    registerProperties({ hero_variant: hero.variant });
  }, [hero.variant]);
  return hero;
}

/** The picture beside the headline: the year in numbers, or the morning phone. */
export type HeroScene = 'phone' | 'growth';

/**
 * The hero scene for this visit, from /builders?scene=phone, recorded on
 * every PostHog event as `hero_scene`. Without it the page shows the growth chart.
 */
export function useHeroScene(): HeroScene {
  const [scene, setScene] = useState<HeroScene>('growth');
  useEffect(() => {
    const chosen: HeroScene =
      new URLSearchParams(window.location.search).get('scene') === 'phone' ? 'phone' : 'growth';
    setScene(chosen);
    registerProperties({ hero_scene: chosen });
  }, []);
  return scene;
}
