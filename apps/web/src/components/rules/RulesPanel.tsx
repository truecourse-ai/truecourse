
import { useEffect, useState } from 'react';
import { Shield, Network, Database, Box, Loader2 } from 'lucide-react';
import { getRules, type RuleResponse } from '@/lib/api';

type CategoryFilter = 'all' | 'service' | 'database' | 'module';

const severityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const typeColors: Record<string, string> = {
  deterministic: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  llm: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
};

const categoryColors: Record<string, string> = {
  service: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  module: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  database: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const categoryLabels: Record<string, string> = {
  service: 'Service',
  module: 'Module',
  database: 'Database',
};

export function RulesPanel() {
  const [rules, setRules] = useState<RuleResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>('all');

  useEffect(() => {
    getRules()
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);

  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const categoryOrder: Record<string, number> = { service: 0, module: 1, database: 2 };
  const typeOrder: Record<string, number> = { deterministic: 0, llm: 1 };
  const filtered = (filter === 'all' ? rules : rules.filter((r) => r.category === filter))
    .slice()
    .sort((a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
      || (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9)
      || (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9)
    );

  const categories: { value: CategoryFilter; label: string; icon: React.ReactNode }[] = [
    { value: 'all', label: 'All', icon: <Shield className="h-3.5 w-3.5" /> },
    { value: 'service', label: 'Service', icon: <Network className="h-3.5 w-3.5" /> },
    { value: 'module', label: 'Module', icon: <Box className="h-3.5 w-3.5" /> },
    { value: 'database', label: 'Database', icon: <Database className="h-3.5 w-3.5" /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* Category filter */}
      <div className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-thin">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilter(cat.value)}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              filter === cat.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No rules found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((rule) => (
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
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${categoryColors[rule.category] || ''}`}
                >
                  {categoryLabels[rule.category] || rule.category}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${typeColors[rule.type] || ''}`}
                >
                  {rule.type === 'deterministic' ? 'Deterministic' : 'LLM'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
