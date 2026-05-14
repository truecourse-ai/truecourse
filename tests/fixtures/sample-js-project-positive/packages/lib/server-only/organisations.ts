
declare const workspaces: Array<{ id: string; name: string; globalConfig: { aiEnabled: boolean }; projects: Array<{ id: string; name: string; projectConfig: { aiEnabled: boolean | null } }> }>;
declare function deriveProjectSettings(global: { aiEnabled: boolean }, local: { aiEnabled: boolean | null }): { aiEnabled: boolean };
declare function getHighestRole(groups: unknown[]): string;

function buildWorkspaceSessions() {
  return workspaces.map((workspace) => ({
    ...workspace,
    projects: workspace.projects.map((project) => {
      const derived = deriveProjectSettings(workspace.globalConfig, project.projectConfig);
      return {
        ...project,
        preferences: { aiEnabled: derived.aiEnabled },
      };
    }),
  }));
}



declare const db: { $transaction: <T>(fn: (tx: typeof db) => Promise<T>) => Promise<T>; member: { delete: (opts: Record<string, unknown>) => Promise<void> }; invite: { deleteMany: (opts: Record<string, unknown>) => Promise<void> } };
declare const memberId: string;
declare const orgId: string;

async function removeMemberFromOrg() {
  await db.$transaction(async (tx) => {
    await tx.invite.deleteMany({
      where: { organisationId: orgId, invitedUserId: memberId },
    });
    await tx.member.delete({
      where: { id: memberId },
    });
  });
}



// FP shape fbc41784e0b7: flatMap over groupMembers to compute highest org role — no type mismatch
declare function getHighestOrgRoleInGroup(groups: Array<{ role: string }>): string;
declare class AppError2 extends Error { constructor(code: string, opts?: { message?: string }); }
declare const AppErrorCode: Record<string, string>;
declare const orgData: { ownerUserId: string; members: Array<{ orgGroupMembers: Array<{ group: { role: string } }> }> };
declare const targetUserId: string;
declare const targetRole: string;

async function updateOrgMemberRole() {
  const [member] = orgData.members;

  if (!member) {
    throw new AppError2(AppErrorCode.NOT_FOUND, {
      message: 'User is not a member of this organisation',
    });
  }

  const currentOrgRole = getHighestOrgRoleInGroup(
    member.orgGroupMembers.flatMap((m) => m.group),
  );

  if (targetRole === 'OWNER') {
    if (orgData.ownerUserId === targetUserId) {
      throw new AppError2(AppErrorCode.INVALID_REQUEST, {
        message: 'User is already the owner of this organisation',
      });
    }
  }

  return currentOrgRole;
}



// FP shape fd05a387f965: createMany group members with generateDatabaseId mapping — no type mismatch
declare function generateId(prefix: string): string;
declare enum OrgGroupType2 { CUSTOM = 'CUSTOM' }
declare enum OrgMemberRole2 { ADMIN = 'ADMIN', MEMBER = 'MEMBER' }
declare const prisma4: {
  $transaction: <T>(fn: (tx: { group: { create: (a: object) => Promise<{ id: string }> }; groupMember: { createMany: (a: object) => Promise<void> } }) => Promise<T>) => Promise<T>;
};

async function createOrganisationGroup(opts: { orgId: string; name: string; orgRole: OrgMemberRole2; memberIds: string[] }) {
  return prisma4.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        id: generateId('org_group'),
        organisationId: opts.orgId,
        name: opts.name,
        type: OrgGroupType2.CUSTOM,
        organisationRole: opts.orgRole,
      },
    });

    await tx.groupMember.createMany({
      data: opts.memberIds.map((memberId) => ({
        id: generateId('group_member'),
        orgMemberId: memberId,
        groupId: group.id,
      })),
    });

    return group;
  });
}


// enum-exhaustive-record-lookup: MAP[key] where key is typed keyof typeof MAP, MAP uses satisfies
type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

const WORKSPACE_ROLE_PERMISSIONS_MAP = {
  OWNER: ['invite', 'remove', 'billing', 'settings', 'delete'] as string[],
  ADMIN: ['invite', 'remove', 'settings'] as string[],
  MEMBER: ['invite'] as string[],
  VIEWER: [] as string[],
} satisfies Record<WorkspaceRole, string[]>;

const WORKSPACE_ROLE_LABEL_MAP = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
} satisfies Record<WorkspaceRole, string>;

export function getWorkspaceRoleLabel(role: keyof typeof WORKSPACE_ROLE_LABEL_MAP): string {
  return WORKSPACE_ROLE_LABEL_MAP[role];
}

export function workspaceRoleHasPermission(
  role: keyof typeof WORKSPACE_ROLE_PERMISSIONS_MAP,
  permission: string,
): boolean {
  return WORKSPACE_ROLE_PERMISSIONS_MAP[role].includes(permission);
}

