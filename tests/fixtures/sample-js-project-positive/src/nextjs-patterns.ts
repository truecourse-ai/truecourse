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



// Positive: data-layer-depends-on-api — route loader is the HTTP layer,
// not the data layer. Calling getOptionalSession(request) inside a loader
// is correct: session validation is auth infrastructure consumed by the
// HTTP entry-point, not by a data-layer module.
declare function getOptionalSession(req: { headers: Record<string, string> }): Promise<{ user: { id: string } | null }>;
declare function fetchDocumentByToken(opts: { token: string; userId?: string }): Promise<{ id: string; title: string } | null>;
declare function fetchRecipientByToken(opts: { token: string }): Promise<{ id: string; email: string } | null>;
declare function redirect(url: string): never;

interface LoaderArgs {
  request: { headers: Record<string, string> };
  params: Record<string, string | undefined>;
}

export async function loader({ request, params }: LoaderArgs) {
  const { user } = await getOptionalSession(request);

  const { token } = params;
  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const [document, recipient] = await Promise.all([
    fetchDocumentByToken({ token, userId: user?.id }).catch(() => null),
    fetchRecipientByToken({ token }).catch(() => null),
  ]);

  if (!document || !recipient) {
    return redirect('/sign/expired');
  }

  return { document, recipient, user };
}



// Pagination loader — numeric fallbacks via `Number(param) || default` are
// self-documenting defaults, not magic numbers.

declare const searchParams: URLSearchParams;
declare function fetchAuditEvents(opts: {
  page: number;
  pageSize: number;
  query: string;
}): Promise<{ items: unknown[]; total: number }>;

export async function loadAuditLog() {
  const page = Number(searchParams.get('page')) || 1;
  const pageSize = Number(searchParams.get('pageSize')) || 25;
  const query = searchParams.get('query') || '';

  return fetchAuditEvents({ page, pageSize, query });
}



// Search params read — URL query key as string literal
declare function useSearchParams(): URLSearchParams;
declare function useState<T>(init: T | (() => T)): [T, (v: T) => void];

function AdminSearchBar() {
  const searchParams = useSearchParams();
  const [filterQuery, setFilterQuery] = useState(() => searchParams?.get('query') ?? '');
  return filterQuery;
}



// HTTP 404 thrown as Response — standard web platform pattern
declare function getParamsFromRequest(): { id?: string; teamUrl?: string };

async function loadTeamDocumentPage(params: ReturnType<typeof getParamsFromRequest>) {
  const { id, teamUrl } = params;

  if (!id || !teamUrl) {
    throw new Response('Not Found', { status: 404 });
  }

  return { id, teamUrl };
}



// pathname.startsWith with a route prefix string — standard URL routing check
declare function useLocation(): { pathname: string | undefined };
declare function cn(...args: unknown[]): string;

function isProfileRoute() {
  const { pathname } = useLocation();
  return cn('w-full justify-start', pathname?.startsWith('/settings/profile') && 'bg-secondary');
}



// params.set('status', value) — URLSearchParams mutation with a query key string
declare function useSearchParams(): URLSearchParams;

function buildStatusFilterUrl(status: string, baseUrl: string): string {
  const params = new URLSearchParams();
  params.set('status', status);
  return `${baseUrl}?${params.toString()}`;
}



// throw new Response('Not found', { status: 404 }) — standard web platform error response pattern
async function loadEmbedSignPage(params: { token?: string }) {
  if (!params.token) {
    throw new Response('Not found', { status: 404 });
  }
  return { token: params.token };
}



declare const readFile: (path: URL) => Promise<Buffer>;
declare const ImageResponse: new (element: any, opts: any) => Response;
declare const notFound: () => never;
declare const source: { getPage: (slug: string[]) => any; getPages: () => any[] };
declare const getPageImage: (page: any) => { segments: string[] };
declare const fileURLToPath: (url: URL) => string;

type OgRouteContext = { params: Promise<{ slug: string[] }> };

export const revalidate = false;

const loadOgAssets = async () => {
  const [logoBuffer, regularFontData, boldFontData] = await Promise.all([
    readFile(new URL('../../../../public/logo.png', import.meta.url)),
    readFile(new URL('../../../../public/fonts/inter-regular.ttf', import.meta.url)),
    readFile(new URL('../../../../public/fonts/inter-bold.ttf', import.meta.url)),
  ]);

  return {
    logoSrc: `data:image/png;base64,${logoBuffer.toString('base64')}`,
    fonts: [
      { name: 'Inter', data: regularFontData, weight: 400 as const, style: 'normal' as const },
      { name: 'Inter', data: boldFontData, weight: 700 as const, style: 'normal' as const },
    ],
  };
};

export async function GET(_req: Request, { params }: OgRouteContext) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));

  if (!page) {
    notFound();
  }

  const { logoSrc, fonts } = await loadOgAssets();

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff',
        padding: '60px 80px',
        fontFamily: 'Inter',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '6px',
          backgroundColor: '#3b82f6',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <img src={logoSrc} alt="App" height="28" />
        <span style={{ color: '#d4d4d8', fontSize: '28px', fontWeight: 400 }}>|</span>
        <span style={{ color: '#71717a', fontSize: '20px', fontWeight: 400 }}>Docs</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <h1
          style={{
            color: '#18181b',
            fontSize: page.data.title.length > 40 ? '48px' : '56px',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: '-0.025em',
            margin: 0,
          }}
        >
          {page.data.title}
        </h1>
        {page.data.description && (
          <p
            style={{
              color: '#71717a',
              fontSize: '22px',
              fontWeight: 400,
              lineHeight: 1.4,
              margin: 0,
              maxWidth: '900px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {page.data.description}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ color: '#a1a1aa', fontSize: '16px', fontWeight: 400 }}>docs.example.com{page.url}</span>
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
