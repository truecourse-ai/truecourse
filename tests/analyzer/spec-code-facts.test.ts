import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeFactSchema, canonicalJson } from '../../packages/shared/src/types/spec-compliance'
import { extractCodeFacts } from '../../packages/analyzer/src/spec-code-facts'

const tempDirs: string[] = []

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'truecourse-code-facts-'))
  tempDirs.push(dir)
  return dir
}

function writeFixture(root: string, relPath: string, content: string): void {
  const fullPath = join(root, relPath)
  mkdirSync(join(fullPath, '..'), { recursive: true })
  writeFileSync(fullPath, content)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function values<T extends Record<string, unknown>>(facts: Awaited<ReturnType<typeof extractCodeFacts>>['facts'], kind: string): T[] {
  return facts.filter((fact) => fact.kind === kind).map((fact) => fact.value as T)
}

describe('extractCodeFacts', () => {
  it('extracts Express routes, mounted routers, middleware arrays, auth signals, and env reads', async () => {
    const root = tempProject()
    writeFixture(root, 'src/users.ts', [
      'import { Router } from "express"',
      'export const usersRouter = Router()',
      'const audit = () => {}',
      'usersRouter.get("/:id", [requireAuth, audit], getUser)',
      'usersRouter.post("/", requireRole("admin"), createUser)',
    ].join('\n'))
    writeFixture(root, 'src/admin.ts', [
      'import express from "express"',
      'import { usersRouter } from "./users"',
      'const app = express()',
      'const apiRouter = express.Router()',
      'apiRouter.use("/users", usersRouter)',
      'apiRouter.patch("/settings", ensureAuth, (req, res) => res.send("ok"))',
      'app.use("/api", apiRouter)',
      'app.get("/health", healthHandler)',
      'const mode = process.env.NODE_ENV',
      'const secret = process.env["API_SECRET"]',
      'const ignored = process.env[name]',
      'if (req.user.role === "admin") allow()',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])

    const routes = values<{ method: string; path: string; middlewares: string[] }>(result.facts, 'api.route')
    expect(routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/users/:id', middlewares: ['requireAuth', 'audit'] }),
      expect.objectContaining({ method: 'POST', path: '/api/users/', middlewares: ['requireRole'] }),
      expect.objectContaining({ method: 'PATCH', path: '/api/settings', middlewares: ['ensureAuth'] }),
      expect.objectContaining({ method: 'GET', path: '/health', middlewares: [] }),
    ]))

    const authSignals = values<{ signal: string; source: string; route?: string }>(result.facts, 'auth.signal')
    expect(authSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: 'requireAuth', source: 'middleware', route: '/api/users/:id' }),
      expect.objectContaining({ signal: 'requireRole("admin")', source: 'role-check' }),
      expect.objectContaining({ source: 'role-check' }),
    ]))

    const envReads = values<{ name: string; access: string }>(result.facts, 'config.env')
    expect(envReads).toEqual(expect.arrayContaining([
      { name: 'NODE_ENV', access: 'dot' },
      { name: 'API_SECRET', access: 'bracket' },
    ]))
    expect(envReads).not.toContainEqual({ name: 'name', access: 'bracket' })
  })

  it('extracts React Router JSX routes, object routes, JSX text, fields, labels, buttons, and validation text', async () => {
    const root = tempProject()
    writeFixture(root, 'src/App.tsx', [
      'import { Route, Routes, createBrowserRouter } from "react-router-dom"',
      'const router = createBrowserRouter([',
      '  { path: "/settings", element: <Settings />, children: [',
      '    { index: true, element: <SettingsIndex /> },',
      '    { path: "*", element: <NotFound /> },',
      '  ] }',
      '])',
      'export function App() {',
      '  return <main>',
      '    <Routes>',
      '      <Route path="/dashboard" element={<Dashboard />}>',
      '        <Route index element={<DashboardHome />} />',
      '        <Route path="reports" element={<Reports />} />',
      '        <Route path="*" element={<Missing />} />',
      '      </Route>',
      '    </Routes>',
      '    <h1>Welcome back</h1>',
      '    <label htmlFor="email">Email address</label>',
      '    <input id="email" name="email" type="email" required />',
      '    <label>Display name<input name="displayName" /></label>',
      '    <button type="submit">Save profile</button>',
      '    <p role="alert">Email is required</p>',
      '  </main>',
      '}',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])

    const routes = values<{ path: string; componentName?: string; index?: boolean }>(result.facts, 'ui.route')
    expect(routes).toEqual(expect.arrayContaining([
      { path: '/dashboard', componentName: 'Dashboard' },
      { path: '/dashboard', componentName: 'DashboardHome', index: true },
      { path: '/dashboard/reports', componentName: 'Reports' },
      { path: '/dashboard/*', componentName: 'Missing' },
      { path: '/settings', componentName: 'Settings' },
      { path: '/settings', componentName: 'SettingsIndex', index: true },
      { path: '/settings/*', componentName: 'NotFound' },
    ]))

    expect(values<{ text: string }>(result.facts, 'ui.text')).toEqual(expect.arrayContaining([
      { text: 'Welcome back' },
      { text: 'Email is required' },
    ]))
    expect(values<{ tag: string; name?: string; id?: string; label?: string; required: boolean }>(result.facts, 'ui.form_field')).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'input', id: 'email', name: 'email', label: 'Email address', required: true }),
      expect.objectContaining({ tag: 'input', name: 'displayName', label: 'Display name', required: false }),
    ]))
    expect(values<{ label: string; type?: string }>(result.facts, 'ui.button')).toContainEqual({ label: 'Save profile', type: 'submit' })
  })

  it('extracts package manifest facts from root and nested package.json files', async () => {
    const root = tempProject()
    writeFixture(root, 'package.json', JSON.stringify({
      name: 'root-package',
      version: '1.0.0',
      private: true,
      scripts: { build: 'tsc', test: 'vitest run' },
      dependencies: { express: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }, null, 2))
    writeFixture(root, 'packages/app/package.json', JSON.stringify({
      name: '@scope/app',
      scripts: { dev: 'vite' },
      dependencies: { react: '^19.0.0' },
    }, null, 2))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])

    expect(values<{ packageName?: string; script: string; command: string }>(result.facts, 'package.script')).toEqual(expect.arrayContaining([
      { packageName: 'root-package', script: 'build', command: 'tsc' },
      { packageName: 'root-package', script: 'test', command: 'vitest run' },
      { packageName: '@scope/app', script: 'dev', command: 'vite' },
    ]))
    expect(values<{ name?: string; dependencies: string[]; devDependencies: string[] }>(result.facts, 'package.metadata')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'root-package', dependencies: ['express'], devDependencies: ['typescript'] }),
      expect.objectContaining({ name: '@scope/app', dependencies: ['react'], devDependencies: [] }),
    ]))
  })

  it('extracts test hints including nested suites, .skip/.only names, and static string references', async () => {
    const root = tempProject()
    writeFixture(root, 'tests/user.test.ts', [
      'describe("users", () => {',
      '  describe("create", () => {',
      '    it("creates an admin", () => { expect(screen.getByText("Admin created")).toBeTruthy() })',
      '    test.only("rejects duplicate email", () => { throw new Error("Email exists") })',
      '  })',
      '  it.skip("lists users", () => {})',
      '})',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])
    expect(values<{ name: string; fullName: string; suitePath: string[]; stringReferences: string[] }>(result.facts, 'test.case')).toEqual(expect.arrayContaining([
      {
        name: 'creates an admin',
        fullName: 'users > create > creates an admin',
        suitePath: ['users', 'create'],
        stringReferences: ['Admin created'],
      },
      {
        name: 'rejects duplicate email',
        fullName: 'users > create > rejects duplicate email',
        suitePath: ['users', 'create'],
        stringReferences: ['Email exists'],
      },
      {
        name: 'lists users',
        fullName: 'users > lists users',
        suitePath: ['users'],
        stringReferences: [],
      },
    ]))
  })

  it('honors ignore files, validates every fact, and returns byte-identical deterministic results', async () => {
    const root = tempProject()
    writeFixture(root, '.gitignore', 'ignored-by-git.ts\n')
    writeFixture(root, '.truecourseignore', 'ignored-by-truecourse.ts\n')
    writeFixture(root, 'src/index.ts', 'app.get("/ok", handler)\n')
    writeFixture(root, 'ignored-by-git.ts', 'app.get("/hidden-git", handler)\n')
    writeFixture(root, 'ignored-by-truecourse.ts', 'app.get("/hidden-truecourse", handler)\n')

    const first = await extractCodeFacts(root)
    const second = await extractCodeFacts(root)

    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(JSON.stringify(first.facts)).toBe(JSON.stringify(second.facts))
    expect(first.facts.map((fact) => canonicalJson(fact))).toEqual([...first.facts.map((fact) => canonicalJson(fact))].sort())
    for (const fact of first.facts) {
      expect(CodeFactSchema.parse(fact)).toEqual(fact)
    }
    expect(values<{ path: string }>(first.facts, 'api.route').map((value) => value.path)).toEqual(['/ok'])
  })
})
