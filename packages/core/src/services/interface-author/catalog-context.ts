import { createAuthorCatalog, type AuthorCatalog } from '@truecourse/guard-generator'
import { mergeInterfaceCatalogs } from '@truecourse/guard-runner'
import type { Interface, InterfacesFile } from '@truecourse/shared'

export const MAX_OWN_TASK_BYTES = 12_000
interface CatalogInput { derived: InterfacesFile | null; authored: InterfacesFile | null }

/** Access getters on every call; cursors remain valid when their requested data is unchanged. */
export function liveAuthorCatalog(input: CatalogInput): () => AuthorCatalog {
  let previousDerived: InterfacesFile | null | undefined
  let previousAuthored: InterfacesFile | null | undefined
  let catalog: AuthorCatalog | undefined
  return () => {
    const derived = input.derived
    const authored = input.authored
    if (!catalog || derived !== previousDerived || authored !== previousAuthored) {
      const merged = mergeInterfaceCatalogs(derived, authored)
      catalog = createAuthorCatalog(merged.interfaces, merged.resources, merged.states?.web)
      previousDerived = derived
      previousAuthored = authored
    }
    return catalog
  }
}

/** Ownership follows at/of only. A task that navigates TO this screen is not owned here. */
export function ownTasks(catalog: InterfacesFile, screenId: string): Interface[] {
  const resources = new Map((catalog.resources?.web ?? []).map(resource => [resource.id, resource]))
  return catalog.interfaces.filter(task => {
    if (task.type !== 'web') return false
    let owner = task.at
    const seen = new Set<string>()
    while (owner && !seen.has(owner)) {
      if (owner === screenId) return true
      seen.add(owner)
      owner = resources.get(owner)?.of
    }
    return false
  }).sort((a, b) => a.id.localeCompare(b.id))
}

/** Whole exact definitions, captured with the initial briefing, outside the shared prefix. */
export function ownTaskContext(input: CatalogInput & { screenId: string }): string {
  const tasks = ownTasks(mergeInterfaceCatalogs(input.derived, input.authored), input.screenId)
  const instruction = 'Reconcile: account for every authored task listed in the briefing against the source and the live screen. List one that still stands exactly as it is in `kept` (never re-send it), re-send one that changed under its own id with the corrected steps, and put one whose control no longer exists in `retired` with the reason. Derived tasks remain unchanged. Retrieve every omitted definition with get_interfaces before deciding on it.'
  const retrieval = 'Use search_interfaces for web catalog metadata and get_interfaces for exact actions. Use get_resources and get_states for exact resource and state definitions. Continue all pages with the same arguments and nextCursor. If the requested definitions change and a cursor is stale, restart retrieval. Source search does not search hidden catalog files.'
  const blocks: string[] = []
  const omitted: string[] = []
  let bytes = Buffer.byteLength(instruction + retrieval) + 500
  for (const task of tasks) {
    const block = JSON.stringify(task)
    // Reserve a bounded list of omitted identities independently of definitions.
    if (bytes + Buffer.byteLength(block) + 2 > MAX_OWN_TASK_BYTES - 2_000) omitted.push(task.id)
    else { blocks.push(block); bytes += Buffer.byteLength(block) + 2 }
  }
  const ids: string[] = []
  let idBytes = 0
  for (const id of omitted) {
    const row = JSON.stringify(id)
    if (idBytes + Buffer.byteLength(row) + 2 > 1_700) break
    ids.push(row)
    idBytes += Buffer.byteLength(row) + 2
  }
  return [
    `Existing tasks owned by this screen: ${tasks.length} total, ${blocks.length} complete definitions included, ${omitted.length} omitted.`,
    instruction, retrieval,
    ...(tasks.length ? blocks : ['No existing web task is owned by this screen.']),
    ...(omitted.length ? [`Omitted ids: ${ids.join(', ')}.`, ...(ids.length < omitted.length
      ? ['Omitted-id manifest incomplete. Page search_interfaces with this screen as resource, then check at/of ownership; resource search also returns tasks related by navigation.'] : [])] : []),
  ].join('\n\n')
}
