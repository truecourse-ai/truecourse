/**
 * SpecCorpusView — the curated-corpus Spec tab (spec-scan redesign).
 *
 * Renders the corpus as area-grouped PROSE: each area lists its source docs
 * (rendered markdown on expand) and the within-area OVERLAPS (two docs that may
 * disagree). An open overlap is resolved inline by recording a doc→doc relation
 * — replace / precedence / keep-both — which writes to decisions.json; a re-scan
 * folds it into corpus.json so generation honours it.
 *
 * Self-contained (fetches its own corpus by repoId) so it can drop into the Spec
 * tab without threading corpus state through the claims-era SpecContext.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, FileText, ChevronRight, ChevronDown, AlertCircle, Layers } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import type { SpecCorpusResponse, SpecCorpusArea, SpecOverlap, SpecRelation, SpecRelationType } from '@/lib/api';

const base = (ref: string): string => ref.split('/').pop() ?? ref;

/** A relation covers an overlap pair when it names both docs (either order), unscoped or scoped to this area. */
function coveringRelation(rels: SpecRelation[], a: string, b: string, area: string): SpecRelation | undefined {
  return rels.find((r) => {
    const samePair = (r.older === a && r.newer === b) || (r.older === b && r.newer === a);
    return samePair && (r.scope === undefined || r.scope === area);
  });
}

export function SpecCorpusView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<SpecCorpusResponse | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    api
      .getSpecCorpus(repoId)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError((e as Error).message))
      .finally(() => !cancelled && setHydrating(false));
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      setData(await api.getSpecCorpusScan(repoId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }, [repoId]);

  const refetch = useCallback(async () => {
    try {
      setData(await api.getSpecCorpus(repoId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [repoId]);

  if (hydrating) return <Centered><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Centered>;

  if (!data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <EmptyState
          icon={Play}
          title="No corpus yet"
          body="Scan the docs to curate them into areas, detect doc relations, and flag overlaps."
        />
        <Button onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {scanning ? 'Scanning…' : 'Scan'}
        </Button>
      </div>
    );
  }

  const { corpus, userRelations } = data;
  const effectiveRels = [...corpus.relations, ...userRelations];
  const lastTouched = new Map(corpus.docs.map((d) => [d.ref, d.lastTouched] as const));
  let open = 0;
  let resolved = 0;
  for (const area of corpus.areas) {
    for (const ov of area.overlaps) {
      if (coveringRelation(effectiveRels, ov.docs[0], ov.docs[1], area.id)) resolved++;
      else open++;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          {corpus.areas.length} areas · {corpus.docs.length} docs · {open} open / {resolved} resolved overlaps
        </span>
        <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
          Rescan
        </Button>
      </header>
      {error && (
        <div className="border-b border-border px-4 py-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {corpus.areas.map((area) => (
          <AreaSection
            key={area.id}
            repoId={repoId}
            area={area}
            effectiveRels={effectiveRels}
            lastTouched={lastTouched}
            onResolved={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function AreaSection({
  repoId,
  area,
  effectiveRels,
  lastTouched,
  onResolved,
}: {
  repoId: string;
  area: SpecCorpusArea;
  effectiveRels: SpecRelation[];
  lastTouched: Map<string, string>;
  onResolved: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-border bg-card/80 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Layers className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">{area.id}</span>
        <span>{area.docRefs.length} docs</span>
        {area.overlaps.length > 0 && <span className="text-amber-600 dark:text-amber-400">{area.overlaps.length} overlap</span>}
      </button>
      {open && (
        <div className="px-4 py-2">
          {area.docRefs.map((ref) => (
            <DocRow key={ref} repoId={repoId} docRef={ref} />
          ))}
          {area.overlaps.map((ov, i) => (
            <OverlapCard
              key={i}
              repoId={repoId}
              area={area.id}
              overlap={ov}
              relation={coveringRelation(effectiveRels, ov.docs[0], ov.docs[1], area.id)}
              lastTouched={lastTouched}
              onResolved={onResolved}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRow({ repoId, docRef }: { repoId: string; docRef: string }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && content === null) {
      setLoading(true);
      try {
        setContent((await api.getSpecDoc(repoId, docRef)).content);
      } catch (e) {
        setContent(`_Could not load ${docRef}: ${(e as Error).message}_`);
      } finally {
        setLoading(false);
      }
    }
  };
  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <FileText className="h-3 w-3 shrink-0" />
        <span className="flex-1 truncate">{docRef}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </button>
      {open && content !== null && (
        <div className="prose prose-sm dark:prose-invert mt-1 max-w-none rounded border border-border bg-muted/30 px-3 py-2 text-[13px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

const RELATION_LABEL: Record<SpecRelationType, string> = {
  replace: 'Replace',
  precedence: 'Precedence',
  'keep-both': 'Keep both',
};

function OverlapCard({
  repoId,
  area,
  overlap,
  relation,
  lastTouched,
  onResolved,
}: {
  repoId: string;
  area: string;
  overlap: SpecOverlap;
  relation: SpecRelation | undefined;
  lastTouched: Map<string, string>;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<SpecRelationType | null>(null);
  const [a, b] = overlap.docs;
  // Default the relation direction by recency: the more recently-touched doc is `newer`.
  const ta = lastTouched.get(a) ?? '';
  const tb = lastTouched.get(b) ?? '';
  const newer = tb >= ta ? b : a;
  const older = newer === a ? b : a;

  const resolve = async (type: SpecRelationType) => {
    setBusy(type);
    try {
      await api.postSpecRelation(repoId, { type, older, newer, scope: area, detectedFrom: 'manual' });
      onResolved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="my-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-medium">{base(a)}</span>
        <span className="text-muted-foreground">↔</span>
        <span className="font-medium">{base(b)}</span>
      </div>
      {overlap.note && <p className="mt-0.5 text-xs text-muted-foreground">{overlap.note}</p>}
      {relation ? (
        <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          Resolved → {RELATION_LABEL[relation.type]} ({base(relation.older)} ⇒ {base(relation.newer)})
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted-foreground">{base(newer)} wins:</span>
          {(['replace', 'precedence', 'keep-both'] as SpecRelationType[]).map((t) => (
            <Button key={t} size="sm" variant="outline" disabled={busy !== null} onClick={() => resolve(t)}>
              {busy === t ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {RELATION_LABEL[t]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}
