/**
 * SpecPanel — the dashboard surface for Module 1 (Spec Consolidation).
 *
 * Layout:
 *   Header      counts (docs, claims, resolved, decided, open) + Apply
 *   Toolbar     batch ops (Accept all defaults, Refresh)
 *   ConflictList  flat sortable list (Q9). Each row expands to show
 *                 candidates side-by-side with pick/custom buttons.
 *
 * Q-locks honored:
 *   Q7  engine pre-picks default; user reviews/overrides.
 *   Q8  this is the primary review surface (CLI is fast-path only).
 *   Q9  flat list, filterable.
 *   Q10 default-pick highlights the newest candidate.
 *   Q11 custom free-text answer per conflict.
 *   Q12 explicit Apply step writes the canonical and chains into IL.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Wand2, Check, AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import type {
  SpecConflict,
  SpecResolution,
  SpecScanResponse,
  SpecApplyResponse,
} from '@/lib/api';

interface SpecPanelProps {
  repoId: string;
}

export function SpecPanel({ repoId }: SpecPanelProps) {
  const [scan, setScan] = useState<SpecScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<SpecApplyResponse | null>(null);
  const [busyConflictId, setBusyConflictId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getSpecScan(repoId);
      setScan(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleResolve = useCallback(
    async (conflict: SpecConflict, resolution: SpecResolution) => {
      setBusyConflictId(conflict.id);
      try {
        await api.postSpecDecision(repoId, {
          conflictId: conflict.id,
          resolution,
          candidateFingerprint: conflict.candidateFingerprint,
        });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusyConflictId(null);
      }
    },
    [repoId, refresh],
  );

  const handleAcceptAllDefaults = useCallback(async () => {
    setLoading(true);
    try {
      await api.postSpecDecisionsBatch(repoId, 'all-defaults');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoId, refresh]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      const r = await api.postSpecApply(repoId);
      setApplyResult(r);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [repoId, refresh]);

  const filtered = scan
    ? scan.openConflicts.filter((c) =>
        filterText
          ? `${c.topic} ${c.subject} ${c.module ?? ''}`
              .toLowerCase()
              .includes(filterText.toLowerCase())
          : true,
      )
    : [];

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Header
        scan={scan}
        loading={loading}
        applying={applying}
        onApply={handleApply}
      />
      <Toolbar
        scan={scan}
        filterText={filterText}
        onFilterChange={setFilterText}
        onAcceptAllDefaults={handleAcceptAllDefaults}
        onRefresh={refresh}
        loading={loading}
      />
      {error && (
        <div className="border-b border-border bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      {applyResult && <ApplyResultBanner result={applyResult} />}
      <div className="flex-1 overflow-auto">
        {loading && !scan ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : scan && filtered.length === 0 ? (
          <EmptyState scan={scan} filterActive={!!filterText} />
        ) : (
          <ConflictList
            conflicts={filtered}
            busyConflictId={busyConflictId}
            onResolve={handleResolve}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({
  scan,
  loading,
  applying,
  onApply,
}: {
  scan: SpecScanResponse | null;
  loading: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
      <div>
        <h2 className="text-lg font-semibold">Spec</h2>
        <p className="text-xs text-muted-foreground">
          Consolidate scattered docs into a canonical, committable spec.
        </p>
      </div>
      {scan && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Stat label="Docs" value={scan.docsScanned} />
          <Stat label="Claims" value={scan.claimsExtracted} />
          <Stat label="Resolved" value={scan.resolved + scan.decided} />
          <Stat label="Open" value={scan.openConflicts.length} highlight={scan.openConflicts.length > 0} />
          <Button
            onClick={onApply}
            disabled={applying || loading || scan.openConflicts.length > 0}
            size="sm"
          >
            {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-base font-semibold ${highlight ? 'text-amber-300' : 'text-foreground'}`}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  );
}

function Toolbar({
  scan,
  filterText,
  onFilterChange,
  onAcceptAllDefaults,
  onRefresh,
  loading,
}: {
  scan: SpecScanResponse | null;
  filterText: string;
  onFilterChange: (s: string) => void;
  onAcceptAllDefaults: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const hasOpen = (scan?.openConflicts.length ?? 0) > 0;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-card/50 px-4 py-2">
      <input
        value={filterText}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter conflicts…"
        className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={onAcceptAllDefaults}
        disabled={!hasOpen || loading}
        title="Accept the engine's default pick on every open conflict"
      >
        <Wand2 className="mr-2 h-3.5 w-3.5" />
        Accept all defaults
      </Button>
      <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      </Button>
    </div>
  );
}

function EmptyState({
  scan,
  filterActive,
}: {
  scan: SpecScanResponse;
  filterActive: boolean;
}) {
  if (scan.openConflicts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Check className="h-6 w-6 text-emerald-400" />
        <div>No open conflicts.</div>
        <div className="text-xs">Click Apply to write the canonical spec and run IL extraction.</div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {filterActive
        ? 'No conflicts match the filter.'
        : 'No conflicts to show.'}
    </div>
  );
}

function ConflictList({
  conflicts,
  busyConflictId,
  onResolve,
}: {
  conflicts: SpecConflict[];
  busyConflictId: string | null;
  onResolve: (conflict: SpecConflict, resolution: SpecResolution) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {conflicts.map((c) => (
        <ConflictRow
          key={c.id}
          conflict={c}
          busy={busyConflictId === c.id}
          onResolve={(resolution) => onResolve(c, resolution)}
        />
      ))}
    </div>
  );
}

function ConflictRow({
  conflict,
  busy,
  onResolve,
}: {
  conflict: SpecConflict;
  busy: boolean;
  onResolve: (resolution: SpecResolution) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState('');

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <FileText className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {conflict.topic}
            </span>
            <span className="font-medium">{conflict.subject}</span>
            <span className="text-xs text-muted-foreground">
              {conflict.candidates.length} candidates
            </span>
          </div>
          {expanded && (
            <div className="mt-3 grid gap-2">
              {conflict.candidates.map((cand) => (
                <CandidateCard
                  key={cand.index}
                  candidate={cand}
                  isDefault={cand.index === conflict.defaultPick}
                  busy={busy}
                  onPick={() => onResolve({ kind: 'pick', candidateIndex: cand.index })}
                />
              ))}
              {customMode ? (
                <div className="rounded border border-dashed border-border p-3">
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Enter the authoritative answer in your own words…"
                    className="w-full resize-none rounded border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={3}
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setCustomMode(false); setCustomText(''); }}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !customText.trim()}
                      onClick={() => onResolve({ kind: 'custom', content: customText.trim() })}
                    >
                      Save custom
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  className="self-start rounded border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setCustomMode(true)}
                  disabled={busy}
                >
                  Or write a custom answer…
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  candidate,
  isDefault,
  busy,
  onPick,
}: {
  candidate: SpecConflict['candidates'][number];
  isDefault: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <div
      className={`rounded border p-3 transition-colors ${
        isDefault ? 'border-primary/60 bg-primary/5' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground">
            {candidate.claim.provenance.file}:{candidate.claim.provenance.line}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {candidate.weight}
          </span>
          {isDefault && (
            <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
              default
            </span>
          )}
        </div>
        <Button size="sm" variant={isDefault ? 'default' : 'outline'} onClick={onPick} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Pick'}
        </Button>
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-xs text-muted-foreground">
        {candidate.claim.provenance.quote}
      </pre>
      {candidate.claim.content !== undefined && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Structured content</summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/30 p-2">
            {JSON.stringify(candidate.claim.content, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function ApplyResultBanner({ result }: { result: SpecApplyResponse }) {
  const ilStatus = (() => {
    if ('error' in result.il) return { label: 'IL extraction failed', tone: 'red' as const, detail: result.il.error };
    if ('skipped' in result.il) return { label: 'IL extraction skipped', tone: 'amber' as const, detail: result.il.skipped };
    const hasIssues = (result.il.validationIssues?.length ?? 0) > 0;
    return {
      label: hasIssues ? 'IL extraction surfaced validation issues' : `IL extraction wrote ${result.il.written} files`,
      tone: hasIssues ? ('amber' as const) : ('emerald' as const),
      detail: undefined,
    };
  })();
  const tone = {
    red: 'bg-red-500/10 text-red-300',
    amber: 'bg-amber-500/10 text-amber-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
  }[ilStatus.tone];
  return (
    <div className={`border-b border-border px-4 py-2 text-xs ${tone}`}>
      <span className="font-semibold">Applied.</span> Materialized {result.materialize?.written ?? 0} canonical files.
      {' · '}
      <span>{ilStatus.label}</span>
      {ilStatus.detail && <span className="ml-2 text-muted-foreground">({ilStatus.detail})</span>}
    </div>
  );
}

