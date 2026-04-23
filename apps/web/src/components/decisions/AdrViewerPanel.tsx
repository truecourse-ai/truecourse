import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check, X, AlertTriangle, FileText, Eye, Code, Save, Workflow, Network, Maximize2, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as api from '@/lib/api';
import type { AdrDraftResponse, AdrFragmentSnapshot, AdrResponse } from '@/lib/api';
import { AdrGraphFragmentDiagram } from './AdrGraphFragmentDiagram';
import { AdrFlowFragmentDiagram } from './AdrFlowFragmentDiagram';

type ViewMode = 'preview' | 'raw';
type AdrTabKind = 'adr' | 'draft';

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

type AdrViewerPanelProps = {
  repoId: string;
  kind: AdrTabKind;
  id: string;
  /** Fired after the user accepts/rejects a draft so the page can close
   *  the tab and refresh the Decisions sidebar. */
  onDraftResolved?: () => void;
};

export function AdrViewerPanel({ repoId, kind, id, onDraftResolved }: AdrViewerPanelProps) {
  if (kind === 'adr') {
    return <AcceptedAdrView repoId={repoId} adrId={id} />;
  }
  return <DraftView repoId={repoId} draftId={id} onResolved={onDraftResolved} />;
}

// ---------------------------------------------------------------------------
// Accepted ADR — thin wrapper around AdrBodyView
// ---------------------------------------------------------------------------

function AcceptedAdrView({ repoId, adrId }: { repoId: string; adrId: string }) {
  const [adr, setAdr] = useState<AdrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { adr: next } = await api.getAdr(repoId, adrId);
      setAdr(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [repoId, adrId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) return <LoadingState />;
  if (error || !adr) return <ErrorState message={error ?? `ADR ${adrId} not found`} />;

  return (
    <AdrBodyView
      statusLabel={adr.status}
      statusTone={statusTone(adr.status)}
      identifier={adr.id}
      date={adr.date}
      extraBadges={adr.isStale ? [{ label: 'stale', tone: 'warning' }] : []}
      title={adr.title}
      entities={adr.linkedNodeIds}
      staleReasons={adr.staleReasons}
      source={adr.source}
      fragments={adr.fragments}
      onSaveRaw={async (source) => {
        const { adr: updated } = await api.saveAdrRaw(repoId, adrId, source);
        setAdr(updated);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Draft — thin wrapper around AdrBodyView, adds Accept/Reject actions
// ---------------------------------------------------------------------------

function DraftView({
  repoId,
  draftId,
  onResolved,
}: {
  repoId: string;
  draftId: string;
  onResolved?: () => void;
}) {
  const [draft, setDraft] = useState<AdrDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { drafts } = await api.getAdrDrafts(repoId);
      const found = drafts.find((d) => d.id === draftId) ?? null;
      setDraft(found);
      if (!found) setError(`Draft ${draftId} is no longer in the review queue`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [repoId, draftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) return <LoadingState />;
  if (error || !draft) return <ErrorState message={error ?? `Draft ${draftId} not found`} />;

  const missing = getMissingSections(draft.madrBody);
  const missingMsg =
    missing.length > 0
      ? `Missing required section${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`
      : undefined;

  const onAccept = async () => {
    setActionInFlight(true);
    try {
      await api.acceptAdrDraft(repoId, draftId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInFlight(false);
    }
  };

  const onReject = async () => {
    setActionInFlight(true);
    try {
      await api.rejectAdrDraft(repoId, draftId);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInFlight(false);
    }
  };

  return (
    <AdrBodyView
      statusLabel="draft"
      statusTone="warning"
      identifier={draft.topic}
      date={draft.createdAt.slice(0, 10)}
      confidence={draft.confidence}
      title={draft.title}
      entities={draft.entities}
      source={draft.source}
      fragments={draft.fragments}
      actions={[
        {
          label: 'Accept',
          icon: <Check className="h-3.5 w-3.5" />,
          kind: 'accept',
          onClick: onAccept,
          disabled: actionInFlight || missing.length > 0,
          disabledReason: missingMsg,
        },
        {
          label: 'Reject',
          icon: <X className="h-3.5 w-3.5" />,
          kind: 'reject',
          onClick: onReject,
          disabled: actionInFlight,
        },
      ]}
      onSaveRaw={async (source) => {
        const { draft: updated } = await api.saveAdrDraftRaw(repoId, draftId, source);
        setDraft(updated);
      }}
      saveDisabledReason={missingMsg}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared body view — one component for draft + accepted
// ---------------------------------------------------------------------------

type MetaBadge = { label: string; tone: 'warning' | 'info' | 'neutral' };

type BodyAction = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  kind: 'accept' | 'reject';
  disabled?: boolean;
  disabledReason?: string;
};

type MaximizedFragment = {
  snapshot: AdrFragmentSnapshot;
  label: string;
};

type AdrBodyViewProps = {
  statusLabel: string;
  statusTone: 'warning' | 'accepted' | 'neutral';
  identifier: string;
  date: string;
  extraBadges?: MetaBadge[];
  /** Draft-only — LLM self-reported confidence [0,1]. Rendered as a
   *  color-coded pill so readers can scan a list of drafts and spot the
   *  ones worth trusting at a glance. */
  confidence?: number;
  title: string;
  entities?: string[];
  staleReasons?: string[];
  /** Full MADR document (frontmatter + body). Sections are parsed from
   *  the body half of this string on every render so Preview always
   *  reflects whatever the user just typed or just saved. */
  source: string;
  fragments?: AdrFragmentSnapshot[];
  actions?: BodyAction[];
  onSaveRaw: (source: string) => Promise<void>;
  /** If set, Save is disabled in Raw mode even when dirty, with this
   *  tooltip — e.g. when required sections are missing. */
  saveDisabledReason?: string;
};

function AdrBodyView({
  statusLabel,
  statusTone,
  identifier,
  date,
  extraBadges,
  confidence,
  title,
  entities,
  staleReasons,
  source,
  fragments,
  actions,
  onSaveRaw,
  saveDisabledReason,
}: AdrBodyViewProps) {
  const [mode, setMode] = useState<ViewMode>('preview');
  const [rawBuffer, setRawBuffer] = useState(source);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Transient "maximize this fragment" state. When set, the Preview area
  // renders just the chosen diagram full-height instead of the normal
  // prose+fragments layout. Not persisted to the URL — view state, not
  // shareable state.
  const [maximized, setMaximized] = useState<MaximizedFragment | null>(null);

  // Parse the body half of the MADR text into sections on every render.
  // One code path for draft + accepted — no mismatch between server-parsed
  // accepted.sections and client-parsed draft sections.
  const body = useMemo(() => stripFrontmatter(source), [source]);
  const sections = useMemo(() => parseBodySections(body), [body]);

  // Reset the textarea when the underlying source changes (after a save or
  // a fresh load via parent refetch).
  useEffect(() => {
    setRawBuffer(source);
  }, [source]);

  const dirty = rawBuffer !== source;
  const saveDisabled = saving || !dirty || !!saveDisabledReason;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSaveRaw(rawBuffer);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-3">
      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <AdrMetaRow
            statusLabel={statusLabel}
            statusTone={statusTone}
            identifier={identifier}
            date={date}
            extraBadges={extraBadges}
            confidence={confidence}
          />
          {/* Title is shown in preview only. In raw mode the title is
              already in the first line of the document (frontmatter +
              H1), so a separate display would be redundant and go stale
              while the user edits. */}
          {mode === 'preview' && (
            <h1 className="mt-1 truncate text-xl font-semibold" title={title}>
              {title}
            </h1>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {mode === 'raw' && (
            <button
              type="button"
              onClick={save}
              disabled={saveDisabled}
              title={saveDisabledReason}
              className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
          )}
          {actions?.map((a) => (
            <ActionButton key={a.label} action={a} />
          ))}
          <ViewModeToggle mode={mode} onChange={setMode} />
        </div>
      </header>

      {/* Entities and stale reasons only surface in preview — same
          rationale as hiding the title: their source of truth is in the
          document text (entities live in frontmatter; staleness is a
          server-computed annotation on the last-saved state). */}
      {mode === 'preview' && <EntitiesRow items={entities} />}
      {mode === 'preview' && staleReasons && staleReasons.length > 0 && (
        <div className="mt-3 shrink-0 rounded-md bg-amber-500/10 p-3 text-xs text-amber-400">
          <div className="font-medium">This ADR may be stale:</div>
          <ul className="mt-1 list-disc pl-4">
            {staleReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {saveError && (
        <div className="mt-2 shrink-0 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Save failed: {saveError}
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1">
        {mode === 'preview' && maximized ? (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 pb-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setMaximized(null)}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                aria-label="Back to ADR"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to ADR
              </button>
              <span>·</span>
              <span>{maximized.label}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pt-2">
              {maximized.snapshot.kind === 'graph' ? (
                <AdrGraphFragmentDiagram snapshot={maximized.snapshot} fillHeight />
              ) : (
                <AdrFlowFragmentDiagram snapshot={maximized.snapshot} fillHeight />
              )}
            </div>
          </div>
        ) : mode === 'preview' ? (
          <div className="h-full space-y-4 overflow-auto">
            <Section label="Context" body={sections.context} fragments={fragments} onMaximize={setMaximized} />
            <Section label="Decision" body={sections.decision} fragments={fragments} onMaximize={setMaximized} />
            <Section label="Consequences" body={sections.consequences} fragments={fragments} onMaximize={setMaximized} />
            {sections.extra.map((s, i) => (
              <Section key={i} label={s.label} body={s.body} fragments={fragments} onMaximize={setMaximized} />
            ))}
          </div>
        ) : (
          <textarea
            value={rawBuffer}
            onChange={(e) => setRawBuffer(e.target.value)}
            spellCheck={false}
            disabled={saving}
            className="h-full w-full resize-none rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed text-foreground/90 outline-none focus:border-primary/50"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AdrMetaRow({
  statusLabel,
  statusTone,
  identifier,
  date,
  extraBadges,
  confidence,
}: {
  statusLabel: string;
  statusTone: 'warning' | 'accepted' | 'neutral';
  identifier: string;
  date: string;
  extraBadges?: MetaBadge[];
  confidence?: number;
}) {
  const toneClass: Record<typeof statusTone, string> = {
    warning: 'bg-amber-500/15 text-amber-400',
    accepted: 'bg-emerald-500/15 text-emerald-400',
    neutral: 'bg-muted text-muted-foreground',
  };
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <FileText className="h-3.5 w-3.5" />
      <span className={`rounded-md px-1.5 py-0.5 ${toneClass[statusTone]}`}>{statusLabel}</span>
      <span>·</span>
      <span className="font-mono text-foreground/80">{identifier}</span>
      <span>·</span>
      <span>{date}</span>
      {extraBadges?.map((b) => (
        <span key={b.label} className="flex items-center gap-0.5">
          <span>·</span>
          {b.tone === 'warning' ? (
            <span className="flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-400">
              <AlertTriangle className="h-3 w-3" /> {b.label}
            </span>
          ) : (
            <span>{b.label}</span>
          )}
        </span>
      ))}
      {confidence !== undefined && <ConfidencePill value={confidence} />}
    </div>
  );
}

/** Color-coded confidence pill. Buckets mirror typical calibration cutoffs:
 *  high (≥0.8) reads as "trust this draft", mid (0.6–0.8) as "review
 *  closely", low (<0.6) as "probably wrong" (muted red so it doesn't
 *  alarm — it's still just a suggestion). A filled bar reinforces the
 *  numeric value for scanning a draft list at a glance. */
function ConfidencePill({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const tone =
    pct >= 0.8
      ? { pill: 'bg-emerald-500/15 text-emerald-400', bar: 'bg-emerald-400' }
      : pct >= 0.6
        ? { pill: 'bg-amber-500/15 text-amber-400', bar: 'bg-amber-400' }
        : { pill: 'bg-rose-500/15 text-rose-400', bar: 'bg-rose-400' };
  return (
    <>
      <span>·</span>
      <span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 ${tone.pill}`}>
        <span>confidence {pct.toFixed(2)}</span>
        <span className="relative h-1 w-10 overflow-hidden rounded-full bg-current/20">
          <span
            className={`absolute inset-y-0 left-0 ${tone.bar}`}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
      </span>
    </>
  );
}

function EntitiesRow({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-3 shrink-0 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <span className="text-muted-foreground">entities: </span>
      <span className="font-mono">{items.join(', ')}</span>
    </div>
  );
}

function ActionButton({ action }: { action: BodyAction }) {
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
      title={action.disabledReason}
      className={`${base} ${palette}`}
    >
      {action.icon}
      {action.label}
    </button>
  );
}

function ViewModeToggle(props: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="flex shrink-0 items-center rounded-md border border-border bg-background text-[11px]">
      <button
        type="button"
        onClick={() => props.onChange('preview')}
        className={`flex items-center gap-1 rounded-l-md px-2 py-1 ${props.mode === 'preview' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        aria-pressed={props.mode === 'preview'}
      >
        <Eye className="h-3 w-3" /> Preview
      </button>
      <button
        type="button"
        onClick={() => props.onChange('raw')}
        className={`flex items-center gap-1 rounded-r-md px-2 py-1 ${props.mode === 'raw' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        aria-pressed={props.mode === 'raw'}
      >
        <Code className="h-3 w-3" /> Raw
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return <div className="p-6 text-sm text-destructive">{message}</div>;
}

// ---------------------------------------------------------------------------
// Body parsing helpers
// ---------------------------------------------------------------------------

function stripLeadingH1(body: string): string {
  return body.replace(/^\s*#\s+.+\n?/, '').replace(/^\n+/, '');
}

/** Strip a leading `---\n...\n---\n` YAML frontmatter block from a full
 *  MADR document, leaving just the markdown body. Returns the original
 *  text when no frontmatter is present. */
function stripFrontmatter(source: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return m ? source.slice(m[0].length) : source;
}

function parseBodySections(body: string): {
  context: string;
  decision: string;
  consequences: string;
  extra: Array<{ label: string; body: string }>;
} {
  const stripped = stripLeadingH1(body);
  const sectionMap = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of stripped.split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      current = h2[1].trim();
      sectionMap.set(current, []);
      continue;
    }
    if (current) sectionMap.get(current)!.push(line);
  }
  const take = (name: string) => {
    for (const [label, lines] of sectionMap) {
      if (label.toLowerCase() === name) {
        sectionMap.delete(label);
        return lines.join('\n').trim();
      }
    }
    return '';
  };
  const context = take('context');
  const decision = take('decision');
  const consequences = take('consequences');
  const extra = [...sectionMap.entries()].map(([label, lines]) => ({
    label,
    body: lines.join('\n').trim(),
  }));
  return { context, decision, consequences, extra };
}

function getMissingSections(body: string): string[] {
  const s = parseBodySections(body);
  const missing: string[] = [];
  if (!s.context) missing.push('Context');
  if (!s.decision) missing.push('Decision');
  if (!s.consequences) missing.push('Consequences');
  return missing;
}

function statusTone(status: AdrResponse['status']): 'warning' | 'accepted' | 'neutral' {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'proposed':
    case 'stale':
      return 'warning';
    default:
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// Section rendering — splits body at fragment fences so React Flow
// diagrams render as siblings of the prose (not descendants) and escape
// PROSE_CLASSES' descendant-selector cascade.
// ---------------------------------------------------------------------------

const PROSE_CLASSES =
  'text-sm leading-6 text-foreground/90 ' +
  '[&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-2 ' +
  '[&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 ' +
  '[&_p]:my-2 ' +
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 ' +
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 ' +
  '[&_li]:my-0.5 ' +
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] ' +
  '[&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:px-0 ' +
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
  '[&_hr]:my-3 [&_hr]:border-border';

type BodyChunk =
  | { kind: 'prose'; text: string }
  | { kind: 'fragment'; lang: 'adr-graph' | 'adr-flow'; content: string };

function splitBodyAtFragments(body: string): BodyChunk[] {
  const re = /^```(adr-graph|adr-flow)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  const chunks: BodyChunk[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > lastIndex) {
      chunks.push({ kind: 'prose', text: body.slice(lastIndex, match.index) });
    }
    chunks.push({
      kind: 'fragment',
      lang: match[1] as 'adr-graph' | 'adr-flow',
      content: match[2],
    });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < body.length) {
    chunks.push({ kind: 'prose', text: body.slice(lastIndex) });
  }
  return chunks;
}

function Section({
  label,
  body,
  fragments,
  onMaximize,
}: {
  label: string;
  body: string;
  fragments?: AdrFragmentSnapshot[];
  onMaximize?: (m: MaximizedFragment) => void;
}) {
  const chunks = useMemo(() => splitBodyAtFragments(body), [body]);
  if (!body) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      <div className="mt-1 space-y-2">
        {chunks.map((chunk, i) => {
          if (chunk.kind === 'prose') {
            return (
              <div key={i} className={PROSE_CLASSES}>
                <ReactMarkdown>{chunk.text}</ReactMarkdown>
              </div>
            );
          }
          if (chunk.lang === 'adr-graph') {
            return (
              <AdrGraphFragment
                key={i}
                snapshot={findGraphSnapshot(chunk.content, fragments)}
                rawContent={chunk.content}
                onMaximize={onMaximize}
              />
            );
          }
          if (chunk.lang === 'adr-flow') {
            return (
              <AdrFlowFragment
                key={i}
                snapshot={findFlowSnapshot(chunk.content, fragments)}
                rawContent={chunk.content}
                onMaximize={onMaximize}
              />
            );
          }
          return null;
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fragment rendering — deterministic locator matching (no counter state)
// ---------------------------------------------------------------------------

function findFlowSnapshot(
  rawContent: string,
  fragments: AdrFragmentSnapshot[] | undefined,
): AdrFragmentSnapshot | undefined {
  const m = /^\s*flowId:\s*(.+?)\s*$/m.exec(rawContent);
  if (!m) return undefined;
  const flowId = m[1].trim().replace(/^["']|["']$/g, '');
  return (fragments ?? []).find((f) => f.kind === 'flow' && f.locator.flowId === flowId);
}

function findGraphSnapshot(
  rawContent: string,
  fragments: AdrFragmentSnapshot[] | undefined,
): AdrFragmentSnapshot | undefined {
  const parseList = (key: string): string[] | undefined => {
    const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(rawContent);
    if (!m) return undefined;
    return m[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  };
  const services = parseList('services');
  const modules = parseList('modules');
  const show = /^\s*show:\s*(\w+)/m.exec(rawContent)?.[1];
  const eq = (a?: string[], b?: string[]) =>
    (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((v, i) => v === (b ?? [])[i]);
  return (fragments ?? []).find(
    (f) =>
      f.kind === 'graph' &&
      eq(services, f.locator.services) &&
      eq(modules, f.locator.modules) &&
      (show === undefined ? true : f.locator.show === show),
  );
}

function AdrGraphFragment({
  snapshot,
  rawContent,
  onMaximize,
}: {
  snapshot?: AdrFragmentSnapshot;
  rawContent: string;
  onMaximize?: (m: MaximizedFragment) => void;
}) {
  if (!snapshot || snapshot.kind !== 'graph') {
    return <FragmentFallback kind="adr-graph" rawContent={rawContent} />;
  }
  const label = `decision-time subgraph · ${snapshot.nodes.length} node${snapshot.nodes.length === 1 ? '' : 's'}`;
  return (
    <div className="my-3">
      <FragmentHeader
        icon={<Network className="h-3 w-3" />}
        label={label}
        onMaximize={onMaximize ? () => onMaximize({ snapshot, label }) : undefined}
      />
      <AdrGraphFragmentDiagram snapshot={snapshot} />
    </div>
  );
}

function AdrFlowFragment({
  snapshot,
  rawContent,
  onMaximize,
}: {
  snapshot?: AdrFragmentSnapshot;
  rawContent: string;
  onMaximize?: (m: MaximizedFragment) => void;
}) {
  if (!snapshot || snapshot.kind !== 'flow') {
    return <FragmentFallback kind="adr-flow" rawContent={rawContent} />;
  }
  const label = `decision-time flow · ${snapshot.flowName} · ${snapshot.steps.length} step${snapshot.steps.length === 1 ? '' : 's'}`;
  return (
    <div className="my-3">
      <FragmentHeader
        icon={<Workflow className="h-3 w-3" />}
        label={label}
        onMaximize={onMaximize ? () => onMaximize({ snapshot, label }) : undefined}
      />
      <AdrFlowFragmentDiagram snapshot={snapshot} />
    </div>
  );
}

/** Shared header row for both fragment kinds — label on the left, small
 *  maximize button on the right when a handler is provided. Keeps the
 *  two fragment components visually identical above the diagram. */
function FragmentHeader({
  icon,
  label,
  onMaximize,
}: {
  icon: React.ReactNode;
  label: string;
  onMaximize?: () => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {onMaximize && (
        <button
          type="button"
          onClick={onMaximize}
          className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-muted hover:text-foreground"
          aria-label="Maximize diagram"
          title="Maximize"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function FragmentFallback({ kind, rawContent }: { kind: string; rawContent: string }) {
  return (
    <div className="my-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
      <div className="mb-1 flex items-center gap-1 text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        <span className="uppercase tracking-wider">{kind} — no snapshot</span>
      </div>
      <pre className="whitespace-pre-wrap font-mono text-muted-foreground">{rawContent}</pre>
    </div>
  );
}
