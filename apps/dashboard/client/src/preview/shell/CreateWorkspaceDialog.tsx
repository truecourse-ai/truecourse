/**
 * Create workspace: one field, one button.
 *
 * The server creates the organization, makes the signed-in user its first
 * member and mints the session into it, so a created workspace is the one the
 * app is in a moment later: success is the reload, not a row appearing here.
 * A refusal is said under the field, where the name was typed.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePreviewState } from './preview-state';

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { createWorkspace } = usePreviewState();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The workspace could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="block text-[11px] font-medium text-muted-foreground">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
          <DialogFooter className="mt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
