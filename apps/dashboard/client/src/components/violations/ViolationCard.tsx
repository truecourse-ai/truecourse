
import { Copy, Check, ChevronDown, ChevronUp, Crosshair, FileCode } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ViolationResponse } from '@/lib/api';

/**
 * Render a violation string that uses markdown-style backticks around code
 * identifiers (the convention used by both deterministic rules and LLM
 * prompts). Backtick-wrapped spans become inline <code> elements; everything
 * else stays as plain text. We intentionally don't support any other markdown
 * (bold, links, lists) — violation text is short and only ever uses backticks.
 */
function renderInlineCode(text: string | null | undefined): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type ViolationCardProps = {
  violation: ViolationResponse;
  onLocateNode?: (nodeId: string, requiredDepth?: string, hints?: { serviceId?: string | null; moduleId?: string | null }) => void;
  onOpenFile?: (path: string, pinned: boolean, scrollToLine?: number) => void;
  isResolved?: boolean;
  diffStatus?: 'new' | 'resolved';
};

const severityColors: Record<string, string> = {
  info: 'border-l-blue-500',
  low: 'border-l-amber-500',
  medium: 'border-l-orange-500',
  high: 'border-l-red-500',
  critical: 'border-l-red-600',
};

const severityBadgeColors: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  low: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  medium: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  high: 'bg-red-500/10 text-red-600 dark:text-red-400',
  critical: 'bg-red-600/10 text-red-700 dark:text-red-500',
};

export function ViolationCard({ violation, onLocateNode, onOpenFile, isResolved, diffStatus }: ViolationCardProps) {
  const [copied, setCopied] = useState(false);
  const [showFix, setShowFix] = useState(false);

  const handleCopyFix = async () => {
    if (!violation.fixPrompt) return;
    await navigator.clipboard.writeText(violation.fixPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isCodeViolation = violation.type === 'code';

  // Most specific target: method > module > database > service
  const locateTargetId = violation.targetMethodId || violation.targetModuleId || violation.targetDatabaseId || violation.targetServiceId;
  const locateTargetName = violation.targetMethodName || violation.targetModuleName || violation.targetDatabaseName || violation.targetServiceName;
  const locateDepth = violation.targetMethodId ? 'methods'
    : violation.targetModuleId ? 'modules'
    : undefined;

  return (
    <Card
      className="rounded-sm p-3"
    >
      <CardContent className="p-0">
        <div className="mb-1.5 flex items-center gap-2">
          {diffStatus && (
            <Badge className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${
              diffStatus === 'new'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
            }`}>
              {diffStatus}
            </Badge>
          )}
          <Badge
            className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold uppercase ${
              severityBadgeColors[violation.severity] || ''
            }`}
          >
            {violation.type}
          </Badge>
          <Badge
            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
              severityBadgeColors[violation.severity] || ''
            }`}
          >
            {violation.severity}
          </Badge>
          {/* Locate button: open file for code violations, focus graph node for arch violations */}
          {isCodeViolation && violation.filePath && onOpenFile ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onOpenFile(violation.filePath!, true, violation.lineStart)}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
              title={`Open ${violation.filePath}:${violation.lineStart}`}
            >
              <FileCode className="h-3 w-3" />
              Open
            </Button>
          ) : onLocateNode && locateTargetId ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onLocateNode(locateTargetId, locateDepth, {
                serviceId: violation.targetServiceId ?? null,
                moduleId: violation.targetModuleId ?? null,
              })}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
              title={`Locate ${locateTargetName || 'target'} in graph`}
            >
              <Crosshair className="h-3 w-3" />
              Locate
            </Button>
          ) : null}
        </div>

        <h4 className={`text-sm font-bold ${isResolved ? 'line-through opacity-60 text-muted-foreground' : 'text-foreground'}`}>
          {renderInlineCode(violation.title)}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {renderInlineCode(violation.content)}
        </p>

        {/* Code violation: show file path + line */}
        {isCodeViolation && violation.filePath && (
          <p className="mt-2 truncate text-[10px] text-muted-foreground" title={`${violation.filePath}${violation.lineStart ? `:${violation.lineStart}` : ''}`}>
            File:{' '}
            <span className="font-medium text-foreground">
              {violation.filePath}
            </span>
            {violation.lineStart && (
              <span className="text-muted-foreground">:{violation.lineStart}</span>
            )}
          </p>
        )}

        {/* Arch violation: show target service/module/method */}
        {!isCodeViolation && (violation.targetServiceName || violation.targetDatabaseName) && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Target:{' '}
            <span className="font-medium text-foreground">
              {violation.targetServiceName || violation.targetDatabaseName}
            </span>
            {violation.targetModuleName && (
              <>
                {' / '}
                <span className="font-medium text-foreground">
                  {violation.targetModuleName}
                </span>
              </>
            )}
            {violation.targetMethodName && (
              <>
                {' / '}
                <span className="font-medium text-foreground">
                  {violation.targetMethodName}
                </span>
              </>
            )}
          </p>
        )}

        {violation.fixPrompt && !isResolved && (
          <div className="mt-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowFix((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {showFix ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Fix Prompt
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={handleCopyFix}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy Fix
                  </>
                )}
              </Button>
            </div>
            {showFix && (
              <pre className="mt-1.5 rounded-md bg-muted px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                {renderInlineCode(violation.fixPrompt)}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
