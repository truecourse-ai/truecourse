
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
