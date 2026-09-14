/**
 * The workspace of the session, and the way into the others: its initial and
 * name, and a menu of every workspace the user belongs to plus Create
 * workspace. Choosing one switches the session and starts the app over in it.
 * Collapsed, the initial alone opens the same menu.
 *
 * It replaces the open shell's workspace block, which names the one workspace
 * there is and offers no way out of it. The list is this component's own read:
 * the shell holds only the workspace the session is in.
 *
 * Both moves end the same way — the session is in another organization now, so
 * the app starts over at the section root rather than re-reading every page it
 * already drew. A refused switch has nowhere of its own to appear, so it is
 * said as a toast; a refused create is said under the field where the name was
 * typed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { WorkspaceSummary } from '@truecourse/shared';
import { usePreviewState } from '@/preview/shell/preview-state';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { listWorkspaces, switchWorkspace } from './api';

const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase();

/** Closes the menu on a click anywhere outside it (and on Escape). */
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

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspace } = usePreviewState();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useClickOutside(open, close);

  // A refused read leaves the list empty: the block still names the workspace
  // the session is in, since that comes from the session and not from here.
  const workspaceId = workspace?.id;
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    void listWorkspaces()
      .then((answer) => {
        if (live) setWorkspaces(answer.workspaces);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const switchInto = useCallback(async (organizationId: string) => {
    try {
      await switchWorkspace(organizationId);
    } catch (e: unknown) {
      toast.error('Could not switch workspace', {
        description: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    window.location.assign('/');
  }, []);

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
                void switchInto(w.id);
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
