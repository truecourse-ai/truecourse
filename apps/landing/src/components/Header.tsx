import { useEffect, useState } from 'react';
import { Github, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/8AYwf26A';

type NavItem = { href: string; label: string; external?: boolean };

const NAV: NavItem[] = [
  { href: '/#open-source', label: 'Open Source' },
  // Hidden until we have real OSS analysis reports — see HomePage.tsx for the matching toggle.
  // { href: '/#reports', label: 'Reports' },
  { href: '/#capabilities', label: 'What it catches' },
  { href: '/knowledge', label: 'Knowledge base' },
  { href: '/teams', label: 'For teams' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-border bg-background/70 backdrop-blur-xl'
          : 'border-b border-transparent',
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          onClick={(e) => {
            // Same-page click: react-router won't re-mount, so no Layout effect fires.
            // Prevent default and scroll explicitly. On a different page, let the
            // Link navigate normally; Layout's pathname effect handles the scroll.
            if (pathname === '/') {
              e.preventDefault();
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            }
          }}
          className="flex items-center gap-2.5"
        >
          <img src="/logo.svg" alt="" className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">TrueCourse</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-[#5865F2] sm:inline-flex"
            aria-label="Join the TrueCourse Discord"
          >
            <DiscordIcon className="h-4 w-4" />
          </a>
          <a
            href="https://github.com/truecourse-ai/truecourse"
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground sm:inline-flex"
          >
            <Github className="h-4 w-4" />
            GitHub
          </a>
          {/* Contextual CTA: on /teams it scrolls to the access form; on the
              OSS-focused home page it routes to the teams page first. */}
          {pathname === '/teams' ? (
            <a
              href="#access"
              className="hidden h-9 items-center rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 sm:inline-flex"
            >
              Request access
            </a>
          ) : (
            <Link
              to="/teams"
              className="hidden h-9 items-center rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 sm:inline-flex"
            >
              For teams
            </Link>
          )}
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border bg-background/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col px-4 py-3 sm:px-6">
            {NAV.map((item) => (
              <NavLink key={item.href} item={item} mobile onNavigate={() => setOpen(false)} />
            ))}
            <a
              href="https://github.com/truecourse-ai/truecourse"
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <DiscordIcon className="h-4 w-4" />
              Discord
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}

function NavLink({
  item,
  mobile,
  onNavigate,
}: {
  item: NavItem;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const cls = cn(
    'rounded-md text-sm transition-colors',
    mobile
      ? 'px-3 py-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      : 'px-3 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
  );

  // Hash links to home page sections — let react-router handle them so the
  // Layout's scroll-to-hash effect runs on navigation.
  if (item.href.startsWith('/#')) {
    return (
      <Link to={item.href} onClick={onNavigate} className={cls}>
        {item.label}
      </Link>
    );
  }

  return (
    <Link to={item.href} onClick={onNavigate} className={cls}>
      {item.label}
    </Link>
  );
}
