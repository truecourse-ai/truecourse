import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { trackPageview } from '@/lib/posthog';
import { trackGAPageview } from '@/lib/ga';

export default function Layout() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash]);

  // PostHog and GA SPA pageviews, fired on every react-router pathname change.
  // The initial pageview is captured automatically by each one's init.
  useEffect(() => {
    trackPageview(pathname + hash);
    trackGAPageview(pathname + hash);
  }, [pathname, hash]);

  return (
    <>
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}
