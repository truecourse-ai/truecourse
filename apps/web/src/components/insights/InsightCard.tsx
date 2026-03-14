'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { InsightResponse } from '@/lib/api';

type InsightCardProps = {
  insight: InsightResponse;
};

const severityColors: Record<string, string> = {
  info: 'border-l-blue-500',
  low: 'border-l-green-500',
  medium: 'border-l-yellow-500',
  high: 'border-l-orange-500',
  critical: 'border-l-red-500',
};

const severityBadgeColors: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  low: 'bg-green-500/10 text-green-600 dark:text-green-400',
  medium: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  high: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  critical: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export function InsightCard({ insight }: InsightCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyFix = async () => {
    if (!insight.fixPrompt) return;
    await navigator.clipboard.writeText(insight.fixPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card
      className={`border-l-4 rounded-sm p-3 ${
        severityColors[insight.severity] || 'border-l-gray-500'
      }`}
    >
      <CardContent className="p-0">
        <div className="mb-1.5 flex items-center gap-2">
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
        </div>

        <h4 className="text-sm font-bold text-foreground">
          {insight.title}
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {insight.content}
        </p>

        {insight.targetServiceName && (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Target:{' '}
            <span className="font-medium text-foreground">
              {insight.targetServiceName}
            </span>
          </p>
        )}

        {insight.fixPrompt && (
          <Button
            variant="outline"
            size="xs"
            onClick={handleCopyFix}
            className="mt-2 text-[10px] text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy Fix Prompt
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
