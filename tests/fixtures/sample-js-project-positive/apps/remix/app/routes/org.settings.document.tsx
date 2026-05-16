// --- unused-export shape: framework-convention-default-export (Remix route default export, document settings) ---
// Remix loads this module by convention — no explicit import statement in any file.

declare function useLoaderData<T>(): T;
declare function Form({ method, children }: { method: string; children: unknown }): JSX.Element;

type DocumentSettings = { requireApproval: boolean; allowDownload: boolean; expiryDays: number };

function OrgDocumentSettingsPage(): JSX.Element {
  const { requireApproval, allowDownload, expiryDays } = useLoaderData<DocumentSettings>();
  return (
    <section className="max-w-lg space-y-4">
      <h2 className="text-lg font-semibold">Document settings</h2>
      <Form method="post">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="requireApproval" defaultChecked={requireApproval} />
          Require approval before sending
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="allowDownload" defaultChecked={allowDownload} />
          Allow recipients to download
        </label>
        <label className="block">
          Expiry days
          <input type="number" name="expiryDays" defaultValue={expiryDays} className="input" />
        </label>
        <button type="submit">Save</button>
      </Form>
    </section>
  );
}

export default OrgDocumentSettingsPage;
