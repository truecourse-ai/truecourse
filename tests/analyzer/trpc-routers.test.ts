/**
 * THE tRPC ROUTER READER (SPEC_GUARD_PLAN item 12) — the fourth route idiom, and
 * the only one whose product is not a route: a router node names procedures and
 * child routers, never an address.
 *
 * The fixtures are the two real shapes the derivation has to survive: a t3 app
 * (`createTRPCRouter` imported from the app's own `~/server/api/trpc`, procedures
 * flat under the root) and cal.com's (a `router` imported from a relative trpc
 * module, four segments deep through child routers in other files).
 */

import { describe, it, expect } from 'vitest'
import { extractTrpcRouters } from '../../packages/analyzer/src/extractors/routes/trpc-routers'
import { extractRouteRegistrations } from '../../packages/analyzer/src/extractors/route-registrations'
import { parseCode } from '../../packages/analyzer/src/parser'

function routers(code: string, filePath = '/app/server/router.ts') {
  return extractTrpcRouters(parseCode(code, 'typescript'), filePath)
}

describe('extractTrpcRouters — what a file states', () => {
  it('reads the procedures of a router and the kind of each', () => {
    const [router] = routers(`
      import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";

      export const postRouter = createTRPCRouter({
        getLatest: publicProcedure.query(({ ctx }) => ctx.db.post.findFirst()),
        create: protectedProcedure.input(createSchema).mutation(({ input }) => save(input)),
        onAdd: publicProcedure.subscription(() => stream()),
        helper: someHelper(),
      });
    `)

    expect(router.name).toBe('postRouter')
    expect(router.exported).toBe(true)
    expect(router.procedures.map((p) => `${p.kind} ${p.name}`)).toEqual([
      'query getLatest',
      'mutation create',
      'subscription onAdd',
    ])
    expect(router.children).toEqual([])
  })

  it('names the child routers a root composes, by key and by identifier', () => {
    const [router] = routers(`
      import { router } from "../../trpc";
      import { bookingsRouter } from "./bookings/_router";
      import { schedulesRouter } from "./schedules/_router";

      export const viewerRouter = router({
        bookings: bookingsRouter,
        schedules: schedulesRouter,
      });
    `)

    expect(router.children).toEqual([
      { key: 'bookings', router: 'bookingsRouter' },
      { key: 'schedules', router: 'schedulesRouter' },
    ])
    expect(router.procedures).toEqual([])
  })

  it('reads an INLINE nested router as dotted keys of the router it is written in', () => {
    // An inline child has no symbol, so nobody downstream could resolve it — the
    // only place it can be composed is here.
    const [router] = routers(`
      import { initTRPC } from "@trpc/server";
      const t = initTRPC.create();

      export const appRouter = t.router({
        health: t.procedure.query(() => "ok"),
        post: t.router({
          create: t.procedure.mutation(() => save()),
          list: t.procedure.query(() => all()),
        }),
      });
    `)

    expect(router.procedures.map((p) => p.name)).toEqual(['health', 'post.create', 'post.list'])
  })

  it('reads the `{ bookingsRouter }` shorthand as a child mounted under its own name', () => {
    const [router] = routers(`
      import { router } from "@trpc/server";
      import { bookingsRouter } from "./bookings";
      export const appRouter = router({ bookingsRouter });
    `)

    expect(router.children).toEqual([{ key: 'bookingsRouter', router: 'bookingsRouter' }])
  })

  it('carries a location that points at the binding', () => {
    const [router] = routers(`
      import { router } from "@trpc/server";
      export const appRouter = router({
        ping: publicProcedure.query(() => "pong"),
      });
    `)

    expect(router.location.filePath).toBe('/app/server/router.ts')
    expect(router.procedures[0].location.startLine).toBe(4)
  })
})

describe('extractTrpcRouters — the gate', () => {
  it('reads nothing from a file with no tRPC evidence at all', () => {
    // `router({...})` with `.query()` values is also how several query builders
    // and state machines are written; the import is what makes it tRPC.
    expect(
      routers(`
        import { router } from "./my-own-router";
        export const appRouter = router({
          find: builder.query(() => 1),
        });
      `),
    ).toEqual([])
  })

  it('accepts a router factory imported from the app’s OWN trpc module', () => {
    // The tier that carries every real app: a sub-router file imports the
    // initialized builder, never `@trpc/server`.
    expect(
      routers(`
        import { router, authedProcedure } from "../../trpc";
        export const bookingsRouter = router({
          get: authedProcedure.query(handler),
        });
      `).map((r) => r.name),
    ).toEqual(['bookingsRouter'])
  })

  it('does not treat an unexported binding as exported', () => {
    const [router] = routers(`
      import { router } from "@trpc/server";
      const internalRouter = router({ ping: publicProcedure.query(fn) });
    `)
    expect(router.exported).toBe(false)
  })
})

describe('the route extraction as a whole', () => {
  it('carries the routers beside the routes and mounts', () => {
    const tree = parseCode(
      `
        import { router } from "@trpc/server";
        export const appRouter = router({ ping: publicProcedure.query(fn) });
      `,
      'typescript',
    )
    const extraction = extractRouteRegistrations(tree, '/app/router.ts', 'typescript')
    expect(extraction.routes).toEqual([])
    expect(extraction.rpcRouters.map((r) => r.name)).toEqual(['appRouter'])
  })

  it('states no routers for a language with no such idiom', () => {
    const tree = parseCode(`from fastapi import FastAPI\napp = FastAPI()\n`, 'python')
    expect(extractRouteRegistrations(tree, '/app/main.py', 'python').rpcRouters).toEqual([])
  })
})
