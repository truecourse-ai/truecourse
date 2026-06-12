/**
 * Right-pane viewer for a single canonical section. A "section" is a
 * `(module, topic)` slice of `claims.json` — endpoints, auth, errors,
 * etc. The viewer fetches the structured claims for that section and
 * renders them as a deterministic markdown view on the client.
 *
 * The "path" string is `<module>/<topic>` for tab plumbing parity with
 * the old file-based canonical viewer. Each claim is rendered with its
 * subject + structured content + provenance.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import type { CanonicalSpecSection, SpecClaim } from '@/lib/api';
import { FileBreadcrumb } from '@/components/code/FileBreadcrumb';
import { useSpec } from './SpecContext';

interface SpecCanonicalFileProps {
  /** `<module>/<topic>` identifier. */
  filePath: string;
}

export function SpecCanonicalFile({ filePath }: SpecCanonicalFileProps) {
  const [section, setSection] = useState<CanonicalSpecSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { canonicalVersion, loadCanonicalSection } = useSpec();

  const [moduleName, topic] = splitPath(filePath);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSection(null);
    if (!moduleName || !topic) {
      setError('Invalid section path.');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    loadCanonicalSection(moduleName, topic)
      .then((s) => {
        if (!cancelled) setSection(s);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadCanonicalSection, moduleName, topic, canonicalVersion]);

  return (
    <div className="flex h-full flex-col bg-background">
      <FileBreadcrumb filePath={filePath} />
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span>{error}</span>
          </div>
        ) : section ? (
          <SectionView section={section} />
        ) : null}
      </div>
    </div>
  );
}

function SectionView({ section }: { section: CanonicalSpecSection }) {
  const manifest = section.manifest;
  const status = typeof manifest.status === 'string' ? (manifest.status as string) : null;
  const description = typeof manifest.description === 'string' ? (manifest.description as string) : null;
  return (
    <div className="text-sm text-foreground">
      <h1 className="mb-2 text-xl font-bold">
        {section.module} — {section.topic}
      </h1>
      <div className="mb-4 text-xs text-muted-foreground">
        {status && <span className="mr-3">status: {status}</span>}
        <span>{section.claims.length} claim{section.claims.length === 1 ? '' : 's'}</span>
      </div>
      {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
      {section.claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">No claims in this section.</p>
      ) : (
        section.claims.map((c) => <ClaimCard key={c.id} claim={c} />)
      )}
    </div>
  );
}

function ClaimCard({ claim }: { claim: SpecClaim }) {
  const { docLabel } = useSpec();
  const label = docLabel(claim.provenance.file);
  return (
    <div className="mb-4 rounded border border-border bg-card/40 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-sm font-semibold">{claim.subject}</span>
        {claim.metadata.status && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {claim.metadata.status}
          </span>
        )}
        {claim.kind === 'constraint' && (
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-sky-600 dark:text-sky-300">
            constraint
          </span>
        )}
        {claim.layer === 'workspace' && (
          <span
            className="ml-auto rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary"
            title="Inherited from workspace Knowledge — shared by every repo"
          >
            workspace
          </span>
        )}
      </div>
      <pre className="my-2 overflow-auto rounded border border-border/60 bg-muted/30 p-2 font-mono text-[11px] text-foreground">
        {JSON.stringify(claim.content, null, 2)}
      </pre>
      <div className="text-[11px] text-muted-foreground">
        Source:{' '}
        {label ? (
          label.url ? (
            <a
              href={label.url}
              target="_blank"
              rel="noreferrer"
              className="text-foreground hover:text-primary hover:underline"
            >
              {label.title}
            </a>
          ) : (
            <span className="text-foreground">{label.title}</span>
          )
        ) : (
          <span className="font-mono">
            {claim.provenance.file}:{claim.provenance.line}
          </span>
        )}
      </div>
    </div>
  );
}

function splitPath(p: string): [string, string] {
  const idx = p.indexOf('/');
  if (idx === -1) return [p, ''];
  return [p.slice(0, idx), p.slice(idx + 1)];
}
