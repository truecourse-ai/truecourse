
declare namespace RouteA { interface LoaderArgs { request: Request } interface ComponentProps { loaderData: { claims: Array<{ id: string; orgId: string; type: string }> } } }
declare function getAdminSessionA(request: Request): Promise<{ user: { id: string; isAdmin: boolean } }>;
declare function listClaims(): Promise<Array<{ id: string; orgId: string; type: string }>>;

export async function loader({ request }: RouteA.LoaderArgs) {
  const { user } = await getAdminSessionA(request);
  if (!user.isAdmin) throw new Response('Forbidden', { status: 403 });
  const claims = await listClaims();
  return { claims };
}

export default function AdminClaimsPage({ loaderData }: RouteA.ComponentProps) {
  const { claims } = loaderData;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Claims</h1>
      <ul className="mt-4 space-y-2">
        {claims.map((c) => (
          <li key={c.id} className="rounded border p-3">
            <span className="font-mono text-sm">{c.type}</span>
            <span className="ml-2 text-muted-foreground">{c.orgId}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}



declare const useLingui9: () => { t: (msg: unknown) => string };
declare const useSearchParams7: () => [URLSearchParams, (params: URLSearchParams) => void];
declare const useLocation2: () => { pathname: string };
declare const useState12: <T>(v: T | (() => T)) => [T, (v: T) => void];
declare const useEffect4: (fn: () => void | (() => void), deps?: unknown[]) => void;
declare const useDebouncedValue2: (v: string, delay: number) => string;
declare const SettingsHeader3: React.FC<{ title: unknown; subtitle?: unknown; hideDivider?: boolean; children?: React.ReactNode }>;
declare const AdminClaimsTable2: React.FC<{ licenseFlags?: Record<string, boolean> }>;
declare const ClaimCreateDialog2: React.FC<{ licenseFlags?: Record<string, boolean> }>;
declare const Input2: React.FC<{ defaultValue?: string; onChange?: (e: { target: { value: string } }) => void; placeholder?: string; className?: string }>;
declare const LicenseClient2: { getInstance: () => { getCachedLicense: () => Promise<{ license?: { flags: Record<string, boolean> } } | null> } | null };
declare const React: { FC: unknown; ReactNode: unknown };

export async function claimsLoader2() {
  const licenseData = await LicenseClient2.getInstance()?.getCachedLicense();
  return { licenseFlags: licenseData?.license?.flags };
}

export default function Claims2({ loaderData }: { loaderData: { licenseFlags?: Record<string, boolean> } }) {
  const { licenseFlags } = loaderData;
  const { t } = useLingui9();

  const [searchParams, setSearchParams] = useSearchParams7();
  const { pathname } = useLocation2();

  const [searchQuery, setSearchQuery] = useState12(() => searchParams?.get('query') ?? '');
  const debouncedSearchQuery = useDebouncedValue2(searchQuery, 500);

  useEffect4(() => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('query', debouncedSearchQuery);

    if (debouncedSearchQuery === '') {
      params.delete('query');
    }

    if (params.toString() === searchParams?.toString()) {
      return;
    }

    setSearchParams(params);
  }, [debouncedSearchQuery, pathname, searchParams]);

  return (
    <div>
      <SettingsHeader3
        title={t`Subscription Claims`}
        subtitle={t`Manage all subscription claims`}
        hideDivider
      >
        <ClaimCreateDialog2 licenseFlags={licenseFlags} />
      </SettingsHeader3>

      <div className="mt-4">
        <Input2
          defaultValue={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t`Search by claim ID or name`}
          className="mb-4"
        />

        <AdminClaimsTable2 licenseFlags={licenseFlags} />
      </div>
    </div>
  );
}
