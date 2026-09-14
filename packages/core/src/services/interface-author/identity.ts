import { createHash } from 'node:crypto'
import type { Interface, InterfaceResource, InterfacesFile } from '@truecourse/shared'
import type { AuthoredFragment } from './draft.js'

export interface ScreenIdentityScope {
  screenId: string
  address?: string
}

export interface ScopeFragmentIdsInput {
  scope?: ScreenIdentityScope
  derived: InterfacesFile | null
  authored: InterfacesFile | null
  replaceable: ReadonlySet<string>
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// Leave room for the task's `web/` prefix as well.
const MAX_ID_LENGTH = 156

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function readable(value: string, limit: number): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, limit).replace(/^-|-$/g, '') || 'screen'
}

function namespace(scope: ScreenIdentityScope): string {
  return `screen-${readable(scope.screenId, 36)}-${hash(scope.screenId)}`
}

function qualifiedId(id: string, prefix: string, exists: boolean): string {
  // A checked draft may pass this boundary again at final acceptance/resume.
  if (!exists && id.startsWith(prefix) && id.length <= MAX_ID_LENGTH) return id
  return `${prefix}${readable(id, 52)}-${hash(id)}`
}

function resourceOwner(id: string, resources: ReadonlyMap<string, InterfaceResource>): string | undefined {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    seen.add(current)
    const resource: InterfaceResource | undefined = resources.get(current)
    if (!resource) return undefined
    if (resource.kind === 'screen') return resource.id
    current = resource.of
  }
  return undefined
}

function taskOwnedBy(task: Interface, scope: ScreenIdentityScope, resources: ReadonlyMap<string, InterfaceResource>): boolean {
  if (task.type !== 'web') return false
  if (task.at) return resourceOwner(task.at, resources) === scope.screenId
  return scope.address !== undefined && 'path' in task.entry && task.entry.path === scope.address
}

/**
 * Give new screen-local names stable catalog-wide identities. This does not
 * validate or repair ownership: foreign/root declarations retain the fields
 * which make the draft invalid, and the existing validator still decides.
 */
export function scopeFragmentIds(fragment: AuthoredFragment, input: ScopeFragmentIdsInput): AuthoredFragment {
  const { scope } = input
  if (!scope) return fragment
  const prefix = namespace(scope)
  const resources = new Map<string, InterfaceResource>()
  for (const resource of [...(input.derived?.resources?.web ?? []), ...(input.authored?.resources?.web ?? [])]) {
    resources.set(resource.id, { ...resources.get(resource.id), ...resource })
  }
  const tasks = new Map([...(input.derived?.interfaces ?? []), ...(input.authored?.interfaces ?? [])]
    .map((task) => [task.id, task]))
  const proposedResources = new Map(resources)
  for (const resource of fragment.resources ?? []) {
    proposedResources.set(resource.id, { ...proposedResources.get(resource.id), ...resource })
  }

  const resourceIds = new Map<string, string>()
  for (const resource of fragment.resources ?? []) {
    // Root screens are derived identities, never screen-local aliases. Invalid
    // kinds, ids, cycles, or foreign parents must remain visible to validation.
    if ((resource.kind !== 'panel' && resource.kind !== 'dialog') || !SLUG.test(resource.id)) continue
    if (resources.get(resource.id)?.kind === 'screen') continue
    if (resourceOwner(resource.id, proposedResources) !== scope.screenId) continue
    if (resourceOwner(resource.id, resources) === scope.screenId) continue
    resourceIds.set(resource.id, qualifiedId(resource.id, `${prefix}-place-`, resources.has(resource.id)))
  }
  const resourceId = (id: string | undefined): string | undefined => id === undefined ? undefined : resourceIds.get(id) ?? id

  return {
    ...fragment,
    interfaces: fragment.interfaces.map((task) => {
      const localId = task.id.startsWith('web/') ? task.id.slice(4) : undefined
      const prior = tasks.get(task.id)
      const keepId = input.replaceable.has(task.id) || (prior !== undefined && taskOwnedBy(prior, scope, resources))
      const id = keepId || localId === undefined || !SLUG.test(localId)
        ? task.id
        : `web/${qualifiedId(localId, `${prefix}-task-`, prior !== undefined)}`
      return {
        ...task,
        id,
        ...(task.at === undefined ? {} : { at: resourceId(task.at)! }),
        ...(task.to === undefined ? {} : { to: resourceId(task.to)! }),
      }
    }),
    ...(fragment.resources === undefined ? {} : {
      resources: fragment.resources.map((resource) => ({
        ...resource,
        id: resourceIds.get(resource.id) ?? resource.id,
        ...(resource.of === undefined ? {} : { of: resourceId(resource.of)! }),
      })),
    }),
  }
}

export function screenIdentityGuidance(scope?: ScreenIdentityScope): string {
  if (!scope) return ''
  return `New task and nested panel/dialog IDs belong to screen \`${scope.screenId}\`. Use clear local kebab-case names (tasks keep the \`web/\` prefix); check_draft assigns the stable \`${namespace(scope)}\` namespace and rewrites local at/to/of references together. Reuse this screen's existing IDs exactly. Screen IDs and shared state IDs retain their catalog names. A name used by another screen does not establish ownership here.`
}
