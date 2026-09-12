/**
 * The one-product shell: the sidebar the whole dashboard hangs off.
 *
 * Top to bottom: the workspace the session is in and the switcher into the
 * others, then
 * Home, Context, Code, Flows, Agent, Notifications (with the unread badge) and
 * Settings, then Admin
 * on its own, separated, when the signed-in user is an operator, then the
 * user menu. Pull requests is NOT here: it lives inside a repository, and the
 * cross-repo feed it used to be is the home page's gate activity.
 *
 * The identity is the session's (`usePreviewUser`) and Sign out really ends it;
 * with no session there is no user block and no workspace block, because there
 * is nobody to name.
 *
 * Collapsing leaves an icon-only rail. Session state only, nothing is stored.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Bell,
  ChevronsUpDown,
  Route,
  GitBranch,
  Home,
  Layers,
  LogOut,
  MousePointer2,
  Moon,
  Plus,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/ee/AuthContext';
import { useThemeToggle } from '@/hooks/useThemeToggle';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { usePreviewState } from './preview-state';
import { usePreviewUser } from './use-preview-user';
import { PREVIEW_BASE } from './base';

export { PREVIEW_BASE };

/** The brand wordmark face, the one place the UI uses the logo's font (`.brand-wordmark`). */
const WORDMARK = { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: '0.01em' } as const;

// A `disabled` entry is shown but not a link: the page is parked, and hiding
// it would make the menu lie about what the product has.
const NAV: { to: string; label: string; icon: LucideIcon; disabled?: boolean }[] = [
  { to: PREVIEW_BASE, label: 'Home', icon: Home },
  { to: `${PREVIEW_BASE}/context`, label: 'Context', icon: Layers },
  { to: `${PREVIEW_BASE}/code`, label: 'Code', icon: GitBranch },
  { to: `${PREVIEW_BASE}/flows`, label: 'Flows', icon: Route },
  { to: `${PREVIEW_BASE}/agent`, label: 'Agent', icon: MousePointer2 },
  { to: `${PREVIEW_BASE}/notifications`, label: 'Notifications', icon: Bell },
  { to: `${PREVIEW_BASE}/settings`, label: 'Settings', icon: Settings },
];

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

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase();

/**
 * The workspace of the session, and the way into the others: its initial and
 * name, and a menu of every workspace the user belongs to plus Create
 * workspace. Choosing one switches the session and starts the app over in it.
 * Collapsed, the initial alone opens the same menu.
 */
function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspace, workspaces, switchWorkspace } = usePreviewState();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(open, close);

  // Nobody is signed in: there is no workspace to name.
  if (!workspace) return null;

  return (
    <div ref={ref} className={`relative ${collapsed ? 'flex justify-center px-0 py-1' : 'px-2 py-1'}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Switch workspace"
        className={
          collapsed
            ? 'flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground transition-colors hover:bg-muted/60'
            : 'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted/60'
        }
      >
        {collapsed ? (
          workspace.initial
        ) : (
          <>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground">
              {workspace.initial}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {workspace.name}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
      {open && (
        <div
          className={`absolute top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-md ${
            collapsed ? 'left-1 w-48' : 'left-2 right-2'
          }`}
        >
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                setOpen(false);
                void switchWorkspace(w.id);
              }}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60 ${
                w.current ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold text-foreground">
                {initialOf(w.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            className="flex w-full items-center gap-2 border-t border-border px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            Create workspace
          </button>
        </div>
      )}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { isDark, toggle: toggleTheme } = useThemeToggle();
  const { workspace } = usePreviewState();
  const user = usePreviewUser();
  const { signOut } = useAuth();
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
            <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border px-3 py-2">
            <div className="text-[13px] text-foreground">{user.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
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
        </div>
      )}
    </div>
  );
}

export function PreviewShell({ children }: { children: ReactNode }) {
  const { unreadCount } = usePreviewState();
  const user = usePreviewUser();
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  const isActive = (to: string) =>
    to === PREVIEW_BASE
      ? pathname === PREVIEW_BASE || pathname === `${PREVIEW_BASE}/`
      : pathname.startsWith(to) ||
        // A repository page belongs to Code, where the repositories are: it stays lit inside one.
        (to === `${PREVIEW_BASE}/code` && pathname.startsWith(`${PREVIEW_BASE}/repos/`));

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside
        className={`flex shrink-0 flex-col border-r border-border bg-card/40 transition-[width] ${
          collapsed ? 'w-14' : 'w-60'
        }`}
      >
        <div className={`flex items-center py-3 ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}>
          {!collapsed && (
            <Link to={PREVIEW_BASE} className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 dark:hidden" />
              <img src="/logo-dark.svg" alt="" className="hidden h-7 w-7 shrink-0 dark:block" />
              <span className="text-sm font-bold" style={WORDMARK}>TrueCourse</span>
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

        <WorkspaceSwitcher collapsed={collapsed} />

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

        {user?.isOperator && (
          <div className="space-y-0.5 border-t border-border px-2 py-2">
            {!collapsed && (
              <div className="px-2.5 pb-1 text-xs uppercase tracking-wider text-muted-foreground/70">
                Operator
              </div>
            )}
            <NavRow
              to={`${PREVIEW_BASE}/admin`}
              label="Admin"
              icon={ShieldCheck}
              active={isActive(`${PREVIEW_BASE}/admin`)}
              collapsed={collapsed}
            />
          </div>
        )}

        <div className="border-t border-border px-2 py-2">
          <UserMenu collapsed={collapsed} />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
