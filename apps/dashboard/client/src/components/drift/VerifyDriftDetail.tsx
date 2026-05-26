/**
 * Right-pane viewer for a single drift item. Shows the artifact
 * reference, severity, message, file/line provenance, and the
 * spec-side vs code-side payloads when the verifier captured them.
 */

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ContractDrift, DriftSeverity } from '@/lib/api';

interface VerifyDriftDetailProps {
  drift: ContractDrift;
  onClose?: () => void;
  onOpenFile?: (path: string, line?: number) => void;
}

const SEVERITY_TONE: Record<DriftSeverity, string> = {
  critical: 'bg-red-500/20 text-red-700 dark:text-red-300 border-red-500/40',
  high: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  low: 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/20',
  info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
};

export function VerifyDriftDetail({ drift, onClose, onOpenFile }: VerifyDriftDetailProps) {
  const artifact = drift.artifactRef
    ? `${drift.artifactRef.kind}:${drift.artifactRef.identity}`
    : null;
  const tone = SEVERITY_TONE[drift.severity];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-6 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
          >
            {drift.severity}
          </span>
          <h2 className="truncate font-mono text-sm">{drift.obligationKey}</h2>
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} title="Close drift">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {artifact && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Artifact
              </div>
              <div className="font-mono text-sm text-foreground">{artifact}</div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              What's wrong
            </div>
            <p className="text-sm leading-relaxed text-foreground">{drift.message}</p>
          </div>

          {drift.filePath && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Where in the code
              </div>
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
            </div>
          )}

          {drift.specSide !== undefined && drift.specSide !== null && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Spec expectation
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                {JSON.stringify(drift.specSide, null, 2)}
              </pre>
            </div>
          )}

          {drift.codeSide !== undefined && drift.codeSide !== null && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Code observation
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/20 p-3 font-mono text-[11px] text-foreground">
                {JSON.stringify(drift.codeSide, null, 2)}
              </pre>
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
