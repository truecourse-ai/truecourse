/**
 * The workspace the session is in: its initial and its name, and nothing to
 * press.
 *
 * It sits in a file of its own because two things draw it. The shell draws it
 * when no switcher was registered, and the registered switcher draws it itself
 * when the person has one workspace and no grant to make another — so the two
 * read identically, and neither imports the other.
 */

import { useDashboardState } from './dashboard-state';

export function WorkspaceNameBlock({ collapsed }: { collapsed: boolean }) {
  const { workspace } = useDashboardState();

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
