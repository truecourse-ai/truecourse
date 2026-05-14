// remix-route-module: Remix loader-only route that performs a redirect — not a Node.js process entry point
declare function redirect(url: string): never;

export function loader({ params }: { params: { slug?: string } }) {
  if (params.slug) {
    throw redirect(`/org/${params.slug}/settings/general`);
  }
  throw redirect('/');
}


// Input placeholder showing an example OIDC well-known URL — display-only UI hint, not used at runtime
declare const FormField: React.FC<{ name: string; label: string; placeholder?: string; required?: boolean }>;
declare const FormItem: React.FC<{ children: React.ReactNode }>;
declare const FormLabel: React.FC<{ children: React.ReactNode; required?: boolean }>;
declare const FormControl: React.FC<{ children: React.ReactNode }>;
declare const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>>;

export function SsoConfigSection({ isSsoEnabled }: { isSsoEnabled: boolean }) {
  return (
    <FormItem>
      <FormLabel required={isSsoEnabled}>Issuer URL</FormLabel>
      <FormControl>
        <Input
          type="url"
          placeholder="https://your-idp.example.com/.well-known/openid-configuration"
          disabled={!isSsoEnabled}
        />
      </FormControl>
    </FormItem>
  );
}



// FP: SSO issuer URL for OIDC discovery — hardcoded org-specific endpoint used for metadata fetch
const SSO_ISSUER_URL = 'https://auth.truecourse-sso.internal/.well-known/openid-configuration';

export function fetchSsoMetadata(): Promise<Response> {
  return fetch(SSO_ISSUER_URL);
}

