
declare function renderToReadableStream(element: unknown, opts: { onError: (err: unknown) => void }): Promise<ReadableStream>;
declare function isbot(userAgent: string): boolean;
declare const PassThrough: new () => NodeJS.ReadWriteStream;
declare const renderToPipeableStream: (element: unknown, opts: { onShellReady: () => void; onShellError: (err: unknown) => void; onError: (err: unknown) => void }) => { pipe: (stream: NodeJS.WritableStream) => void };

export default async function handleSsrRequest(
  request: Request,
  _responseStatusCode: number,
  _responseHeaders: Headers,
  routerContext: unknown,
): Promise<Response> {
  const userAgent = request.headers.get('user-agent') ?? '';
  const isBotRequest = isbot(userAgent);

  return new Promise((resolve, reject) => {
    let responseStatusCode = _responseStatusCode;
    const { pipe, abort } = renderToPipeableStream(routerContext, {
      onShellReady() {
        const body = new PassThrough();
        _responseHeaders.set('Content-Type', 'text/html');
        resolve(
          new Response(body as unknown as ReadableStream, {
            headers: _responseHeaders,
            status: responseStatusCode,
          }),
        );
        pipe(body);
      },
      onShellError(err) {
        reject(err);
      },
      onError(err) {
        responseStatusCode = 500;
        console.error(err);
      },
    });

    setTimeout(abort, 5000);
  });
}
