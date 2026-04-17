import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopOffendersResponse, TopOffender } from '@/lib/api';

type SortKey = 'violationCount' | 'criticalCount' | 'highCount';

export function TopOffendersTable({
  data,
  onOffenderClick,
  activeOffenderId,
}: {
  data: TopOffendersResponse;
  onOffenderClick?: (offender: TopOffender) => void;
  activeOffenderId?: string | null;
}) {
  const [sortBy, setSortBy] = useState<SortKey>('violationCount');

  const sorted = [...data.offenders].sort((a, b) => b[sortBy] - a[sortBy]);

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Top Offenders</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No violations targeting specific services or modules.</p>
        </CardContent>
      </Card>
    );
  }

  const colHeader = (label: string, key: SortKey) => (
    <th
      className={`cursor-pointer px-2 py-1.5 text-right text-xs font-medium text-muted-foreground hover:text-foreground ${sortBy === key ? 'text-foreground' : ''}`}
      onClick={() => setSortBy(key)}
    >
      {label}
      {sortBy === key && ' ↓'}
    </th>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Top Offenders</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-1.5 text-left text-xs font-medium text-muted-foreground">#</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">Name</th>
              {colHeader('Total', 'violationCount')}
              {colHeader('Critical', 'criticalCount')}
              {colHeader('High', 'highCount')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((offender, i) => {
              const isActive = activeOffenderId === offender.id;
              return (
              <tr
                key={offender.id}
                className={`border-b border-border/50 transition-colors ${onOffenderClick ? 'cursor-pointer hover:bg-muted/50' : ''} ${isActive ? 'bg-accent/50' : ''}`}
                onClick={() => onOffenderClick?.(offender)}
              >
                <td className="px-4 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{offender.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {offender.kind}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{offender.violationCount}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {offender.criticalCount > 0 ? (
                    <span className="text-red-400">{offender.criticalCount}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                  {offender.highCount > 0 ? (
                    <span className="text-orange-400">{offender.highCount}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
