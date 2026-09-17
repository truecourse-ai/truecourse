import { SiGithub } from 'react-icons/si';
import { Link } from 'react-router';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/TanxB63arz';
const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';
const CONTACT_URL = 'mailto:mushegh@truecourse.dev';

type LinkItem = { href: string; label: string };

const PRODUCT: LinkItem[] = [
  { href: '/#how', label: 'How it works' },
  { href: '/#sandbox', label: 'Sandbox' },
  { href: '/#integrations', label: 'Integrations' },
  { href: '/#enterprise', label: 'Enterprise' },
];

const RESOURCES: LinkItem[] = [
  { href: 'https://docs.truecourse.dev/', label: 'Documentation' },
  { href: '/blog', label: 'Blog' },
  { href: GITHUB_URL, label: 'GitHub' },
  { href: DISCORD_URL, label: 'Discord' },
];

const COMPANY: LinkItem[] = [
  { href: CONTACT_URL, label: 'Contact' },
  { href: `${CONTACT_URL}?subject=TrueCourse%20for%20our%20team`, label: 'Talk to sales' },
];

const LEGAL: LinkItem[] = [
  {
    href: 'https://github.com/truecourse-ai/truecourse/blob/main/LICENSE',
    label: 'License (MIT)',
  },
  {
    href: 'https://github.com/truecourse-ai/truecourse/blob/main/CODE_OF_CONDUCT.md',
    label: 'Code of conduct',
  },
];

export function Footer() {
  return (
    <footer className="site">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-about">
            <Link to="/" className="brand">
              <span className="mark" aria-hidden />
              TrueCourse
            </Link>
            <p>Your requirements, proven on every pull request.</p>
            <div className="foot-social">
              <a
                className="icon-btn"
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
              >
                <SiGithub />
              </a>
              <a
                className="icon-btn"
                href={DISCORD_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Discord"
              >
                <DiscordIcon />
              </a>
              <a className="icon-btn" href={CONTACT_URL} aria-label="Email">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 5h20v14H2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </a>
            </div>
          </div>

          <Column title="Product" links={PRODUCT} />
          <Column title="Resources" links={RESOURCES} />
          <Column title="Company" links={COMPANY} />
          <Column title="Legal" links={LEGAL} />
        </div>

        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} TrueCourse AI, Inc.</span>
          <span>2261 Market Street STE 88087, San Francisco, CA 94114</span>
        </div>
      </div>
    </footer>
  );
}

function Column({ title, links }: { title: string; links: LinkItem[] }) {
  return (
    <div className="foot-col">
      <h4>{title}</h4>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            {l.href.startsWith('/') ? (
              <Link to={l.href}>{l.label}</Link>
            ) : (
              <a
                href={l.href}
                {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
