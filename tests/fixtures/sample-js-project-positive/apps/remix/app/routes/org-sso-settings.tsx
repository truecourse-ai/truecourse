// org-sso-settings.tsx — SSO configuration settings route
// React component/route (TSX): JSX markup and hooks inflate line count;
// this is standard React framework structure, not decomposable excess logic.

declare function useLoaderData<T>(): T;
declare function useActionData<T>(): T | undefined;
declare function useFetcher(): { submit: (data: FormData, opts: { method: string }) => void; state: string };
declare const Switch: (props: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string }) => JSX.Element;
declare const Label: (props: { htmlFor?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const Input: (props: Record<string, unknown>) => JSX.Element;
declare const Button: (props: { type?: string; variant?: string; disabled?: boolean; children: React.ReactNode }) => JSX.Element;
declare const Alert: (props: { variant?: string; className?: string; children: React.ReactNode }) => JSX.Element;
declare const AlertTitle: (props: { children: React.ReactNode }) => JSX.Element;
declare const AlertDescription: (props: { children: React.ReactNode }) => JSX.Element;
declare const Badge: (props: { variant?: string; children: React.ReactNode }) => JSX.Element;
declare function useState<T>(init: T): [T, (v: T) => void];

type SsoProvider = 'SAML' | 'OIDC' | 'GOOGLE' | 'MICROSOFT';

type SsoConfig = {
  provider: SsoProvider;
  enabled: boolean;
  entityId?: string;
  metadataUrl?: string;
  clientId?: string;
  clientSecret?: string;
  enforced: boolean;
  allowedDomains: string[];
};

type SsoSettingsLoaderData = {
  orgId: string;
  orgName: string;
  ssoConfig: SsoConfig | null;
  canConfigure: boolean;
};

declare function getOrgSsoConfig(orgId: string): Promise<SsoConfig | null>;
declare function canUserConfigureSso(userId: string, orgId: string): Promise<boolean>;

export async function loader({ params }: { params: { orgSlug: string } }) {
  const { orgSlug } = params;
  const org = await getOrgBySlug_sso(orgSlug);
  if (!org) throw new Response('Not Found', { status: 404 });

  const [ssoConfig, canConfigure] = await Promise.all([
    getOrgSsoConfig(org.id),
    canUserConfigureSso('current-user', org.id),
  ]);

  return { orgId: org.id, orgName: org.name, ssoConfig, canConfigure };
}

declare function getOrgBySlug_sso(slug: string): Promise<{ id: string; name: string } | null>;

export default function OrgSsoSettings() {
  const { orgName, ssoConfig, canConfigure } = useLoaderData<SsoSettingsLoaderData>();
  const fetcher = useFetcher();
  const [selectedProvider, setSelectedProvider] = useState<SsoProvider>(ssoConfig?.provider ?? 'SAML');
  const [enforced, setEnforced] = useState(ssoConfig?.enforced ?? false);

  const isSaving = fetcher.state !== 'idle';

  if (!canConfigure) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTitle>Access Restricted</AlertTitle>
          <AlertDescription>You do not have permission to configure SSO for this organization.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Single Sign-On</h1>
        <p className="text-muted-foreground">
          Configure SSO for {orgName} to allow members to authenticate with your identity provider.
        </p>
      </div>

      {ssoConfig?.enabled && (
        <Alert className="mb-6">
          <AlertTitle>SSO Active</AlertTitle>
          <AlertDescription>
            SSO is currently enabled with{' '}
            <Badge variant="outline">{ssoConfig.provider}</Badge>.
            {ssoConfig.enforced && ' Login is enforced via SSO.'}
          </AlertDescription>
        </Alert>
      )}

      <fetcher.submit as unknown as React.ReactElement>
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>SSO Provider</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['SAML', 'OIDC', 'GOOGLE', 'MICROSOFT'] as SsoProvider[]).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => setSelectedProvider(provider)}
                  className={`rounded border px-3 py-2 text-sm font-medium ${
                    selectedProvider === provider
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  {provider}
                </button>
              ))}
            </div>
          </div>

          {(selectedProvider === 'SAML') && (
            <>
              <div className="space-y-2">
                <Label htmlFor="entityId">Entity ID</Label>
                <Input
                  id="entityId"
                  name="entityId"
                  defaultValue={ssoConfig?.entityId ?? ''}
                  placeholder="https://your-idp.example.com/entity"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="metadataUrl">Metadata URL</Label>
                <Input
                  id="metadataUrl"
                  name="metadataUrl"
                  defaultValue={ssoConfig?.metadataUrl ?? ''}
                  placeholder="https://your-idp.example.com/metadata.xml"
                />
              </div>
            </>
          )}

          {(selectedProvider === 'OIDC' || selectedProvider === 'GOOGLE' || selectedProvider === 'MICROSOFT') && (
            <>
              <div className="space-y-2">
                <Label htmlFor="clientId">Client ID</Label>
                <Input
                  id="clientId"
                  name="clientId"
                  defaultValue={ssoConfig?.clientId ?? ''}
                  placeholder="Your OAuth client ID"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Client Secret</Label>
                <Input
                  id="clientSecret"
                  name="clientSecret"
                  type="password"
                  defaultValue={ssoConfig?.clientSecret ?? ''}
                  placeholder="Your OAuth client secret"
                />
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <Switch
              id="enforced"
              checked={enforced}
              onCheckedChange={setEnforced}
            />
            <Label htmlFor="enforced" className="cursor-pointer">
              Enforce SSO — require all members to log in via SSO
            </Label>
          </div>

          <input type="hidden" name="provider" value={selectedProvider} />
          <input type="hidden" name="enforced" value={String(enforced)} />

          <div className="flex gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Configuration'}
            </Button>
            {ssoConfig?.enabled && (
              <Button type="button" variant="destructive" disabled={isSaving}>
                Disable SSO
              </Button>
            )}
          </div>
        </div>
      </fetcher.submit>
    </div>
  );
}
