/**
 * Layered-architecture patterns that should NOT trigger
 * `architecture/deterministic/data-layer-depends-on-api`.
 *
 * Mode 1 (caller-is-api-layer-not-data-layer): route loaders and tRPC
 * context factories ARE the API/request-boundary layer themselves, so
 * calling session helpers from them is correct, not a layer violation.
 *
 * Mode 2 (imported-symbol-is-dom-utility-not-api): a `get*`-named symbol
 * sourced from a constants/utils file that reads the DOM is a client-side
 * utility, not an API call. Importing it from a UI component is allowed.
 */

declare const getOptionalSession: (request: Request) => Promise<{ user: { id: string } } | null>;

interface LoaderArgs {
  readonly request: Request;
}

interface LoaderResult {
  readonly userId: string | null;
  readonly token: string;
}

// Mode 1a: Remix route loader (`*.loader.tsx` / `routes/**`). The loader
// IS the API layer entry point; calling `getOptionalSession` here is the
// standard pattern for authenticating an HTTP request.
export async function loader({ request }: LoaderArgs): Promise<LoaderResult> {
  const session = await getOptionalSession(request);
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  return { userId: session?.user.id ?? null, token };
}

interface TrpcContextOptions {
  readonly req: Request;
}

interface TrpcContext {
  readonly req: Request;
  readonly session: { user: { id: string } } | null;
}

// Mode 1b: tRPC request-boundary context factory. `createTrpcContext` runs
// once per HTTP request and is part of the API layer; pulling the session
// off the request here is authentication infrastructure, not a data-layer
// dependency on the API layer.
export async function createTrpcContext({ req }: TrpcContextOptions): Promise<TrpcContext> {
  const session = await getOptionalSession(req);
  return { req, session };
}

declare const getPdfPagesCount: () => number;

interface FieldsViewProps {
  readonly documentId: string;
}

interface FieldsViewModel {
  readonly documentId: string;
  readonly pageCount: number;
  readonly label: string;
}

// Mode 2: UI component reads `getPdfPagesCount`, a DOM-querying helper
// living in `constants/pdf-viewer.ts`. The `get*` naming convention does
// not make it an API call, and the caller is presentation code, not a
// data-layer module.
export function buildFieldsView({ documentId }: FieldsViewProps): FieldsViewModel {
  const pageCount = getPdfPagesCount();
  return {
    documentId,
    pageCount,
    label: `Document ${documentId} (${pageCount} pages)`,
  };
}
