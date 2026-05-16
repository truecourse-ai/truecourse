
// [unknown-catch-variable] catch(err) — only console.error(err) then fixed 500 response
declare const db: { subscription: { delete(opts: { where: { id: string; userId: string } }): Promise<{ id: string }> } };
declare function parseAuthHeader(header: string | null): Promise<{ userId: string }>;

export const handleZapierUnsubscribe = async (req: Request): Promise<Response> => {
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) {
      return new Response('Unauthorized', { status: 401 });
    }
    const body = await req.json() as { subscriptionId: string };
    const auth = await parseAuthHeader(authorization);
    const deleted = await db.subscription.delete({ where: { id: body.subscriptionId, userId: auth.userId } });
    return Response.json(deleted);
  } catch (err) {
    console.error(err);
    return Response.json({ message: 'Internal Server Error' }, { status: 500 });
  }
};



// [unknown-catch-variable] catch(err) — passed to error converter as value; no property access
declare const ApiError: { toHttpError(err: unknown): { status: number; body: { code: string; message: string } } };
declare function processPaymentIntent(intentId: string, amount: number): Promise<{ id: string; status: string }>;

async function handleCreatePaymentIntent(intentId: string, amount: number): Promise<Response> {
  try {
    const result = await processPaymentIntent(intentId, amount);
    return Response.json(result);
  } catch (err) {
    const { status, body } = ApiError.toHttpError(err);
    return Response.json(body, { status });
  }
}



// [unknown-catch-variable] catch(err) — never referenced; block returns generic 500 object
declare function handleApiRequest(req: Request): Promise<{ data: unknown }>;

async function safeApiHandler(req: Request): Promise<{ data?: unknown; error?: string; status: number }> {
  try {
    const result = await handleApiRequest(req);
    return { data: result.data, status: 200 };
  } catch (err) {
    return { error: 'Internal Server Error', status: 500 };
  }
}
