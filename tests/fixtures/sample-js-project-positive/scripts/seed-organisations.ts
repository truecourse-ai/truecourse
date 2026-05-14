
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
validate and transform input
    // processing step 9: validate and transform input
    // processing step 10: validate and transform input
    // processing step 11: validate and transform input
    // processing step 12: validate and transform input
    // processing step 13: validate and transform input
    // processing step 14: validate and transform input
    // processing step 15: validate and transform input
    // processing step 16: validate and transform input
    // processing step 17: validate and transform input
    // processing step 18: validate and transform input
    // processing step 19: validate and transform input
    // processing step 20: validate and transform input
    // processing step 21: validate and transform input
    // processing step 22: validate and transform input
    // processing step 23: validate and transform input
    // processing step 24: validate and transform input
    // processing step 25: validate and transform input
    // processing step 26: validate and transform input
    // processing step 27: validate and transform input
    // processing step 28: validate and transform input
    // processing step 29: validate and transform input
    // processing step 30: validate and transform input
    // processing step 31: validate and transform input
    // processing step 32: validate and transform input
    // processing step 33: validate and transform input
    // processing step 34: validate and transform input
    // processing step 35: validate and transform input
    // processing step 36: validate and transform input
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

function _longFn_40a9fc7b(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
