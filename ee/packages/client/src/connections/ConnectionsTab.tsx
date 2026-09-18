/**
 * Settings › Connections: the accounts a document can come from, one row each
 * with its brand marks.
 *
 * A connection is the ACCOUNT, made once per workspace. An Atlassian site is
 * ONE account — a single login whose token reads both Jira and Confluence — so
 * it is one row wearing both marks. What that account READS is a source, added
 * in Context, so this page never mentions a project or a space: it connects, it
 * tests, and it disconnects.
 *
 * One account connects today. The rest stay listed and say Coming soon: hiding
 * them would make the page lie about where this is going, and offering them
 * would make it lie about what it does.
 *
 * Testing makes one read per product the account serves and says what each of
 * them answered, because an account may hold one product's licence and not the
 * other's. A refusal is Atlassian's own reason, as the server relayed it —
 * paraphrasing it would throw away the only thing that says what to change.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CONTEXT_CONNECTION_KINDS,
  CONTEXT_CONNECTION_LABEL,
  CONTEXT_SOURCE_KIND_LABEL,
  formatRelativeTime,
  type ContextConnectionProvider,
  type ContextConnectionTestResponse,
  type ContextConnectionView,
  type ContextSourceKind,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { listContextConnections } from '@/lib/api';
import { StatusWord } from '@/dashboard/ui/status-word';
import { ConnectorLogo, type ConnectorTool } from './connector-logos';
import { removeConnection, saveConnection, testConnection } from './api';

/** One row of the page: an account that connects, or a tool that will. */
interface Connector {
  key: string;
  label: string;
  /** The brand marks the row wears, side by side for an account serving several. */
  tools: ConnectorTool[];
  /** The account behind it, or null while the tool is still Coming soon. */
  provider: ContextConnectionProvider | null;
}

const CONNECTORS: readonly Connector[] = [
  {
    key: 'atlassian',
    label: CONTEXT_CONNECTION_LABEL.atlassian,
    tools: ['jira', 'confluence'],
    provider: 'atlassian',
  },
  {
    key: 'google-drive',
    label: CONTEXT_SOURCE_KIND_LABEL['google-drive'],
    tools: ['gdrive'],
    provider: null,
  },
  { key: 'onedrive', label: CONTEXT_SOURCE_KIND_LABEL.onedrive, tools: ['onedrive'], provider: null },
  { key: 'notion', label: CONTEXT_SOURCE_KIND_LABEL.notion, tools: ['notion'], provider: null },
  { key: 'slack', label: CONTEXT_SOURCE_KIND_LABEL.slack, tools: ['slack'], provider: null },
];

const FIELD =
  'mt-1 w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
const FIELD_MONO = `${FIELD} font-mono`;
const BUTTON = 'rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50';

/** The products an account serves, as a sentence: `Jira and Confluence`. */
function productWords(kinds: readonly ContextSourceKind[]): string {
  const words = kinds.map((kind) => CONTEXT_SOURCE_KIND_LABEL[kind]);
  if (words.length < 2) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`;
}

/** What a connection form holds while it is being filled in. */
interface Form {
  baseUrl: string;
  accountEmail: string;
  apiToken: string;
}

const EMPTY: Form = { baseUrl: '', accountEmail: '', apiToken: '' };

export function ConnectionsTab() {
  const [connections, setConnections] = useState<ContextConnectionView[] | null>(null);
  const [editing, setEditing] = useState<ContextConnectionProvider | null>(null);

  const read = useCallback(async () => {
    const answer = await listContextConnections();
    setConnections(answer.connections);
  }, []);

  useEffect(() => {
    void read().catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)));
  }, [read]);

  const viewOf = (provider: ContextConnectionProvider): ContextConnectionView | null =>
    (connections ?? []).find((connection) => connection.provider === provider) ?? null;

  return (
    <>
      <ul className="divide-y divide-border border-b border-border" aria-label="Connectors">
        {CONNECTORS.map((connector) => {
          const provider = connector.provider;
          const view = provider ? viewOf(provider) : null;
          const row = (
            <div className="flex w-full items-start gap-4 px-6 py-3">
              <span className="mt-0.5 flex shrink-0 items-center gap-1">
                {connector.tools.map((tool) => (
                  <ConnectorLogo key={tool} tool={tool} className="h-6 w-6" />
                ))}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground">
                    {connector.label}
                  </span>
                  {provider ? (
                    view?.connected ? (
                      <StatusWord tone="success" word="Connected" />
                    ) : (
                      <StatusWord tone="neutral" word="Not connected" />
                    )
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">Coming soon</span>
                  )}
                </div>
                {view?.connected && (
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground">
                      {view.baseUrl}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(view.updatedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
          return (
            <li key={connector.key}>
              {provider ? (
                <button
                  type="button"
                  aria-label={
                    view?.connected
                      ? `Edit the ${connector.label} connection`
                      : `Connect ${connector.label}`
                  }
                  onClick={() => setEditing(provider)}
                  className="block w-full transition-colors hover:bg-muted/40"
                >
                  {row}
                </button>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>

      {editing && (
        <ConnectionDialog
          provider={editing}
          view={viewOf(editing)}
          onClose={() => setEditing(null)}
          onChanged={() => void read()}
        />
      )}
    </>
  );
}

/**
 * One account. Saving stores it; Test makes one read per product it serves,
 * with whatever token is in the field or the stored one when it is left blank —
 * which is what the masked placeholder means.
 */
function ConnectionDialog({
  provider,
  view,
  onClose,
  onChanged,
}: {
  provider: ContextConnectionProvider;
  view: ContextConnectionView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const label = CONTEXT_CONNECTION_LABEL[provider];
  const kinds = view?.kinds ?? CONTEXT_CONNECTION_KINDS[provider];
  const [form, setForm] = useState<Form>({
    ...EMPTY,
    baseUrl: view?.baseUrl ?? '',
    accountEmail: view?.accountEmail ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<ContextConnectionTestResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const edit = (patch: Partial<Form>): void => {
    setForm({ ...form, ...patch });
    setTested(null);
    setFailure(null);
  };

  const payload = () => ({
    baseUrl: form.baseUrl.trim(),
    accountEmail: form.accountEmail.trim(),
    ...(form.apiToken.trim() ? { apiToken: form.apiToken.trim() } : {}),
  });

  const run = (what: () => Promise<void>): void => {
    setBusy(true);
    setFailure(null);
    void what()
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            The account this workspace reads {productWords(kinds)} with. What it reads is added in
            Context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-[11px] font-medium text-muted-foreground">
            Site URL
            <input
              value={form.baseUrl}
              onChange={(e) => edit({ baseUrl: e.target.value })}
              placeholder="https://your-site.atlassian.net"
              className={FIELD_MONO}
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            Account email
            <input
              type="email"
              autoComplete="off"
              value={form.accountEmail}
              onChange={(e) => edit({ accountEmail: e.target.value })}
              placeholder="you@company.com"
              className={FIELD}
            />
          </label>
          <label className="block text-[11px] font-medium text-muted-foreground">
            API token
            <input
              type="password"
              autoComplete="off"
              value={form.apiToken}
              onChange={(e) => edit({ apiToken: e.target.value })}
              placeholder={
                view?.connected
                  ? `${view.tokenMask ?? '••••'}, leave blank to keep`
                  : 'Paste an Atlassian API token'
              }
              className={FIELD_MONO}
            />
          </label>
          {tested && (
            <ul className="space-y-1">
              {kinds.map((kind) => {
                const verdict = tested.products[kind];
                if (!verdict) return null;
                return (
                  <li key={kind}>
                    {verdict.ok ? (
                      <StatusWord
                        tone="success"
                        word={`${CONTEXT_SOURCE_KIND_LABEL[kind]} answered.`}
                      />
                    ) : (
                      <p className="text-[11px] text-destructive">
                        {`${CONTEXT_SOURCE_KIND_LABEL[kind]}: ${verdict.error}`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {failure && <p className="text-[11px] text-destructive">{failure}</p>}
        </div>

        <DialogFooter>
          {view?.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const answer = await removeConnection(provider);
                  onChanged();
                  onClose();
                  toast.success(
                    answer.paused.length > 0
                      ? `${label} disconnected. ${answer.paused.length} source${answer.paused.length === 1 ? '' : 's'} paused.`
                      : `${label} disconnected.`,
                  );
                })
              }
              className={`${BUTTON} mr-auto border border-border text-destructive hover:bg-destructive/10`}
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setTested(await testConnection(provider, payload()));
              })
            }
            className={`${BUTTON} border border-border text-foreground hover:bg-muted/60`}
          >
            {busy ? 'Working…' : 'Test'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await saveConnection(provider, payload());
                onChanged();
                onClose();
                toast.success(`${label} connected.`);
              })
            }
            className={`${BUTTON} bg-primary text-primary-foreground hover:opacity-90`}
          >
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
