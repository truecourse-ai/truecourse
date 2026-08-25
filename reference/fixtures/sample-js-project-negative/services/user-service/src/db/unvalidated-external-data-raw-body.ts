/**
 * Negative fixture for database/deterministic/unvalidated-external-data.
 *
 * The request body is destructured straight off `req.json()` and written to the
 * database with no schema validation — the real bug the rule catches. The
 * persisted values ARE the raw external payload, tainted through the request
 * receiver itself.
 */
interface ApiRequest {
  json: () => Promise<{ hookUrl: string; eventName: string }>;
}

interface Db {
  subscription: {
    create: (args: {
      data: { url: string; event: string };
    }) => Promise<{ id: string }>;
  };
}

declare const db: Db;

export async function subscribeWebhook(req: ApiRequest): Promise<{ id: string }> {
  const { hookUrl, eventName } = await req.json();

  // VIOLATION: database/deterministic/unvalidated-external-data
  return db.subscription.create({ data: { url: hookUrl, event: eventName } });
}
