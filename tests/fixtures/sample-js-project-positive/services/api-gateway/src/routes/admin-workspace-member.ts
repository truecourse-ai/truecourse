// Positive: too-many-lines — thin server adapter pattern. The actual logic is
// short, but the arrow function body is inflated by nested schema/where/data
// object literals, mirroring the trpc procedure-builder shape that this rule
// over-fires on.
declare const adminProcedure: {
  input: (schema: unknown) => {
    output: (schema: unknown) => {
      mutation: <T>(handler: (args: { ctx: { logger: { info: (m: unknown) => void } }; input: { workspaceId: string; workspaceMemberId: string } }) => Promise<T>) => unknown;
    };
  };
};
declare const ZRemoveWorkspaceMemberRequest: { parse: (v: unknown) => { workspaceId: string; workspaceMemberId: string } };
declare const ZRemoveWorkspaceMemberResponse: { parse: (v: unknown) => void };
declare const WorkspaceMemberInviteStatus: { PENDING: 'PENDING' };
declare const prisma: {
  workspace: { findUnique: (opts: unknown) => Promise<null | { ownerUserId: string; subscription: unknown; workspaceClaim: unknown; teams: { id: string }[]; members: { id: string; userId: string }[]; invites: { id: string }[] }> };
  $transaction: (fn: (tx: { envelope: { updateMany: (opts: unknown) => Promise<void> }; workspaceMember: { delete: (opts: unknown) => Promise<void> } }) => Promise<void>) => Promise<void>;
};
declare const billing: { reconcileSeatPlan: (sub: unknown, claim: unknown, count: number) => Promise<void> };
declare const jobs: { triggerJob: (opts: unknown) => Promise<void> };
declare class WorkspaceError extends Error { constructor(code: string, opts: { message: string }); }
declare const WorkspaceErrorCode: { NOT_FOUND: 'NOT_FOUND'; INVALID_REQUEST: 'INVALID_REQUEST' };

// Pre-validate at module load so the rule's Zod-pattern detector lights up the
// same way it does on a real trpc admin router.
const _sampleRequest = ZRemoveWorkspaceMemberRequest.parse({ workspaceId: '', workspaceMemberId: '' });
void _sampleRequest;

export const removeAdminWorkspaceMemberRoute = adminProcedure
  .input(ZRemoveWorkspaceMemberRequest)
  .output(ZRemoveWorkspaceMemberResponse)
  .mutation(async ({ ctx, input }) => {
    const { workspaceId, workspaceMemberId } = input;

    ctx.logger.info({
      input: {
        workspaceId,
        workspaceMemberId,
      },
    });

    const workspace = await prisma.workspace.findUnique({
      where: {
        id: workspaceId,
      },
      include: {
        subscription: true,
        workspaceClaim: true,
        teams: {
          select: {
            id: true,
          },
        },
        members: {
          select: {
            id: true,
            userId: true,
          },
        },
        invites: {
          where: {
            status: WorkspaceMemberInviteStatus.PENDING,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!workspace) {
      throw new WorkspaceError(WorkspaceErrorCode.NOT_FOUND, {
        message: 'Workspace not found',
      });
    }

    const memberToRemove = workspace.members.find((member) => member.id === workspaceMemberId);

    if (!memberToRemove) {
      throw new WorkspaceError(WorkspaceErrorCode.NOT_FOUND, {
        message: 'Member not found in this workspace',
      });
    }

    if (memberToRemove.userId === workspace.ownerUserId) {
      throw new WorkspaceError(WorkspaceErrorCode.INVALID_REQUEST, {
        message: 'Cannot remove the workspace owner. Transfer ownership first.',
      });
    }

    const projectedMemberCount = workspace.members.length + workspace.invites.length - 1;

    if (workspace.subscription) {
      await billing.reconcileSeatPlan(
        workspace.subscription,
        workspace.workspaceClaim,
        projectedMemberCount,
      );
    }

    const teamIds = workspace.teams.map((team) => team.id);

    await prisma.$transaction(async (tx) => {
      if (teamIds.length > 0) {
        await tx.envelope.updateMany({
          where: {
            userId: memberToRemove.userId,
            teamId: {
              in: teamIds,
            },
          },
          data: {
            userId: workspace.ownerUserId,
          },
        });
      }

      await tx.workspaceMember.delete({
        where: {
          id: workspaceMemberId,
          workspaceId,
        },
      });
    });

    await jobs.triggerJob({
      name: 'send.workspace-member-removed.email',
      payload: {
        workspaceId,
        memberUserId: memberToRemove.userId,
      },
    });
  });
