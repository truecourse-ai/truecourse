/**
 * SpecSourceAddView — the focused ADD flow for a web spec source, in the right
 * pane: paste a site's llms.txt URL → Check → a preview of exactly what would be
 * fetched → Fetch.
 *
 * The preview is its own step because an add pulls a whole documentation site
 * over the network: the page count is on screen before anything is written, the
 * same confirm gate the CLI prints. Nothing here calls an LLM, so there is no
 * cost estimate — the pages it materializes are priced by the next Scan.
 *
 * The fetch streams progress over `spec:progress`, so the page's shared progress
 * popup renders the checklist; this pane shows the running state and, when the
 * snapshot lands, hands off to the new source's detail.
 */

import { useState } from 'react';
import { AlertCircle, Globe, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import * as api from '@/lib/api';
import type { SpecSourcePreview } from '@/lib/api';
import { pageCount, SKIP_REASON } from '@/lib/spec-web-source';

export function SpecSourceAddView({
  repoId,
  onAdded,
  onCancel,
}: {
  repoId: string;
  /** The site is registered and snapshotted — open its detail. */
  onAdded: (sourceId: string) => void;
  /** Leave the add view — the pane returns to the previous selection. */
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SpecSourcePreview | null>(null);
  const [busy, setBusy] = useState<'check' | 'fetch' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    const value = url.trim();
    if (!value) return;
    setBusy('check');
    setError(null);
    try {
      setPreview(await api.previewSpecSource(repoId, value));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const fetchNow = async (): Promise<void> => {
    if (!preview) return;
    setBusy('fetch');
    setError(null);
    try {
      const result = await api.addSpecSource(repoId, preview.llmsTxtUrl);
      onAdded(result.source.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-10">
        <EmptyState
          icon={Globe}
          title="Add a documentation site"
          body="Only llms.txt-enabled sites — paste the file’s URL directly. Its pages are snapshotted into the repo as spec docs and folded in by the next Scan."
        />

        <div className="flex items-center gap-2">
          <Input
            value={url}
            autoFocus
            disabled={disabled}
            placeholder="https://docs.example.com/llms.txt"
            aria-label="llms.txt URL"
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void check();
            }}
          />
          <Button variant="outline" disabled={disabled || url.trim() === ''} onClick={() => void check()}>
            {busy === 'check' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Check
          </Button>
        </div>

        {preview && (
          <div className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm text-foreground">
              Found “{preview.title}” — {pageCount(preview.totalLinks)} ({preview.fetchableLinks} fetchable
              {preview.skipped.length > 0 ? `, ${preview.skipped.length} skipped` : ''})
            </p>
            {preview.skipped.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Skipped: {SKIP_REASON[preview.skipped[0].reason] ?? preview.skipped[0].reason}
                {preview.skipped.length > 1 ? ` and ${preview.skipped.length - 1} more` : ''}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Button disabled={disabled} onClick={() => void fetchNow()}>
                {busy === 'fetch' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Fetch
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={onCancel}>
                Cancel
              </Button>
            </div>
            {busy === 'fetch' && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Fetching {pageCount(preview.fetchableLinks)} — progress is in the popup.
              </p>
            )}
          </div>
        )}

        {!preview && (
          <div className="flex items-center">
            <Button variant="ghost" disabled={disabled} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
