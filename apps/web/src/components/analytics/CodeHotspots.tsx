import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CodeViolationSummary } from '@/lib/api';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600/10 text-red-500',
  high: 'bg-red-500/10 text-red-400',
  medium: 'bg-orange-500/10 text-orange-400',
  low: 'bg-amber-500/10 text-amber-400',
  info: 'bg-blue-500/10 text-blue-400',
};

export function CodeHotspots({
  data,
  onFileClick,
  activeFilePath,
}: {
  data: CodeViolationSummary;
  onFileClick?: (filePath: string) => void;
  activeFilePath?: string | null;
}) {
  const entries = Object.entries(data.byFile)
    .map(([filePath, count]) => ({
      filePath,
      count,
      severity: data.highestSeverityByFile[filePath] ?? 'info',
    }))
    .sort((a, b) => {
      // Sort by count desc, then severity
      if (b.count !== a.count) return b.count - a.count;
      return (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5);
    })
    .slice(0, 10);

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Code Hotspots</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No code violations found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Code Hotspots</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-1.5 text-left text-xs font-medium text-muted-foreground">#</th>
              <th className="px-2 py-1.5 text-left text-xs font-medium text-muted-foreground">File</th>
              <th className="px-2 py-1.5 text-right text-xs font-medium text-muted-foreground">Violations</th>
              <th className="px-4 py-1.5 text-right text-xs font-medium text-muted-foreground">Severity</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => {
              const fileName = entry.filePath.split('/').pop() || entry.filePath;
              const isActive = activeFilePath === entry.filePath;
              return (
                <tr
                  key={entry.filePath}
                  className={`border-b border-border/50 transition-colors ${onFileClick ? 'cursor-pointer hover:bg-muted/50' : ''} ${isActive ? 'bg-accent/50' : ''}`}
                  onClick={() => onFileClick?.(entry.filePath)}
                  title={entry.filePath}
                >
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <span className="truncate block max-w-[250px]" title={entry.filePath}>
                      {fileName}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{entry.count}</td>
                  <td className="px-4 py-1.5 text-right">
                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_COLORS[entry.severity] ?? ''}`}>
                      {entry.severity}
                    </span>
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
