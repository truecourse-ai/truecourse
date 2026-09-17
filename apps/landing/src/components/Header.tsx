import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { Link, useLocation, useNavigate } from 'react-router';
import { cn } from '@/lib/cn';
import { AppLink } from './AppLink';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/TanxB63arz';
const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';
const DOCS_URL = 'https://docs.truecourse.dev/';

const NAV = [
  { href: '/#how', label: 'Product' },
  { href: '/#sandbox', label: 'Sandbox' },
  { href: '/#enterprise', label: 'Enterprise' },
  { href: DOCS_URL, label: 'Docs' },
  { href: '/blog', label: 'Blog' },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const onHome = location.pathname === '/';
  const onBlog = location.pathname.startsWith('/blog');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Off the home page there's no hero behind the header, so keep the blurred
  // surface always on.
  const showSurface = scrolled || !onHome;

  const navLink = (item: (typeof NAV)[number]) =>
    item.href.startsWith('/') ? (
      <Link
        key={item.href}
        to={item.href}
        onClick={() => setOpen(false)}
        style={item.href === '/blog' && onBlog ? { color: 'var(--fg)' } : undefined}
      >
        {item.label}
      </Link>
    ) : (
      <a key={item.href} href={item.href} target="_blank" rel="noreferrer">
        {item.label}
      </a>
    );

  return (
    <header className={cn('site', showSurface && 'scrolled')} id="site-header">
      <div className="wrap nav">
        <Link
          to="/"
          onClick={(e) => {
            if (onHome) {
              e.preventDefault();
              if (location.hash || location.search) navigate('/', { replace: true });
              window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
            }
          }}
          className="brand"
        >
          <span className="mark" aria-hidden />
          TrueCourse
        </Link>

        <nav className="nav-links">{NAV.map(navLink)}</nav>

        <div className="nav-actions">
          <AppLink className="nav-signin desktop-only" placement="header">
            Sign in
          </AppLink>
          <AppLink className="btn btn-primary btn-sm" placement="header">
            Get started
          </AppLink>
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
            {NAV.map(navLink)}
            <AppLink placement="header">Sign in</AppLink>
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
