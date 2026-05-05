/**
 * Next.js app-router route handler. Errors thrown here are caught by
 * Next.js's error boundary (error.tsx) and the route returns a 500
 * automatically. The `promise-all-no-error-handling` rule already
 * exempts `page.tsx` / `layout.tsx`, but `route.ts` / `route.tsx` files
 * are also framework-handled and must not fire.
 *
 * Mirrors documenso's `apps/docs/src/app/og/docs/[...slug]/route.tsx`
 * and `apps/docs/src/app/llms-full.txt/route.ts`.
 */

import { promises as fs } from 'fs';

export async function GET(): Promise<Response> {
  const [config, manifest] = await Promise.all([
    fs.readFile('/tmp/config.json', 'utf-8'),
    fs.readFile('/tmp/manifest.json', 'utf-8'),
  ]);
  return new Response(`${config}\n${manifest}`);
}
