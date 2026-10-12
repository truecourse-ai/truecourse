import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The header of the ad pages, in place of the main site's: the mark, the
 * page's own links and its ask. It gains a border once the page scrolls.
 */
export function Header({ links, children }: { links?: { href: string; label: string }[]; children: ReactNode }) {
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
        {links && (
          <nav className="nav-links">
            {links.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </nav>
        )}
        {children}
      </div>
    </header>
  );
}
