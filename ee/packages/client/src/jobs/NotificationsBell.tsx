/**
 * The sidebar notifications entry: a nav row with a bell + live unread badge.
 * Rendered by the OSS console shell via the `EeClientModule.shell.headerWidget`
 * seam, so it reads the same `useJobs()` state as the rest of the app. Links to
 * the full notifications page.
 */

import { Link, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useJobs } from './JobsContext';

const TO = '/notifications';

export default function NotificationsBell({ collapsed }: { collapsed?: boolean }) {
  const { unreadCount } = useJobs();
  const { pathname } = useLocation();
  const active = pathname === TO;
  const badge = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <Link
      to={TO}
      title={collapsed ? `Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}` : undefined}
      className={`relative flex items-center rounded-md text-sm font-medium transition-colors ${
        collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-2.5 py-1.5'
      } ${
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <span className="relative flex shrink-0">
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className={`absolute flex items-center justify-center rounded-full bg-primary text-[9px] font-semibold leading-none text-primary-foreground ${
              collapsed ? '-right-1.5 -top-1.5 h-3.5 min-w-3.5 px-1' : '-right-2 -top-1.5 h-4 min-w-4 px-1'
            }`}
          >
            {badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">Notifications</span>}
    </Link>
  );
}
