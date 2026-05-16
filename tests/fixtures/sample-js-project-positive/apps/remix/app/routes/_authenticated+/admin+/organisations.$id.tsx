// Toast variant 'destructive' in a single admin route — standalone protocol vocabulary usage
declare function toast(opts: { title: string; description?: string; variant?: string }): void;

async function handleDeleteOrganisation(orgId: string) {
  try {
    await deleteOrganisation(orgId);
    toast({ title: 'Organisation deleted', variant: 'success' });
  } catch (err) {
    toast({ title: 'Error', description: 'Failed to delete organisation', variant: 'destructive' });
  }
}

declare function deleteOrganisation(orgId: string): Promise<void>;



// --- FP shape: Remix default page component returning JSX; return type trivially inferred. Framework convention ---
declare function useLingui(): { t: (s: string) => string };
declare function useNavigate(): (path: string) => void;
declare const React: { createElement: (tag: string, props: unknown, ...children: unknown[]) => unknown };

export default function OrganisationDetailPage({ params }: { params: { id: string } }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const orgId = params.id;

  return (
    <div>
      <h1>{t('Organisation')}</h1>
      <span>{orgId}</span>
    </div>
  );
}



// --- FP shape: Remix loader export (non-async); return type inferred. Framework-conventional export ---
declare function redirect2(url: string): never;
declare function data3(payload: unknown): unknown;

export function loaderEmailDomain({ params }: { params: { id?: string } }) {
  const id = params.id;

  if (!id) {
    throw redirect2('/admin/email-domains');
  }

  return data3({ domainId: id });
}



// --- FP shape: Remix async loader export; return type inferred. Framework-conventional export ---
declare function getSiteSettings(): Promise<Array<{ id: string; value: unknown }>>;
declare const SITE_SETTINGS_BANNER_ID: string;
declare function data4(payload: unknown): unknown;

export async function loaderSiteSettings() {
  const banner = await getSiteSettings().then((settings) =>
    settings.find((setting) => setting.id === SITE_SETTINGS_BANNER_ID),
  );

  return data4({ banner });
}



// --- FP shape: Next.js async page component returning JSX; return type (Promise<JSX.Element>) trivially inferred, idiomatic to omit ---
declare function notFound(): never;
declare const source: { getPage(slug: string[] | undefined): { data: { title: string } } | undefined };

export default async function DocsPage(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  return (
    <div>
      <h1>{page.data.title}</h1>
    </div>
  );
}



// [unknown-catch-variable] catch(err) — AppError.parseError wraps then console.error + fixed toast
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare function suspendOrganisation(orgId: string): Promise<void>;
declare const adminToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleOrgSuspension(orgId: string): Promise<void> {
  try {
    await suspendOrganisation(orgId);
    adminToast({ title: 'Organisation suspended', description: 'The organisation has been suspended.' });
  } catch (err) {
    const error = AppError.parseError(err);
    console.error(error);
    adminToast({
      title: 'Action failed',
      description: 'We could not suspend the organisation. Please try again.',
      variant: 'destructive',
    });
  }
}
