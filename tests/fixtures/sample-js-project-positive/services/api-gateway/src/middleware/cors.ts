
// 403 as HTTP status argument is the standard Forbidden status code
declare const c: { json(body: unknown, status: number): Response };
declare const NEXT_PUBLIC_WEBAPP_URL: () => string;

async function validateRequestOrigin(c: { req: { header(key: string): string | undefined }; json(body: unknown, status: number): Response }): Promise<Response | null> {
  const validOrigin = new URL(NEXT_PUBLIC_WEBAPP_URL()).origin;
  const headerOrigin = c.req.header('Origin');

  if (headerOrigin && headerOrigin !== validOrigin) {
    return c.json(
      {
        message: 'Forbidden',
        statusCode: 403,
      },
      403,
    );
  }

  return null;
}



// shape: async arrow satisfies middleware signature expected to return a Promise; inner corsHandler() called directly with no await needed
declare function corsHandler(req: Request, res: Response, options?: Record<string, unknown>): Response;
declare interface CorsOptions { allowedOrigins?: string[]; maxAge?: number }

function initCors(options?: CorsOptions) {
  return async (req: Request, res: Response) => corsHandler(req, res, options);
}

const corsMiddleware = initCors({ allowedOrigins: ['https://example.com'], maxAge: 86400 });
