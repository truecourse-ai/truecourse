

// --- missing-boundary-types shape: nextjs-options-route-handler ---
declare function cors(request: Request, response: Response): Response;

export function GET(request: Request) {
  return cors(
    request,
    new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export function OPTIONS(request: Request) {
  return cors(
    request,
    new Response(null, { status: 204 }),
  );
}




// --- missing-return-type shape: nextjs-options-route-handler (framework-mandated export) ---
declare function cors(request: Request, response: Response): Response;

export function OPTIONS(request: Request) {
  return cors(
    request,
    new Response(null, { status: 204 }),
  );
}




// --- missing-return-type shape: nextjs-get-route-handler (framework-mandated export) ---
declare function getServerDocs(): Promise<string>;

export async function GET() {
  const docs = await getServerDocs();

  return new Response(docs, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
