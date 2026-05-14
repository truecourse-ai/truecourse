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

function _longFn_abf76b11(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
