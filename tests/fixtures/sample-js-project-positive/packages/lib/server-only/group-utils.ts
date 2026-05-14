
// --- function-return-type-varies shape: empty-object early-return vs populated GroupOption ---
// The early `return {}` is a structurally valid empty GroupOption, not a
// different type. TypeScript unifies all three branches as GroupOption.
declare type SelectOption = { value: string; label: string; [key: string]: unknown };
declare type GroupOption = { [key: string]: SelectOption[] };

function groupSelectOptions(options: SelectOption[], groupBy?: string): GroupOption {
  if (options.length === 0) {
    return {};
  }

  if (!groupBy) {
    return { '': options };
  }

  const grouped: GroupOption = {};

  for (const option of options) {
    const key = (option[groupBy] as string) ?? '';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(option);
  }

  return grouped;
}


// FP: enum-exhaustive Record keyed by MemberRole; role typed as MemberRole so key always present
// Record access returns array; .some() called — rule flags MAP[role] as unchecked
enum MemberRole_4f2f58b0 {
  OWNER = 'OWNER',
  CONTRIBUTOR = 'CONTRIBUTOR',
  VIEWER = 'VIEWER',
}

enum GroupPermission_4f2f58b0 {
  MANAGE = 'MANAGE',
  WRITE = 'WRITE',
  READ = 'READ',
  COMMENT = 'COMMENT',
}

const MEMBER_ROLE_GROUP_PERMISSIONS_MAP_4f2f58b0 = {
  [MemberRole_4f2f58b0.OWNER]: [GroupPermission_4f2f58b0.MANAGE, GroupPermission_4f2f58b0.WRITE, GroupPermission_4f2f58b0.READ, GroupPermission_4f2f58b0.COMMENT],
  [MemberRole_4f2f58b0.CONTRIBUTOR]: [GroupPermission_4f2f58b0.WRITE, GroupPermission_4f2f58b0.READ, GroupPermission_4f2f58b0.COMMENT],
  [MemberRole_4f2f58b0.VIEWER]: [GroupPermission_4f2f58b0.READ, GroupPermission_4f2f58b0.COMMENT],
} satisfies Record<MemberRole_4f2f58b0, GroupPermission_4f2f58b0[]>;

export function canPerformGroupAction_4f2f58b0(role: MemberRole_4f2f58b0, permission: GroupPermission_4f2f58b0): boolean {
  return MEMBER_ROLE_GROUP_PERMISSIONS_MAP_4f2f58b0[role].some((p) => p === permission);
}

