
declare const getSessionOpt12: (req: Request) => Promise<{ user: { id: string } | null }>;
declare const acceptTeamInvite12: (opts: { token: string }) => Promise<void>;
declare const prisma12: {
  teamMemberInvite: {
    findUnique: (opts: { where: { token: string }; include: unknown }) => Promise<{ email: string; token: string; team: { name: string }; status: string } | null>;
  };
  user: {
    findFirst: (opts: { where: unknown; select: unknown }) => Promise<{ id: string } | null>;
  };
};
declare const Button12: React.ComponentType<{ asChild?: boolean; variant?: string; children: React.ReactNode }>;
declare const Link12: React.ComponentType<{ to: string; children: React.ReactNode }>;
declare const superLoaderJson12: <T>(data: T) => T;
declare const useSuperLoaderData12: <T>() => T;

type TeamInviteLoaderData12 =
  | { state: 'InvalidLink' }
  | { state: 'LoginRequired'; email: string; teamName: string }
  | { state: 'Success'; email: string; teamName: string; isCurrentUser: boolean };

export async function teamInviteLoader12({ params, request }: { params: { token?: string }; request: Request }): Promise<TeamInviteLoaderData12> {
  const session = await getSessionOpt12(request);
  const { token } = params;

  if (!token) {
    return { state: 'InvalidLink' };
  }

  const invite = await prisma12.teamMemberInvite.findUnique({
    where: { token },
    include: { team: { select: { name: true } } },
  });

  if (!invite) {
    return { state: 'InvalidLink' };
  }

  const user = await prisma12.user.findFirst({
    where: { email: { equals: invite.email, mode: 'insensitive' } as unknown },
    select: { id: true },
  });

  if (user) {
    await acceptTeamInvite12({ token: invite.token });
  }

  if (!user) {
    return { state: 'LoginRequired', email: invite.email, teamName: invite.team.name };
  }

  return {
    state: 'Success',
    email: invite.email,
    teamName: invite.team.name,
    isCurrentUser: user.id === session.user?.id,
  };
}

export function TeamInviteAcceptPage12() {
  const data = useSuperLoaderData12<TeamInviteLoaderData12>();

  if (data.state === 'InvalidLink') {
    return (
      <div className="w-screen max-w-lg px-4">
        <h1 className="text-2xl font-bold">Invalid invitation link</h1>
        <p className="mt-2 text-muted-foreground">This invitation link is invalid or has already been used.</p>
        <Button12 asChild className="mt-4">
          <Link12 to="/signin">Sign in</Link12>
        </Button12>
      </div>
    );
  }

  if (data.state === 'LoginRequired') {
    return (
      <div className="w-screen max-w-lg px-4">
        <h1 className="text-2xl font-bold">Join {data.teamName}</h1>
        <p className="mt-2 text-muted-foreground">
          Create an account with <strong>{data.email}</strong> to join this team.
        </p>
        <Button12 asChild className="mt-4">
          <Link12 to={`/signup?email=${encodeURIComponent(data.email)}`}>Create account</Link12>
        </Button12>
      </div>
    );
  }

  return (
    <div className="w-screen max-w-lg px-4">
      <h1 className="text-2xl font-bold">Joined {data.teamName}</h1>
      <p className="mt-2 text-muted-foreground">
        You have successfully joined <strong>{data.teamName}</strong>.
      </p>
      {data.isCurrentUser ? (
        <Button12 asChild className="mt-4">
          <Link12 to="/dashboard">Go to dashboard</Link12>
        </Button12>
      ) : (
        <Button12 asChild className="mt-4">
          <Link12 to="/signin">Sign in to continue</Link12>
        </Button12>
      )}
    </div>
  );
}
if (data.state === 'LoginRequired') {
    return (
      <div className="w-screen max-w-lg px-4">
        <h1 className="text-2xl font-bold">Join {data.teamName}</h1>
        <p className="mt-2 text-muted-foreground">
          Create an account with <strong>{data.email}</strong> to join this team.
        </p>
        <Button12 asChild className="mt-4">
          <Link12 to={`/signup?email=${encodeURIComponent(data.email)}`}>Create account</Link12>
        </Button12>
      </div>
    );
  }

  return (
    <div className="w-screen max-w-lg px-4">
      <h1 className="text-2xl font-bold">Joined {data.teamName}</h1>
      <p className="mt-2 text-muted-foreground">
        You have successfully joined <strong>{data.teamName}</strong>.
      </p>
      {data.isCurrentUser ? (
        <Button12 asChild className="mt-4">
          <Link12 to="/dashboard">Go to dashboard</Link12>
        </Button12>
      ) : (
        <Button12 asChild className="mt-4">
          <Link12 to="/signin">Sign in to continue</Link12>
        </Button12>
      )}
    </div>
  );
}

function _longFn_295dceba(input: number): number {
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
