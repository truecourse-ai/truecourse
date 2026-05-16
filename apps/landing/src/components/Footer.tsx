import { Github, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DiscordIcon } from './DiscordIcon';

const DISCORD_URL = 'https://discord.gg/8AYwf26A';

export function Footer() {
  return (
    <footer className="relative overflow-hidden">
      <div className="bg-radial-glow absolute inset-x-0 -top-32 -z-10 h-64 opacity-50" />
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <img src="/logo.svg" alt="" className="h-7 w-7" />
              <span className="text-base font-semibold tracking-tight">TrueCourse</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              The validation layer for AI-generated code. Open source, local-first, and
              built for the speed your models code at.
            </p>
            <div className="mt-5 flex items-center gap-2">
              <a
                href="https://github.com/truecourse-ai/truecourse"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                aria-label="GitHub"
              >
                <Github className="h-4 w-4" />
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-[#5865F2]"
                aria-label="Discord"
              >
                <DiscordIcon className="h-4 w-4" />
              </a>
              <a
                href="mailto:mushegh@truecourse.dev"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                aria-label="Email"
              >
                <Mail className="h-4 w-4" />
              </a>
            </div>
          </div>

          <Column
            title="Product"
            links={[
              { href: '/#open-source', label: 'Open source' },
              { href: '/teams', label: 'For teams' },
              { href: '/#capabilities', label: 'What it catches' },
              // Hidden until we have real OSS analysis reports — see HomePage.tsx for the matching toggle.
              // { href: '/#reports', label: 'Field reports' },
            ]}
          />
          <Column
            title="Resources"
            links={[
              { href: 'https://github.com/truecourse-ai/truecourse', label: 'GitHub' },
              { href: DISCORD_URL, label: 'Discord' },
              { href: 'https://www.npmjs.com/package/truecourse', label: 'npm' },
              {
                href: 'https://github.com/truecourse-ai/truecourse#readme',
                label: 'Documentation',
              },
              { href: 'mailto:mushegh@truecourse.dev', label: 'Contact' },
            ]}
          />
          <Column
            title="Legal"
            links={[
              {
                href: 'https://github.com/truecourse-ai/truecourse/blob/main/LICENSE',
                label: 'License (MIT)',
              },
              {
                href: 'https://github.com/truecourse-ai/truecourse/blob/main/CODE_OF_CONDUCT.md',
                label: 'Code of conduct',
              },
            ]}
          />
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
          <div className="text-xs text-muted-foreground">
            <p>
              © {new Date().getFullYear()} TrueCourse AI, Inc. &middot; MIT licensed.
            </p>
            <p className="mt-1">
              2261 Market Street STE 88087, San Francisco, CA 94114 US
            </p>
          </div>
          <p className="text-xs text-muted-foreground sm:text-right">
            Built with TypeScript and tree-sitter.
          </p>
        </div>
      </div>
    </footer>
  );
}

function Column({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-foreground">
        {title}
      </h4>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => {
          const className =
            'text-sm text-muted-foreground transition-colors hover:text-foreground';
          const isInternal = l.href.startsWith('/');
          return (
            <li key={l.href}>
              {isInternal ? (
                <Link to={l.href} className={className}>
                  {l.label}
                </Link>
              ) : (
                <a
                  href={l.href}
                  className={className}
                  {...(l.href.startsWith('http')
                    ? { target: '_blank', rel: 'noreferrer' }
                    : {})}
                >
                  {l.label}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
