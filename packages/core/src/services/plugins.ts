import { PLUGINS, type Plugin } from '@truecourse/analyzer'

// ---------------------------------------------------------------------------
// Plugin catalog — server-facing wire shape for the shipped invariant plugins.
//
// Surfaces alongside the static rule catalog (see `services/rules.service.ts`)
// so the dashboard's RulesPanel can list plugins under a third type filter
// (`invariant`) without dragging the analyzer package into the dashboard
// server's dependency graph.
// ---------------------------------------------------------------------------

export interface PluginCatalogEntry {
  /** `invariants/<plugin-type>` — stable across releases. */
  key: string
  pluginType: string
  name: string
  description: string
  category: 'invariants'
  type: 'invariant'
  enforcement: 'deterministic' | 'llm' | 'mixed'
  defaultSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  enabled: true
  pluginVersion: number
}

function toEntry(p: Plugin): PluginCatalogEntry {
  return {
    key: `invariants/${p.type}`,
    pluginType: p.type,
    name: p.metadata.name,
    description: p.metadata.description,
    category: 'invariants',
    type: 'invariant',
    enforcement: p.metadata.enforcement,
    defaultSeverity: p.metadata.defaultSeverity,
    enabled: true,
    pluginVersion: p.version,
  }
}

export function getPluginCatalog(): PluginCatalogEntry[] {
  return PLUGINS.map(toEntry)
}
