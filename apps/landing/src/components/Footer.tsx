import { SiGithub } from 'react-icons/si';
import { Link } from 'react-router-dom';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/TanxB63arz';
const GITHUB_URL = 'https://github.com/truecourse-ai/truecourse';

type LinkItem = { href: string; label: string };

const PRODUCT: LinkItem[] = [
  { href: '/#why-now', label: 'Why now' },
  { href: '/#approach', label: 'Approach' },
  { href: '/#integrations', label: 'Integrations' },
  { href: '/#why-us', label: 'Why us' },
  { href: '/#enterprise', label: 'Enterprise' },
];

const RESOURCES: LinkItem[] = [
  { href: GITHUB_URL, label: 'GitHub' },
  { href: DISCORD_URL, label: 'Discord' },
  { href: 'https://www.npmjs.com/package/truecourse', label: 'npm' },
  { href: 'https://github.com/truecourse-ai/truecourse#readme', label: 'Documentation' },
  { href: 'mailto:mushegh@truecourse.dev', label: 'Contact' },
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
            <p>
              The verified knowledge layer for engineering. Compile your team&apos;s
              decisions into contracts and check every commit against them.
            </p>
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
              <a className="icon-btn" href="mailto:mushegh@truecourse.dev" aria-label="Email">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 5h20v14H2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M3 6l9 7 9-7" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              </a>
            </div>
          </div>

          <Column title="Product" links={PRODUCT} />
          <Column title="Resources" links={RESOURCES} />
          <Column title="Legal" links={LEGAL} />
        </div>

        <div className="foot-bottom">
          <span>
            © {new Date().getFullYear()} TrueCourse AI, Inc. · 2261 Market Street STE
            88087, San Francisco, CA 94114
          </span>
          <span>
            Built with <span className="heart">♥</span> for engineers shipping with AI.
          </span>
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
