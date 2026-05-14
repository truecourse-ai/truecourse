
// [unknown-catch-variable] catch(err) — instanceof AppError before .message; non-match raw console.error
declare class AppError extends Error { code: string; message: string }
declare function registerZapierSubscription(opts: { hookUrl: string; event: string; userId: string }): Promise<{ id: string }>;

async function handleZapierSubscribe(hookUrl: string, event: string, userId: string): Promise<Response> {
  try {
    const subscription = await registerZapierSubscription({ hookUrl, event, userId });
    return Response.json(subscription);
  } catch (err) {
    if (err instanceof AppError) {
      return Response.json({ message: err.message }, { status: 400 });
    }
    console.error(err);
    return Response.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
