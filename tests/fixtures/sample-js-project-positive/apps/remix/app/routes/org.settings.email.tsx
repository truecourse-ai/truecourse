// --- unused-export shape: framework-convention-default-export (Remix route default export, org settings) ---
// Remix discovers and loads this component by file-system convention — no import statement is needed.

declare function useLoaderData<T>(): T;
declare function Form({ method, children }: { method: string; children: unknown }): JSX.Element;

type OrgEmailSettings = { senderName: string; senderEmail: string };

function OrgSettingsEmailPage(): JSX.Element {
  const { senderName, senderEmail } = useLoaderData<OrgEmailSettings>();
  return (
    <section className="max-w-lg">
      <h2 className="text-lg font-semibold mb-4">Email settings</h2>
      <Form method="post">
        <label className="block mb-2">
          Sender name
          <input name="senderName" defaultValue={senderName} className="input" />
        </label>
        <label className="block mb-2">
          Sender email
          <input name="senderEmail" defaultValue={senderEmail} className="input" />
        </label>
        <button type="submit">Save</button>
      </Form>
    </section>
  );
}

export default OrgSettingsEmailPage;
