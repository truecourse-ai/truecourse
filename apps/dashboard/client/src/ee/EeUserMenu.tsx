/**
 * Header user control for enterprise: the signed-in user plus the
 * controls that live in the community header bar (theme toggle, GitHub,
 * Discord) folded into this dropdown, ending with sign-out. Renders
 * nothing in community mode or before auth resolves.
 */

import { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronDown, Sun, Moon, Github, Star } from 'lucide-react';
import { useEeAuth } from '@/ee/EeAuthContext';
import { useThemeToggle } from '@/hooks/useThemeToggle';
import { DiscordIcon, GITHUB_URL, DISCORD_URL } from '@/components/layout/social';

const itemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors';

export function EeUserMenu() {
  const { status, user, signOut } = useEeAuth();
  const { isDark, toggle: toggleTheme } = useThemeToggle();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (status !== 'authed' || !user) return null;

  const display =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  const initial = (user.firstName?.[0] ?? user.email[0] ?? '?').toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
          {initial}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-56 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium text-foreground">
              {display}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {user.email}
            </div>
          </div>

          <div className="my-1 border-t border-border" />

          {/* Theme — kept open so the change is visible immediately. */}
          <button
            role="menuitem"
            onClick={toggleTheme}
            className={itemClass}
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>

          <a
            role="menuitem"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            <Github className="h-3.5 w-3.5" />
            Star on GitHub
            <Star className="ml-auto h-3 w-3 text-muted-foreground" />
          </a>

          <a
            role="menuitem"
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemClass + ' text-[#5865F2] hover:text-[#5865F2]'}
          >
            <DiscordIcon className="h-3.5 w-3.5" />
            Discord
          </a>

          <div className="my-1 border-t border-border" />

          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className={itemClass}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
