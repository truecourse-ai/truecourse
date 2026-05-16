// --- unused-export shape: framework-convention-default-export (Remix route default export, branding settings) ---
// The Remix framework consumes this default export by file-system convention.

declare function useLoaderData<T>(): T;
declare function Form({ method, children, encType }: { method: string; children: unknown; encType?: string }): JSX.Element;

type BrandingSettings = { logoUrl: string | null; primaryColor: string };

function OrgBrandingPage(): JSX.Element {
  const { logoUrl, primaryColor } = useLoaderData<BrandingSettings>();
  return (
    <section className="max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">Branding</h2>
      {logoUrl && <img src={logoUrl} alt="Organisation logo" className="h-12" />}
      <Form method="post" encType="multipart/form-data">
        <input type="file" name="logo" accept="image/*" />
        <input type="color" name="primaryColor" defaultValue={primaryColor} />
        <button type="submit">Update branding</button>
      </Form>
    </section>
  );
}

export default OrgBrandingPage;



// Shape: ternary rendering one of two components based on boolean condition — valid JSX conditional, no type mismatch
declare const isPersonalLayout: boolean;
declare function PersonalDashboard(): JSX.Element;
declare function TeamDashboard(): JSX.Element;

export function AppLayoutSnippet() {
  return (
    <div>
      <div className="header-right">
        {isPersonalLayout ? <PersonalDashboard /> : <TeamDashboard />}
      </div>
    </div>
  );
}
