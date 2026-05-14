declare function analyticsProxy(request: Request): Promise<Response>;

export async function loader({ request }: { request: Request }) {
  return analyticsProxy(request);
}

export async function action({ request }: { request: Request }) {
  return analyticsProxy(request);
}
