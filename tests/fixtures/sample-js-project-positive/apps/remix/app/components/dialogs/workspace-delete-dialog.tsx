declare function navigate(path: string): Promise<void>;
declare function refreshSession(): Promise<void>;
declare function deleteWorkspace(opts: { workspaceId: string }): Promise<void>;

interface WorkspaceDeleteDialogProps {
  workspaceId: string;
  redirectTo?: string;
}

export const handleWorkspaceDelete = async ({ workspaceId, redirectTo }: WorkspaceDeleteDialogProps) => {
  await deleteWorkspace({ workspaceId });

  await refreshSession();

  if (redirectTo) {
    await navigate(redirectTo);
  }
};
