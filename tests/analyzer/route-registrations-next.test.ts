import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzeFileContent } from '../../packages/analyzer/src/file-analyzer'
import { RouteRegistrationSchema } from '../../packages/shared/src/index'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'next-routes-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })
function write(file: string, content = ''): string {
  const absolute = path.join(root, file)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
  return absolute
}
function next(app = '', evidence = 'dependency'): void {
  if (evidence === 'config') write(path.join(app, 'next.config.mjs'), 'export default {}')
  else write(path.join(app, 'package.json'), JSON.stringify({ [evidence === 'dev' ? 'devDependencies' : 'dependencies']: { next: '^15.0.0' } }))
}
function routes(file: string, source = 'export function GET() { return Response.json({ ok: true }) }') {
  const absolute = write(file, source)
  return analyzeFileContent(absolute, source, file.endsWith('.js') ? 'javascript' : 'typescript').routeRegistrations ?? []
}
const operations = (result: ReturnType<typeof routes>) => result.map((route) => `${route.httpMethod} ${route.path}`)

describe('Next App Router registrations and contracts', () => {
  it('extracts collection CRUD with separate request and response contracts', () => {
    next()
    const result = routes('app/api/expenses/route.ts', `
      import { NextResponse } from 'next/server'
      export const dynamic = 'force-dynamic'
      export async function GET(request: Request) {
        const category = request.nextUrl.searchParams.get('category')
        return NextResponse.json({ expenses: [] })
      }
      export async function POST(request: Request) {
        const { amount, description } = await request.json()
        return NextResponse.json({ id: 1, amount, description }, { status: 201 })
      }
    `)
    expect(operations(result)).toEqual(['GET /api/expenses', 'POST /api/expenses'])
    expect(result[0].requestContract?.queryFields).toEqual([{ name: 'category', required: 'unknown' }])
    expect(result[0].requestContract?.produces).toEqual({ statuses: [200], bodyKeys: ['expenses'] })
    expect(result[1].requestContract?.bodyFields?.map((field) => field.name)).toEqual(['amount', 'description'])
    expect(result[1].requestContract?.produces?.statuses).toEqual([201])
    result.forEach((route) => expect(RouteRegistrationSchema.safeParse(route).success).toBe(true))
  })

  it('extracts dynamic item GET/PUT/DELETE and no implicit methods', () => {
    next()
    const result = routes('app/api/expenses/[id]/route.ts', `
      export async function GET() { return Response.json({ id: 1 }) }
      export async function PUT(request: Request) { const { amount } = await request.json(); return Response.json({ amount }) }
      export async function DELETE() { return new Response(null, { status: 204 }) }
    `)
    expect(operations(result)).toEqual(['GET /api/expenses/{id}', 'PUT /api/expenses/{id}', 'DELETE /api/expenses/{id}'])
    expect(result[2].requestContract?.produces?.statuses).toEqual([204])
  })

  it('supports src/app, JavaScript, arrows, function expressions and all seven explicit verbs', () => {
    next('', 'config')
    const result = routes('src/app/route.js', `
      export const GET = () => Response.json({ get: true }), POST = async function(req) { const { title } = await req.json(); return Response.json({ post: title }, { status: 201 }) }
      export let PUT = function () { return new Response(null, { status: 202 }) }
      export var PATCH = () => new Response(null, { status: 204 })
      export function DELETE() { return new Response(null, { status: 204 }) }
      export function HEAD() { return new Response(null, { status: 200 }) }
      export const OPTIONS = () => new Response(null, { status: 204 })
    `)
    expect(operations(result)).toEqual(['GET /', 'POST /', 'PUT /', 'PATCH /', 'DELETE /', 'HEAD /', 'OPTIONS /'])
    expect(result[0].requestContract?.produces?.bodyKeys).toEqual(['get'])
    expect(result[1].requestContract?.produces?.bodyKeys).toEqual(['post'])
    expect(result[1].requestContract?.bodyFields?.map((field) => field.name)).toEqual(['title'])
    result.forEach((route) => expect(RouteRegistrationSchema.safeParse(route).success).toBe(true))
  })

  it('resolves local export lists and aliases at distinct contract join sites', () => {
    next('', 'dev')
    const result = routes('app/auth/route.ts', `
      const read = () => Response.json({ session: true });
      const alias = read;
      async function write(req: Request) { const { token } = await req.json(); return Response.json({ saved: token }, { status: 201 }) }
      export { alias as GET, write as POST };
      export const PUT = write;
      const del = (() => new Response(null, { status: 204 })) satisfies Handler;
      export { del as DELETE };
    `)
    expect(operations(result)).toEqual(['GET /auth', 'POST /auth', 'PUT /auth', 'DELETE /auth'])
    expect(result[0].requestContract?.produces?.bodyKeys).toEqual(['session'])
    expect(result[1].requestContract?.bodyFields?.map((field) => field.name)).toEqual(['token'])
    expect(result[2].requestContract).toEqual(result[1].requestContract)
    expect(result[3].requestContract?.produces?.statuses).toEqual([204])
  })

  it('records explicit imported, wrapped and re-exported methods without borrowing contracts', () => {
    next()
    const result = routes('app/auth/route.ts', `
      import { handler as imported } from './auth';
      export { imported as GET };
      export { handler as POST, PUT } from './handlers';
      export const PATCH = withAuth(imported);
      export * from './others';
    `)
    expect(operations(result)).toEqual(['GET /auth', 'POST /auth', 'PUT /auth', 'PATCH /auth'])
    expect(result.every((route) => route.requestContract === undefined)).toBe(true)
  })

  it('supports destructured handler exports and string-named export aliases', () => {
    next()
    const result = routes('app/auth/route.ts', `
      import { handlers } from './auth';
      export const { GET, write: POST, DELETE: remove } = handlers;
      const { PUT } = handlers;
      export { PUT };
      const head = () => new Response(null, { status: 204 });
      export { head as "HEAD" };
    `)
    expect(operations(result)).toEqual(['GET /auth', 'POST /auth', 'PUT /auth', 'HEAD /auth'])
    expect(result[0].requestContract).toBeUndefined()
    expect(result[3].requestContract?.produces?.statuses).toEqual([204])
  })

  it.each([
    ['app/(api)/(v1)/api/[id]/route.ts', ['/api/{id}']],
    ['app/files/[...path]/route.ts', ['/files/{...path}']],
    ['app/docs/[[...slug]]/route.ts', ['/docs', '/docs/{...slug}']],
    ['app/docs/[[...slug]]/(content)/route.ts', ['/docs', '/docs/{...slug}']],
    ['app/[[...slug]]/route.ts', ['/', '/{...slug}']],
    ['app/%5Fpublic/route.ts', ['/_public']],
  ])('normalizes %s', (file, expected) => {
    next()
    expect(routes(file).map((route) => route.path)).toEqual(expected)
  })

  it.each([
    'route.ts', 'lib/route.ts', 'other/app/api/route.ts', 'app/api/route.tsx',
    'app/api/route.test.ts', 'app/api/route.d.ts', 'app/api/page.ts',
    'app/_private/api/route.ts', 'app/@slot/api/route.ts', 'app/(.)photo/route.ts',
    'app/(..)photo/route.ts', 'app/(...)photo/route.ts', 'app/files/[...slug]/child/route.ts',
    'pages/api/expenses.ts', 'src/pages/api/expenses.ts',
  ])('does not claim %s as an App Router endpoint', (file) => {
    next()
    expect(routes(file)).toEqual([])
  })

  it('requires framework evidence and ignores invalid or unrelated manifests/configs', () => {
    expect(routes('app/api/route.ts')).toEqual([])
    write('next.config.json', '{}')
    write('next.config.cjs', 'module.exports = {}')
    write('package.json', '{broken')
    expect(routes('app/api/route.ts')).toEqual([])
    write('package.json', '{"dependencies":{"react":"19"}}')
    expect(routes('app/api/route.ts')).toEqual([])
  })

  it('ignores non-method, default, type-only, lowercase, unexported and non-callable declarations', () => {
    next()
    expect(routes('app/api/route.ts', `
      function GET() { return Response.json({ ok: true }) }
      export default GET;
      export const get = GET, ALL = GET, TRACE = GET, runtime = 'nodejs';
      export type { POST } from './types';
      export { type PUT } from './types';
      import type { PATCH } from './types'; export { PATCH };
      export const DELETE = 42, HEAD = { status: 200 }, OPTIONS = 'GET';
    `)).toEqual([])
  })

  it('prefers app over src/app, including an empty root app directory', () => {
    next()
    fs.mkdirSync(path.join(root, 'app'))
    expect(routes('src/app/api/route.ts')).toEqual([])
    expect(operations(routes('app/api/route.ts'))).toEqual(['GET /api'])
  })

  it('uses monorepo app roots without workspace prefixes and rejects sibling packages', () => {
    next('apps/web')
    next('apps/admin', 'config')
    expect(operations(routes('apps/web/src/app/api/route.ts'))).toEqual(['GET /api'])
    expect(operations(routes('apps/admin/app/api/route.ts'))).toEqual(['GET /api'])
    expect(routes('packages/util/app/api/route.ts')).toEqual([])
  })

  it('does not borrow evidence across nested package boundaries', () => {
    next()
    write('app/examples/package.json', '{"name":"plain-example"}')
    expect(routes('app/examples/app/api/route.ts')).toEqual([])
    next('app/examples')
    expect(operations(routes('app/examples/app/api/route.ts'))).toEqual(['GET /api'])
  })
})
