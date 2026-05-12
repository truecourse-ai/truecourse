/**
 * Right-pane viewer for a single IL contract file (.tc). Reuses the
 * Code Analysis `CodeViewer` component verbatim — same gutter, theme,
 * fonts, dark-mode handling — so the BL Drift contracts viewer and
 * the file viewer are visually identical.
 *
 * `.tc` files have no CodeMirror grammar (the format is bespoke); the
 * picker in CodeViewer returns `null` for unknown extensions, so the
 * editor renders the content as plain text. Syntax-coloring parity
 * with VS Code would require a CodeMirror language for `.tc` (which
 * doesn't exist) — deferred for now in exchange for shared chrome.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import * as api from '@/lib/api';
import { CodeViewer } from '@/components/code/CodeViewer';
import { useSpec } from '@/components/spec/SpecContext';

interface ContractsFileProps {
  repoId: string;
  filePath: string;
}

function FileBreadcrumb({ filePath }: { filePath: string }) {
  const parts = filePath.split('/');
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
      <div className="flex flex-1 items-center gap-1 overflow-hidden text-sm">
        {parts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <span
              className={
                i === parts.length - 1
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }
            >
              {part}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ContractsFile({ repoId, filePath }: ContractsFileProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { canonicalVersion } = useSpec();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    api
      .getContractsFile(repoId, filePath)
      .then((f) => {
        if (!cancelled) setContent(f.content);
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
  }, [repoId, filePath, canonicalVersion]);

  return (
    <div className="flex h-full flex-col">
      <FileBreadcrumb filePath={filePath} />
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <CodeViewer
            content={content ?? ''}
            language="tc"
            filePath={filePath}
            violations={[]}
          />
        </div>
      )}
    </div>
  );
}
