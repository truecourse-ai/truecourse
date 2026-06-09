/**
 * Enterprise console shell — a persistent left sidebar (workspace + nav +
 * user menu) wrapping the EE pages (Overview, Repositories, Settings…).
 *
 * Intentionally different from the OSS chrome: OSS is a single-repo analyzer
 * (top Header + in-repo icon rail), EE is a multi-repo governance console, so
 * it gets app-shell navigation. Nav items come from the EE client module
 * (capability-filtered); icons are mapped here so the module contract stays
 * framework-free. Lives on the OSS side so the ee package needn't import OSS
 * layout components.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  FolderGit2,
  GitPullRequest,
  Building2,
  Cpu,
  Settings,
  BookOpen,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react';
import { useEeModule } from '@/ee/EeModuleContext';
import { useEeAuth } from '@/ee/EeAuthContext';
import { EeUserMenu } from '@/ee/EeUserMenu';

const COLLAPSE_KEY = 'tc-ee-nav-collapsed';

const ICONS: Record<string, LucideIcon> = {
  Home,
  FolderGit2,
  GitPullRequest,
  Building2,
  Cpu,
  Settings,
  BookOpen,
  ShieldCheck,
};

function NavRow({
  to,
  label,
  iconName,
  active,
  collapsed,
}: {
  to: string;
  label: string;
  iconName?: string;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = iconName ? ICONS[iconName] : undefined;
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      className={`flex items-center rounded-md text-sm font-medium transition-colors ${
        collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-1.5'
      } ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

/** Lazily load the ee module's sidebar widget (the notifications bell). */
function useHeaderWidget(): ComponentType<{ collapsed?: boolean }> | null {
  const { shell } = useEeModule();
  const [Widget, setWidget] = useState<ComponentType<{ collapsed?: boolean }> | null>(null);
  useEffect(() => {
    if (!shell?.headerWidget) {
      setWidget(null);
      return;
    }
    let cancelled = false;
    void shell.headerWidget().then((m) => {
      if (!cancelled) setWidget(() => m.default as ComponentType<{ collapsed?: boolean }>);
    });
    return () => {
      cancelled = true;
    };
  }, [shell]);
  return Widget;
}

export function EePageShell({ children }: { children: ReactNode }) {
  const { navItems } = useEeModule();
  const { user } = useEeAuth();
  // Operator-only items (the Admin console) are hidden for regular members, and
  // grouped with notifications at the bottom rather than in the section nav.
  const visibleNav = navItems.filter((n) => !n.requiresOperator || user?.isOperator);
  const primaryNav = visibleNav.filter((n) => !n.requiresOperator);
  const operatorNav = visibleNav.filter((n) => n.requiresOperator);
  const HeaderWidget = useHeaderWidget();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — in-memory only */
      }
      return next;
    });

  // Active for the exact path or a deeper path under it (e.g. /settings/models
  // highlights a /settings item) — but "/" matches only when exact.
  const isActive = (to: string) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/');

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside
        className={`flex shrink-0 flex-col border-r border-border bg-card/40 transition-[width] ${
          collapsed ? 'w-14' : 'w-60'
        }`}
      >
        {/* Brand + collapse toggle: expanded = logo left + toggle right; collapsed
            = just the toggle, centered at the top (logo returns on expand). */}
        <div
          className={`flex items-center py-3 ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}
        >
          {!collapsed && (
            <Link to="/" className="flex items-center gap-2">
              <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0" />
              <span className="text-sm font-semibold">TrueCourse</span>
            </Link>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {/* Primary nav (from the EE module, capability-filtered) */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
          {primaryNav.map((item) => (
            <NavRow
              key={item.id}
              to={item.to}
              label={item.label}
              iconName={item.iconName}
              active={isActive(item.to)}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Operator tools (Admin) — grouped with notifications at the bottom. */}
        {operatorNav.length > 0 && (
          <div className="space-y-0.5 px-2 pb-1">
            {operatorNav.map((item) => (
              <NavRow
                key={item.id}
                to={item.to}
                label={item.label}
                iconName={item.iconName}
                active={isActive(item.to)}
                collapsed={collapsed}
              />
            ))}
          </div>
        )}

        {/* Notifications bell (ee module widget), above the user menu */}
        {HeaderWidget && (
          <div className="px-2 pb-1">
            <HeaderWidget collapsed={collapsed} />
          </div>
        )}

        {/* User menu pinned to the bottom */}
        <div className="border-t border-border px-2 py-2">
          <EeUserMenu variant="sidebar" collapsed={collapsed} />
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
