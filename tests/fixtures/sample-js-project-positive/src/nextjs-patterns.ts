/**
 * Next.js patterns that should NOT trigger any rules.
 *
 * Route handlers with unused positional request parameter.
 * Page and layout function signatures.
 * Dynamic route params.
 */

interface NextRequest {
  url: string;
  method: string;
}

interface RouteContext {
  params: { id: string };
}

interface PageProps {
  readonly params: { slug: string };
  readonly searchParams: Record<string, string | undefined>;
}

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  const data = await fetchData(params.id);
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: NextRequest, { params }: RouteContext): Promise<Response> {
  const body = await parseBody(request);
  const result = await saveData(params.id, body);
  return new Response(JSON.stringify(result), { status: 201 });
}

export function Page({ params, searchParams }: PageProps): string {
  const page = parseInt(searchParams.page ?? '1', 10);
  return `Page: ${params.slug}, page ${page}`;
}

export function renderLayout(children: string): string {
  return `<main>${children}</main>`;
}

async function fetchData(id: string): Promise<{ id: string; name: string }> {
  await Promise.resolve();
  return { id, name: `Item ${id}` };
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  await Promise.resolve();
  return { url: request.url };
}

async function saveData(id: string, data: Record<string, unknown>): Promise<{ id: string; saved: boolean }> {
  await Promise.resolve();
  return { id, saved: Object.keys(data).length > 0 };
}
