/**
 * Collapsible list of docs the LLM relevance filter excluded from
 * claim extraction. Each entry shows the path + the LLM's short
 * reason; a per-row "Include" button writes a manualIncludes override
 * to decisions.json and re-scans, bringing the doc back into the
 * corpus.
 *
 * Hidden when there are no skipped docs. Collapsed by default — most
 * of the time the user trusts the filter; expanding is the safety
 * valve when they suspect a real spec doc got dropped.
 */

import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpec } from './SpecContext';

export function SpecSkippedDocs() {
  const { scan, includeDoc, loading } = useSpec();
  const [expanded, setExpanded] = useState(false);
  const skipped = scan?.skippedDocs ?? [];
  if (skipped.length === 0) return null;
  return (
    <div className="border-b border-border bg-card/30">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>Skipped docs · {skipped.length}</span>
        <span className="ml-auto normal-case tracking-normal text-[10px] text-muted-foreground/70">
          {expanded ? 'Click an entry to include' : 'LLM judged not spec-source'}
        </span>
      </button>
      {expanded && (
        <ul className="max-h-[40vh] overflow-y-auto border-t border-border/40">
          {skipped.map((entry) => (
            <li
              key={entry.path}
              className="flex items-start gap-2 border-b border-border/30 px-3 py-1.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs text-foreground" title={entry.path}>
                  {entry.path}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {entry.reason || '(no reason provided)'}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => includeDoc(entry.path)}
                title={`Force-include ${entry.path} and re-scan`}
                className="shrink-0"
              >
                <Plus className="mr-1 h-3 w-3" />
                Include
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
