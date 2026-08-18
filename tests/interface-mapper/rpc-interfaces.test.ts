/**
 * THE RPC DERIVATION (SPEC_GUARD_PLAN item 12) — a tRPC router tree composed into
 * the HTTP operations an adapter actually serves.
 *
 * Like the api-tree tests, the fixtures run real source through the real
 * analyzer, so this covers the extractor → mapper seam. Two shapes are pinned
 * because they are the two the derivation was built against: a t3 app (one
 * `~/server/api/trpc` builder, the root in `root.ts`, the Next app-router handler
 * at `app/api/trpc/[trpc]/route.ts`) and cal.com's (`viewer.bookings.get`, four
 * segments through child routers in three files).
 *
 * The rule with the most weight here is the one that derives NOTHING: no mount
 * evidence, no operations. tRPC's `/api/trpc` is a convention, and an operation
 * at an address nobody serves is worse than one nobody mapped.
 */

import { describe, it, expect } from 'vitest'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { deriveRpcOperations } from '../../packages/interface-mapper/src/rpc-interfaces'
import { deriveApiInterfacesFromTree } from '../../packages/interface-mapper/src/api-tree'
import type { FileAnalysis } from '../../packages/shared/src/index'

function analyze(filePath: string, source: string): FileAnalysis {
  return analyzeFileContent(filePath, source, 'typescript')
}

/** The Next app-router handler every t3 app ships — its LOCATION is the mount. */
const NEXT_HANDLER = `
  import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
  import { appRouter } from "~/server/api/root";

  const handler = (req: Request) =>
    fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext });

  export { handler as GET, handler as POST };
`

const T3_ROOT = `
  import { createTRPCRouter } from "~/server/api/trpc";
  import { postRouter } from "~/server/api/routers/post";

  export const appRouter = createTRPCRouter({
    post: postRouter,
    health: publicProcedure.query(() => "ok"),
  });
`

const T3_POST_ROUTER = `
  import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";

  export const postRouter = createTRPCRouter({
    getLatest: publicProcedure.query(({ ctx }) => ctx.db.post.findFirst()),
    create: protectedProcedure.input(schema).mutation(({ input }) => save(input)),
    onAdd: publicProcedure.subscription(() => stream()),
  });
`

const T3_TREE = [
  analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
  analyze('src/server/api/root.ts', T3_ROOT),
  analyze('src/server/api/routers/post.ts', T3_POST_ROUTER),
]

describe('deriveRpcOperations — composition', () => {
  const seeds = deriveRpcOperations(T3_TREE)

  it('composes the key path from the root down and mounts it where the adapter sits', () => {
    expect(seeds.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /api/trpc/health',
      'POST /api/trpc/post.create',
      'GET /api/trpc/post.getLatest',
    ])
  })

  it('carries the dotted procedure as the join key on every seed', () => {
    expect(seeds.map((s) => s.procedure)).toEqual(['health', 'post.create', 'post.getLatest'])
  })

  it('derives no operation for a subscription — it is not an HTTP method the runner has', () => {
    expect(seeds.some((s) => s.procedure?.endsWith('onAdd'))).toBe(false)
  })

  it('composes a four-segment name through child routers in other files', () => {
    // cal.com's shape: app → viewer → bookings → get.
    const tree = [
      analyze('apps/web/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze(
        'packages/trpc/server/routers/_app.ts',
        `
          import { router } from "../trpc";
          import { viewerRouter } from "./viewer/_router";
          export const appRouter = router({ viewer: viewerRouter });
        `,
      ),
      analyze(
        'packages/trpc/server/routers/viewer/_router.ts',
        `
          import { router } from "../../trpc";
          import { bookingsRouter } from "./bookings/_router";
          export const viewerRouter = router({ bookings: bookingsRouter });
        `,
      ),
      analyze(
        'packages/trpc/server/routers/viewer/bookings/_router.ts',
        `
          import { router, authedProcedure } from "../../../trpc";
          export const bookingsRouter = router({
            get: authedProcedure.input(schema).query(handler),
            confirm: authedProcedure.input(schema).mutation(handler),
          });
        `,
      ),
    ]
    expect(deriveRpcOperations(tree).map((s) => `${s.method} ${s.path}`)).toEqual([
      'POST /api/trpc/viewer.bookings.confirm',
      'GET /api/trpc/viewer.bookings.get',
    ])
  })

  it('resolves a child router by the importing file when two files declare the name', () => {
    const shared = `
      import { router, publicProcedure } from "../trpc";
      export const itemsRouter = router({ list: publicProcedure.query(fn) });
    `
    const tree = [
      analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze(
        'src/server/root.ts',
        `
          import { router } from "./trpc";
          import { itemsRouter } from "./admin/items";
          export const appRouter = router({ admin: itemsRouter });
        `,
      ),
      analyze('src/server/admin/items.ts', shared),
      analyze('src/server/public/items.ts', shared),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.procedure)).toEqual(['admin.list'])
  })

  it('drops a child nothing resolves rather than composing a name the server lacks', () => {
    const tree = [
      analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze(
        'src/server/root.ts',
        `
          import { router, publicProcedure } from "./trpc";
          import { ghostRouter } from "@acme/elsewhere";
          export const appRouter = router({
            ghost: ghostRouter,
            ping: publicProcedure.query(fn),
          });
        `,
      ),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.procedure)).toEqual(['ping'])
  })

  it('survives a router tree that names itself', () => {
    const tree = [
      analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze(
        'src/server/root.ts',
        `
          import { router, publicProcedure } from "./trpc";
          export const appRouter = router({ self: appRouter, ping: publicProcedure.query(fn) });
        `,
      ),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.procedure)).toEqual(['ping'])
  })
})

describe('deriveRpcOperations — the mount', () => {
  it('derives nothing when no adapter states a mount', () => {
    // The whole tree is there and readable. `/api/trpc` is still a convention,
    // not a fact this repository stated.
    expect(deriveRpcOperations(T3_TREE.slice(1))).toEqual([])
  })

  it('reads the mount off a Next PAGES handler', () => {
    const tree = [
      analyze('src/pages/api/trpc/[trpc].ts', NEXT_HANDLER),
      ...T3_TREE.slice(1),
    ]
    expect(deriveRpcOperations(tree)[0]?.path).toBe('/api/trpc/health')
  })

  it('reads the mount off a remix flat adapter route', () => {
    const tree = [
      analyze(
        'app/routes/api.trpc.$trpc.ts',
        `
          import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
          import { appRouter } from "~/server/api/root";
          export const loader = ({ request }) =>
            fetchRequestHandler({ endpoint: "/api/trpc", req: request, router: appRouter });
        `,
      ),
      ...T3_TREE.slice(1),
    ]
    expect(deriveRpcOperations(tree)[0]?.path).toBe('/api/trpc/health')
  })

  it('reads the mount off an express adapter’s own `use` call', () => {
    const tree = [
      analyze(
        'src/server.ts',
        `
          import express from 'express'
          import * as trpcExpress from '@trpc/server/adapters/express'
          import { appRouter } from './server/api/root'

          const app = express()
          app.use('/trpc', trpcMiddleware)
          app.listen(3000)
        `,
      ),
      ...T3_TREE.slice(1),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.path)).toContain('/trpc/health')
  })

  it('derives nothing when two adapters state two different mounts', () => {
    const tree = [
      analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze('src/pages/api/v2/trpc/[trpc].ts', NEXT_HANDLER),
      ...T3_TREE.slice(1),
    ]
    expect(deriveRpcOperations(tree)).toEqual([])
  })

  it('is unbothered by the same mount stated twice', () => {
    const tree = [
      analyze('apps/web/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      analyze('apps/admin/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER),
      ...T3_TREE.slice(1),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.procedure)).toEqual([
      'health',
      'post.create',
      'post.getLatest',
    ])
  })

  it('derives nothing from a repo with no routers at all', () => {
    expect(deriveRpcOperations([analyze('src/app/api/trpc/[trpc]/route.ts', NEXT_HANDLER)])).toEqual([])
  })
})

describe('deriveRpcOperations — the root', () => {
  it('takes the router the ADAPTER names, not the biggest tree', () => {
    // A repo with a second, unmounted router (a fixture, a legacy tree) still has
    // exactly one root: the one the handler imports.
    const tree = [
      ...T3_TREE,
      analyze(
        'src/server/legacy/root.ts',
        `
          import { router, publicProcedure } from "../trpc";
          export const legacyRouter = router({ old: publicProcedure.query(fn) });
        `,
      ),
    ]
    expect(deriveRpcOperations(tree).map((s) => s.procedure)).toEqual([
      'health',
      'post.create',
      'post.getLatest',
    ])
  })
})

describe('the api derivation with an RPC tree', () => {
  const interfaces = deriveApiInterfacesFromTree(T3_TREE)

  it('mints the same ids the route derivation would for the same operations', () => {
    expect(interfaces.map((j) => j.id)).toEqual([
      'api/get-api-trpc-health',
      'api/post-api-trpc-post-create',
      'api/get-api-trpc-post-getlatest',
    ])
  })

  it('marks each one with the procedure it is', () => {
    expect(interfaces.map((j) => j.procedure)).toEqual(['health', 'post.create', 'post.getLatest'])
  })

  it('fingerprints them as the operations they are — the procedure is not identity', () => {
    const rpc = interfaces.find((j) => j.procedure === 'health')!
    const plain = deriveApiInterfacesFromTree([], [{ method: 'GET', routePath: '/api/trpc/health' }])[0]
    expect(rpc.fingerprint).toBe(plain.fingerprint)
  })
})
