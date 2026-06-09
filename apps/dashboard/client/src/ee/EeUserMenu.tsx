/**
 * Signed-in user control for enterprise: identity plus the controls that live
 * in the community header bar (theme toggle, GitHub, Discord) folded into a
 * dropdown, ending with sign-out. Renders nothing in community mode or before
 * auth resolves.
 *
 * Two layouts via `variant`:
 *  - `header` (default): a compact avatar+chevron for the top OSS Header; the
 *    menu drops down.
 *  - `sidebar`: a full-width row (avatar + name + email) for the EE console's
 *    pinned sidebar footer; the menu opens UPWARD so it isn't clipped off the
 *    bottom of the viewport.
 */

import { useEffect, useRef, useState } from 'react';
import { LogOut, ChevronDown, Sun, Moon, Github, Star } from 'lucide-react';
import { useEeAuth } from '@/ee/EeAuthContext';
import { useThemeToggle } from '@/hooks/useThemeToggle';
import { DiscordIcon, GITHUB_URL, DISCORD_URL } from '@/components/layout/social';

const itemClass =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors';

export function EeUserMenu({
  variant = 'header',
  collapsed = false,
}: {
  variant?: 'header' | 'sidebar';
  /** Sidebar collapsed to an icon rail → show only the avatar. */
  collapsed?: boolean;
}) {
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
  const isSidebar = variant === 'sidebar';
  const isCompact = isSidebar && collapsed;

  const avatar = (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">
      {initial}
    </span>
  );

  // Sidebar: pinned to the bottom, so the menu opens upward. Collapsed → a fixed
  // min-width so the dropdown isn't squeezed to the narrow rail.
  const menuPosition = isSidebar
    ? `bottom-full left-0 mb-1 ${isCompact ? 'min-w-56' : 'w-full'}`
    : 'right-0 top-full mt-1 min-w-56';

  return (
    <div className="relative" ref={ref}>
      {isSidebar ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`flex w-full items-center rounded-md py-1.5 transition-colors hover:bg-muted/60 ${
            isCompact ? 'justify-center px-0' : 'gap-2.5 px-2 text-left'
          }`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={isCompact ? display : undefined}
        >
          {avatar}
          {!isCompact && (
            <>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-medium text-foreground">{display}</span>
                <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
            {initial}
          </span>
          <ChevronDown className="h-3 w-3" />
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute z-50 rounded-md border border-border bg-popover p-1 shadow-lg ${menuPosition}`}
        >
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium text-foreground">{display}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
          </div>

          <div className="my-1 border-t border-border" />

          {/* Theme — kept open so the change is visible immediately. */}
          <button role="menuitem" onClick={toggleTheme} className={itemClass}>
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
