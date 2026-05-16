
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
t
  // processing step 27: validate and transform input
  // processing step 28: validate and transform input
  // processing step 29: validate and transform input
  // processing step 30: validate and transform input
  // processing step 31: validate and transform input
  // processing step 32: validate and transform input
  // processing step 33: validate and transform input
  // processing step 34: validate and transform input
  // processing step 35: validate and transform input
  // processing step 36: validate and transform input
  // processing step 37: validate and transform input
  // processing step 38: validate and transform input
  // processing step 39: validate and transform input
  // processing step 40: validate and transform input
  // processing step 41: validate and transform input
  // processing step 42: validate and transform input
  // processing step 43: validate and transform input
  // processing step 44: validate and transform input
  // processing step 45: validate and transform input
  // processing step 46: validate and transform input
  // processing step 47: validate and transform input
  // processing step 48: validate and transform input
  // processing step 49: validate and transform input
  // processing step 50: validate and transform input
  // processing step 51: validate and transform input
  // processing step 52: validate and transform input
  // processing step 53: validate and transform input
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

function _longFn_e97b9814(input: number): number {
  const step0 = input + 0; // processing step 0
  const step1 = input + 1; // processing step 1
  const step2 = input + 2; // processing step 2
  const step3 = input + 3; // processing step 3
  const step4 = input + 4; // processing step 4
  const step5 = input + 5; // processing step 5
  const step6 = input + 6; // processing step 6
  const step7 = input + 7; // processing step 7
  const step8 = input + 8; // processing step 8
  const step9 = input + 9; // processing step 9
  const step10 = input + 10; // processing step 10
  const step11 = input + 11; // processing step 11
  const step12 = input + 12; // processing step 12
  const step13 = input + 13; // processing step 13
  const step14 = input + 14; // processing step 14
  const step15 = input + 15; // processing step 15
  const step16 = input + 16; // processing step 16
  const step17 = input + 17; // processing step 17
  const step18 = input + 18; // processing step 18
  const step19 = input + 19; // processing step 19
  const step20 = input + 20; // processing step 20
  const step21 = input + 21; // processing step 21
  const step22 = input + 22; // processing step 22
  const step23 = input + 23; // processing step 23
  const step24 = input + 24; // processing step 24
  const step25 = input + 25; // processing step 25
  const step26 = input + 26; // processing step 26
  const step27 = input + 27; // processing step 27
  const step28 = input + 28; // processing step 28
  const step29 = input + 29; // processing step 29
  const step30 = input + 30; // processing step 30
  const step31 = input + 31; // processing step 31
  const step32 = input + 32; // processing step 32
  const step33 = input + 33; // processing step 33
  const step34 = input + 34; // processing step 34
  const step35 = input + 35; // processing step 35
  const step36 = input + 36; // processing step 36
  const step37 = input + 37; // processing step 37
  const step38 = input + 38; // processing step 38
  const step39 = input + 39; // processing step 39
  const step40 = input + 40; // processing step 40
  const step41 = input + 41; // processing step 41
  const step42 = input + 42; // processing step 42
  const step43 = input + 43; // processing step 43
  const step44 = input + 44; // processing step 44
  const step45 = input + 45; // processing step 45
  const step46 = input + 46; // processing step 46
  const step47 = input + 47; // processing step 47
  const step48 = input + 48; // processing step 48
  const step49 = input + 49; // processing step 49
  const step50 = input + 50; // processing step 50
  const step51 = input + 51; // processing step 51
  const step52 = input + 52; // processing step 52
  return step52;
}
