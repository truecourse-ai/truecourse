/**
 * The repository's Settings tab: what this repository is, whether its pull
 * requests are checked, and unlink.
 *
 * It is the last entry of the repository menu, so Code stays a list whose rows
 * OPEN the repository rather than previewing its settings beside the list.
 *
 * Only what the server holds is here. The pull request switch saves as it is
 * flipped and goes back if the server refuses: a control whose change went no
 * further than this tab would be the one thing this page could get wrong.
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
import { Facts, providerName } from '@/dashboard/ui/bits';
import type { Repo } from '@/dashboard/data/types';
import { repositoryProvider } from '@/dashboard/data/providers';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { putPullRequestChecks } from '@/lib/api';

export function SettingsTab({ repo }: { repo: Repo }) {
  const { unlinkRepo } = useDashboardState();
  const navigate = useNavigate();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [checkPullRequests, setCheckPullRequests] = useState(repo.checkPullRequests);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleChecks = async (): Promise<void> => {
    const next = !checkPullRequests;
    setCheckPullRequests(next);
    setSaving(true);
    setSaveError(null);
    try {
      await putPullRequestChecks(repo.id, next);
    } catch (err) {
      setCheckPullRequests(!next);
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
              { label: 'Provider', value: providerName(repo.provider) },
              // A folder on this machine tracks no branch: the run reads what
              // is checked out, so the row is not drawn at all.
              ...(repo.defaultBranch
                ? [
                    {
                      label: 'Default branch',
                      value: <span className="font-mono">{repo.defaultBranch}</span>,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </section>

      {repositoryProvider(repo.provider)?.pullRequests === true && (
        <section className="border-b border-border px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Pull requests
          </h3>
          <label className="mt-2 flex items-center gap-3 text-xs text-foreground">
            <button
              type="button"
              role="switch"
              aria-checked={checkPullRequests}
              disabled={saving}
              onClick={() => void toggleChecks()}
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                checkPullRequests ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-[left] ${
                  checkPullRequests ? 'left-3.5' : 'left-0.5'
                }`}
              />
            </button>
            Check pull requests
          </label>
          {saveError && <p className="mt-1 text-[11px] text-destructive">{saveError}</p>}
        </section>
      )}

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
                navigate('/code');
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
