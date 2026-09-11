import type { Interface, InterfaceResource } from '../../../../packages/shared/src/index.js'
import type { AuthorUserContext } from '../../../../packages/guard-generator/src/prompts.js'
import type { GuardFailureObservation } from '../../../../packages/shared/src/guard/failure-observation.js'

export const FIXTURE_VERSION = 1
export function missingDialogObservation(): Extract<GuardFailureObservation, { kind: 'web-target' }> {
  return { version: 1, kind: 'web-target', assertion: 'visible:0', page: 'guard-server://web/organisations',
    operation: 'to see', locator: { role: 'dialog', name: 'Create organisation' }, matchCount: 0, visibility: 'hidden', reason: 'absent' }
}
export function authoringFixture() {
  const interfaces: Interface[] = Array.from({ length: 1200 }, (_, n) => ({
    id: `web/archive-${String(n).padStart(4, '0')}`, type: 'web', title: `Archive screen ${n}`,
    entry: { method: 'GET', path: `/archive/${n}` }, steps: [{ kind: 'navigate', path: `/archive/${n}` }],
    fingerprint: `sha256:synthetic-${n}`, at: `screen-${n}`,
  } as Interface))
  const own = { id: 'web/create-organisation', type: 'web', title: 'Create organisation',
    entry: { method: 'GET', path: '/organisations' }, steps: [{ kind: 'navigate', path: '/organisations' }],
    fingerprint: 'sha256:organisation', at: 'organisations' } as Interface
  const late = { id: 'web/zz-member-invite', type: 'web', title: 'Invite member',
    entry: { method: 'GET', path: '/teams/members' }, steps: [{ kind: 'navigate', path: '/teams/members' }],
    fingerprint: 'sha256:invite', at: 'members' } as Interface
  interfaces.push(own, late)
  const resources: Record<string, InterfaceResource[]> = { web: [
    { id: 'organisations', kind: 'screen', title: 'Organisations', address: '/organisations' },
    { id: 'members', kind: 'panel', title: 'Members', of: 'organisations' },
    ...Array.from({ length: 1200 }, (_, n) => ({ id: `screen-${n}`, kind: 'panel' as const,
      title: `Archive panel ${n}`, of: 'organisations', description: `Unrelated archive record ${n}` })),
  ] }
  const context: AuthorUserContext = {
    flow: { id: 'organisation', title: 'Create organisation', goal: 'Show the creation dialog' },
    driver: 'web', areaTags: ['organisations'], interfacePath: [own.id],
    milestones: [{ order: 1, claim: 'Creating an organisation displays its dialog', doc: 'synthetic.md',
      sectionHeading: 'Creation', sectionText: 'Creating an organisation displays its dialog.', realization: ['navigate /organisations'] }],
  }
  return { interfaces, resources, own, late, context }
}
