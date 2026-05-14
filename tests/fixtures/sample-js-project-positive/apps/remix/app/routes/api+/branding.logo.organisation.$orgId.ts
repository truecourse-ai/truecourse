
declare function getOrgBrandingLogo(opts: { orgId: string }): Promise<{ data: Uint8Array; contentType: string } | null>;
declare namespace RouteE { interface LoaderArgs { params: { orgId: string } } }

export async function loader({ params }: RouteE.LoaderArgs) {
  const logo = await getOrgBrandingLogo({ orgId: params.orgId });

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
