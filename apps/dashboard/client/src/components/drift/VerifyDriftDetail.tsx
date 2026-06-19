/**
 * Right-pane viewer for a single drift item. Shows the artifact
 * reference, severity, message, file/line provenance, and the
 * spec-side vs code-side payloads when the verifier captured them.
 *
 * When an LLM transport is configured, the panel fetches an on-demand,
 * cached readable enrichment for the selected drift and renders PROSE for
 * the "Spec expectation" / "Code observation" sections, keeping the
 * structured JSON behind a "Show structured" disclosure. While the
 * enrichment is loading — and whenever it comes back null (no LLM, or the
 * call failed) — the structured snippets render directly, so the panel
 * never blocks and always shows something useful.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DriftTypeBadge, driftType } from './driftType';
import { postDriftEnrich } from '@/lib/api';
import type { ContractDrift, DriftSeverity, EnrichedDrift } from '@/lib/api';

interface VerifyDriftDetailProps {
  drift: ContractDrift;
  /**
   * The repo the drift belongs to. Used to POST the on-demand enrichment.
   * When omitted, the panel renders structured-only (no enrichment fetch).
   */
  repoId?: string;
  onClose?: () => void;
  onOpenFile?: (path: string, line?: number) => void;
  /**
   * Builds a GitHub blob deep-link for the drift's file/line. When provided and
   * it returns a non-null URL, the "Where in the code" location renders as an
   * external link instead of the in-app `onOpenFile` button (used in the EE / PR
   * context, where the local code viewer isn't wired). Returns null for
   * local/OSS repos with no GitHub remote.
   */
  githubFileUrl?: (
    path: string,
    lineStart?: number | null,
    lineEnd?: number | null,
  ) => string | null;
}

const SEVERITY_TONE: Record<DriftSeverity, string> = {
  critical: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  low: 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/20',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
};

export function VerifyDriftDetail({
  drift,
  repoId,
  onClose,
  onOpenFile,
  githubFileUrl,
}: VerifyDriftDetailProps) {
  const identity = drift.artifactRef?.identity ?? null;
  const tone = SEVERITY_TONE[drift.severity];
  const blobUrl = drift.filePath
    ? githubFileUrl?.(drift.filePath, drift.lineStart, drift.lineEnd) ?? null
    : null;

  // On-demand readable enrichment for THIS drift. `null` = none yet / no LLM /
  // failed → fall back to structured. Refetched whenever the selected drift
  // changes; a stale in-flight response for a previous drift is dropped.
  const [enriched, setEnriched] = useState<EnrichedDrift | null>(null);
  const [enriching, setEnriching] = useState(false);
  // The structured JSON is hidden behind a disclosure once prose is shown.
  const [showStructured, setShowStructured] = useState(false);

  useEffect(() => {
    setEnriched(null);
    setShowStructured(false);
    if (!repoId) return;
    let cancelled = false;
    setEnriching(true);
    postDriftEnrich(repoId, {
      artifactRef: drift.artifactRef,
      obligationKey: drift.obligationKey,
      message: drift.message,
      severity: drift.severity,
      specSide: drift.specSide,
      codeSide: drift.codeSide,
      specOrigin: drift.specOrigin,
    })
      .then((res) => {
        if (!cancelled) setEnriched(res);
      })
      .catch(() => {
        // Enrichment is best-effort; on any failure keep the structured view.
        if (!cancelled) setEnriched(null);
      })
      .finally(() => {
        if (!cancelled) setEnriching(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-run when the identity-defining content of the drift changes.
  }, [
    repoId,
    drift.id,
    drift.obligationKey,
    drift.message,
    drift.specSide,
    drift.codeSide,
    drift.artifactRef,
    drift.severity,
    drift.specOrigin,
  ]);

  // Spec-side origin of the requirement (source doc + section). Absent on old
  // snapshots predating the field. The verifier uses `[-1, -1]` to mark an
  // unknown line range — suppress the range in that case.
  const origin = drift.specOrigin ?? null;
  const originHasLines =
    origin != null &&
    Array.isArray(origin.lines) &&
    origin.lines.length === 2 &&
    origin.lines[0] > 0 &&
    origin.lines[1] > 0;
  // Deep-link the spec doc the same way "Where in the code" links the code site:
  // a repo-relative source resolves to its GitHub blob at the verify commit (with
  // the obligation's line anchor); a synced workspace-KB doc carries a server-
  // attached `sourceUrl` (e.g. its Confluence page) and links straight out; a bare
  // URL source links out too. Anything else stays plain text (local/OSS, or no
  // GitHub remote — `githubFileUrl` returns null).
  const originBlobUrl =
    origin != null
      ? githubFileUrl?.(
          origin.source,
          originHasLines ? origin.lines[0] : null,
          originHasLines ? origin.lines[1] : null,
        ) ?? null
      : null;
  const originExternalUrl =
    origin?.sourceUrl ??
    (origin != null && /^https?:\/\//i.test(origin.source) ? origin.source : null);
  const originHref = originBlobUrl ?? originExternalUrl;
  // Friendly label for the source (workspace doc title), falling back to the path.
  const originText = origin?.sourceLabel ?? origin?.source ?? '';
  // The slicer's synthetic line range is meaningless for an external doc — only
  // show "(lines …)" for an in-repo source we actually deep-link by line.
  const showOriginLines = originHasLines && !originExternalUrl;

  const hasSpecSide = drift.specSide !== undefined && drift.specSide !== null;
  const hasCodeSide = drift.codeSide !== undefined && drift.codeSide !== null;
  const hasStructured = hasSpecSide || hasCodeSide;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
          >
            {drift.severity}
          </span>
          <DriftTypeBadge kind={driftType(drift)} />
          <h2 className="truncate font-mono text-sm">{drift.obligationKey}</h2>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} title="Close drift">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="space-y-4">
          {identity && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Artifact
              </div>
              <div className="font-mono text-sm text-foreground">{identity}</div>
            </div>
          )}

          {origin && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Source
              </div>
              <div className="font-mono text-sm text-foreground break-all">
                {originHref ? (
                  <a
                    href={originHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline"
                  >
                    <span className="break-all">{originText}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  originText
                )}
                {origin.section && <span className="text-muted-foreground"> § {origin.section}</span>}
                {showOriginLines && (
                  <span className="text-muted-foreground">
                    {' '}
                    (lines {origin.lines[0]}
                    {origin.lines[1] !== origin.lines[0] && `–${origin.lines[1]}`})
                  </span>
                )}
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              What's wrong
            </div>
            {/* The readable summary leads when present; the terse structured
                `message` stays the AI/query anchor and renders otherwise. */}
            <p className="text-sm leading-relaxed text-foreground">
              {enriched ? enriched.summary : drift.message}
            </p>
            {enriched && (
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {drift.message}
              </p>
            )}
          </div>

          {drift.filePath && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Where in the code
              </div>
              {blobUrl ? (
                <a
                  href={blobUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 break-all font-mono text-xs text-primary hover:underline"
                >
                  <span className="break-all">
                    {drift.filePath}
                    {drift.lineStart != null && `:${drift.lineStart}`}
                    {drift.lineEnd != null && drift.lineEnd !== drift.lineStart && `–${drift.lineEnd}`}
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => drift.filePath && onOpenFile?.(drift.filePath, drift.lineStart ?? undefined)}
                  disabled={!onOpenFile}
                  className="block w-full break-all text-left font-mono text-xs text-primary hover:underline disabled:cursor-default disabled:no-underline disabled:text-foreground"
                >
                  {drift.filePath}
                  {drift.lineStart != null && `:${drift.lineStart}`}
                  {drift.lineEnd != null && drift.lineEnd !== drift.lineStart && `–${drift.lineEnd}`}
                </button>
              )}
            </div>
          )}

          {/* Spec expectation — prose when enriched, structured JSON otherwise. */}
          {(hasSpecSide || enriched) && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Spec expectation
              </div>
              {enriched ? (
                <p className="text-sm leading-relaxed text-foreground">{enriched.specReadable}</p>
              ) : (
                hasSpecSide && (
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                    {JSON.stringify(drift.specSide, null, 2)}
                  </pre>
                )
              )}
            </div>
          )}

          {/* Code observation — prose when enriched, structured JSON otherwise. */}
          {(hasCodeSide || enriched) && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Code observation
              </div>
              {enriched ? (
                <p className="text-sm leading-relaxed text-foreground">{enriched.codeReadable}</p>
              ) : (
                hasCodeSide && (
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                    {JSON.stringify(drift.codeSide, null, 2)}
                  </pre>
                )
              )}
            </div>
          )}

          {/* When prose is shown, keep the structured JSON available behind a
              disclosure so the precise anchor is one click away. */}
          {enriched && hasStructured && (
            <div>
              <button
                type="button"
                onClick={() => setShowStructured((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                {showStructured ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Show structured
              </button>
              {showStructured && (
                <div className="mt-2 space-y-3">
                  {hasSpecSide && (
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Spec side
                      </div>
                      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                        {JSON.stringify(drift.specSide, null, 2)}
                      </pre>
                    </div>
                  )}
                  {hasCodeSide && (
                    <div>
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Code side
                      </div>
                      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                        {JSON.stringify(drift.codeSide, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {enriching && !enriched && (
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Generating readable summary…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VerifyEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <p>Select a drift from the list to inspect it.</p>
    </div>
  );
}
