/**
 * Create workspace: a name, what it builds, and one button.
 *
 * The server creates the organization, makes the signed-in user its first
 * member and mints the session into it, so a created workspace is the one the
 * app is in a moment later: success is the reload, not a row appearing here.
 * A refusal is said under the fields, where they were typed.
 *
 * The description is required and not decoration: every document the workspace
 * ever holds is kept or dropped by whether it describes THIS product, and this
 * sentence is what that means. A workspace without one can connect nothing.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PRODUCT_DESCRIPTION_MAX_CHARS, normalizeWorkspaceDescription } from '@truecourse/shared';
import { createWorkspace } from './api';

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const described = normalizeWorkspaceDescription(description) !== null;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await createWorkspace(name, description);
      window.location.assign('/');
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
          <label className="mt-3 block text-[11px] font-medium text-muted-foreground">
            What it builds
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="What it builds"
              maxLength={PRODUCT_DESCRIPTION_MAX_CHARS}
              placeholder="What your product is, in one sentence."
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Documentation is kept or dropped by whether it describes this product, so this sentence
            is what every document is judged against.
          </p>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
          <DialogFooter className="mt-4">
            <button
              type="submit"
              disabled={busy || !name.trim() || !described}
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
