
import { Copy, Check, ChevronDown, ChevronUp, Crosshair, FileCode, BellOff, MoreVertical } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { setRuleEnabled, type ViolationResponse } from '@/lib/api';
import { useEdition } from '@/contexts/CapabilityContext';

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
  /** When set, enables the "Disable rule" action which calls the rules API for this repo. */
  repoId?: string;
  /** Called after a successful disable so the panel can hide same-rule violations. */
  onRuleDisabled?: (ruleKey: string) => void;
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

export function ViolationCard({ violation, onLocateNode, onOpenFile, isResolved, diffStatus, repoId, onRuleDisabled }: ViolationCardProps) {
  const [copied, setCopied] = useState(false);
  const [showFix, setShowFix] = useState(false);
  const [disablingRule, setDisablingRule] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpen]);

  const handleCopyFix = async () => {
    if (!violation.fixPrompt) return;
    await navigator.clipboard.writeText(violation.fixPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ruleKey = violation.ruleKey;
  const canDisableRule = !!repoId && !!ruleKey && !isResolved && diffStatus !== 'resolved';

  const handleDisableRule = async () => {
    if (!repoId || !ruleKey) return;
    setMenuOpen(false);
    setDisablingRule(true);
    try {
      await setRuleEnabled(repoId, ruleKey, false);
      onRuleDisabled?.(ruleKey);
    } catch {
      setDisablingRule(false);
    }
  };

  const isCodeViolation = violation.type === 'code';
  // Hosted (EE) has no architecture graph, so every violation with a file links
  // straight to the code on GitHub — there's no "Locate in graph" to fall back to.
  const hosted = useEdition() === 'enterprise';

  // Most specific target: method > module > database > service
  const locateTargetId = violation.targetMethodId || violation.targetModuleId || violation.targetDatabaseId || violation.targetServiceId;
  const locateTargetName = violation.targetMethodName || violation.targetModuleName || violation.targetDatabaseName || violation.targetServiceName;
  const locateDepth = violation.targetMethodId ? 'methods'
    : violation.targetModuleId ? 'modules'
    : undefined;

  return (
    <Card
      className={`rounded-sm p-3 ${isResolved ? 'opacity-60' : ''}`}
    >
      <CardContent className="p-0">
        <div className="mb-1.5 flex items-center gap-2">
          {/* No new/resolved pill — in a diff the severity badges still carry
              severity, "added" is the default, and resolved rows are struck
              through (see `isResolved` below). */}
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
          <div className="ml-auto flex items-center gap-1">
            {/* Open the code for any violation with a file — always in hosted (no
                graph), or for code violations in OSS. Otherwise OSS arch violations
                fall back to a "Locate in graph" jump. */}
            {(isCodeViolation || hosted) && violation.filePath && onOpenFile ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onOpenFile(violation.filePath!, true, violation.lineStart)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                title={`Open ${violation.filePath}:${violation.lineStart}`}
              >
                <FileCode className="h-3 w-3" />
                Open
              </Button>
            ) : !hosted && onLocateNode && locateTargetId ? (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onLocateNode(locateTargetId, locateDepth, {
                  serviceId: violation.targetServiceId ?? null,
                  moduleId: violation.targetModuleId ?? null,
                })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
                title={`Locate ${locateTargetName || 'target'} in graph`}
              >
                <Crosshair className="h-3 w-3" />
                Locate
              </Button>
            ) : null}
            {canDisableRule && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  disabled={disablingRule}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="More actions"
                  title="More actions"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleDisableRule}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">Disable rule for this repo</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{ruleKey}</span>
                        <span className="mt-0.5 text-[10px] text-muted-foreground">
                          Hides every violation from this rule. Re-enable from the Rules panel.
                        </span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
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
