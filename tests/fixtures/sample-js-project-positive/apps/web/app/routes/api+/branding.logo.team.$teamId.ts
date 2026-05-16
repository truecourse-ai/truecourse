
declare const db: { team: { findUnique: (opts: any) => Promise<any> } };

type LoaderArgs = { params: { teamId?: string }; request: Request };

export async function loader({ params }: LoaderArgs) {
  const { teamId } = params;

  if (!teamId) {
    return Response.json(
      { status: 'error', message: 'Invalid team ID' },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({ where: { id: teamId } });

  if (!team || !team.brandingLogo) {
    return Response.json(
      { status: 'error', message: 'Logo not found' },
      { status: 404 },
    );
  }

  return new Response(team.brandingLogo, {
    headers: { 'content-type': 'image/png' },
  });
}
