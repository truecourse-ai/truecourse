// deleteProjectSpace — thin-server FP shape
declare const prisma_deleteProject: {
  projectSpace: {
    findFirst: (opts: unknown) => Promise<{
      id: number;
      name: string;
      slug: string;
      organisationId: string;
      spaceGroups: Array<{
        organisationGroup: {
          organisationGroupMembers: Array<{
            organisationMember: { user: { id: number; name: string | null; email: string } };
          }>;
        };
      }>;
    } | null>;
    delete: (opts: unknown) => Promise<void>;
  };
  organisationGroup: { deleteMany: (opts: unknown) => Promise<void> };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};
declare const buildProjectSpaceWhereQuery: (opts: { spaceId: number; userId: number; roles: string[] }) => unknown;
declare const PROJECT_ROLE_PERMISSIONS_MAP: Record<string, string[]>;
declare const AppError_delete: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_delete: { UNAUTHORIZED: string; NOT_FOUND: string };
declare const jobs_delete: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };
declare const OrganisationGroupType_delete: { INTERNAL_TEAM: string };
declare const uniqueBy_delete: <T>(arr: T[], fn: (item: T) => unknown) => T[];

type DeleteProjectSpaceOptions = {
  userId: number;
  spaceId: number;
};

export const deleteProjectSpace = async ({ userId, spaceId }: DeleteProjectSpaceOptions) => {
  const space = await prisma_deleteProject.projectSpace.findFirst({
    where: buildProjectSpaceWhereQuery({
      spaceId,
      userId,
      roles: PROJECT_ROLE_PERMISSIONS_MAP['DELETE_PROJECT_SPACE'],
    }) as Parameters<typeof prisma_deleteProject.projectSpace.findFirst>[0]['where'],
    include: {
      spaceGroups: {
        include: {
          organisationGroup: {
            include: {
              organisationGroupMembers: {
                include: {
                  organisationMember: {
                    include: {
                      user: {
                        select: { id: true, name: true, email: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  } as unknown as Parameters<typeof prisma_deleteProject.projectSpace.findFirst>[0]);

  if (!space) {
    throw new AppError_delete(AppErrorCode_delete.UNAUTHORIZED, {
      message: 'You are not authorised to delete this project space',
    });
  }

  const membersToNotify = uniqueBy_delete(
    space.spaceGroups.flatMap((group) =>
      group.organisationGroup.organisationGroupMembers.map((m) => ({
        id: m.organisationMember.user.id,
        name: m.organisationMember.user.name ?? '',
        email: m.organisationMember.user.email,
      })),
    ),
    (m) => m.id,
  );

  await prisma_deleteProject.$transaction(async (tx) => {
    const txTyped = tx as typeof prisma_deleteProject;
    await txTyped.projectSpace.delete({ where: { id: spaceId } });
    await txTyped.organisationGroup.deleteMany({
      where: {
        type: OrganisationGroupType_delete.INTERNAL_TEAM,
        teamGroups: { none: {} },
      },
    });
  });

  await jobs_delete.triggerJob({
    name: 'send.project-space-deleted.email',
    payload: {
      space: { name: space.name, slug: space.slug },
      members: membersToNotify,
      organisationId: space.organisationId,
    },
  });
};
