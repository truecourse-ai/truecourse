
import { useEffect, useState, useMemo } from 'react';
import { Shield, Bug, Network, Zap, HeartPulse, Code2, Database, Paintbrush, Loader2, Search } from 'lucide-react';
import { getRules, type RuleResponse } from '@/lib/api';
import { SeverityDropdown, type SeverityFilter } from '@/components/ui/SeverityDropdown';

type DomainFilter = 'all' | 'security' | 'bugs' | 'architecture' | 'performance' | 'reliability' | 'code-quality' | 'database' | 'style';

const severityColors: Record<string, string> = {
  critical: 'bg-red-600/20 text-red-400 border-red-600/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  low: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

const typeColors: Record<string, string> = {
  deterministic: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  llm: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
};

const domainColors: Record<string, string> = {
  security: 'bg-red-500/20 text-red-400 border-red-500/30',
  bugs: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  architecture: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  performance: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  reliability: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'code-quality': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  database: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  style: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
};

const domainLabels: Record<string, string> = {
  security: 'Security',
  bugs: 'Bugs',
  architecture: 'Architecture',
  performance: 'Performance',
  reliability: 'Reliability',
  'code-quality': 'Code Quality',
  database: 'Database',
  style: 'Style',
};

function getDomain(rule: RuleResponse): string {
  const key = rule.key || '';
  const slash = key.indexOf('/');
  return slash > 0 ? key.slice(0, slash) : rule.category;
}

const domainTabs: { value: DomainFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All', icon: <Shield className="h-3.5 w-3.5" /> },
  { value: 'security', label: 'Security', icon: <Shield className="h-3.5 w-3.5" /> },
  { value: 'bugs', label: 'Bugs', icon: <Bug className="h-3.5 w-3.5" /> },
  { value: 'architecture', label: 'Architecture', icon: <Network className="h-3.5 w-3.5" /> },
  { value: 'performance', label: 'Performance', icon: <Zap className="h-3.5 w-3.5" /> },
  { value: 'reliability', label: 'Reliability', icon: <HeartPulse className="h-3.5 w-3.5" /> },
  { value: 'code-quality', label: 'Code Quality', icon: <Code2 className="h-3.5 w-3.5" /> },
  { value: 'database', label: 'Database', icon: <Database className="h-3.5 w-3.5" /> },
  { value: 'style', label: 'Style', icon: <Paintbrush className="h-3.5 w-3.5" /> },
];

export function RulesPanel() {
  const [rules, setRules] = useState<RuleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DomainFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'deterministic' | 'llm'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    getRules()
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

  // Pre-category: search + severity + type filtered
  const preCategoryFiltered = useMemo(() => {
    let result = rules;
    if (severityFilter !== 'all') result = result.filter((r) => r.severity === severityFilter);
    if (typeFilter !== 'all') result = result.filter((r) => r.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q)
      );
    }
    return result;
  }, [rules, severityFilter, typeFilter, search]);

  const filtered = useMemo(() => {
    const result = filter === 'all' ? preCategoryFiltered : preCategoryFiltered.filter((r) => getDomain(r) === filter);
    return result.slice().sort((a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
    );
  }, [preCategoryFiltered, filter]);

  // Domain counts reflect search + severity
  const domainCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of preCategoryFiltered) counts[getDomain(r)] = (counts[getDomain(r)] || 0) + 1;
    return counts;
  }, [preCategoryFiltered]);

  // Severity counts reflect search (not severity filter itself)
  const severityCounts = useMemo(() => {
    let result = rules;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q)
      );
    }
    const counts: Record<string, number> = {};
    for (const r of result) counts[r.severity] = (counts[r.severity] || 0) + 1;
    return counts;
  }, [rules, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search + severity filter */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search rules..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary/50"
            />
          </div>
          <SeverityDropdown value={severityFilter} onChange={setSeverityFilter} counts={severityCounts} />
          <div className="flex rounded-md border border-border">
            {(['all', 'deterministic', 'llm'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-1 text-[10px] font-medium first:rounded-l-md last:rounded-r-md ${
                  typeFilter === t
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {t === 'all' ? 'All' : t === 'deterministic' ? 'Det' : 'LLM'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Domain tabs */}
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-thin">
          {domainTabs.map((tab) => {
            const count = tab.value === 'all' ? preCategoryFiltered.length : domainCounts[tab.value] || 0;
            return (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  filter === tab.value
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {tab.icon}
                {tab.label}
                {count > 0 && (
                  <span className="ml-0.5 text-[10px] opacity-70">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search ? 'No rules match your search' : 'No rules found'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rule) => {
            const domain = getDomain(rule);
            return (
              <div
                key={rule.key}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium text-foreground">{rule.name}</h4>
                  <div className="flex shrink-0 gap-1.5">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${severityColors[rule.severity] || ''}`}
                    >
                      {rule.severity}
                    </span>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{rule.description}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${domainColors[domain] || ''}`}
                  >
                    {domainLabels[domain] || domain}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${typeColors[rule.type] || ''}`}
                  >
                    {rule.type === 'deterministic' ? 'Deterministic' : 'LLM'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
