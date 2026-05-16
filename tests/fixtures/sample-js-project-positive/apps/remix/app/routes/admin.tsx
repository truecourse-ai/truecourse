
// FP shape fa3b6cdbc413: loader using getOrganisation and form.reset on close — no type mismatch
declare function getOrganisationSettings(opts: { slug: string }): Promise<{ brandingEnabled: boolean; emailReplyTo?: string }>;
declare function useLoaderData<T>(): T;
declare const Form: React.FC<{ onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }>;
declare function Input(props: { defaultValue?: string; name: string }): JSX.Element;

function AdminSiteSettingsPage() {
  const settings = useLoaderData<{ brandingEnabled: boolean; emailReplyTo?: string }>();
  return (
    <Form onSubmit={(e) => e.preventDefault()}>
      <Input name="emailReplyTo" defaultValue={settings.emailReplyTo} />
    </Form>
  );
}
