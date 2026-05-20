/**
 * Positive fixture for bugs/deterministic/missing-return-await.
 *
 * Hono-style controllers return `c.json(...)` / `c.text(...)` which are
 * synchronous Responses — no Promise to await. The rule previously
 * matched any `return someCall(...)` in an async try/catch unless the
 * receiver matched a hardcoded short-list (`NextResponse`, `Response`,
 * `res`, `reply`). Hono's request context is conventionally `c`, which
 * misses the short-list. The fix is type-aware: ask the compiler
 * whether the returned expression is actually Promise-like.
 */

interface HonoResponse {
  readonly status: number;
}

interface HonoContext {
  json(body: Record<string, unknown>, status?: number): HonoResponse;
  text(body: string): HonoResponse;
}

interface FileService {
  list(): Promise<readonly string[]>;
  normaliseStoredId(id: string): Promise<string | null>;
}

export async function listFiles(c: HonoContext, service: FileService): Promise<HonoResponse> {
  try {
    const items = await service.list();
    // c.json returns a Response synchronously — no rejection to catch.
    return c.json({ items });
  } catch (err: unknown) {
    return c.text(`error: ${String(err)}`);
  }
}

export async function normaliseId(service: FileService, existingId: string): Promise<string> {
  try {
    const fromStore = await service.normaliseStoredId(existingId);
    // `.trim()` returns a string, not a Promise — nothing to await.
    return (fromStore ?? existingId).trim();
  } catch (err: unknown) {
    return String(err);
  }
}
