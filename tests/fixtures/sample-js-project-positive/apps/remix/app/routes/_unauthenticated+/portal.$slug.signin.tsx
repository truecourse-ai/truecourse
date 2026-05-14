
declare function getOptionalSession(request: Request): Promise<{ isAuthenticated: boolean; user: { id: string } | null }>;
declare function prisma_findFirst(where: object): Promise<{ name: string; enabled: boolean } | null>;
declare function redirect(url: string): never;
declare namespace Route { interface LoaderArgs { request: Request; params: { slug: string } } }

export async function loader({ request, params }: Route.LoaderArgs) {
  const { isAuthenticated, user } = await getOptionalSession(request);

  const slug = params.slug;

  const portal = await prisma_findFirst({ where: { slug } });

  if (!portal || !portal.enabled) {
    throw redirect('/');
  }

  return { isAuthenticated, user, portal };
}
