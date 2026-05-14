/**
 * Right-pane viewer for a single canonical spec file.
 * `.md` files render as markdown; `.yaml` (and anything else) renders
 * as a syntax-flat code block.
 */

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import * as api from '@/lib/api';
import { FileBreadcrumb } from '@/components/code/FileBreadcrumb';
import { useSpec } from './SpecContext';

interface SpecCanonicalFileProps {
  repoId: string;
  filePath: string;
}

export function SpecCanonicalFile({ repoId, filePath }: SpecCanonicalFileProps) {
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
      .getSpecCanonicalFile(repoId, filePath)
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

  const isMarkdown = filePath.endsWith('.md');

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
        ) : content == null ? null : isMarkdown ? (
          <div className="mx-auto max-w-4xl text-sm text-foreground">
            <FileMarkdown source={content} />
          </div>
        ) : (
          <pre className="mx-auto max-w-4xl overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-xs text-muted-foreground">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

function FileMarkdown({ source }: { source: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h1 className="mb-3 mt-2 text-xl font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-lg font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold">{children}</h3>,
        h4: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold">{children}</h4>,
        p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
        li: ({ children }) => <li className="mb-1">{children}</li>,
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>
        ),
        pre: ({ children }) => (
          <pre className="my-3 overflow-auto rounded border border-border bg-muted/40 p-3 font-mono text-xs">{children}</pre>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 border-l-2 border-border pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-auto rounded border border-border">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-border bg-muted/40 px-2 py-1 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-border/60 px-2 py-1">{children}</td>,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
