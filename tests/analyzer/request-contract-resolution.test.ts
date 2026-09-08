import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzeFile } from '../../packages/analyzer/src/file-analyzer'
import { resolveRequestContracts } from '../../packages/analyzer/src/request-contract-resolution'
import type { FileAnalysis } from '../../packages/shared/src/index'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
async function contracts(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-contract-resolution-'))
  roots.push(root)
  const all = { 'package.json': '{"dependencies":{"next":"15"}}', 'tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["./*"]},"moduleResolution":"bundler"}}', ...files }
  for (const [name, content] of Object.entries(all)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const analyses = (await Promise.all(Object.keys(files).filter((file) => /\.[jt]s$/.test(file)).map((file) => analyzeFile(path.join(root, file))))).filter((file): file is FileAnalysis => file !== null)
  return resolveRequestContracts(root, analyses).flatMap((file) => file.routeRegistrations ?? [])
}

describe('project request contract resolution', () => {
  it('follows path aliases, re-exports and renamed imports with call-specific arguments', async () => {
    const routes = await contracts({
      'app/api/items/route.ts': `import { send as reply, body as read, list } from '@/lib';
        export async function POST(req: Request) { return reply({ item: await read(req) }, 201) }
        export function GET(req: Request) { return reply(list(new URL(req.url).searchParams)) }`,
      'lib/index.ts': `export { json as send, readBody as body } from './http'; export { list } from './items'`,
      'lib/http.ts': `export const json = (value: unknown, status = 200) => Response.json(value, { status });
        export async function readBody(req: Request) { const value = JSON.parse(await req.text()); return validate(value) }
        function validate(value: any) { const { title } = value; return { title } }`,
      'lib/items.ts': `export function list(params: URLSearchParams) { const cursor = params.get('cursor'); return { items: [], cursor } }`,
    })
    expect(routes.find((r) => r.httpMethod === 'POST')?.requestContract).toEqual({ bodyFields: [{ name: 'title', required: 'unknown' }], produces: { statuses: [201], bodyKeys: ['item'] } })
    expect(routes.find((r) => r.httpMethod === 'GET')?.requestContract).toEqual({ queryFields: [{ name: 'cursor', required: 'unknown' }], produces: { statuses: [200], bodyKeys: ['cursor', 'items'] } })
  })

  it('keeps source-proven error responses and excludes discarded responses', async () => {
    const [route] = await contracts({
      'app/api/items/route.ts': `import { reply, error } from '@/http'; export async function POST(req: Request) {
        try { reply({ discarded: true }, 202); return reply({ created: true }, 201) } catch (e) { return error(e) }
      }`,
      'http.ts': `export function reply(body: unknown, status: number) { return new Response(JSON.stringify(body), { status }) }
        export function error(e: unknown) { if (e instanceof TypeError) return reply({ error: 'bad' }, 400); return reply({ error: 'failed' }, 500) }`,
    })
    expect(route.requestContract?.produces).toEqual({ statuses: [201, 400, 500], bodyKeys: ['created', 'error'] })
  })

  it('does not identify helpers by name or invent dynamic statuses', async () => {
    const routes = await contracts({
      'app/api/items/route.ts': `import { json, dynamic, shadow } from '@/http';
        export function GET(req: Request) { return json({ nope: true }) }
        export function POST(req: Request) { return dynamic(req.headers.get('status')) }
        export function PUT(req: Request) { return shadow() }`,
      'http.ts': `export function json(body: unknown) { return body }
        export function dynamic(status: any) { return Response.json({ ok: true }, { status }) }
        export function shadow() { const Response = { json: (body: unknown) => body }; return Response.json({ fake: true }) }`,
    })
    expect(routes.find((r) => r.httpMethod === 'GET')?.requestContract).toBeUndefined()
    expect(routes.find((r) => r.httpMethod === 'POST')?.requestContract?.produces).toEqual({ bodyKeys: ['ok'] })
    expect(routes.find((r) => r.httpMethod === 'PUT')?.requestContract).toBeUndefined()
  })

  it('resolves explicit handler re-exports and stops recursion', async () => {
    const routes = await contracts({
      'app/api/items/route.ts': `export { handler as GET, recursive as POST } from '@/http'`,
      'http.ts': `export function handler(req: Request) { return Response.json({ ready: true }, { status: 200 }) }
        export function recursive(req: Request): Response { return recursive(req) }`,
    })
    expect(routes.find((r) => r.httpMethod === 'GET')?.requestContract?.produces).toEqual({ statuses: [200], bodyKeys: ['ready'] })
    expect(routes.find((r) => r.httpMethod === 'POST')?.requestContract).toBeUndefined()
  })

  it('does not invent a default through unknown options, mutations, or a replaced helper', async () => {
    const routes = await contracts({
      'app/api/items/route.ts': `import * as http from '@/http';
        export function GET(req: Request) { return http.spread(req.json()) }
        export function POST(req: Request) { return http.mutated(req.json()) }
        export function PUT(req: Request) { return http.replaced() }`,
      'http.ts': `export function spread(options: any) { return Response.json({ ok: true }, { ...options }) }
        export function mutated(value: any) { const options = { status: 201 }; options.status = value; return Response.json({ ok: true }, options) }
        export function replaced() { let reply = (x: unknown) => Response.json(x); reply = (x) => x as Response; return reply({ fake: true }) }`,
    })
    expect(routes.find((r) => r.httpMethod === 'GET')?.requestContract?.produces).toEqual({ bodyKeys: ['ok'] })
    expect(routes.find((r) => r.httpMethod === 'POST')?.requestContract?.produces).toEqual({ bodyKeys: ['ok'] })
    expect(routes.find((r) => r.httpMethod === 'PUT')?.requestContract).toBeUndefined()
  })

  it('resolves an aliased NextResponse only from next/server', async () => {
    const [route] = await contracts({
      'app/api/items/route.ts': `import { reply } from '@/http'; export function GET() { return reply() }`,
      'http.ts': `import { NextResponse as Reply } from 'next/server'; export function reply() { return Reply.json({ ready: true }, { status: 202 }) }`,
    })
    expect(route.requestContract?.produces).toEqual({ statuses: [202], bodyKeys: ['ready'] })
  })

  it('extracts the complete expense app without executing its SQLite helpers', async () => {
    const root = path.resolve('tests/fixtures/next-expense-app')
    const sources = ['app/api/expenses/route.ts', 'app/api/expenses/[id]/route.ts', 'lib/http.ts', 'lib/store.ts', 'lib/validation.ts', 'lib/expenses.ts']
    const files = (await Promise.all(sources.map((file) => analyzeFile(path.join(root, file))))).filter((file): file is FileAnalysis => file !== null)
    const routes = resolveRequestContracts(root, files).flatMap((file) => file.routeRegistrations ?? [])
    const get = routes.find((r) => r.path === '/api/expenses' && r.httpMethod === 'GET')!.requestContract!
    expect(get.queryFields?.map((f) => f.name).sort()).toEqual(['category', 'from', 'page', 'q', 'to'])
    expect(get.produces?.statuses).toEqual([200, 400, 500])
    expect(get.produces?.bodyKeys).toEqual(['error', 'expenses', 'page', 'pageSize', 'totalPages', 'totalSpentCents'])
    const post = routes.find((r) => r.httpMethod === 'POST')!.requestContract!
    expect(post.bodyFields?.map((f) => f.name).sort()).toEqual(['amount', 'category', 'date', 'description', 'notes'])
    expect(post.produces?.statuses).toEqual([201, 400, 500])
    expect(fs.existsSync(path.join(root, 'data'))).toBe(false)
  })
})
