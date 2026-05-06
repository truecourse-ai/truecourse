/**
 * Bracket access on `Record<UnionKey, V>` and `Map<K, V>` types is a
 * MAP lookup, not array indexing. The unchecked-array-access rule
 * should NOT flag these — Records keyed by a finite union are
 * exhaustive by construction.
 *
 * Domain types (`PlanId`, `Role`, `Permission`) and lookup tables
 * (`PLANS`, `ORGANISATION_MEMBER_ROLE_MAP`, `ROLE_PERMISSIONS`,
 * `AGENT_STATUS_MAP`) are imported from the shared user-service models
 * to keep the fixture project coherent across services.
 *
 * Mirrors documenso's
 *   apps/remix/app/components/dialogs/organisation-create-dialog.tsx:306 (`plans[planId]`)
 *   apps/remix/app/components/dialogs/organisation-leave-dialog.tsx:92  (`ORGANISATION_MEMBER_ROLE_MAP[role]`)
 * and OpenHands'
 *   frontend/src/utils/org/permissions.ts (`rolePermissions: Record<Role, Permission[]>`)
 *   frontend/src/utils/status.ts (`AGENT_STATUS_MAP: { [k: string]: string }`)
 */

import { AGENT_STATUS_MAP, ORGANISATION_MEMBER_ROLE_MAP, PLANS, ROLE_PERMISSIONS } from '../../../user-service/src/models/billing.model';
import type { Permission, PlanId, Role } from '../../../user-service/src/models/billing.model';

// `.map((planId) => { const plan = PLANS[planId]; ... })` — exact
// documenso shape (organisation-create-dialog.tsx:306).
export function describePlans(): { name: string; price: number }[] {
  const ids: PlanId[] = ['free', 'pro', 'team'];
  return ids.map((planId) => {
    const plan = PLANS[planId];
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
//   frontend/src/hooks/organizations/use-permissions.ts:8 (`rolePermissions[role]`)
export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

// `{ [k: string]: V }` index-signature object. Same shape category as
// Record — a map.
export function statusLabel(state: string): string {
  return AGENT_STATUS_MAP[state];
}

// React state setter: `(prev) => ({ ...prev, [key]: !prev[key] })`. The
// `prev[key]` lookup is on a Record/object — not array indexing. Mirrors
// OpenHands' plugin-launch-modal.tsx:58 and skill-ready-content-list.tsx:20.
export function toggle(state: Record<string, boolean>, key: string): Record<string, boolean> {
  return { ...state, [key]: !state[key] };
}
