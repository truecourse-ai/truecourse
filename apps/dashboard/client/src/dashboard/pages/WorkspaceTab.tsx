/**
 * Settings › Workspace — the one sentence saying what this workspace's product
 * is.
 *
 * It is not a label. Every document the workspace holds is kept or dropped by
 * whether it describes THIS product, and this sentence is the whole of what
 * "this product" means to the scan — so it is required before anything can be
 * connected, and changing it re-judges every document once.
 *
 * Present in every mode. Hosted, a workspace states it when it is created and
 * edits it here; local, there is one implicit workspace and no Create workspace
 * dialog, so this page is where it is set at all.
 */

import { useEffect, useState } from 'react';
import { StatusWord } from '@/dashboard/ui/status-word';
import { Facts } from '@/dashboard/ui/bits';
import {
  fetchWorkspaceProfile,
  saveWorkspaceDescription,
} from '@/dashboard/data/workspace-profile';
import {
  PRODUCT_DESCRIPTION_MAX_CHARS,
  WORKSPACE_DESCRIPTION_MIN_CHARS,
  normalizeWorkspaceDescription,
  type WorkspaceProfileResponse,
} from '@truecourse/shared';

const FIELD =
  'mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

export function WorkspaceTab() {
  const [profile, setProfile] = useState<WorkspaceProfileResponse | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchWorkspaceProfile()
      .then((next) => {
        if (!live) return;
        setProfile(next);
        setDescription(next.description ?? '');
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    saveWorkspaceDescription(description)
      .then((next) => {
        setProfile(next);
        setDescription(next.description ?? '');
        setSaved(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const ready = normalizeWorkspaceDescription(description) !== null;

  return (
    <div>
      <Facts
        className="border-b border-border"
        rowClassName="px-6"
        rows={[
          {
            label: 'Product',
            value: profile?.description ?? (
              <span className="text-muted-foreground">not set yet</span>
            ),
          },
          {
            label: 'Updated',
            value: profile?.updatedAt ? (
              new Date(profile.updatedAt).toLocaleString()
            ) : (
              <span className="text-muted-foreground">never</span>
            ),
          },
        ]}
      />

      <form onSubmit={submit} className="max-w-xl space-y-2 px-6 py-5">
        <label className="block text-[11px] font-medium text-muted-foreground">
          What this workspace&rsquo;s product is
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="What this workspace's product is"
            maxLength={PRODUCT_DESCRIPTION_MAX_CHARS}
            placeholder="One sentence: what the product is and what kind of system it is."
            className={FIELD}
          />
        </label>

        <p className="pt-1 text-[11px] text-muted-foreground">
          Documents are kept or dropped by whether they describe this product, and this sentence is
          what they are judged against — so nothing can be connected until it is set, and changing
          it re-judges every document once. {WORKSPACE_DESCRIPTION_MIN_CHARS} to{' '}
          {PRODUCT_DESCRIPTION_MAX_CHARS} characters.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={busy || !ready}
            className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          {saved && !error && <StatusWord tone="success" word="Saved" />}
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      </form>
    </div>
  );
}
