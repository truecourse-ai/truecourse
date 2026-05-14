

// --- missing-boundary-types shape: remix-default-component-export (JSX page) ---
declare function useMemo<T>(fn: () => T, deps: unknown[]): T;
declare const useSession: () => { user: { name: string; email: string }; organisations: Array<{ id: string; name: string }> };
declare function appMetaTags(label: unknown): Array<{ title?: string; name?: string; content?: string }>;
declare const msg: (strings: TemplateStringsArray) => unknown;

export function meta() {
  return appMetaTags(msg`Dashboard`);
}

export default function DashboardPage() {
  const { user, organisations } = useSession();

  const teamCount = useMemo(() => organisations.length, [organisations]);

  return (
    <div>
      <h1>Welcome, {user.name}</h1>
      <p>You have access to {teamCount} workspace(s).</p>
    </div>
  );
}




// --- missing-boundary-types shape: remix-v3-route-exports-with-component-props ---
type RouteComponentProps = { loaderData: { licenseFlags: Record<string, boolean> | undefined } };
declare function useState<T>(init: T | (() => T)): [T, (v: T) => void];
declare function useSearchParams(): [URLSearchParams, (p: URLSearchParams) => void];
declare function useLocation(): { pathname: string };

export async function licenseLoader() {
  return { licenseFlags: { enterprise: true } };
}

export default function LicenseDashboard({ loaderData }: RouteComponentProps) {
  const { licenseFlags } = loaderData;
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const [query, setQuery] = useState(() => searchParams?.get('query') ?? '');

  void pathname;
  void setQuery;

  return (
    <div>
      <h1>License Dashboard</h1>
      <p>Enterprise: {licenseFlags?.enterprise ? 'Yes' : 'No'}</p>
      <p>Search: {query}</p>
    </div>
  );
}




// --- missing-boundary-types shape: remix-meta-reserved-export ---
declare function appMetaTags(label: unknown): Array<{ title?: string; name?: string; content?: string }>;
declare const msg: (strings: TemplateStringsArray) => unknown;

export function meta() {
  return appMetaTags(msg`Inbox`);
}

export default function InboxOverviewPage() {
  return (
    <div>
      <h1>Inbox</h1>
      <p>Your pending signing requests will appear here.</p>
    </div>
  );
}




// --- missing-return-type shape: remix-async-loader-export (framework-mandated export) ---
declare function requireSession(request: Request): Promise<{ userId: string; orgId: string }>;
declare function getDocumentById(id: string): Promise<{ id: string; title: string; status: string } | null>;
declare function notFound(): never;

type AdminLoaderArgs = { request: Request; params: { id: string } };

export async function loader({ request, params }: AdminLoaderArgs) {
  const session = await requireSession(request);
  void session;

  const document = await getDocumentById(params.id);

  if (!document) {
    throw notFound();
  }

  return { document };
}




// --- missing-return-type shape: react-export-default-function-returning-jsx ---
declare const useLingui: () => { t: (s: unknown) => string };
declare function useCurrentTeam(): { id: string; name: string; slug: string };

export default function EditorHeaderPage() {
  const { t } = useLingui();
  const team = useCurrentTeam();

  return (
    <div>
      <h1>{t('Editor')}</h1>
      <span>{team.name}</span>
    </div>
  );
}




// --- missing-return-type shape: remix-default-page-component-jsx ---
declare const useSession: () => { user: { name: string; avatarUrl: string | null; email: string } };

export default function ProfilePage() {
  const { user } = useSession();

  return (
    <div>
      <h1>Profile</h1>
      <p>{user.name}</p>
      <p>{user.email}</p>
    </div>
  );
}




// --- missing-return-type shape: remix-layout-component-returning-outlet ---
declare function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
declare function useNavigate(): (path: string) => void;
declare const Outlet: () => JSX.Element;
declare const ThemeProvider: (props: { children: React.ReactNode; theme: string }) => JSX.Element;
declare const useSession: () => { organisations: Array<{ id: string; teams: Array<{ id: string }> }> };
declare function isPersonalLayout(orgs: Array<{ id: string; teams: Array<{ id: string }> }>): boolean;

export default function PersonalSettingsLayout() {
  const { organisations } = useSession();
  const navigate = useNavigate();

  const isPersonalMode = isPersonalLayout(organisations);
  const team = organisations[0]?.teams[0] ?? null;

  useEffect(() => {
    if (!isPersonalMode || !team) {
      void navigate('/settings/profile');
    }
  }, []);

  if (!isPersonalMode || !team) {
    return null;
  }

  return (
    <ThemeProvider theme="light">
      <Outlet />
    </ThemeProvider>
  );
}
