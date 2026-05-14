export function safeNonNull(x: string | null): number { if (x === null) return 0; return x.length; }
export interface OptionalField { name?: string; }
export type StringOrNumber = string | number;
export function wrapString(x: string): string { return x; }
export const CONFIG_VALUE = 42;
export type SimpleMap = Map<string, boolean>;
export function returnsUnknown(data: unknown): unknown { return data; }
export function objectParam(val: Record<string, unknown>): Record<string, unknown> { return val; }
export function isString(x: unknown): x is string { return typeof x === 'string'; }
export function processValue(input: unknown): boolean {
  if (typeof input === 'undefined') { return false; }
  if (typeof input === 'object') { return input !== null; }
  const result = String(input);
  const trimmed = result.trim();
  return trimmed.length > 0;
}
export function lookupKey(obj: Record<string, unknown>, key: string): unknown { return obj[key as keyof typeof obj]; }


// Positive: unchecked-array-access — Partial<Record> typed object property lookup with keyof key.
// planFlags is Partial<TPlanClaim>; flag.key is typed as keyof TPlanClaim.
// !planFlags[flag.key] handles undefined via truthiness — no array index involved.
type TPlanClaim = {
  advancedReporting: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  ssoEnabled: boolean;
};

export function getMissingPlanFeatures(
  planFlags: Partial<TPlanClaim>,
  required: Array<{ key: keyof TPlanClaim; label: string }>,
): string[] {
  const missing: string[] = [];
  for (const flag of required) {
    if (!planFlags[flag.key]) {
      missing.push(flag.label);
    }
  }
  return missing;
}



// Positive: unchecked-array-access — Record keyed by expiry type, access inside ternary that checks key.
// expiresIn is typed as ExpiryPreset | null; the ternary guard ensures only valid keys reach the lookup.
type ExpiryPreset = '7d' | '30d' | '90d' | '365d';
type DurationMs = { milliseconds: number };

const TOKEN_EXPIRY_DURATIONS: Record<ExpiryPreset, DurationMs> = {
  '7d': { milliseconds: 7 * 24 * 60 * 60 * 1000 },
  '30d': { milliseconds: 30 * 24 * 60 * 60 * 1000 },
  '90d': { milliseconds: 90 * 24 * 60 * 60 * 1000 },
  '365d': { milliseconds: 365 * 24 * 60 * 60 * 1000 },
};

declare function addMilliseconds(base: Date, ms: number): Date;

export function resolveTokenExpiresAt(expiresIn: ExpiryPreset | null): Date | null {
  return expiresIn ? addMilliseconds(new Date(), TOKEN_EXPIRY_DURATIONS[expiresIn].milliseconds) : null;
}



// Positive: argument-type-mismatch — Object.values() assigned to a typed property.
// Object.values(PRIORITY_VARIANT) returns string[] which matches the variants array type.
const PRIORITY_VARIANT = {
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  critical: 'priority-critical',
} as const;

const STATUS_VARIANT = {
  draft: 'status-draft',
  active: 'status-active',
  archived: 'status-archived',
} as const;

export const FIELD_STYLE_CONFIG = {
  priorityPattern: /^priority-(low|medium|high|critical)$/u,
  statusPattern: /^status-(draft|active|archived)$/u,
  priorityVariants: Object.values(PRIORITY_VARIANT),
  statusVariants: Object.values(STATUS_VARIANT),
};



// Positive: unchecked-array-access — planId drawn from a hardcoded array of known plan IDs;
// availablePlans is typed Record keyed by exactly those IDs — a type-safe Record lookup, not array indexing.
type InternalPlanId = 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

interface PlanDetails {
  name: string;
  maxSeats: number;
  monthlyPrice: number;
}

declare const availablePlans: Record<InternalPlanId, PlanDetails>;

const PLAN_IDS: InternalPlanId[] = ['STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

export function getPlanSummaries(): Array<{ id: InternalPlanId } & PlanDetails> {
  return PLAN_IDS.map((planId) => ({
    id: planId,
    ...availablePlans[planId],
  }));
}



// Positive: magic-string — 'REPORT' is a typed discriminant value matching the ReportType enum literal.
// Typed discriminants used as object literal properties are not magic strings.
declare function seedBlankReport(userId: number, workspaceId: number): Promise<{ id: string }>;
declare function navigateToEditor(path: string): Promise<void>;

type EditorSurface = {
  resourceId: string;
  resourceType: 'REPORT' | 'TEMPLATE';
  userId: number;
};

export async function openReportEditor(
  userEmail: string,
  userId: number,
  workspaceId: number,
): Promise<EditorSurface> {
  const report = await seedBlankReport(userId, workspaceId);
  await navigateToEditor(`/reports/${report.id}/edit`);
  return {
    resourceId: report.id,
    resourceType: 'REPORT',
    userId,
  };
}



// Positive: magic-string — 'reportId' discriminant in a typed ID lookup object.
// Typed union discriminant strings used as object literal property values are not magic strings.
declare function getReportById(args: { id: { type: string; id: string }; mode?: string }): Promise<unknown>;

export async function loadReportAsTemplate(reportId: string): Promise<unknown> {
  return getReportById({
    id: {
      type: 'reportId',
      id: reportId,
    },
    mode: 'TEMPLATE',
  });
}



// Positive: unchecked-array-access — PARTICIPANT_ROLE_LABELS is a plain object keyed exhaustively
// by every ParticipantRole enum member, enforced at compile time by `satisfies`.
// Accessing it with a ParticipantRole typed value is type-safe — no out-of-bounds possible.
const enum ParticipantRole { VIEWER = 'VIEWER', SIGNER = 'SIGNER', APPROVER = 'APPROVER', CC = 'CC' }

const PARTICIPANT_ROLE_LABELS = {
  [ParticipantRole.VIEWER]: { label: 'Viewer', description: 'Can view the report' },
  [ParticipantRole.SIGNER]: { label: 'Signer', description: 'Must sign the report' },
  [ParticipantRole.APPROVER]: { label: 'Approver', description: 'Must approve before signing' },
  [ParticipantRole.CC]: { label: 'CC', description: 'Receives a copy only' },
} satisfies Record<ParticipantRole, { label: string; description: string }>;

export function getParticipantRoleLabel(role: ParticipantRole): { label: string; description: string } {
  return PARTICIPANT_ROLE_LABELS[role];
}



// magic-string: 'workspace-admin' role string repeated 3+ times across permission checks
declare function getUserRole(userId: string): Promise<string>;
declare function logAuditEvent(action: string, role: string): void;
declare function checkPermission(role: string, resource: string): boolean;

export async function canManageWorkspace(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  if (role === 'workspace-admin') {
    logAuditEvent('permission_check', 'workspace-admin');
    return checkPermission('workspace-admin', 'workspace');
  }
  return false;
}



// Positive: unchecked-array-access — RECIPIENT_ROLES_DESC2 is a plain object keyed exhaustively
// by every RecipientRole2 enum member, enforced at compile time by `satisfies`.
// Accessing it with a RecipientRole2 typed value is type-safe — no out-of-bounds possible.
enum RecipientRole2 { SIGNER = 'SIGNER', VIEWER = 'VIEWER', APPROVER = 'APPROVER', CC = 'CC' }

const RECIPIENT_ROLES_DESC2 = {
  [RecipientRole2.SIGNER]: { actionVerb: 'Sign', actioned: 'Signed' },
  [RecipientRole2.VIEWER]: { actionVerb: 'View', actioned: 'Viewed' },
  [RecipientRole2.APPROVER]: { actionVerb: 'Approve', actioned: 'Approved' },
  [RecipientRole2.CC]: { actionVerb: 'CC', actioned: "CC'd" },
} satisfies Record<keyof typeof RecipientRole2, { actionVerb: string; actioned: string }>;

export function getRecipientRoleAction(role: RecipientRole2): { actionVerb: string; actioned: string } {
  return RECIPIENT_ROLES_DESC2[role];
}

