/**
 * The repository's Settings tab: what this repository is, and unlink.
 *
 * It is the last entry of the repository menu, so Code stays a list whose rows
 * OPEN the repository rather than previewing its settings beside the list.
 *
 * Only what the server holds is here. The gate policy and the notify list are
 * not stored anywhere yet, so they are not offered: a control whose Save went
 * no further than this tab would be the one thing this page could get wrong.
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { Facts, PROVIDER_NAME } from '@/preview/ui/bits';
import type { Repo } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/base';

export function SettingsTab({ repo }: { repo: Repo }) {
  const { unlinkRepo } = usePreviewState();
  const navigate = useNavigate();
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <section className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Repository
        </h3>
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          <Facts
            rows={[
              { label: 'Name', value: repo.fullName },
              { label: 'Provider', value: PROVIDER_NAME[repo.provider] },
              {
                label: 'Default branch',
                value: <span className="font-mono">{repo.defaultBranch}</span>,
              },
            ]}
          />
        </div>
      </section>

      <section className="px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Unlink</h3>
        <button
          type="button"
          onClick={() => setConfirmUnlink(true)}
          className="mt-2 rounded border border-border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-muted/60"
        >
          Unlink repository
        </button>
      </section>

      <Dialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink {repo.fullName}?</DialogTitle>
            <DialogDescription>
              The gate stops posting checks on this repository. Its runs, evidence and scenarios stay readable.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmUnlink(false)}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmUnlink(false);
                unlinkRepo(repo.id);
                // The repo route below our feet just died — land on Code,
                // where the repositories are.
                navigate(`${PREVIEW_BASE}/code`);
              }}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Unlink
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
