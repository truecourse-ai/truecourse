
declare function renderToStream(
  element: unknown,
  options: {
    onShellReady(): void;
    onShellError(error: unknown): void;
    onError(error: unknown): void;
  }
): { pipe(dest: unknown): void; abort(): void };
declare function createPassThrough(): unknown;

function handleServerRequest(element: unknown): Promise<Response> {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToStream(element, {
      onShellReady() {
        shellRendered = true;
        const body = createPassThrough();
        resolve(new Response(null, { status: 200 }));
        pipe(body);
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        if (shellRendered) {
          console.error(error);
        }
      },
    });
    setTimeout(abort, 5000);
  });
}



declare function renderToStream(element: unknown, options: Record<string, unknown>): unknown;

function handleRequest() {
  return renderToStream(null, {
    onShellReady() {
      void 0;
    },
    onShellError(error: unknown) {
      console.error(error);
    },
    onAllReady() {
      void 0;
    },
    onError(error: unknown) {
      console.error(error);
    },
  });
}


declare const renderToString: (element: React.ReactElement) => string;
declare const ServerRouter: (props: { url: string; context: unknown }) => React.ReactElement;
declare const createStaticHandler: (routes: unknown[]) => { query: (req: Request) => Promise<unknown> };
declare const createStaticRouter: (routes: unknown[], context: unknown) => unknown;
declare const routes: unknown[];
declare const Response: new (body: string, init?: { status?: number; headers?: Record<string, string> }) => Response;

export async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
): Promise<Response> {
  const handler = createStaticHandler(routes);
  const context = await handler.query(request);

  if (context instanceof Response) {
    return context;
  }

  const router = createStaticRouter(routes, context);

  const html = renderToString(
    <ServerRouter url={request.url} context={context} />,
  );

  responseHeaders.set('Content-Type', 'text/html');

  return new Response(`<!DOCTYPE html>${html}`, {
    status: responseStatusCode,
    headers: Object.fromEntries(responseHeaders.entries()),
  });
}


// remix-ssr-entry-handler: entry.server.tsx exports handleRequest per-request, not a process bootstrap
declare function renderToStream(element: unknown, opts: object): { pipe: (writable: unknown) => void };
declare function createReadableStream(readable: unknown): ReadableStream;

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: unknown,
) {
  return new Promise<Response>((resolve) => {
    const { pipe } = renderToStream(<div />, {
      onShellReady() {
        responseHeaders.set('Content-Type', 'text/html');
        resolve(new Response(createReadableStream(pipe), {
          status: responseStatusCode,
          headers: responseHeaders,
        }));
      },
    });
  });
}
