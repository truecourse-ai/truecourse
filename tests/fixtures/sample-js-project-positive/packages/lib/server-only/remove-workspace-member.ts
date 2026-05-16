
type WorkspaceMember = { id: string; userId: string };
type WorkspaceInvite = { id: string; status: string };
type Workspace = { id: string; ownerUserId: string; members: WorkspaceMember[]; invites: WorkspaceInvite[]; subscription?: { planId: string } };

declare class AppError extends Error { constructor(code: string, opts: { message: string }); }
declare function syncSeatCount(subscription: { planId: string }, count: number): Promise<void>;

async function removeWorkspaceMember(workspace: Workspace, memberId: string) {
  const memberToDelete = workspace.members.find((member) => member.id === memberId);

  if (!memberToDelete) {
    throw new AppError('NOT_FOUND', { message: 'Member not found in this workspace' });
  }

  if (memberToDelete.userId === workspace.ownerUserId) {
    throw new AppError('INVALID_REQUEST', { message: 'Cannot remove the workspace owner' });
  }

  const newMemberCount = workspace.members.length + workspace.invites.length - 1;

  if (workspace.subscription) {
    await syncSeatCount(workspace.subscription, newMemberCount);
  }

  return { removedMemberId: memberId };
}
