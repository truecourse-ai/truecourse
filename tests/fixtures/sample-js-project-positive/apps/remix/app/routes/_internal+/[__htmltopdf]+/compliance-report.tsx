declare function decryptSecondaryData(d: string): string | null;
declare function findDocumentAuditLogs(opts: { documentId: number; page?: number; perPage?: number }): Promise<{ data: { id: string; type: string; createdAt: string; name: string; email: string; ipAddress: string }[]; totalPages: number }>;
declare function getTranslations(lang: string): Promise<{ t: (key: string) => string }>;
declare const DateTime: { fromISO: (s: string) => { toFormat: (fmt: string) => string } };
declare function redirect(url: string): never;

declare namespace Route {
  interface LoaderArgs { request: Request; }
  type LinksFunction = () => { rel: string; href: string }[];
}

export const links: Route.LinksFunction = () => [
  { rel: 'stylesheet', href: '/app.css' },
  { rel: 'stylesheet', href: '/audit-log.print.css' },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const d = url.searchParams.get('d');

  if (typeof d !== 'string' || !d) {
    throw redirect('/');
  }

  const rawDocumentId = decryptSecondaryData(d);

  if (!rawDocumentId || isNaN(Number(rawDocumentId))) {
    throw redirect('/');
  }

  const documentId = Number(rawDocumentId);

  const lang = url.searchParams.get('lang') ?? 'en';
  const { t } = await getTranslations(lang);

  const auditLogs = await findDocumentAuditLogs({ documentId, page: 1, perPage: 100 });

  return { documentId, auditLogs: auditLogs.data, lang, t };
}

export default function ComplianceReportRoute({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { auditLogs, documentId, lang } = loaderData;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="font-bold text-2xl">Compliance Audit Report</h1>
        <p className="text-muted-foreground text-sm">Document ID: {documentId}</p>
      </header>
      <section>
        <h2 className="mb-4 font-semibold text-lg">Audit Trail</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left">Event</th>
              <th className="py-2 text-left">User</th>
              <th className="py-2 text-left">IP Address</th>
              <th className="py-2 text-left">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log) => (
              <tr key={log.id} className="border-b">
                <td className="py-2">{log.type}</td>
                <td className="py-2">
                  <div>{log.name}</div>
                  <div className="text-muted-foreground text-xs">{log.email}</div>
                </td>
                <td className="py-2 font-mono text-xs">{log.ipAddress}</td>
                <td className="py-2 text-xs">
                  {DateTime.fromISO(log.createdAt).toFormat('yyyy-MM-dd HH:mm:ss')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {auditLogs.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-sm">No audit log entries found.</p>
        )}
      </section>
    </div>
  );
}
