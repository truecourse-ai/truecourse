declare function usePathname(): string;

export function buildWebhookFilterUrl(filters: Record<string, string>, basePath: string): string {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== 'all') {
      params.set(key, value);
    }
  });

  let path = basePath;

  if (params.toString()) {
    path += `?${params.toString()}`;
  }

  return path;
}



// FP shape: Remix route module exporting loader + default component — not a Node.js server entry point.
// process.on('uncaughtException') is not applicable here.
declare function redirect(url: string): never;
declare function json<T>(data: T, init?: { status: number }): Response;
declare function getWebhookById(id: string): Promise<{ id: string; url: string; secret: string; enabled: boolean }>;
declare function requireUserId(request: Request): Promise<string>;

export async function loader({ request, params }: { request: Request; params: { id: string } }) {
  const userId = await requireUserId(request);
  const webhook = await getWebhookById(params.id);
  if (!webhook) {
    throw redirect('/settings/webhooks');
  }
  return json({ webhook });
}

export function WebhookDetailPage({ loaderData }: { loaderData: { webhook: { id: string; url: string; secret: string; enabled: boolean } } }) {
  const { webhook } = loaderData;
  return webhook.url;
}

export default WebhookDetailPage;
