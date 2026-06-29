/**
 * SpecOverlapDetail — right-pane viewer for one flagged within-area overlap.
 * Shows the two docs that may disagree (side-by-side, scrolled to + highlighting
 * the conflicting section) and the resolution: one click records a doc→doc
 * relation (replace / precedence / keep-both) with the chosen direction, written
 * to decisions.json. Opened from the Spec tab's left nav (URL `?spec=overlap::…`).
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as api from '@/lib/api';
import type { SpecCorpusResponse, SpecRelation, SpecRelationType } from '@/lib/api';
import { SpecDocViewer } from './SpecDocViewer';

const base = (ref: string): string => ref.split('/').pop() ?? ref;

/** How the resolved-state summary reads, e.g. "old.md replaced by new.md". */
const RESOLVED_VERB: Record<SpecRelationType, string> = {
  replace: 'replaced by',
  precedence: 'overridden (where overlapping) by',
  'keep-both': 'kept alongside',
};

function coveringRelation(rels: SpecRelation[], a: string, b: string, area: string): SpecRelation | undefined {
  return rels.find((r) => {
    const samePair = (r.older === a && r.newer === b) || (r.older === b && r.newer === a);
    return samePair && (r.scope === undefined || r.scope === area);
  });
}

export function SpecOverlapDetail({
  repoId,
  area,
  docA,
  docB,
  data,
  onResolved,
}: {
  repoId: string;
  area: string;
  docA: string;
  docB: string;
  data: SpecCorpusResponse;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Which heading to scroll each column to (nonce lets re-clicking the same one re-scroll).
  const [scrollA, setScrollA] = useState<{ heading: string; nonce: number } | undefined>();
  const [scrollB, setScrollB] = useState<{ heading: string; nonce: number } | undefined>();

  const effectiveRels = [...data.corpus.relations, ...data.userRelations];
  // A user-authored relation for this pair (revokable). Auto/filename relations
  // aren't in decisions.json, so they can be overridden but not revoked.
  const userRel = coveringRelation(data.userRelations, docA, docB, area);
  // Single-product repos tag everything `core/*`; drop the redundant product so
  // the area reads as its concern (matches the left-nav tags + conflict rows).
  const showProduct = new Set(data.corpus.areas.map((a) => a.product)).size > 1;
  const fmtArea = (id: string): string => (showProduct ? id : id.split('/').pop() ?? id);
  const relation = coveringRelation(effectiveRels, docA, docB, area);
  const overlap = data.corpus.areas
    .find((ar) => ar.id === area)
    ?.overlaps.find(
      (o) => (o.docs[0] === docA && o.docs[1] === docB) || (o.docs[0] === docB && o.docs[1] === docA),
    );
  const note = overlap?.note;
  const sectionsFor = (d: string): string[] => (overlap?.sections ?? []).filter((s) => s.doc === d).map((s) => s.heading);

  // On open (or when the overlap changes), scroll each pane to its first
  // conflicting section so the disagreement is in view immediately.
  useEffect(() => {
    const a = sectionsFor(docA)[0];
    const b = sectionsFor(docB)[0];
    if (a) setScrollA({ heading: a, nonce: 1 });
    if (b) setScrollB({ heading: b, nonce: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docA, docB, area]);

  const lastTouched = new Map(data.corpus.docs.map((d) => [d.ref, d.lastTouched] as const));
  const newerDoc = (lastTouched.get(docB) ?? '') >= (lastTouched.get(docA) ?? '') ? docB : docA;
  const olderDoc = newerDoc === docA ? docB : docA;

  // One flat set of buttons — each is a complete decision (relation type +
  // direction), no separate "authoritative" toggle.
  const actions: { key: string; type: SpecRelationType; winner: string; label: string; hint: string }[] = [
    { key: 'replace-newer', type: 'replace', winner: newerDoc, label: 'Use newer only', hint: `${base(newerDoc)} replaces ${base(olderDoc)} — ${base(olderDoc)} is dropped from generation.` },
    { key: 'replace-older', type: 'replace', winner: olderDoc, label: 'Use older only', hint: `${base(olderDoc)} replaces ${base(newerDoc)} — ${base(newerDoc)} is dropped from generation.` },
    { key: 'prefer-newer', type: 'precedence', winner: newerDoc, label: 'Prefer newer', hint: `Both feed generation, but ${base(newerDoc)} wins where they overlap.` },
    { key: 'prefer-older', type: 'precedence', winner: olderDoc, label: 'Prefer older', hint: `Both feed generation, but ${base(olderDoc)} wins where they overlap.` },
    { key: 'keep-both', type: 'keep-both', winner: newerDoc, label: 'Keep both', hint: 'Both are current peers — combine them.' },
  ];

  const resolve = async (a: (typeof actions)[number]): Promise<void> => {
    setBusy(a.key);
    try {
      const loser = a.winner === docA ? docB : docA;
      await api.postSpecRelation(repoId, { type: a.type, older: loser, newer: a.winner, scope: area, detectedFrom: 'manual' });
      setEditing(false);
      onResolved();
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (): Promise<void> => {
    if (!userRel) return;
    setBusy('revoke');
    try {
      await api.deleteSpecRelation(repoId, { older: userRel.older, newer: userRel.newer, scope: userRel.scope });
      setEditing(false);
      onResolved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{base(docA)}</span>
          <span className="text-muted-foreground">↔</span>
          <span>{base(docB)}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtArea(area)}</span>
        </div>
        {note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note}</p>}
        {relation && !editing ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              Resolved → {base(relation.older)} {RESOLVED_VERB[relation.type]} {base(relation.newer)}
            </span>
            <button type="button" onClick={() => setEditing(true)} className="text-muted-foreground underline hover:text-foreground">
              Change
            </button>
            {userRel && (
              <button type="button" onClick={revoke} disabled={busy !== null} className="text-muted-foreground underline hover:text-foreground">
                {busy === 'revoke' ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {actions.map((a) => (
              <Button key={a.key} size="sm" variant="outline" disabled={busy !== null} title={a.hint} onClick={() => resolve(a)}>
                {busy === a.key ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                {a.label}
              </Button>
            ))}
            {editing && relation && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 divide-x divide-border">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <SpecDocViewer repoId={repoId} docRef={docA} badge={docA === newerDoc ? 'Newer' : 'Older'} scrollTo={scrollA} highlight={sectionsFor(docA)} />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <SpecDocViewer repoId={repoId} docRef={docB} badge={docB === newerDoc ? 'Newer' : 'Older'} scrollTo={scrollB} highlight={sectionsFor(docB)} />
        </div>
      </div>
    </div>
  );
}
