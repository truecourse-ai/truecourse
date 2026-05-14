
// FP: React route with loader and default export component — standard Remix route structure inflates line count
declare const getOptionalSession: (request: Request) => Promise<{ user?: { id: number; email: string } } | null>;
declare const acceptTeamInvitation: (token: string, userId?: number) => Promise<{ success: boolean; teamName: string }>;
declare const prisma: { teamMemberInvite: { findUnique: (args: unknown) => Promise<{ token: string; teamId: number; email: string; team: { name: string } } | null> } };
declare const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean; variant?: string }>;
declare const Trans: React.FC<{ children: React.ReactNode }>;
declare const Link: React.FC<{ to: string; className?: string; children: React.ReactNode }>;
declare type Route = { LoaderArgs: { params: Record<string, string>; request: Request }; ComponentProps: { loaderData: unknown } };

export async function loader({ params, request }: Route['LoaderArgs']) {
  const session = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    return { state: 'InvalidLink' } as const;
  }

  const teamMemberInvite = await prisma.teamMemberInvite.findUnique({
    where: { token },
    include: {
      team: {
        select: { name: true },
      },
    },
  });

  if (!teamMemberInvite) {
    return { state: 'InvalidLink' } as const;
  }

  if (session?.user) {
    try {
      await acceptTeamInvitation(token, session.user.id);
      return { state: 'Accepted', teamName: teamMemberInvite.team.name } as const;
    } catch {
      return { state: 'Error', teamName: teamMemberInvite.team.name } as const;
    }
  }

  return {
    state: 'NotLoggedIn',
    teamName: teamMemberInvite.team.name,
    inviteEmail: teamMemberInvite.email,
    token,
  } as const;
}

export default function TeamInvitePage({ loaderData }: Route['ComponentProps']) {
  const data = loaderData as ReturnType<typeof loader> extends Promise<infer T> ? T : never;

  if (data.state === 'InvalidLink') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold">
          <Trans>Invalid Invitation</Trans>
        </h1>
        <p className="text-muted-foreground mb-6">
          <Trans>This invitation link is invalid or has already been used.</Trans>
        </p>
        <Button asChild>
          <Link to="/"><Trans>Go Home</Trans></Link>
        </Button>
      </div>
    );
  }

  if (data.state === 'Accepted') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold">
          <Trans>Welcome to {(data as { teamName: string }).teamName}</Trans>
        </h1>
        <p className="text-muted-foreground mb-6">
          <Trans>You have successfully joined the team.</Trans>
        </p>
        <Button asChild>
          <Link to="/"><Trans>Go to Dashboard</Trans></Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="mb-2 text-2xl font-bold">
        <Trans>Team Invitation</Trans>
      </h1>
      <p className="text-muted-foreground mb-6">
        <Trans>
          You have been invited to join{' '}
          <span className="font-semibold">{(data as { teamName?: string }).teamName}</span>.
          Sign in to accept the invitation.
        </Trans>
      </p>
      <Button asChild>
        <Link to={`/sign-in?callbackUrl=/team/invite/${(data as { token?: string }).token ?? ''}`}>
          <Trans>Sign In to Accept</Trans>
        </Link>
      </Button>
    </div>
  );
}


// TSX invite route: loader + default export with JSX branches — standard Remix unauthenticated route structure
declare function resolveOrgInviteToken(opts: { token: string }): Promise<{ id: number; email: string; orgId: number; org: { name: string; logoUrl: string | null } } | null>;
declare function acceptOrgInvite(opts: { token: string; userId: number }): Promise<void>;
declare function getSessionUser(request: Request): Promise<{ id: number; email: string } | null>;
declare const OrgBadge: React.FC<{ name: string; logoUrl: string | null }>;
declare const ActionButton: React.FC<{ to: string; variant?: string; children: React.ReactNode }>;

export async function orgInviteLoader({ params, request }: { params: { token?: string }; request: Request }) {
  if (!params.token) {
    return { state: 'InvalidLink' as const };
  }

  const invite = await resolveOrgInviteToken({ token: params.token });

  if (!invite) {
    return { state: 'InvalidLink' as const };
  }

  const user = await getSessionUser(request);

  if (user) {
    try {
      await acceptOrgInvite({ token: params.token, userId: user.id });
      return { state: 'Accepted' as const, orgName: invite.org.name, logoUrl: invite.org.logoUrl };
    } catch {
      return { state: 'Error' as const, orgName: invite.org.name };
    }
  }

  return {
    state: 'PendingLogin' as const,
    orgName: invite.org.name,
    logoUrl: invite.org.logoUrl,
    inviteEmail: invite.email,
    token: params.token,
  };
}

export function OrgInvitePage({ loaderData }: { loaderData: Awaited<ReturnType<typeof orgInviteLoader>> }) {
  if (loaderData.state === 'InvalidLink') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="mb-2 text-2xl font-bold">Invalid Invitation</h1>
        <p className="text-muted-foreground mb-6">This invitation link is invalid or has expired.</p>
        <ActionButton to="/">Go Home</ActionButton>
      </div>
    );
  }

  if (loaderData.state === 'Accepted') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <OrgBadge name={loaderData.orgName} logoUrl={loaderData.logoUrl} />
        <h1 className="mb-2 text-2xl font-bold">Welcome to {loaderData.orgName}</h1>
        <p className="text-muted-foreground mb-6">You have successfully joined the organisation.</p>
        <ActionButton to="/dashboard">Go to Dashboard</ActionButton>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-2 text-2xl font-bold">Organisation Invitation</h1>
      <p className="text-muted-foreground mb-6">
        You have been invited to join <span className="font-semibold">{(loaderData as { orgName: string }).orgName}</span>. Sign in to accept.
      </p>
      <ActionButton to={`/sign-in?next=/org/invite/${(loaderData as { token?: string }).token ?? ''}`}>
        Sign In to Accept
      </ActionButton>
    </div>
  );
}

