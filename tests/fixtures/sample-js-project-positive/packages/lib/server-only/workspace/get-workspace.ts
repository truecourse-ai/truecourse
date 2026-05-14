
// FP: buildTeamWhereQuery is an imported utility referenced in the function body.
// ES module imports are hoisted; no use-before-define issue.
declare const prisma: { team: { findFirst: (q: unknown) => Promise<unknown> } };
declare function buildWorkspaceFilter(opts: { workspaceId?: number; userId: number }): unknown;
declare function getHighestRole(groups: unknown[]): string;

export async function getWorkspaceById(opts: { userId: number; workspaceId: number }) {
  return await prisma.team.findFirst({
    where: {
      ...buildWorkspaceFilter({ workspaceId: opts.workspaceId, userId: opts.userId }),
      id: opts.workspaceId,
    },
  });
}
