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

  it('extracts statically visible Express request body fields and response statuses', async () => {
    const root = tempProject()
    writeFixture(root, 'src/api.ts', [
      'const app = express()',
      'app.post("/users", (req, res) => {',
      '  if (!req.body.email) return res.status(400).json({ error: "email" })',
      '  return res.status(201).json({ id: "u1", email: req.body["email"] })',
      '})',
      'app.delete("/users/:id", (_req, res) => res.sendStatus(204))',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])
    expect(values<{ method: string; path: string; name: string }>(result.facts, 'api.request.field')).toEqual(expect.arrayContaining([
      { method: 'POST', path: '/users', name: 'email' },
    ]))
    expect(values<{ method: string; path: string; statusCode: number }>(result.facts, 'api.response.status')).toEqual(expect.arrayContaining([
      { method: 'POST', path: '/users', statusCode: 201 },
      { method: 'POST', path: '/users', statusCode: 400 },
      { method: 'DELETE', path: '/users/:id', statusCode: 204 },
    ]))
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

  it('extracts statically resolvable composed React routes, labels, fields, and text', async () => {
    const root = tempProject()
    writeFixture(root, 'src/ui-copy.ts', [
      'export const LABELS = {',
      '  email: "Email address",',
      '  search: "Search users",',
      '  empty: "No users found",',
      '} as const',
      'export const TITLES = { profile: "Profile overview" } as const',
    ].join('\n'))
    writeFixture(root, 'src/routes.ts', [
      'export const ROUTES = {',
      '  profile: "/profile",',
      '  settings: "/settings",',
      '} as const',
    ].join('\n'))
    writeFixture(root, 'src/App.tsx', [
      'import { Route, createBrowserRouter } from "react-router-dom"',
      'import { LABELS, TITLES } from "./ui-copy"',
      'import { ROUTES } from "./routes"',
      'const EMAIL_ID = "email" as const',
      'const FIELD_NAMES = { email: "email", search: "query" } as const',
      'const LOCAL_COPY = { cta: "Continue" } as const',
      'const router = createBrowserRouter([',
      '  { path: ROUTES.settings, element: <Settings /> },',
      '])',
      'export function App() {',
      '  return <main>',
      '    <Route path={ROUTES.profile} element={<Profile />} />',
      '    <TextField id={EMAIL_ID} name={FIELD_NAMES.email} label={LABELS.email} required />',
      '    <SearchBox name={FIELD_NAMES.search} placeholder={LABELS.search} />',
      '    <EmptyState title={TITLES.profile} message={LABELS.empty} />',
      '    <Banner text={LOCAL_COPY.cta} />',
      '    <TextField name="dynamic" label={t("email")} />',
      '    <Route path={routeFor("billing")} element={<Billing />} />',
      '  </main>',
      '}',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])

    expect(values<{ path: string; componentName?: string }>(result.facts, 'ui.route')).toEqual(expect.arrayContaining([
      { path: '/profile', componentName: 'Profile' },
      { path: '/settings', componentName: 'Settings' },
    ]))
    expect(values<{ path: string }>(result.facts, 'ui.route')).not.toContainEqual(expect.objectContaining({ path: '/billing' }))

    expect(values<{ tag: string; name?: string; id?: string; label?: string; required: boolean }>(result.facts, 'ui.form_field')).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'TextField', id: 'email', name: 'email', label: 'Email address', required: true }),
      expect.objectContaining({ tag: 'SearchBox', name: 'query', label: 'Search users', required: false }),
    ]))
    expect(values<{ tag: string; name?: string; label?: string }>(result.facts, 'ui.form_field')).not.toContainEqual(expect.objectContaining({
      tag: 'TextField',
      name: 'dynamic',
    }))

    expect(values<{ text: string }>(result.facts, 'ui.text')).toEqual(expect.arrayContaining([
      { text: 'Profile overview' },
      { text: 'No users found' },
      { text: 'Continue' },
    ]))
    expect(values<{ text: string }>(result.facts, 'ui.text')).not.toContainEqual({ text: 'email' })
  })

  it('extracts package manifest facts from root and nested package.json files', async () => {
    const root = tempProject()
    writeFixture(root, 'package.json', JSON.stringify({
      name: 'root-package',
      version: '1.0.0',
      private: true,
      bin: 'dist/index.js',
      scripts: { build: 'tsc', test: 'vitest run' },
      dependencies: { express: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }, null, 2))
    writeFixture(root, 'packages/app/package.json', JSON.stringify({
      name: '@scope/app',
      bin: { app: 'src/index.ts' },
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
    expect(values<{ name: string; entry?: string; packageName?: string }>(result.facts, 'cli.binary')).toEqual(expect.arrayContaining([
      { name: 'root-package', entry: 'dist/index.js', packageName: 'root-package' },
      { name: 'app', entry: 'src/index.ts', packageName: '@scope/app' },
    ]))
  })

  it('extracts Commander CLI commands, options, arguments, aliases, actions, and static signatures', async () => {
    const root = tempProject()
    writeFixture(root, 'src/constants.ts', [
      'export const COMMANDS = { analyze: "analyze", rules: "rules" } as const',
      'export const SPEC_OPTION = "-s, --spec-compliance <globs>"',
    ].join('\n'))
    writeFixture(root, 'src/index.ts', [
      'import { Command } from "commander"',
      'import { COMMANDS, SPEC_OPTION } from "./constants"',
      'const program = new Command()',
      'program.name("truecourse").version("1.0.0").description("TrueCourse CLI")',
      'program.command(COMMANDS.analyze).description("Analyze repo").option(SPEC_OPTION, "Spec globs").requiredOption("--project <path>", "Project path").option("--no-llm", "Disable LLM").action(runAnalyze)',
      'const rulesCmd = program.command(COMMANDS.rules).alias("r").description("Manage rules")',
      'rulesCmd.command("enable <ruleKey>").argument("[scope...]", "Rule scope").action(enableRule)',
      'program.command(makeName()).action(dynamic)',
    ].join('\n'))

    const first = await extractCodeFacts(root)
    const second = await extractCodeFacts(root)
    expect(first.errors).toEqual([])
    expect(JSON.stringify(first.facts)).toBe(JSON.stringify(second.facts))

    expect(values<{ name: string; source?: string }>(first.facts, 'cli.binary')).toEqual(expect.arrayContaining([
      { name: 'truecourse', source: 'commander' },
    ]))
    expect(values<{ name: string; fullName: string; path: string[]; parentPath: string[]; aliases: string[]; hasAction: boolean }>(first.facts, 'cli.command')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'analyze', fullName: 'truecourse analyze', path: ['analyze'], parentPath: [], hasAction: true }),
      expect.objectContaining({ name: 'rules', fullName: 'truecourse rules', path: ['rules'], parentPath: [], aliases: ['r'], hasAction: false }),
      expect.objectContaining({ name: 'enable', fullName: 'truecourse rules enable', path: ['rules', 'enable'], parentPath: ['rules'], hasAction: true }),
    ]))
    expect(values<{ fullName: string }>(first.facts, 'cli.command')).not.toContainEqual(expect.objectContaining({ fullName: 'truecourse dynamic' }))
    expect(values<{ command: string; name: string; shortName?: string; argument?: string; required: boolean; negated: boolean }>(first.facts, 'cli.option')).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'truecourse analyze', name: '--spec-compliance', shortName: '-s', argument: 'globs', required: false, negated: false }),
      expect.objectContaining({ command: 'truecourse analyze', name: '--project', argument: 'path', required: true, negated: false }),
      expect.objectContaining({ command: 'truecourse analyze', name: '--no-llm', required: false, negated: true }),
    ]))
    expect(values<{ command: string; name: string; required: boolean; variadic: boolean }>(first.facts, 'cli.argument')).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: 'truecourse rules enable', name: 'ruleKey', required: true, variadic: false }),
      expect.objectContaining({ command: 'truecourse rules enable', name: 'scope', required: false, variadic: true }),
    ]))

    for (const fact of first.facts) {
      expect(CodeFactSchema.parse(fact)).toEqual(fact)
    }
  })

  it('extracts Prisma, Drizzle, SQLAlchemy, Docker Compose, and GitHub Actions facts', async () => {
    const root = tempProject()
    writeFixture(root, 'services/user/prisma/schema.prisma', [
      'model User {',
      '  id String @id',
      '  email String @unique',
      '}',
    ].join('\n'))
    writeFixture(root, 'services/notify/src/db/schema.ts', [
      'import { pgTable, uuid, text } from "drizzle-orm/pg-core"',
      'export const messages = pgTable("messages", {',
      '  id: uuid("id").primaryKey(),',
      '  subject: text("subject").notNull(),',
      '})',
    ].join('\n'))
    writeFixture(root, 'services/billing/models/invoice.py', [
      'from sqlalchemy import Column, Integer, String',
      'class Invoice(Base):',
      '    __tablename__ = "invoices"',
      '    id = Column(Integer, primary_key=True)',
      '    number = Column(String, nullable=False)',
    ].join('\n'))
    writeFixture(root, 'docker-compose.yml', [
      'services:',
      '  api:',
      '    build: .',
      '    ports: ["3000:3000"]',
      '  redis:',
      '    image: redis:7',
    ].join('\n'))
    writeFixture(root, '.github/workflows/ci.yml', [
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: pnpm test',
    ].join('\n'))

    const result = await extractCodeFacts(root)
    expect(result.errors).toEqual([])
    expect(values<{ name: string }>(result.facts, 'data.table')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'User' }),
      expect.objectContaining({ name: 'messages' }),
      expect.objectContaining({ name: 'invoices' }),
    ]))
    expect(values<{ table: string; name: string }>(result.facts, 'data.field')).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'User', name: 'email' }),
      expect.objectContaining({ table: 'messages', name: 'subject' }),
      expect.objectContaining({ table: 'invoices', name: 'number' }),
    ]))
    expect(values<{ name: string }>(result.facts, 'infra.compose.service')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api' }),
      expect.objectContaining({ name: 'redis' }),
    ]))
    expect(values<{ name: string; runsOn: string }>(result.facts, 'infra.ci.job')).toEqual([
      expect.objectContaining({ name: 'test', runsOn: 'ubuntu-latest' }),
    ])
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
