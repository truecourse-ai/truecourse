/**
 * The repository's Settings tab: the gate policy, who gets notified, the facts,
 * and unlink. It is the last entry of the repository menu, so the Repositories
 * page stays a list whose rows OPEN the repository (selecting a repository
 * opens its page) rather than previewing its settings beside the list.
 */

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { GatePolicy, Repo } from '@/preview/data/types';
import { usePreviewState } from '@/preview/shell/preview-state';

export function SettingsTab({ repo }: { repo: Repo }) {
  const { updateRepo, unlinkRepo } = usePreviewState();
  const [policy, setPolicy] = useState<GatePolicy>(repo.policy);
  const [emails, setEmails] = useState(repo.notifyEmails.join(', '));
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  useEffect(() => {
    setPolicy(repo.policy);
    setEmails(repo.notifyEmails.join(', '));
  }, [repo.id, repo.policy, repo.notifyEmails]);

  const parsedEmails = emails
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const dirty = policy !== repo.policy || parsedEmails.join(',') !== repo.notifyEmails.join(',');

  const save = () => updateRepo(repo.id, { policy, notifyEmails: parsedEmails });
  const discard = () => {
    setPolicy(repo.policy);
    setEmails(repo.notifyEmails.join(', '));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <section className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Gate policy</h3>
        <div className="mt-2 flex items-center gap-1">
          {(['blocking', 'advisory'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={policy === p}
              onClick={() => setPolicy(p)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                policy === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Notify these addresses
        </h3>
        <input
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          aria-label="Notify e-mail addresses"
          placeholder="oncall@acme.dev, someone@acme.dev"
          className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </section>

      <section className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save settings
        </button>
        {dirty && (
          <button
            type="button"
            onClick={discard}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
          >
            Discard changes
          </button>
        )}
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
