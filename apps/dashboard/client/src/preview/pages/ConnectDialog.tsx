// PREVIEW: the connect-by-URL path here is REAL (it clones on the server); the
// provider flow beside it is a mock. Delete with the preview when the
// one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Connect a repository: pick a provider (a provider with nothing connected
 * authorizes first), pick the account and the repositories it can see (checked
 * against the plan's private-repository allowance), confirm. The repository then
 * appears on Home with its onboarding chain in flight. Opened from Home.
 *
 * Below the providers, the one path that really works today: a public repository
 * by git URL. It posts to `/api/repos/connect`, which clones the repository on
 * the server and registers it, so the row it adds to Home is a real one. The
 * clone happens inside the request, hence the pending button.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Capsule, ProviderIcon, PROVIDER_NAME } from '@/preview/ui/bits';
import type { ConnectableRepo, ProviderId } from '@/preview/data/types';
import { connectRepo } from '@/preview/data/real-repos';
import { usePreviewState } from '@/preview/shell/preview-state';

const PROVIDER_OPTIONS: ProviderId[] = ['github', 'gitlab', 'azure'];

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    connections,
    connectableRepos,
    addConnection,
    connectRepositories,
    privateReposUsed,
    privateRepoLimit,
    repos,
    refreshRealRepos,
  } = usePreviewState();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [provider, setProvider] = useState<ProviderId>('github');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setPicked([]);
      setProvider('github');
      setConnectionId(null);
      setUrl('');
      setCloning(false);
      setUrlError(null);
    }
  }, [open]);

  const accounts = connections.filter((c) => c.provider === provider);
  const connection = accounts.find((c) => c.id === connectionId) ?? accounts[0] ?? null;
  const available = connectableRepos.filter(
    (c) => c.connectionId === connection?.id && !repos.some((r) => r.fullName === c.fullName),
  );
  const pickedPrivate = available.filter((c) => picked.includes(c.fullName) && c.visibility === 'private').length;
  const overAllowance = privateReposUsed + pickedPrivate > privateRepoLimit;

  const toggle = (repo: ConnectableRepo) =>
    setPicked((prev) =>
      prev.includes(repo.fullName) ? prev.filter((n) => n !== repo.fullName) : [...prev, repo.fullName],
    );

  /** Pick a provider: straight to its repositories, authorizing first when nothing is connected yet. */
  const choose = (id: ProviderId) => {
    setProvider(id);
    const existing = connections.filter((c) => c.provider === id);
    setConnectionId(existing[0]?.id ?? addConnection(id).id);
    setPicked([]);
    setStep(2);
  };

  /** The real one: clone on the server, then let Home re-read the registry. */
  const submitUrl = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || cloning) return;
    setCloning(true);
    setUrlError(null);
    try {
      await connectRepo(trimmed);
      await refreshRealRepos();
      onOpenChange(false);
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Could not connect that repository');
    } finally {
      setCloning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
          <DialogDescription>
            Step {step} of 3 ·{' '}
            {step === 1 ? 'pick a provider' : step === 2 ? 'pick repositories' : 'confirm and start onboarding'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {PROVIDER_OPTIONS.map((id) => {
              const mine = connections.filter((c) => c.provider === id);
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2.5">
                  <ProviderIcon provider={id} className="h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-foreground">{PROVIDER_NAME[id]}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {mine.length === 0
                        ? 'not connected yet'
                        : mine.map((c) => `${c.account} (${c.kind})`).join(' · ')}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => choose(id)}
                    className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${
                      mine.length === 0
                        ? 'border border-border text-foreground hover:bg-muted/60'
                        : 'bg-primary text-primary-foreground hover:opacity-90'
                    }`}
                  >
                    {mine.length === 0 ? 'Connect' : 'Select'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {step === 1 && (
          <form onSubmit={submitUrl} className="border-t border-border pt-3">
            <label htmlFor="connect-url" className="block text-[11px] text-muted-foreground">
              Or connect a public repository by URL
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="connect-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                spellCheck={false}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="submit"
                disabled={url.trim().length === 0 || cloning}
                className="shrink-0 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {cloning ? 'Cloning...' : 'Connect'}
              </button>
            </div>
            {urlError && <p className="mt-1.5 text-[11px] text-destructive">{urlError}</p>}
          </form>
        )}

        {step === 2 && (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Account</span>
              {accounts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={connection?.id === c.id}
                  onClick={() => {
                    setConnectionId(c.id);
                    setPicked([]);
                  }}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    connection?.id === c.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground hover:bg-muted/70'
                  }`}
                >
                  {c.account} · {c.kind}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const created = addConnection(provider);
                  setConnectionId(created.id);
                  setPicked([]);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Add account
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {privateReposUsed + pickedPrivate} of {privateRepoLimit} private repositories used
            </p>
            <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {available.length === 0 && (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Every repository this account can see is already connected.
                </li>
              )}
              {available.map((c) => (
                <li key={c.fullName} className="flex items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    id={`pick-${c.fullName}`}
                    checked={picked.includes(c.fullName)}
                    onChange={() => toggle(c)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-border"
                  />
                  <label htmlFor={`pick-${c.fullName}`} className="min-w-0 flex-1 cursor-pointer">
                    <span className="block truncate font-mono text-xs text-foreground">{c.fullName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{c.about}</span>
                  </label>
                  <Capsule>{c.visibility}</Capsule>
                </li>
              ))}
            </ul>
            {overAllowance && (
              <p className="mt-2 text-[11px] text-destructive">
                That is more private repositories than the Team plan allows. Deselect one, or move to Enterprise.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="rounded-md border border-border px-3 py-2.5">
            <p className="text-xs text-foreground">
              {picked.length} repositor{picked.length === 1 ? 'y' : 'ies'} from{' '}
              {connection ? `${PROVIDER_NAME[connection.provider]} · ${connection.account}` : 'the connection'}:
            </p>
            <ul className="mt-1.5 space-y-1">
              {picked.map((name) => (
                <li key={name} className="font-mono text-[11px] text-muted-foreground">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Back
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={picked.length === 0 || overAllowance}
              onClick={() => setStep(3)}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Continue
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={() => {
                connectRepositories(picked);
                onOpenChange(false);
              }}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Connect and start onboarding
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

