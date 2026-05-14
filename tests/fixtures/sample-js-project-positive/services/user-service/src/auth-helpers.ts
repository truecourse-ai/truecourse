
// --- argument-type-mismatch shape: promise .then() with property access ---
// client.csrf.$get().then(async (res) => res.json()).csrfToken — valid chained promise, no mismatch.
interface CsrfResponse { csrfToken: string }
interface ApiClient { csrf: { $get: () => Promise<{ json: () => Promise<CsrfResponse> }> } }
declare const client: ApiClient;
async function getCsrfToken(): Promise<string> {
  const { csrfToken } = await client.csrf.$get().then(async (res) => res.json());
  return csrfToken;
}
