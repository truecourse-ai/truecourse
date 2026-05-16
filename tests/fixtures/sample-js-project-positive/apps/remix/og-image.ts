
// FP shape: CSS property string in a single satori inline style object (single-usage-false-trigger)
declare function generateOgImage(element: unknown, options: unknown): Promise<Buffer>;

async function renderShareOgImage(title: string, logoUrl: string) {
  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        height: '100%',
        width: '100%',
        backgroundColor: 'white',
        position: 'relative',
      },
      children: [{ type: 'span', props: { children: title } }],
    },
  };

  return generateOgImage(element, { width: 1200, height: 630 });
}



// FP shape: HTTP 404 Response throw in a standalone route loader (protocol-api-vocabulary)
declare function getTemplateByToken(token: string): Promise<{ enabled: boolean } | null>;

async function directLinkLoader(params: { token?: string }) {
  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const template = await getTemplateByToken(token).catch(() => null);

  if (!template || !template.enabled) {
    throw new Response('Not Found', { status: 404 });
  }

  return { template };
}



// FP shape: standard HTTP 404 throws in parallel independent route loaders (protocol-api-vocabulary)
declare function getRecipientByToken(token: string): Promise<{ id: string } | null>;
declare function getDocumentByToken(token: string): Promise<{ id: string; status: string } | null>;

async function signTokenLoader(params: { token?: string }) {
  if (!params.token) {
    throw new Response('Not Found', { status: 404 });
  }

  const recipient = await getRecipientByToken(params.token);

  if (!recipient) {
    throw new Response('Not Found', { status: 404 });
  }

  return { recipient };
}

async function viewTokenLoader(params: { token?: string }) {
  if (!params.token) {
    throw new Response('Not Found', { status: 404 });
  }

  const document = await getDocumentByToken(params.token);

  if (!document) {
    throw new Response('Not Found', { status: 404 });
  }

  return { document };
}



// --- FP shape: Next.js route handler (GET) returning ImageResponse; trivially inferred from body, codebase pattern ---
declare class ImageResponse {
  constructor(element: unknown, opts: { width: number; height: number; fonts: unknown[] });
}
declare function notFound2(): never;
declare const source2: { getPage(slug: string[]): { data: { title: string } } | undefined };
declare function fetchFontData(name: string, weight: number): Promise<ArrayBuffer>;

declare interface RouteContext { params: Promise<{ slug: string[] }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const { slug } = await params;
  const page = source2.getPage(slug.slice(0, -1));

  if (!page) {
    notFound2();
  }

  const fontData = await fetchFontData('Inter', 700);

  return new ImageResponse(
    <div style={{ fontSize: 64 }}>{page.data.title}</div>,
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Inter', data: fontData, weight: 700 as const }],
    },
  );
}
