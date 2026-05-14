
declare const prisma43: {
  organisationMember: {
    findMany: (opts: unknown) => Promise<Array<{
      id: string;
      userId: number;
      user: { id: number; email: string; name: string | null; avatarImageId: string | null };
      organisationGroupMembers: Array<{
        group: {
          id: string;
          teamGroups: Array<{ teamId: number; role: string }>;
        };
      }>;
    }>>;
  };
};
declare const AppError43: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode43: { UNAUTHORIZED: string };
declare const getHighestTeamRole43: (groups: unknown[]) => string;
declare const getHighestOrgRole43: (groups: unknown[]) => string;

type GetWorkspaceTeamMembersOptions43 = { userId: number; teamId: number };

export const getWorkspaceTeamMembers43 = async ({ userId, teamId }: GetWorkspaceTeamMembersOptions43) => {
  const members = await prisma43.organisationMember.findMany({
    where: {
      organisationGroupMembers: {
        some: {
          group: {
            teamGroups: { some: { teamId } },
          },
        },
      },
    } as unknown,
    include: {
      user: { select: { id: true, email: true, name: true, avatarImageId: true } } as unknown,
      organisationGroupMembers: {
        include: {
          group: { include: { teamGroups: true } as unknown },
        } as unknown,
      } as unknown,
    } as unknown,
  });

  const isAuthorized = members.some((m) => m.userId === userId);
  if (!isAuthorized) {
    throw new AppError43(AppErrorCode43.UNAUTHORIZED, { message: 'You are not a member of this team' });
  }

  return members.map((member) => {
    const groups = member.organisationGroupMembers.map((gm) => gm.group);
    const highestTeamRole = getHighestTeamRole43(groups);
    const highestOrgRole = getHighestOrgRole43(groups);

    return {
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      avatarImageId: member.user.avatarImageId,
      teamRole: highestTeamRole,
      orgRole: highestOrgRole,
    };
  });
};
