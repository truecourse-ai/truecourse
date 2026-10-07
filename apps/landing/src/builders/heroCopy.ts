import { useEffect, useState } from 'react';
import { registerProperties } from '@/lib/posthog';

/**
 * The hero's headline, matched to the search an ad answered. An ad links to
 * /builders?hero=<variant>, the hero repeats what was searched, and every
 * PostHog event from the visit carries `hero_variant` so the variants can be
 * compared. Without a known variant the page shows its own headline.
 */

export type HeroCopy = { variant: string; title: string; sub: string; long?: boolean };

const FILTER_SUB =
  'You built the app with Lovable, Replit or Claude Code. We test it, watch it and fix it, for $99 a month.';

const DEFAULT: HeroCopy = {
  variant: 'default',
  title: 'Your AI CTO',
  sub: 'Get your evenings and weekends back. It keeps your app working while you focus on your business and the people you care about.',
};

const VARIANTS: Record<string, HeroCopy> = {
  'fractional-cto': {
    variant: 'fractional-cto',
    title: 'A fractional CTO for apps built with AI',
    sub: FILTER_SUB,
    long: true,
  },
  'part-time-cto': {
    variant: 'part-time-cto',
    title: 'A part-time CTO for your AI-built app',
    sub: FILTER_SUB,
    long: true,
  },
};

/**
 * The hero copy for this visit. The prerendered page carries the default; the
 * variant is applied once the page runs, before the hero fades in.
 */
export function useHeroCopy(): HeroCopy {
  const [copy, setCopy] = useState(DEFAULT);
  useEffect(() => {
    const chosen = VARIANTS[new URLSearchParams(window.location.search).get('hero') ?? ''] ?? DEFAULT;
    setCopy(chosen);
    registerProperties({ hero_variant: chosen.variant });
  }, []);
  return copy;
}
