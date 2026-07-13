import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, FolderGit2, Loader2 } from 'lucide-react';
import type { BrowseDirResponse } from '@truecourse/shared';
import { browseDir } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type DirectoryPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the currently-browsed absolute directory when the user confirms. */
  onSelect: (path: string) => void;
};

/**
 * Local-only directory picker. Enumerates subdirectories via the server's
 * `/api/repos/browse` endpoint (browsers can't expose absolute paths). Single
 * click navigates into a folder; "Use this folder" confirms whatever directory
 * is currently being browsed, so picking a repo means navigating into it first.
 */
export function DirectoryPicker({ open, onOpenChange, onSelect }: DirectoryPickerProps) {
  const [data, setData] = useState<BrowseDirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier request resolving after a newer navigation.
  const requestId = useRef(0);

  async function load(path?: string) {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await browseDir(path);
      if (id !== requestId.current) return;
      setData(result);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    // Seed with the home dir each time the dialog opens (no path → server default).
    if (open) void load(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select a folder</DialogTitle>
          <DialogDescription className="truncate">
            {data?.path ?? 'Loading...'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Up"
            disabled={loading || !data || data.parent === null}
            onClick={() => data?.parent && void load(data.parent)}
          >
            <ArrowUp />
          </Button>
        </div>

        <ScrollArea className="h-64 rounded-md border">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-3">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : data && data.entries.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
              No subfolders
            </div>
          ) : (
            <div className="flex flex-col p-1">
              {data?.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  // Accessible name is exactly the folder name; the "repo" tag is
                  // decorative, so it must not leak into the button's label.
                  aria-label={entry.name}
                  onClick={() => void load(entry.path)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.isRepo && (
                    <span
                      aria-hidden="true"
                      className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
                    >
                      <FolderGit2 className="h-3 w-3" />
                      repo
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!data}
            onClick={() => {
              if (data) {
                onSelect(data.path);
                onOpenChange(false);
              }
            }}
          >
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
