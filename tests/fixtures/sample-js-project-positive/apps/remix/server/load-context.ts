// Dynamically imported via import() in vite.config.ts — static graph analysis misses this
// Also: job definitions imported via barrel aggregators in packages/lib/jobs/client.ts

export interface AppLoadContext {
  userId: string | null;
  sessionId: string | null;
  requestId: string;
  env: Record<string, string>;
}

export function getLoadContext(request: Request): AppLoadContext {
  return {
    userId: extractUserIdFromRequest(request),
    sessionId: extractSessionIdFromRequest(request),
    requestId: generateRequestId(),
    env: process.env as Record<string, string>,
  };
}

declare function extractUserIdFromRequest(req: Request): string | null;
declare function extractSessionIdFromRequest(req: Request): string | null;
declare function generateRequestId(): string;
