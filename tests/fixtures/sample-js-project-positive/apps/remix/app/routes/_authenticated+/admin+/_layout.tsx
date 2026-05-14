
declare function useCurrentUser(): { name: string; isAdmin: boolean };
declare function Navigate(props: { to: string }): React.ReactElement;

export default function AdminLayout() {
  const user = useCurrentUser();

  if (!user.isAdmin) {
    return <Navigate to="/" />;
  }

  return (
    <div className="flex min-h-screen">
      <nav className="w-60 border-r bg-muted/30 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Admin</h2>
        <ul className="mt-4 space-y-1">
          <li><a href="/admin/users" className="block rounded px-2 py-1 hover:bg-muted">Users</a></li>
          <li><a href="/admin/claims" className="block rounded px-2 py-1 hover:bg-muted">Claims</a></li>
          <li><a href="/admin/stats" className="block rounded px-2 py-1 hover:bg-muted">Stats</a></li>
        </ul>
      </nav>
      <main className="flex-1 p-6" />
    </div>
  );
}



declare const useLocation3: () => { pathname: string };
declare const cn3: (...args: unknown[]) => string;
declare const AdminLicenseStatusBanner2: React.FC<{ license: unknown }>;
declare const Button11: React.FC<{ variant?: string; className?: string; asChild?: boolean; children?: React.ReactNode }>;
declare const Link8: React.FC<{ to: string; children?: React.ReactNode }>;
declare const BarChart3Icon2: React.FC<{ className?: string }>;
declare const Building2Icon2: React.FC<{ className?: string }>;
declare const WalletIcon2: React.FC<{ className?: string }>;
declare const UsersIcon2: React.FC<{ className?: string }>;
declare const FileTextIcon2: React.FC<{ className?: string }>;
declare const SettingsIcon2: React.FC<{ className?: string }>;
declare const Trans7: React.FC<{ children?: React.ReactNode }>;
declare const Outlet3: React.FC<{}>;
declare const React: { FC: unknown; ReactNode: unknown };

export default function AdminLayout2({ loaderData }: { loaderData: { license: unknown } }) {
  const { license } = loaderData;
  const { pathname } = useLocation3();

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 md:px-8">
      <AdminLicenseStatusBanner2 license={license} />

      <h1 className="font-semibold text-4xl">
        <Trans7>Admin Panel</Trans7>
      </h1>

      <div className="mt-4 grid grid-cols-12 gap-x-8 md:mt-8">
        <div className={cn3('col-span-12 flex gap-x-2.5 gap-y-2 overflow-hidden overflow-x-auto md:col-span-3 md:flex md:flex-col')}>
          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/stats') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/stats">
              <BarChart3Icon2 className="mr-2 h-5 w-5" />
              <Trans7>Stats</Trans7>
            </Link8>
          </Button11>

          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/organisations') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/organisations">
              <Building2Icon2 className="mr-2 h-5 w-5" />
              <Trans7>Organisations</Trans7>
            </Link8>
          </Button11>

          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/claims') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/claims">
              <WalletIcon2 className="mr-2 h-5 w-5" />
              <Trans7>Claims</Trans7>
            </Link8>
          </Button11>

          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/users') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/users">
              <UsersIcon2 className="mr-2 h-5 w-5" />
              <Trans7>Users</Trans7>
            </Link8>
          </Button11>

          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/documents') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/documents">
              <FileTextIcon2 className="mr-2 h-5 w-5" />
              <Trans7>Documents</Trans7>
            </Link8>
          </Button11>

          <Button11
            variant="ghost"
            className={cn3('justify-start md:w-full', pathname?.startsWith('/admin/settings') && 'bg-secondary')}
            asChild
          >
            <Link8 to="/admin/settings">
              <SettingsIcon2 className="mr-2 h-5 w-5" />
              <Trans7>Settings</Trans7>
            </Link8>
          </Button11>
        </div>

        <div className="col-span-12 md:col-span-9">
          <Outlet3 />
        </div>
      </div>
    </div>
  );
}



// FP shape: Remix route modules (loader-only files) executed within the framework's request lifecycle.
// These are not long-running server entry points; process.on('uncaughtException') does not belong here.
declare function requireAdminRole(request: Request): Promise<void>;
declare function redirect(url: string): never;
declare function json<T>(data: T): Response;

export async function loader({ request }: { request: Request }) {
  try {
    await requireAdminRole(request);
  } catch {
    throw redirect('/');
  }
  return json({ ok: true });
}

export async function adminDashboardIndexLoader({ request }: { request: Request }) {
  await requireAdminRole(request);
  return json({ section: 'dashboard' });
}
