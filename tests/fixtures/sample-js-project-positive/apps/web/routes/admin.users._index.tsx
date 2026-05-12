// Positive: uncaught-exception-no-handler FP — Remix / React Router v7
// route module. The path matches the visitor's entry-point heuristic
// (`._index.tsx` contains `index.`), but this file is a route component
// invoked by the framework's request pipeline, not a Node.js process entry
// point. Registering `process.on('uncaughtException')` here is incorrect —
// that handler belongs at the top-level server entry point (e.g.
// `server/main.js`), not in every route module.
//
// Covers both FP modes from rule-briefs.json — they share the same root
// cause (over-broad entry-point path heuristic):
//   1. remix-react-router-route-modules — this route component file
//      mirrors documenso's `apps/remix/app/routes/_authenticated+/admin+/
//      users._index.tsx` (and 30+ sibling route files).
//   2. non-entry-server-utility-or-ssr-handler — the colocated
//      `getThemeSession` cookie-session helper mirrors documenso's
//      `apps/remix/app/storage/theme-session.server.ts`. In a real Remix
//      app it would live in a `*.server.ts` sibling; here it co-resides
//      with the route to keep the fixture single-file (the visitor's
//      decision is one-shot per program, so the same path-heuristic bug
//      drives both modes).

declare const json: <T>(data: T, init?: { readonly status?: number }) => Response;
declare const useLoaderData: <T>() => T;
declare const Form: (props: {
  readonly method: 'get' | 'post';
  readonly children: JSX.Element | readonly JSX.Element[];
}) => JSX.Element;
declare const Link: (props: {
  readonly to: string;
  readonly children: string;
}) => JSX.Element;

export interface AdminUserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'admin' | 'member' | 'owner';
  readonly createdAt: string;
}

interface RouteArgs {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | undefined>>;
}

// Server-side loader. Runs inside the framework request pipeline; any
// exception is caught by the route's ErrorBoundary, never bubbles to the
// Node process. There is no process to install `uncaughtException` on at
// import time.
export async function loader({ request }: RouteArgs): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') ?? '';
  const rawPage = url.searchParams.get('page') ?? '1';
  const page = Number.parseInt(rawPage, 10);

  const rows = await fetchAdminUsers({ search, page });
  return json({ rows, page, search });
}

export async function action({ request }: RouteArgs): Promise<Response> {
  const formData = await request.formData();
  const intent = String(formData.get('intent') ?? '');

  if (intent === 'archive') {
    const id = String(formData.get('id') ?? '');
    await archiveAdminUser(id);
    return json({ ok: true });
  }
  return json({ ok: false }, { status: 400 });
}

export const meta = (): readonly { readonly title: string }[] => [
  { title: 'Admin \u00b7 Users' },
];

export const handle: { readonly breadcrumb: string } = { breadcrumb: 'Users' };

export default function AdminUsersRoute(): JSX.Element {
  const { rows, page, search } = useLoaderData<{
    readonly rows: readonly AdminUserRow[];
    readonly page: number;
    readonly search: string;
  }>();

  return (
    <section className="admin-users">
      <header>
        <h1>Administrator users</h1>
        <Form method="get">
          <input name="q" defaultValue={search} aria-label="Search users" />
          <button type="submit">Search</button>
        </Form>
      </header>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><Link to={`/admin/users/${row.id}`}>{row.name}</Link></td>
              <td>{row.email}</td>
              <td>{row.role}</td>
              <td>{row.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <footer>
        <span>Page {page}</span>
      </footer>
    </section>
  );
}

export function ErrorBoundary(): JSX.Element {
  return <div role="alert">Failed to load administrator users.</div>;
}

// Co-located cookie-session helper representing the
// non-entry-server-utility-or-ssr-handler FP shape (theme-session.server.ts
// in documenso). Not a process entry point.
interface CookieSessionStorage<TData> {
  readonly getSession: (cookieHeader: string | null) => Promise<{
    readonly get: <K extends keyof TData>(key: K) => TData[K] | undefined;
    readonly set: <K extends keyof TData>(key: K, value: TData[K]) => void;
  }>;
  readonly commitSession: (session: {
    readonly get: (key: keyof TData) => unknown;
  }) => Promise<string>;
}

declare const createCookieSessionStorage: <TData>(opts: {
  readonly cookie: {
    readonly name: string;
    readonly httpOnly: boolean;
    readonly sameSite: 'lax' | 'strict' | 'none';
    readonly secrets: readonly string[];
  };
}) => CookieSessionStorage<TData>;

export interface ThemeSessionData {
  readonly theme: 'light' | 'dark' | 'system';
}

export const themeSessionStorage = createCookieSessionStorage<ThemeSessionData>({
  cookie: {
    name: '__theme',
    httpOnly: true,
    sameSite: 'lax',
    secrets: ['fixture-secret-not-real'],
  },
});

export async function getThemeSession(request: Request): Promise<{
  readonly getTheme: () => ThemeSessionData['theme'];
  readonly setTheme: (theme: ThemeSessionData['theme']) => void;
  readonly commit: () => Promise<string>;
}> {
  const session = await themeSessionStorage.getSession(
    request.headers.get('Cookie'),
  );
  return {
    getTheme: () => session.get('theme') ?? 'system',
    setTheme: (theme) => session.set('theme', theme),
    commit: () => themeSessionStorage.commitSession(session),
  };
}

// Module-local data-access helpers. Mirrors how Remix route modules
// typically co-locate per-route Prisma queries.
const ADMIN_USERS_PAGE_SIZE = 25;

declare const db: {
  readonly user: {
    readonly findMany: (args: {
      readonly where: { readonly name?: { readonly contains: string } };
      readonly skip: number;
      readonly take: number;
    }) => Promise<readonly AdminUserRow[]>;
    readonly update: (args: {
      readonly where: { readonly id: string };
      readonly data: { readonly archived: true };
    }) => Promise<AdminUserRow>;
  };
};

function fetchAdminUsers(args: {
  readonly search: string;
  readonly page: number;
}): Promise<readonly AdminUserRow[]> {
  return db.user.findMany({
    where: args.search ? { name: { contains: args.search } } : {},
    skip: (args.page - 1) * ADMIN_USERS_PAGE_SIZE,
    take: ADMIN_USERS_PAGE_SIZE,
  });
}

async function archiveAdminUser(id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { archived: true } });
}
