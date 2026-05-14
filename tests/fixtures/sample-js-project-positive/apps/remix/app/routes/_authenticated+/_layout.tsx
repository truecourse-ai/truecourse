
declare const SITE_BANNER_SETTING_ID: string;
declare function fetchSiteConfig(): Promise<Array<{ id: string; value: string }>>;

async function loadBannerSetting() {
  const banner = await fetchSiteConfig().then((configs) =>
    configs.find((config) => config.id === SITE_BANNER_SETTING_ID),
  );
  return banner;
}



// --- FP shape: Remix Layout export (React component) returning JSX; trivially inferred. Framework convention function ---
declare function ThemeProvider(props: { specifiedTheme: string | undefined; themeAction: string; children: unknown }): unknown;
declare function LayoutContent2(props: { children: unknown }): unknown;
declare function useLoaderData2<T>(): T;

export function Layout2({ children }: { children: unknown }) {
  const loaderData = useLoaderData2<{ theme?: string }>();
  const { theme } = loaderData || {};

  return (
    <ThemeProvider specifiedTheme={theme} themeAction="/api/theme">
      <LayoutContent2>{children}</LayoutContent2>
    </ThemeProvider>
  );
}



// --- FP shape: Remix layout component returning JSX outlet; trivially inferred. Framework convention ---
declare function Outlet2(): unknown;
declare function useCurrentOrganisation(): { id: string; url: string };

export default function OrgLayout() {
  const currentOrganisation = useCurrentOrganisation();

  return (
    <div key={currentOrganisation.url} className="mx-auto w-full max-w-screen-xl px-4">
      <Outlet2 />
    </div>
  );
}



// --- FP shape: Remix loader export; return type inferred from data() call, framework-conventional export ---
declare function getOptionalSession2(req: unknown): Promise<{ isAuthenticated: boolean; user?: { id: string } }>;
declare function getSiteSettings2(): Promise<Array<{ id: string; value: unknown }>>;
declare const BANNER_ID: string;
declare function data5(payload: unknown): unknown;

export async function loaderLayout({ request }: { request: unknown }) {
  const [session, banner] = await Promise.all([
    getOptionalSession2(request),
    getSiteSettings2().then((settings) => settings.find((s) => s.id === BANNER_ID)),
  ]);

  return data5({ session, banner });
}



// --- FP shape: React component function returning JSX; trivially inferred, codebase-wide pattern ---
declare function useLoaderData3<T>(): T;
declare function Outlet3(): unknown;

export function LayoutContent3({ children }: { children: unknown }) {
  const loaderData = useLoaderData3<{ publicEnv: Record<string, string>; lang: string }>();
  const { publicEnv, lang } = loaderData || {};

  return (
    <div lang={lang}>
      {children}
      <Outlet3 />
    </div>
  );
}



// --- FP shape: React layout component returning JSX; trivially inferred, whole codebase omits return types on components ---
declare function usePathname(): string;
declare function useMemo2<T>(fn: () => T, deps: unknown[]): T;

export default function DocsLayout({ children }: { children: unknown }) {
  const pathname = usePathname();

  const { activeSection } = useMemo2(() => {
    const pathParts = pathname.split('/').filter(Boolean);
    return { activeSection: pathParts[1] ?? 'overview' };
  }, [pathname]);

  return (
    <div data-section={activeSection}>
      <nav>
        <a href="/docs">Docs</a>
      </nav>
      <main>{children}</main>
    </div>
  );
}



// --- FP shape: Remix route default-export React components returning JSX; TS infers return type, annotation idiomatic-optional ---
declare function useLingui2(): { t: (s: string) => string };
declare function useSession4(): { user: { id: string }; organisations: Array<{ id: string; name: string }> };

export default function DashboardPage() {
  const { t } = useLingui2();
  const { user, organisations } = useSession4();

  return (
    <div>
      <h1>{t('Dashboard')}</h1>
      <p>{user.id}</p>
      <ul>
        {organisations.map((org) => (
          <li key={org.id}>{org.name}</li>
        ))}
      </ul>
    </div>
  );
}


declare const useSession: () => { user: { id: string; name: string }; organisations: Array<{ id: string; url: string; name: string; teams: Array<{ id: string; url: string; name: string }> }> };
declare const useParams: () => Record<string, string | undefined>;
declare const Outlet: () => JSX.Element;
declare const AppSidebar: (props: { currentOrg: { id: string; url: string; name: string } | null; teams: Array<{ id: string; url: string; name: string }> }) => JSX.Element;
declare const SiteBanner: (props: { content: string }) => JSX.Element;
declare const redirect: (url: string) => never;
declare const getOptionalSession: (req: Request) => Promise<{ isAuthenticated: boolean }>;
declare const getSiteSettings: () => Promise<Array<{ id: string; value: string }>>;
declare const SITE_SETTINGS_BANNER_ID: string;

export const shouldRevalidate = () => false;

export async function authenticatedLayoutLoader({ request }: { request: Request }) {
  const [session, allSettings] = await Promise.all([
    getOptionalSession(request),
    getSiteSettings(),
  ]);

  if (!session.isAuthenticated) {
    throw redirect('/signin');
  }

  const banner = allSettings.find((s) => s.id === SITE_SETTINGS_BANNER_ID);

  return { banner };
}

export default function AuthenticatedLayout({
  loaderData,
  params,
}: {
  loaderData: { banner?: { value: string } };
  params: Record<string, string | undefined>;
}) {
  const { banner } = loaderData;
  const { user, organisations } = useSession();

  const teamUrl = params.teamUrl;
  const orgUrl = params.orgUrl;

  const teams = organisations.flatMap((org) => org.teams);

  const extractCurrentOrg = () => {
    if (orgUrl) return organisations.find((org) => org.url === orgUrl) ?? null;
    if (teamUrl) return organisations.find((org) => org.teams.some((t) => t.url === teamUrl)) ?? null;
    return null;
  };

  const currentOrg = extractCurrentOrg();

  return (
    <div className="flex min-h-screen flex-row">
      <AppSidebar currentOrg={currentOrg} teams={teams} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {banner && <SiteBanner content={banner.value} />}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
