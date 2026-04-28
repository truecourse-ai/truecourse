import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck } from 'lucide-react';
import { getPlugins, type PluginCatalogEntry } from '@/lib/api';

const enforcementColors: Record<'deterministic' | 'llm' | 'mixed', string> = {
  deterministic: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  llm: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  mixed: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const enforcementLabels: Record<'deterministic' | 'llm' | 'mixed', string> = {
  deterministic: 'Deterministic',
  llm: 'LLM',
  mixed: 'Mixed',
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-600/20 text-red-400 border-red-600/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  low: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

type EnforcementFilter = 'all' | 'deterministic' | 'llm' | 'mixed';

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [enforcementFilter, setEnforcementFilter] = useState<EnforcementFilter>('all');

  useEffect(() => {
    getPlugins()
      .then(setPlugins)
      .catch(() => setPlugins([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = plugins;
    if (enforcementFilter !== 'all') {
      result = result.filter((p) => p.enforcement === enforcementFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.pluginType.toLowerCase().includes(q),
      );
    }
    return result;
  }, [plugins, search, enforcementFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search + enforcement filter */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex rounded-md border border-border">
            {(['all', 'deterministic', 'llm', 'mixed'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setEnforcementFilter(t)}
                className={`px-2 py-1 text-[10px] font-medium first:rounded-l-md last:rounded-r-md ${
                  enforcementFilter === t
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {t === 'all' ? 'All' : t === 'deterministic' ? 'Det' : t === 'llm' ? 'LLM' : 'Mixed'}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Plugins generate per-project invariants from your spec + code. Trigger discovery from the
          Invariants tab.
        </p>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <ShieldCheck className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {search || enforcementFilter !== 'all'
                ? 'No plugins match your filter'
                : 'No plugins shipped yet.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2 px-3 py-3">
            {filtered.map((p) => (
              <li key={p.key} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-foreground">{p.name}</h4>
                    <code className="text-[10px] text-muted-foreground">{p.pluginType}</code>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                        severityColors[p.defaultSeverity] || ''
                      }`}
                      title="Default severity for this plugin's findings"
                    >
                      {p.defaultSeverity}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                      enforcementColors[p.enforcement]
                    }`}
                    title="How this plugin enforces its invariants"
                  >
                    {enforcementLabels[p.enforcement]}
                  </span>
                  <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    v{p.pluginVersion}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
