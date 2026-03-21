import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { CodeViewer } from './CodeViewer';
import * as api from '@/lib/api';
import type { CodeViolationResponse } from '@/lib/api';

type CodeViewerPanelProps = {
  repoId: string;
  filePath: string;
  analysisId?: string;
  scrollToLine?: number;
  isDiffMode?: boolean;
  onClose: () => void;
};

export function CodeViewerPanel({
  repoId,
  filePath,
  analysisId,
  scrollToLine,
  isDiffMode,
  onClose,
}: CodeViewerPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState('text');
  const [violations, setViolations] = useState<CodeViolationResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      api.getFileContent(repoId, filePath, isDiffMode ? 'working-tree' : undefined),
      api.getCodeViolations(repoId, filePath, analysisId),
    ])
      .then(([fileData, violationData]) => {
        if (cancelled) return;
        setContent(fileData.content);
        setLanguage(fileData.language);
        setViolations(violationData);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [repoId, filePath, analysisId, isDiffMode]);

  const pathParts = filePath.split('/');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex flex-1 items-center gap-1 overflow-hidden text-sm">
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground">/</span>}
              <span className={i === pathParts.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {part}
              </span>
            </span>
          ))}
        </div>
        {violations.length > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {violations.length} issue{violations.length !== 1 ? 's' : ''}
          </span>
        )}
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <CodeViewer
            content={content || ''}
            language={language}
            violations={violations}
            scrollToLine={scrollToLine}
          />
        </div>
      )}
    </div>
  );
}
