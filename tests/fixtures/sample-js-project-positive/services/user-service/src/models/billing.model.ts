/**
 * Billing-domain types shared across the web component layer and the
 * user-service handlers. Picking finite-union plan/role keys keeps
 * `Record<PlanId, ...>` exhaustive — that's the lookup shape several
 * fixture components rely on (PlanLookup, RadioField, TrpcConsumer).
 */

export type PlanId = 'free' | 'pro' | 'team';
export type Role = 'owner' | 'admin' | 'member';
export type Permission = 'permRead' | 'permWrite' | 'permAdmin';

export interface PlanInfo {
  readonly label: string;
  readonly priceCents: number;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  free: { label: 'Free', priceCents: 0 },
  pro: { label: 'Pro', priceCents: 1900 },
  team: { label: 'Team', priceCents: 4900 },
};

export const ORGANISATION_MEMBER_ROLE_MAP: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  member: 'Member',
};

const PERM_READ: Permission = 'permRead';
const PERM_WRITE: Permission = 'permWrite';
const PERM_ADMIN: Permission = 'permAdmin';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [PERM_READ, PERM_WRITE, PERM_ADMIN],
  admin: [PERM_READ, PERM_WRITE],
  member: [PERM_READ],
};

export const AGENT_STATUS_MAP: { [k: string]: string } = {
  loading: 'Status: Initializing',
  ready: 'Status: Ready',
  error: 'Status: Error',
};
