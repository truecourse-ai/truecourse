
declare const TEAM_ROLE_PERMISSIONS19: Record<string, string[]>;
declare const AppError19: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode19: { NOT_FOUND: string; UNAUTHORIZED: string };
declare const getMemberRoles19: (opts: { userId: number; teamId: number }) => Promise<{ teamRole: string; orgRole: string }>;
declare const generateId19: () => string;
declare const buildTeamQuery19: (opts: { teamId: number; userId: number; roles: string[] }) => unknown;
declare const isRoleWithinHierarchy19: (a: string, b: string) => boolean;
declare const prisma19: {
  team: { findFirst: (opts: unknown) => Promise<{ id: number; organisation: { members: Array<{ id: string }> }; teamGroups: Array<{ id: string; groupId: string }> } | null> };
  organisationGroup: { findFirst: (opts: unknown) => Promise<{ id: string; organisationGroupMembers: Array<{ organisationMemberId: string }> } | null> };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};
declare const authenticatedProcedure19: { input: (s: unknown) => { output: (s: unknown) => { mutation: (fn: unknown) => unknown } } };
declare const ZAddTeamMembersReqSchema19: unknown;
declare const ZAddTeamMembersResSchema19: unknown;
declare const OrgGroupType19: { INTERNAL_ORGANISATION: string };

export const addTeamMembersRoute19 = authenticatedProcedure19
  .input(ZAddTeamMembersReqSchema19)
  .output(ZAddTeamMembersResSchema19)
  .mutation(async ({ input, ctx }: { input: { teamId: number; orgMembers: Array<{ orgMemberId: string; teamRole: string }> }; ctx: { user: { id: number }; logger: { info: (msg: string, data?: unknown) => void } } }) => {
    const { teamId, orgMembers } = input;
    const { user } = ctx;

    ctx.logger.info('addTeamMembersRoute19 called', { teamId, orgMembers });

    return await addTeamMembers19({ userId: user.id, teamId, membersToAdd: orgMembers });
  });

type AddTeamMembersOptions19 = {
  userId: number;
  teamId: number;
  membersToAdd: Array<{ orgMemberId: string; teamRole: string }>;
};

export const addTeamMembers19 = async ({ userId, teamId, membersToAdd }: AddTeamMembersOptions19) => {
  const team = await prisma19.team.findFirst({
    where: buildTeamQuery19({
      teamId,
      userId,
      roles: TEAM_ROLE_PERMISSIONS19['MANAGE_TEAM'] ?? [],
    }) as unknown,
    include: {
      organisation: { include: { members: { select: { id: true } } } },
      teamGroups: true,
    } as unknown,
  });

  if (!team) {
    throw new AppError19(AppErrorCode19.NOT_FOUND, { message: 'Team not found or insufficient permissions' });
  }

  const callerRoles = await getMemberRoles19({ userId, teamId });

  for (const member of membersToAdd) {
    if (!isRoleWithinHierarchy19(callerRoles.teamRole, member.teamRole)) {
      throw new AppError19(AppErrorCode19.UNAUTHORIZED, {
        message: `Cannot assign role '${member.teamRole}' — it exceeds your own role.`,
      });
    }
  }

  const orgMemberIds = team.organisation.members.map((m) => m.id);
  const validMembers = membersToAdd.filter((m) => orgMemberIds.includes(m.orgMemberId));

  if (validMembers.length === 0) {
    return { added: 0 };
  }

  const internalGroup = await prisma19.organisationGroup.findFirst({
    where: {
      type: OrgGroupType19.INTERNAL_ORGANISATION,
      teamGroups: { some: { teamId } },
    } as unknown,
    include: { organisationGroupMembers: true } as unknown,
  });

  if (!internalGroup) {
    throw new AppError19(AppErrorCode19.NOT_FOUND, { message: 'Internal group not found for team' });
  }

  await prisma19.$transaction(async (tx) => {
    for (const member of validMembers) {
      const alreadyMember = internalGroup.organisationGroupMembers.some(
        (gm) => gm.organisationMemberId === member.orgMemberId,
      );

      if (!alreadyMember) {
        await (tx as typeof prisma19).organisationGroup.findFirst({
          where: { id: internalGroup.id } as unknown,
        });
      }
    }
  });

  return { added: validMembers.length };
};



declare const ORG_MEMBER_ROLE_PERMS30: Record<string, string[]>;
declare const AppError30: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode30: { NOT_FOUND: string; UNAUTHORIZED: string };
declare const getMemberOrgRole30: (opts: { orgId: string; reference: { type: string; id: number } }) => Promise<string>;
declare const generateId30: () => string;
declare const buildOrgQuery30: (opts: { orgId?: string; userId: number; roles: string[] }) => unknown;
declare const isRoleInHierarchy30: (callerRole: string, targetRole: string) => boolean;
declare const unique30: <T>(arr: T[]) => T[];
declare const prisma30: {
  organisationGroup: {
    findFirst: (opts: unknown) => Promise<{ id: string; organisationId: string; type: string; organisationGroupMembers: Array<{ organisationMemberId: string }> } | null>;
    update: (opts: unknown) => Promise<void>;
  };
};
declare const authenticatedProcedure30: { input: (s: unknown) => { output: (s: unknown) => { mutation: (fn: unknown) => unknown } } };
declare const ZUpdateOrgGroupReqSchema30: unknown;
declare const ZUpdateOrgGroupResSchema30: unknown;
declare const OrgGroupType30: { INTERNAL_ORGANISATION: string };

export const updateOrgGroupRoute30 = authenticatedProcedure30
  .input(ZUpdateOrgGroupReqSchema30)
  .output(ZUpdateOrgGroupResSchema30)
  .mutation(async ({ input, ctx }: { input: { id: string; name?: string; members?: string[] }; ctx: { user: { id: number }; logger: { info: (msg: string, data?: unknown) => void } } }) => {
    const { id, ...data } = input;
    const { user } = ctx;

    ctx.logger.info('updateOrgGroupRoute30 called', { id });

    const group = await prisma30.organisationGroup.findFirst({
      where: {
        id,
        organisation: buildOrgQuery30({ orgId: undefined, userId: user.id, roles: ORG_MEMBER_ROLE_PERMS30['MANAGE_ORGANISATION'] ?? [] }),
      } as unknown,
      include: { organisationGroupMembers: true } as unknown,
    });

    if (!group) {
      throw new AppError30(AppErrorCode30.NOT_FOUND, { message: 'Organisation group not found' });
    }

    if (group.type === OrgGroupType30.INTERNAL_ORGANISATION) {
      throw new AppError30(AppErrorCode30.UNAUTHORIZED, { message: 'Cannot modify internal organisation groups' });
    }

    const callerRole = await getMemberOrgRole30({
      orgId: group.organisationId,
      reference: { type: 'User', id: user.id },
    });

    if (!isRoleInHierarchy30(callerRole, 'MEMBER')) {
      throw new AppError30(AppErrorCode30.UNAUTHORIZED, { message: 'Insufficient permissions to modify this group' });
    }

    const newMemberIds = data.members ? unique30(data.members) : undefined;
    const currentMemberIds = group.organisationGroupMembers.map((m) => m.organisationMemberId);

    await prisma30.organisationGroup.update({
      where: { id } as unknown,
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(newMemberIds !== undefined ? {
          organisationGroupMembers: {
            deleteMany: { organisationMemberId: { notIn: newMemberIds } } as unknown,
            createMany: {
              data: newMemberIds
                .filter((mid) => !currentMemberIds.includes(mid))
                .map((mid) => ({ id: generateId30(), organisationMemberId: mid })),
              skipDuplicates: true,
            } as unknown,
          },
        } : {}),
      } as unknown,
    });

    return { success: true };
  });
