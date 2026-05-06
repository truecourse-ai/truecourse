/**
 * Bracket access on `Record<UnionKey, V>` and `Map<K, V>` types is a
 * MAP lookup, not array indexing. The unchecked-array-access rule
 * should NOT flag these — Records keyed by a finite union are
 * exhaustive by construction.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/organisation-create-dialog.tsx:306 (`plans[planId]`)
 *   apps/remix/app/components/dialogs/organisation-leave-dialog.tsx:92  (`ORGANISATION_MEMBER_ROLE_MAP[role]`)
 */

type PlanId = 'free' | 'pro' | 'team';
type Role = 'owner' | 'admin' | 'member';

interface PlanInfo { readonly label: string; readonly priceCents: number }

const plans: Record<PlanId, PlanInfo> = {
  free: { label: 'Free', priceCents: 0 },
  pro: { label: 'Pro', priceCents: 1900 },
  team: { label: 'Team', priceCents: 4900 },
};

const ORGANISATION_MEMBER_ROLE_MAP: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  member: 'Member',
};

// `.map((planId) => { const plan = plans[planId]; ... })` — exact
// documenso shape (organisation-create-dialog.tsx:306).
export function describePlans(): { name: string; price: number }[] {
  const ids: PlanId[] = ['free', 'pro', 'team'];
  return ids.map((planId) => {
    const plan = plans[planId];
    return { name: plan.label, price: plan.priceCents };
  });
}

// `const role = ORGANISATION_MEMBER_ROLE_MAP[r]` — pre-translation lookup.
export function describeRoles(roles: readonly Role[]): string[] {
  return roles.map((r) => {
    const label = ORGANISATION_MEMBER_ROLE_MAP[r];
    return `Role: ${label}`;
  });
}

// Plain object literal used as a dispatch table keyed by union string.
const handlers: Record<'add' | 'remove' | 'reset', (n: number) => number> = {
  add: (n) => n + 1,
  remove: (n) => n - 1,
  reset: () => 0,
};

export function dispatch(action: 'add' | 'remove' | 'reset', n: number): number {
  const handler = handlers[action];
  return handler(n);
}

// Record<K, V[]> — Record values that are themselves arrays. The receiver
// is still a Record (map), not an array. Mirrors OpenHands'
//   frontend/src/utils/org/permissions.ts (`rolePermissions: Record<Role, PermissionKey[]>`)
//   frontend/src/hooks/organizations/use-permissions.ts:8 (`rolePermissions[role]`)
type Permission = 'permRead' | 'permWrite' | 'permAdmin';
const PERM_READ: Permission = 'permRead';
const PERM_WRITE: Permission = 'permWrite';
const PERM_ADMIN: Permission = 'permAdmin';
const rolePermissions: Record<Role, Permission[]> = {
  owner: [PERM_READ, PERM_WRITE, PERM_ADMIN],
  admin: [PERM_READ, PERM_WRITE],
  member: [PERM_READ],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return rolePermissions[role];
}

// `{ [k: string]: V }` index-signature object. Same shape category as
// Record — a map. Mirrors OpenHands'
//   frontend/src/utils/status.ts (`AGENT_STATUS_MAP: { [k: string]: string }`)
const AGENT_STATUS_MAP: { [k: string]: string } = {
  loading: 'Status: Initializing',
  ready: 'Status: Ready',
  error: 'Status: Error',
};

export function statusLabel(state: string): string {
  return AGENT_STATUS_MAP[state];
}

// React state setter: `(prev) => ({ ...prev, [key]: !prev[key] })`. The
// `prev[key]` lookup is on a Record/object — not array indexing. Mirrors
// OpenHands' plugin-launch-modal.tsx:58 and skill-ready-content-list.tsx:20.
export function toggle(state: Record<string, boolean>, key: string): Record<string, boolean> {
  return { ...state, [key]: !state[key] };
}
