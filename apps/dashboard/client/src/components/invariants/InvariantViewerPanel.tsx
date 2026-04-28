import { useState } from 'react';
import { Loader2, Check, X, Trash2 } from 'lucide-react';
import type { InvariantResponse, InvariantDraftResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// Public entry — main-area viewer for a single invariant or draft
// ---------------------------------------------------------------------------

type InvariantViewerPanelProps =
  | {
      kind: 'draft';
      draft: InvariantDraftResponse;
      onAccept: () => Promise<void>;
      onReject: () => Promise<void>;
      onResolved: () => void;
    }
  | {
      kind: 'active';
      invariant: InvariantResponse;
      slug: string;
      onRetire: () => Promise<void>;
      onResolved: () => void;
    };

export function InvariantViewerPanel(props: InvariantViewerPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      props.onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (props.kind === 'draft') {
    const { draft } = props;
    return (
      <BodyView
        statusLabel="draft"
        statusTone="warning"
        type={draft.type}
        scope={draft.scope}
        confidence={draft.confidence}
        rationale={draft.rationale}
        provenance={draft.provenance}
        declaration={draft.declaration}
        actions={[
          {
            kind: 'accept',
            label: 'Accept',
            icon: <Check className="h-3.5 w-3.5" />,
            disabled: busy,
            onClick: () => runAction(props.onAccept),
          },
          {
            kind: 'reject',
            label: 'Reject',
            icon: <X className="h-3.5 w-3.5" />,
            disabled: busy,
            onClick: () => runAction(props.onReject),
          },
        ]}
        error={error}
        busy={busy}
      />
    );
  }

  const { invariant, slug } = props;
  return (
    <BodyView
      statusLabel="active"
      statusTone="accepted"
      type={invariant.type}
      scope={invariant.scope}
      slug={slug}
      pluginVersion={invariant.pluginVersion}
      provenance={invariant.provenance}
      declaration={invariant.declaration}
      actions={[
        {
          kind: 'reject',
          label: 'Retire',
          icon: <Trash2 className="h-3.5 w-3.5" />,
          disabled: busy,
          onClick: () => runAction(props.onRetire),
        },
      ]}
      error={error}
      busy={busy}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared body view
// ---------------------------------------------------------------------------

type StatusTone = 'warning' | 'accepted';

type ActionDescriptor = {
  kind: 'accept' | 'reject';
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
};

type BodyViewProps = {
  statusLabel: string;
  statusTone: StatusTone;
  type: string;
  scope: string;
  slug?: string;
  pluginVersion?: number;
  confidence?: number;
  rationale?: string;
  provenance: {
    source: 'discovered' | 'hand-authored';
    inputs: Array<'code' | 'spec'>;
    timestamp: string;
    signal?: string;
    specSection?: string;
  };
  declaration: unknown;
  actions: ActionDescriptor[];
  error: string | null;
  busy: boolean;
};

function BodyView({
  statusLabel,
  statusTone,
  type,
  scope,
  slug,
  pluginVersion,
  confidence,
  rationale,
  provenance,
  declaration,
  actions,
  error,
  busy,
}: BodyViewProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-3">
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <MetaRow
            statusLabel={statusLabel}
            statusTone={statusTone}
            type={type}
            confidence={confidence}
            pluginVersion={pluginVersion}
          />
          <h1 className="mt-1 truncate text-xl font-semibold" title={scope}>
            {scope}
          </h1>
          {slug && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={slug}>
              <code>{slug}</code>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions.map((a) => (
            <ActionButton key={a.label} action={a} busy={busy} />
          ))}
        </div>
      </header>

      {error && (
        <div className="mt-3 shrink-0 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1 text-sm">
        {rationale && (
          <Section title="Rationale">
            <p className="text-muted-foreground">{rationale}</p>
          </Section>
        )}

        <Section title="Provenance">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Source</dt>
            <dd>{provenance.source}</dd>
            <dt className="text-muted-foreground">Inputs</dt>
            <dd>{provenance.inputs.join(', ') || '—'}</dd>
            {provenance.specSection && (
              <>
                <dt className="text-muted-foreground">Spec section</dt>
                <dd className="truncate" title={provenance.specSection}>
                  <code>{provenance.specSection}</code>
                </dd>
              </>
            )}
            {provenance.signal && (
              <>
                <dt className="text-muted-foreground">Signal</dt>
                <dd>{provenance.signal}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Discovered</dt>
            <dd>{new Date(provenance.timestamp).toLocaleString()}</dd>
          </dl>
        </Section>

        <Section title="Declaration">
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed">
            <code>{JSON.stringify(declaration, null, 2)}</code>
          </pre>
        </Section>
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

function MetaRow({
  statusLabel,
  statusTone,
  type,
  confidence,
  pluginVersion,
}: {
  statusLabel: string;
  statusTone: StatusTone;
  type: string;
  confidence?: number;
  pluginVersion?: number;
}) {
  const statusPalette =
    statusTone === 'accepted'
      ? 'bg-emerald-500/15 text-emerald-500'
      : 'bg-amber-500/15 text-amber-500';
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className={`rounded px-1.5 py-0.5 font-medium ${statusPalette}`}>{statusLabel}</span>
      <span className="rounded bg-primary/15 px-1.5 py-0.5 font-medium text-primary">{type}</span>
      {pluginVersion !== undefined && (
        <span className="text-muted-foreground">v{pluginVersion}</span>
      )}
      {confidence !== undefined && <ConfidencePill value={confidence} />}
    </div>
  );
}

function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    pct >= 80
      ? 'bg-emerald-500/15 text-emerald-500'
      : pct >= 60
        ? 'bg-amber-500/15 text-amber-500'
        : 'bg-red-500/15 text-red-500';
  return (
    <span className={`rounded px-1.5 py-0.5 font-medium ${tone}`}>{pct}% confidence</span>
  );
}

function ActionButton({ action, busy }: { action: ActionDescriptor; busy: boolean }) {
  const base =
    'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50';
  const palette =
    action.kind === 'accept'
      ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
      : 'bg-red-500/20 text-red-400 hover:bg-red-500/30';
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={`${base} ${palette}`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.icon}
      {action.label}
    </button>
  );
}
