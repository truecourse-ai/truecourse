/**
 * Corpus: the version row (the baseline or a pull request's version, see
 * ./CoverageVersions.tsx), then a flat table of the corpus: every kept document
 * and every conflict, the way Repositories lists repositories. A row opens the
 * document or the conflict as its own page (`/corpus/doc/:ref`,
 * `/corpus/conflict/:id`, see ./CorpusPage.tsx). Search by title or path; Type,
 * Status and Area are the filters. On a pull request's version each row carries
 * what that version changed against its parent.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildCorpusConflicts } from '@/preview/vendor/shared';
import { SpecSourceProvider } from '@/components/spec/spec-source';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { useSpecCorpus } from '@/preview/vendor/components/spec/SpecCorpusView';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { StatusWord, TEST_TONE, TEST_WORD } from '@/preview/ui/status-word';
import { createPreviewSpecSource } from '@/preview/data/fake-api';
import { docsAtVersion, type SpecDoc } from '@/preview/data/corpus';
import type { Repo, TestStatus } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { CoverageVersionPicker, useCoverageVersion } from './CoverageVersions';

/** A document's status: the worst of its sections, in the order the board ranks them. */
const RANK: TestStatus[] = ['failing', 'blocked', 'not-testable', 'never-run', 'passing'];
function docStatus(doc: SpecDoc | undefined): TestStatus {
  if (!doc) return 'never-run';
  for (const status of RANK) if (doc.sections.some((s) => s.status === status)) return status;
  return 'passing';
}

type Row =
  | { kind: 'doc'; id: string; ref: string; title: string; area: string; status: TestStatus; sections: number; claims: number; touched: string; change?: string; web: boolean }
  | { kind: 'conflict'; id: string; title: string; area: string; resolved: boolean; change?: string };

function ChangeMark({ change }: { change: string | undefined }) {
  if (!change) return null;
  const dot =
    change === 'added' || change === 'resolved' ? 'bg-emerald-500' : change === 'removed' ? 'bg-red-500' : 'bg-sky-500';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {change}
    </span>
  );
}

function CorpusBody({ repo, versions }: { repo: Repo; versions: ReturnType<typeof useCoverageVersion> }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const corpus = useSpecCorpus(repo.id, true);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);

  const version = corpus.data?.version;
  const docsHere = useMemo(() => docsAtVersion(repo.id, versions.version), [repo.id, versions.version]);

  const rows = useMemo<Row[]>(() => {
    const data = corpus.data;
    if (!data) return [];
    const areaOf = (tag: string) => tag.split('/').pop() ?? tag;
    const docs: Row[] = data.corpus.docs.map((d) => {
      const doc = docsHere.find((x) => x.path === d.ref);
      return {
        kind: 'doc',
        id: d.ref,
        ref: d.ref,
        title: doc?.title ?? d.ref.split('/').pop() ?? d.ref,
        area: areaOf(d.areaTags[0] ?? ''),
        status: docStatus(doc),
        sections: doc?.sections.length ?? 0,
        claims: doc?.sections.reduce((n, s) => n + s.claims, 0) ?? 0,
        touched: formatRelativeTime(d.lastTouched),
        change: version?.docChanges[d.ref]?.change,
        web: d.origin === 'web',
      };
    });
    const conflicts: Row[] = buildCorpusConflicts(data.corpus, {
      manualExcludes: data.manualExcludes ?? [],
      conflictResolutions: data.conflictResolutions ?? [],
    }).map((cf) => ({
      kind: 'conflict',
      id: cf.id,
      title: cf.note || `${cf.a} and ${cf.b}`,
      area: areaOf(cf.area),
      resolved: cf.resolved,
      change:
        version?.conflictChanges[`overlap::${cf.area}::${cf.a}::${cf.b}`] ??
        version?.conflictChanges[`overlap::${cf.area}::${cf.b}::${cf.a}`],
    }));
    return [...conflicts, ...docs];
  }, [corpus.data, docsHere, version]);

  const typeOptions = useMemo(
    () =>
      [
        { key: 'doc', label: 'Documents', count: rows.filter((r) => r.kind === 'doc').length },
        { key: 'conflict', label: 'Conflicts', count: rows.filter((r) => r.kind === 'conflict').length },
      ].filter((o) => o.count > 0),
    [rows],
  );
  const statusOptions = useMemo(
    () =>
      RANK.map((key) => ({
        key,
        label: TEST_WORD[key],
        count: rows.filter((r) => r.kind === 'doc' && r.status === key).length,
      })).filter((o) => o.count > 0),
    [rows],
  );
  const areaOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: key, count }));
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!q || r.title.toLowerCase().includes(q) || (r.kind === 'doc' && r.ref.toLowerCase().includes(q))) &&
        (typeFilter.length === 0 || typeFilter.includes(r.kind)) &&
        (statusFilter.length === 0 || (r.kind === 'doc' && statusFilter.includes(r.status))) &&
        (areaFilter.length === 0 || areaFilter.includes(r.area)),
    );
  }, [rows, query, typeFilter, statusFilter, areaFilter]);

  const openRow = (r: Row) =>
    navigate(
      r.kind === 'doc'
        ? `/preview/repos/${repo.id}/corpus/doc/${encodeURIComponent(r.ref)}${versions.version && versions.version.parentId ? `?version=${encodeURIComponent(versions.version.id)}` : ''}`
        : `/preview/repos/${repo.id}/corpus/conflict/${encodeURIComponent(r.id)}${versions.version && versions.version.parentId ? `?version=${encodeURIComponent(versions.version.id)}` : ''}`,
    );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Corpus"
        subtitle={shown.length === rows.length ? `${rows.length}` : `${shown.length} of ${rows.length}`}
      />
      <CoverageVersionPicker repo={repo} versions={versions.versions} version={versions.version} onSelect={versions.select} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border bg-card px-6 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the corpus"
            placeholder="Search documents and conflicts"
            className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
            <FilterBar label="Type" ariaLabel="Filter by type" options={typeOptions} selected={typeFilter} onChange={setTypeFilter} />
            <FilterBar label="Status" ariaLabel="Filter documents by status" options={statusOptions} selected={statusFilter} onChange={setStatusFilter} multi />
            <FilterBar label="Area" ariaLabel="Filter by area" options={areaOptions} selected={areaFilter} onChange={setAreaFilter} multi />
          </div>
        </div>
        <table className="w-full border-collapse text-[13px]" aria-label="Spec corpus">
          <thead className="bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Document</th>
              <th className="px-3 py-2 text-left font-semibold">Area</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Sections</th>
              <th className="px-3 py-2 text-right font-semibold">Claims</th>
              <th className="px-3 py-2 text-left font-semibold">Change</th>
              <th className="px-6 py-2 text-left font-semibold">Touched</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={() => openRow(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openRow(r);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <td className="px-6 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-foreground">{r.title}</span>
                    {r.kind === 'conflict' && <span className={CHIP_CLASS}>conflict</span>}
                    {r.kind === 'doc' && r.web && <span className={CHIP_CLASS}>site</span>}
                  </span>
                  {r.kind === 'doc' && (
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{r.ref}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{r.area}</span>
                </td>
                <td className="px-3 py-2.5">
                  {r.kind === 'doc' ? (
                    <StatusWord tone={TEST_TONE[r.status]} word={TEST_WORD[r.status]} />
                  ) : (
                    <StatusWord tone={r.resolved ? 'success' : 'blocked'} word={r.resolved ? 'Resolved' : 'Open'} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{r.kind === 'doc' ? r.sections : ''}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{r.kind === 'doc' ? r.claims : ''}</td>
                <td className="px-3 py-2.5">
                  <ChangeMark change={r.change} />
                </td>
                <td className="px-6 py-2.5 text-muted-foreground">{r.kind === 'doc' ? r.touched : ''}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                  {corpus.hydrating ? 'Loading the corpus.' : 'Nothing matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CorpusTab({ repo }: { repo: Repo }) {
  const versions = useCoverageVersion(repo.id);
  const versionId = versions.version?.id ?? null;
  const source = useMemo(() => createPreviewSpecSource(repo.id, versionId), [repo.id, versionId]);
  return (
    <SpecSourceProvider source={source}>
      <CorpusBody repo={repo} versions={versions} />
    </SpecSourceProvider>
  );
}
