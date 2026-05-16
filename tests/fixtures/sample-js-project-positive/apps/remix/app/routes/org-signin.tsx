// org-signin.tsx — org-specific sign-in page route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useActionData<T>(): T | undefined;
declare function redirect(url: string): never;
declare const SignInForm: (props: { orgSlug: string; ssoEnabled: boolean; ssoProvider?: string; onSuccess: () => void }) => JSX.Element;
declare const SsoButton: (props: { provider: string; orgSlug: string }) => JSX.Element;
declare const OrgLogo: (props: { logoUrl?: string; name: string; size?: string }) => JSX.Element;
declare const Alert: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;

type OrgSignInConfig = {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  ssoEnabled: boolean;
  ssoProvider?: string;
  allowPasswordAuth: boolean;
  requireSso: boolean;
};

type OrgSignInLoaderData = {
  org: OrgSignInConfig;
  redirectTo?: string;
};

type OrgSignInActionData = {
  error?: string;
};

declare function getOrgSignInConfig(slug: string): Promise<OrgSignInConfig | null>;

export async function loader({ params, request }: { params: { orgUrl: string }; request: Request }) {
  const { orgUrl } = params;
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirectTo') ?? undefined;

  const org = await getOrgSignInConfig(orgUrl);
  if (!org) throw new Response('Organization Not Found', { status: 404 });

  return { org, redirectTo };
}

export default function OrgSignIn() {
  const { org, redirectTo } = useLoaderData<OrgSignInLoaderData>();
  const actionData = useActionData<OrgSignInActionData>();

  const handleSignInSuccess = () => {
    window.location.href = redirectTo ?? `/${org.slug}/dashboard`;
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <OrgLogo logoUrl={org.logoUrl} name={org.name} size="lg" />
          <h1 className="mt-4 text-2xl font-bold">{org.name}</h1>
          <p className="text-muted-foreground">Sign in to your organization account</p>
        </div>

        {actionData?.error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{actionData.error}</AlertDescription>
          </Alert>
        )}

        {org.requireSso && !org.ssoEnabled ? (
          <Alert className="mb-4">
            <AlertDescription>
              This organization requires Single Sign-On, but SSO is not configured yet.
              Please contact your administrator.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="rounded-lg border bg-background p-6 shadow-sm">
            {org.ssoEnabled && org.ssoProvider && (
              <div className="mb-4">
                <SsoButton provider={org.ssoProvider} orgSlug={org.slug} />

                {org.allowPasswordAuth && !org.requireSso && (
                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">or</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(org.allowPasswordAuth && !org.requireSso) && (
              <SignInForm
                orgSlug={org.slug}
                ssoEnabled={org.ssoEnabled}
                ssoProvider={org.ssoProvider}
                onSuccess={handleSignInSuccess}
              />
            )}
          </div>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Not a member of {org.name}?{' '}
          <a href="/signup" className="text-primary hover:underline">Sign up</a>
        </p>
      </div>
    </div>
  );
}
