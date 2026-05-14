// createWorkspaceGroupRoute — thin-server tRPC mutation FP shape
declare const WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP_group: Record<string, string[]>;
declare const AppError_group: new (code?: string, opts?: { message?: string }) => Error;
declare const AppErrorCode_group: { UNAUTHORIZED: string; INVALID_BODY: string };
declare const getMemberWorkspaceRole_group: (opts: { workspaceId: string; reference: { type: string; id: number } }) => Promise<string>;
declare const generateDatabaseId_group: () => string;
declare const buildWorkspaceWhereQuery_group: (opts: { workspaceId: string; userId: number; roles: string[] }) => unknown;
declare const isWorkspaceRoleWithinUserHierarchy_group: (callerRole: string, targetRole: string) => boolean;
declare const prisma_group: {
  workspace: {
    findFirst: (opts: unknown) => Promise<{
      id: string;
      groups: Array<{ id: string; name: string; type: string }>;
      members: Array<{ id: string; user: { id: number; email: string; name: string | null } }>;
    } | null>;
  };
  workspaceGroup: {
    create: (opts: unknown) => Promise<{ id: string; name: string; type: string; workspaceRole: string }>;
  };
  workspaceGroupMember: { createMany: (opts: unknown) => Promise<void> };
};
declare const WorkspaceGroupType_group: { CUSTOM: string };
declare const authenticatedProcedure_group: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: (fn: (opts: { input: unknown; ctx: { user: { id: number }; logger: { info: (v: unknown) => void } } }) => Promise<unknown>) => unknown;
    };
  };
};
declare const ZCreateWorkspaceGroupRequestSchema_group: unknown;
declare const ZCreateWorkspaceGroupResponseSchema_group: unknown;

export const createWorkspaceGroupRoute = authenticatedProcedure_group
  .input(ZCreateWorkspaceGroupRequestSchema_group)
  .output(ZCreateWorkspaceGroupResponseSchema_group)
  .mutation(async ({ input, ctx }) => {
    const { workspaceId, workspaceRole, name, memberIds } = input as {
      workspaceId: string;
      workspaceRole: string;
      name: string;
      memberIds: number[];
    };
    const { user } = ctx;

    ctx.logger.info({ input: { workspaceId } });

    const workspace = await prisma_group.workspace.findFirst({
      where: buildWorkspaceWhereQuery_group({
        workspaceId,
        userId: user.id,
        roles: WORKSPACE_MEMBER_ROLE_PERMISSIONS_MAP_group['MANAGE_WORKSPACE'],
      }) as unknown as Parameters<typeof prisma_group.workspace.findFirst>[0]['where'],
      include: {
        groups: true,
        members: { include: { user: { select: { id: true, email: true, name: true } } } },
      },
    } as unknown as Parameters<typeof prisma_group.workspace.findFirst>[0]);

    if (!workspace) {
      throw new AppError_group(AppErrorCode_group.UNAUTHORIZED);
    }

    const callerRole = await getMemberWorkspaceRole_group({
      workspaceId,
      reference: { type: 'User', id: user.id },
    });

    if (!isWorkspaceRoleWithinUserHierarchy_group(callerRole, workspaceRole)) {
      throw new AppError_group(AppErrorCode_group.UNAUTHORIZED, {
        message: 'You cannot assign a role higher than your own',
      });
    }

    const validMemberIds = memberIds.filter((memberId) =>
      workspace.members.some((m) => m.user.id === memberId),
    );

    if (validMemberIds.length !== memberIds.length) {
      throw new AppError_group(AppErrorCode_group.INVALID_BODY, {
        message: 'One or more members do not belong to this workspace',
      });
    }

    const groupId = generateDatabaseId_group();

    const group = await prisma_group.workspaceGroup.create({
      data: {
        id: groupId,
        name,
        type: WorkspaceGroupType_group.CUSTOM,
        workspaceRole,
        workspaceId,
      },
    } as unknown as Parameters<typeof prisma_group.workspaceGroup.create>[0]);

    if (validMemberIds.length > 0) {
      await prisma_group.workspaceGroupMember.createMany({
        data: validMemberIds.map((memberId) => ({
          workspaceGroupId: group.id,
          workspaceMemberId: workspace.members.find((m) => m.user.id === memberId)?.id ?? '',
        })),
      } as unknown as Parameters<typeof prisma_group.workspaceGroupMember.createMany>[0]);
    }

    return group;
  });
