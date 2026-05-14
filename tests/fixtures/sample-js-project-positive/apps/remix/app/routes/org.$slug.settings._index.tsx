// remix-route-module: Remix loader-only route that performs a redirect — not a Node.js process entry point
declare function redirect(url: string): never;

export function loader({ params }: { params: { slug?: string } }) {
  if (params.slug) {
    throw redirect(`/org/${params.slug}/settings/general`);
  }
  throw redirect('/');
}
