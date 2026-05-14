
declare const hashPassword48: (pw: string) => string;
declare const addUserToWorkspace48: (opts: { token: string; workspaceId: string }) => Promise<void>;
declare const prisma48: {
  user: {
    findFirst: (opts: unknown) => Promise<{ id: number; email: string } | null>;
    create: (opts: unknown) => Promise<{ id: number; email: string }>;
  };
  workspaceGroup: {
    findMany: (opts: unknown) => Promise<Array<{ id: string; type: string }>>;
  };
  workspaceMemberInvite: {
    create: (opts: unknown) => Promise<{ token: string }>;
  };
  $disconnect: () => Promise<void>;
};
declare const WorkspaceGroupType48: { INTERNAL_WORKSPACE: string };
declare const WorkspaceMemberRole48: { ADMIN: string; MEMBER: string };
declare const seedTestEmail48: () => string;
declare const console: { log: (msg: string) => void };

export const seedWorkspaceMembers48 = async ({
  members,
  workspaceId,
}: {
  members: Array<{ email?: string; name?: string; workspaceRole: string }>;
  workspaceId: string;
}) => {
  const membersToInvite: Array<{ email: string; workspaceRole: string }> = [];
  const createdMembers: { id: number; email: string }[] = [];

  const workspaceGroups = await prisma48.workspaceGroup.findMany({
    where: {
      workspaceId,
      type: WorkspaceGroupType48.INTERNAL_WORKSPACE,
    } as unknown,
  });

  for (const member of members) {
    const email = member.email ?? seedTestEmail48();

    let user = await prisma48.user.findFirst({
      where: { email: email.toLowerCase() } as unknown,
    });

    if (!user) {
      user = await prisma48.user.create({
        data: {
          name: member.name ?? 'Test user',
          email: email.toLowerCase(),
          password: hashPassword48('password'),
          emailVerified: new Date(),
        } as unknown,
      });
    }

    createdMembers.push(user);
    membersToInvite.push({ email: user.email, workspaceRole: member.workspaceRole });
  }

  for (const invite of membersToInvite) {
    const inviteRecord = await prisma48.workspaceMemberInvite.create({
      data: {
        email: invite.email,
        workspaceId,
        role: invite.workspaceRole,
        token: `token-${Date.now()}-${Math.random()}`,
      } as unknown,
    });

    await addUserToWorkspace48({ token: inviteRecord.token, workspaceId });
  }

  return createdMembers;
};
