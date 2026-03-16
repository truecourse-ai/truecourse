'use client';

import { Copy, Check, ChevronDown, ChevronUp, Crosshair } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { InsightResponse } from '@/lib/api';

type InsightCardProps = {
  insight: InsightResponse;
  onLocateNode?: (nodeId: string, requiredDepth?: string) => void;
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

export function InsightCard({ insight, onLocateNode, isResolved, diffStatus }: InsightCardProps) {
  const [copied, setCopied] = useState(false);
  const [showFix, setShowFix] = useState(false);

  const handleCopyFix = async () => {
    if (!insight.fixPrompt) return;
    await navigator.clipboard.writeText(insight.fixPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Most specific target: method > module > database > service
  const locateTargetId = insight.targetMethodId || insight.targetModuleId || insight.targetDatabaseId || insight.targetServiceId;
  const locateTargetName = insight.targetMethodName || insight.targetModuleName || insight.targetDatabaseName || insight.targetServiceName;
  const locateDepth = insight.targetMethodId ? 'methods'
    : insight.targetModuleId ? 'modules'
    : undefined;

  return (
    <Card
      className={`border-l-4 rounded-sm p-3 ${
        severityColors[insight.severity] || 'border-l-gray-500'
      }`}
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
              severityBadgeColors[insight.severity] || ''
            }`}
          >
            {insight.type}
          </Badge>
          <Badge
            className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
              severityBadgeColors[insight.severity] || ''
            }`}
          >
            {insight.severity}
          </Badge>
          {onLocateNode && locateTargetId && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => onLocateNode(locateTargetId, locateDepth)}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
              title={`Locate ${locateTargetName || 'target'} in graph`}
            >
              <Crosshair className="h-3 w-3" />
              Locate
            </Button>
          )}
        </div>

        <h4 className={`text-sm font-bold ${isResolved ? 'line-through opacity-60 text-muted-foreground' : 'text-foreground'}`}>
          {insight.title}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {insight.content}
        </p>

        {(insight.targetServiceName || insight.targetDatabaseName) && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Target:{' '}
            <span className="font-medium text-foreground">
              {insight.targetServiceName || insight.targetDatabaseName}
            </span>
            {insight.targetModuleName && (
              <>
                {' / '}
                <span className="font-medium text-foreground">
                  {insight.targetModuleName}
                </span>
              </>
            )}
            {insight.targetMethodName && (
              <>
                {' / '}
                <span className="font-medium text-foreground">
                  {insight.targetMethodName}
                </span>
              </>
            )}
          </p>
        )}

        {insight.fixPrompt && !isResolved && (
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
                {insight.fixPrompt}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
