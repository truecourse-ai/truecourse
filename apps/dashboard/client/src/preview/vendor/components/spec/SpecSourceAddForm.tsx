// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/spec/SpecSourceAddForm.tsx; delete with the preview.
/**
 * The ADD flow of a web spec source: paste a site's llms.txt URL → Check → a
 * preview of exactly what would be fetched → Fetch.
 *
 * The preview is its own step because an add pulls a whole documentation site
 * over the network: the page count is on screen before anything is written, the
 * same confirm gate the CLI prints. Nothing here calls an LLM, so there is no
 * cost estimate, the pages it materializes are priced by the next Scan.
 *
 * The fetch streams progress over `spec:progress`, so the page's shared progress
 * popup renders the checklist with its moving counters; the form shows the
 * running state and hands the new source's id back when the snapshot lands.
 *
 * A pure form: the frame around it (the Sources page's add panel, or its empty
 * state) decides how it is presented.
 */

import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import * as api from '@/preview/vendor/lib/api';
import type { SpecSourcePreview } from '@/preview/vendor/lib/api';
import { pageCount, SKIP_REASON } from '@/preview/vendor/lib/spec-web-source';

export function SpecSourceAddForm({
  repoId,
  onAdded,
  onCancel,
}: {
  repoId: string;
  /** The site is registered and snapshotted, open its row. */
  onAdded: (sourceId: string) => void;
  /** Leave the add flow. Omit where there is nothing to go back to (the empty state). */
  onCancel?: () => void;
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
    <div className="space-y-3">
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
        {onCancel && (
          <Button variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Only llms.txt-enabled sites, paste the file’s URL directly. Its pages are snapshotted into
        the repo as spec docs and folded in by the next Scan.
      </p>

      {preview && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-sm text-foreground">
            Found “{preview.title}”, {pageCount(preview.totalLinks)} ({preview.fetchableLinks} fetchable
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
            {busy === 'fetch' && (
              <span className="text-[11px] text-muted-foreground">
                Fetching {pageCount(preview.fetchableLinks)}, the counters are in the progress popup.
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
