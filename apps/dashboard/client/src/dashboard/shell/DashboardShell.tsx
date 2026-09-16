/**
 * The one-product shell: the sidebar the whole dashboard hangs off.
 *
 * Top to bottom: the workspace the session is in, then Home, Context, Code,
 * Flows, Agent, Notifications (with the unread badge) and Settings, then the
 * way out to the community and the user menu.
 *
 * There is ONE workspace, so the block at the top names it and offers no way
 * out of it. An edition with more than one registers a switcher that replaces
 * the block.
 *
 * The identity is the session's (`useDashboardUser`) and Sign out really ends it;
 * with no session there is no user block and no workspace block, because there
 * is nobody to name.
 *
 * Collapsing leaves an icon-only rail. Session state only, nothing is stored.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Bell,
  Route,
  GitBranch,
  Home,
  Layers,
  LogOut,
  MousePointer2,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { Brand } from '@/components/brand';
import { DiscordIcon } from '@/components/DiscordIcon';
import { EVENTS, trackEvent } from '@/lib/posthog';
import { useServerMode } from '@/contexts/CapabilityContext';
import { useThemeToggle } from '@/hooks/useThemeToggle';
import { useDashboardState } from './dashboard-state';
import { useDashboardUser } from './use-dashboard-user';
import { useOnboarding } from './use-onboarding';
import { registeredWorkspaceSwitcher } from './registry';

// A `disabled` entry is shown but not a link: the page is parked, and hiding
// it would make the menu lie about what the product has.
const NAV: { to: string; label: string; icon: LucideIcon; disabled?: boolean }[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/context', label: 'Context', icon: Layers },
  { to: '/code', label: 'Code', icon: GitBranch },
  { to: '/flows', label: 'Flows', icon: Route },
  { to: '/agent', label: 'Agent', icon: MousePointer2 },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];

/** The community's front door, the same invitation the README and the site give. */
export const DISCORD_INVITE_URL = 'https://discord.gg/TanxB63arz';

function rowClass(active: boolean, collapsed: boolean): string {
  return `relative flex items-center rounded-md text-sm font-medium transition-colors ${
    collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-1.5'
  } ${active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`;
}

function NavRow({
  to,
  label,
  icon: Icon,
  active,
  collapsed,
  badge,
  disabled,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  disabled?: boolean;
}) {
  const body = (
    <>
      <span className="relative flex shrink-0">
        <Icon className="h-4 w-4" />
        {badge != null && badge > 0 && (
          <span
            className={`absolute flex items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground ${
              collapsed ? '-right-1.5 -top-1.5 h-3.5 min-w-3.5' : '-right-2 -top-1.5 h-4 min-w-4'
            }`}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
    </>
  );
  if (disabled) {
    return (
      <span aria-disabled className={`${rowClass(false, collapsed)} cursor-default opacity-50 hover:bg-transparent hover:text-muted-foreground`} title="Coming soon">
        {body}
      </span>
    );
  }
  return (
    <Link to={to} className={rowClass(active, collapsed)} aria-current={active ? 'page' : undefined}>
      {body}
    </Link>
  );
}

/**
 * The way out to the community: a link off the app, styled as a nav row so it
 * belongs to the sidebar. It is here for everyone, signed in or not — the
 * Discord is the product's, not the workspace's.
 */
function DiscordRow({ collapsed }: { collapsed: boolean }) {
  return (
    <a
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent(EVENTS.discordJoinClicked)}
      {...(collapsed ? { 'aria-label': 'Join Discord' } : {})}
      className={rowClass(false, collapsed)}
    >
      <span className="relative flex shrink-0">
        <DiscordIcon className="h-4 w-4" />
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">Join Discord</span>}
    </a>
  );
}

/** Closes a menu on a click anywhere outside it (and on Escape). */
function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/**
 * The workspace the session is in: its initial and its name. There is one, so
 * there is nothing to choose between — an edition with more than one registers
 * a switcher that replaces this block.
 *
 * Local mode is always this block: there is one implicit workspace and no
 * identity provider to move a session through, so the server mounts no
 * `/api/auth/workspaces` routes for a switcher to call. The mode is checked
 * here, once, rather than inside whatever was registered.
 */
function WorkspaceBlock({ collapsed }: { collapsed: boolean }) {
  const Switcher = registeredWorkspaceSwitcher();
  const { workspace } = useDashboardState();
  const local = useServerMode() === 'local';
  if (Switcher && !local) return <Switcher collapsed={collapsed} />;

  // Nobody is signed in: there is no workspace to name.
  if (!workspace) return null;

  return (
    <div className={collapsed ? 'flex justify-center px-0 py-1' : 'px-2 py-1'}>
      <div className={collapsed ? '' : 'flex w-full items-center gap-2 px-1.5 py-1.5'}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground">
          {workspace.initial}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {workspace.name}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The two checkpoints of a new workspace, tracked above the user menu until
 * both are done: a mark each, its words, and the way to do it. Gone once the
 * workspace is one.
 */
function GettingStarted({ collapsed }: { collapsed: boolean }) {
  const { ready, hasContext, hasRepo, done } = useOnboarding();
  if (!ready || done) return null;
  const steps = [
    { key: 'context', label: 'Connect context', done: hasContext, to: '/context?add=1' },
    { key: 'repo', label: 'Connect repository', done: hasRepo, to: '/code?connect=1' },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  if (collapsed) {
    return (
      <div className="flex justify-center border-t border-border py-2">
        <Link
          to='/'
          aria-label={`Getting started, ${doneCount} of ${steps.length} done`}
          className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground"
        >
          {doneCount}/{steps.length}
        </Link>
      </div>
    );
  }
  return (
    <div className="border-t border-border px-3 py-3" aria-label="Getting started">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Getting started
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {doneCount} of {steps.length}
        </span>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {steps.map((step) => (
          <li key={step.key}>
            {step.done ? (
              <span className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-muted-foreground">
                <span
                  aria-hidden
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                >
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="line-through">{step.label}</span>
              </span>
            ) : (
              <Link
                to={step.to}
                className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground transition-colors hover:bg-muted/60"
              >
                <span aria-hidden className="inline-block h-4 w-4 shrink-0 rounded-full border border-border" />
                <span>{step.label}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { isDark, toggle: toggleTheme } = useThemeToggle();
  const { workspace } = useDashboardState();
  const user = useDashboardUser();
  const { signOut } = useAuth();
  // A local server has nobody signed in and so nothing to sign out of: the
  // session is this machine's, and it ends when the server does.
  const signedIn = useServerMode() !== 'local';
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(open, close);

  // Nobody is signed in: there is no identity to draw, and inventing one would
  // be the only lie the sidebar could tell.
  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Account menu"
        className={`flex w-full items-center rounded-md text-left transition-colors hover:bg-muted/60 ${
          collapsed ? 'justify-center px-0 py-2' : 'gap-2 px-1.5 py-1.5'
        }`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          {user.initial}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-foreground">{user.name}</span>
            {user.email && (
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border px-3 py-2">
            <div className="text-[13px] text-foreground">{user.name}</div>
            {user.email && (
              <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
            )}
            {workspace && (
              <div className="mt-1.5 truncate text-[11px] text-muted-foreground">{workspace.name}</div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {isDark ? 'Light mode' : 'Dark mode'}
          </button>
          {signedIn && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { unreadCount } = useDashboardState();
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  const isActive = (to: string) =>
    to === '/'
      ? pathname === '/'
      : pathname.startsWith(to) ||
        // A repository page belongs to Code, where the repositories are: it stays lit inside one.
        (to === '/code' && pathname.startsWith('/repos/'));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside
        className={`flex shrink-0 flex-col border-r border-border bg-card/40 transition-[width] ${
          collapsed ? 'w-14' : 'w-60'
        }`}
      >
        <div className={`flex items-center py-3 ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}>
          {!collapsed && (
            <Link to='/' className="flex items-center gap-2">
              <Brand />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <WorkspaceBlock collapsed={collapsed} />

        <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 py-1" aria-label="Workspace">
          {NAV.map((item) => (
            <NavRow
              key={item.to}
              to={item.to}
              label={item.label}
              icon={item.icon}
              active={isActive(item.to)}
              collapsed={collapsed}
              {...(item.disabled ? { disabled: true } : {})}
              {...(item.label === 'Notifications' ? { badge: unreadCount } : {})}
            />
          ))}
        </nav>

        <GettingStarted collapsed={collapsed} />
        <div className="space-y-0.5 border-t border-border px-2 py-2">
          <DiscordRow collapsed={collapsed} />
          <UserMenu collapsed={collapsed} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
