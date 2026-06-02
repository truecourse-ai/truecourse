import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/TanxB63arz';
const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

const NAV = [
  { href: '/#why-now', label: 'Why now' },
  { href: '/#approach', label: 'Approach' },
  { href: '/#integrations', label: 'Integrations' },
  { href: '/#enterprise', label: 'Enterprise' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const onHome = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Off the home page there's no hero behind the header, so keep the blurred
  // surface always on (mirrors the request-access prototype).
  const showSurface = scrolled || !onHome;

  return (
    <header className={cn('site', showSurface && 'scrolled')} id="site-header">
      <div className="wrap nav">
        <Link
          to="/"
          onClick={(e) => {
            if (onHome) {
              e.preventDefault();
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            }
          }}
          className="brand"
        >
          <span className="mark" aria-hidden />
          TrueCourse
        </Link>

        <nav className="nav-links">
          {NAV.map((item) => (
            <Link key={item.href} to={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          <a
            className="icon-btn desktop-only"
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Discord"
          >
            <DiscordIcon />
          </a>
          <a
            className="icon-btn desktop-only"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
          >
            <SiGithub />
          </a>
          {onHome ? (
            <Link className="btn btn-primary btn-sm" to="/request-access">
              Request access
            </Link>
          ) : (
            <Link className="btn btn-sm" to="/">
              <span className="arr">←</span> Back
            </Link>
          )}
          <button
            type="button"
            className="icon-btn mobile-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mobile-menu">
          <div className="wrap row">
            {NAV.map((item) => (
              <Link key={item.href} to={item.href} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ))}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              <SiGithub /> GitHub
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noreferrer">
              <DiscordIcon /> Discord
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
