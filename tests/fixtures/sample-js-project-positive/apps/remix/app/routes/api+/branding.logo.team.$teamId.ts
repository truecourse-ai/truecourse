
declare function getTeamBrandingLogo(opts: { teamId: string }): Promise<{ data: Uint8Array; contentType: string } | null>;
declare namespace Route7 { interface LoaderArgs { params: { teamId: string }; request: Request } }

export async function loader({ params }: Route7.LoaderArgs) {
  const logo = await getTeamBrandingLogo({ teamId: params.teamId });

  if (!logo) {
    throw new Response('Not found', { status: 404 });
  }

  return new Response(logo.data, {
    headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
