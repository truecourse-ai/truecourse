/**
 * Remix per-request SSR handler.
 *
 * `entry.server.tsx` is Remix's framework-managed module that exports the
 * default `handleRequest` function. Remix invokes this once per incoming
 * HTTP request to render the React tree to a stream and pipe it into the
 * response. It is NOT a Node.js process bootstrap — it does not own the
 * process lifecycle, never calls `app.listen` / `http.createServer`, and
 * must not register process-global rejection handlers.
 * Those listeners belong in the actual server bootstrap (e.g. `server.ts`
 * that runs the Remix express adapter), not here.
 *
 * The rule currently fires on this file purely because its filename
 * contains `server.`, even though the module is a per-request renderer.
 *
 * Modes covered in this single file (all three are filename-driven FPs
 * against the same rule shape — entry-point-looking path without a
 * process-level handler):
 *
 *   - remix-ssr-entry-handler   : `entry.server.tsx` itself (this file).
 *   - remix-route-module        : Sibling Remix route modules under
 *                                 `app/routes/...` are flagged for the
 *                                 same reason; the snippet below shows
 *                                 the per-route loader/component shape
 *                                 that lives next to this file.
 *   - server-suffix-utility-module : `.server.ts` utility modules (e.g.
 *                                    cookie/session storage helpers)
 *                                    that share the `server.` suffix but
 *                                    are not process entry points.
 */

declare const PassThrough: new () => {
  pipe: (dest: unknown) => unknown;
};
declare const renderToPipeableStream: (
  element: unknown,
  options: {
    onShellReady?: () => void;
    onShellError?: (error: unknown) => void;
    onError?: (error: unknown) => void;
  },
) => { pipe: (dest: { pipe: (d: unknown) => unknown }) => void; abort: () => void };
declare const RemixServer: (props: { context: unknown; url: string }) => unknown;
declare const isbot: (userAgent: string | null) => boolean;

interface EntryContext {
  readonly url: string;
}

interface ResponseHeaders {
  get: (name: string) => string | null;
  set: (name: string, value: string) => void;
}

const ABORT_DELAY = 5_000;

// Remix calls this default export once per request. There is no top-level
// side effect that owns the process; this is a renderer, not a bootstrap.
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: ResponseHeaders,
  remixContext: EntryContext,
): Promise<Response> {
  const userAgent = request.headers.get('user-agent');
  const callbackName = isbot(userAgent) ? 'onAllReady' : 'onShellReady';

  return new Promise((resolve, reject) => {
    let didError = false;

    const { pipe, abort } = renderToPipeableStream(
      RemixServer({ context: remixContext, url: request.url }),
      {
        [callbackName]: (): void => {
          const body = new PassThrough();
          responseHeaders.set('Content-Type', 'text/html');
          pipe(body);
          resolve(new Response(body as unknown as BodyInit, {
            status: didError ? 500 : responseStatusCode,
            headers: responseHeaders as unknown as HeadersInit,
          }));
        },
        onShellError(error: unknown): void {
          reject(error);
        },
        onError(error: unknown): void {
          didError = true;
          console.error(error);
        },
      } as Parameters<typeof renderToPipeableStream>[1],
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

// --- mode: remix-route-module ----------------------------------------------
// The same FP fires on every Remix route file (apps/remix/app/routes/*.tsx).
// They co-locate next to entry.server.tsx and are imported by the framework;
// they never own process lifecycle. Below is the canonical route shape.

declare const json: <T>(data: T) => { readonly data: T };
declare const useLoaderData: <T>() => T;

interface LoaderArgs {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
}

export async function loader({ params }: LoaderArgs): Promise<{ readonly data: { documentId: string } }> {
  const documentId = params.documentId ?? '';
  return json({ documentId });
}

export function AdminDocumentsIndexRoute(): unknown {
  const { documentId } = useLoaderData<{ documentId: string }>();
  return { type: 'div', props: { children: `Document ${documentId}` } };
}

// --- mode: server-suffix-utility-module ------------------------------------
// Cookie / session storage helpers conventionally use the `.server.ts` suffix
// so the Remix bundler keeps them out of the client bundle. They are pure
// utility modules — no http listener, no process handler — but the rule
// catches them because of the `server.` substring in the path.

declare const createCookieSessionStorage: <T>(opts: {
  cookie: { name: string; secrets: readonly string[]; sameSite: 'lax'; path: '/'; httpOnly: true; secure: boolean };
}) => {
  getSession: (cookieHeader: string | null) => Promise<{ get: (key: string) => T | undefined; set: (key: string, value: T) => void }>;
  commitSession: (session: unknown) => Promise<string>;
};

export const themeSessionStorage = createCookieSessionStorage<'light' | 'dark'>({
  cookie: {
    name: '__theme',
    secrets: ['s3cr3t'],
    sameSite: 'lax',
    path: '/',
    httpOnly: true,
    secure: true,
  },
});

export async function getTheme(request: Request): Promise<'light' | 'dark' | undefined> {
  const session = await themeSessionStorage.getSession(request.headers.get('Cookie'));
  return session.get('theme');
}
