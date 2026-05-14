
declare function decryptSecondaryData(d: string): string | null;
declare function unsafeGetEntireEnvelopeForPdf(opts: { id: { type: string; id: number }; type: string }): Promise<unknown>;
declare function getAuditLogTranslations(locale: string): Promise<{ t: (key: string) => string }>;
declare const Card: React.FC<{ children?: React.ReactNode; className?: string }>;
declare const CardContent: React.FC<{ children?: React.ReactNode; className?: string }>;
declare const AuditLogTable: React.FC<{ envelope: unknown; translations: unknown }>;
declare const DateTime: { fromMillis: (ms: number) => { toISO: () => string } };
declare const redirect: (path: string) => never;
declare const React: { FC: unknown; ReactNode: unknown };

export const auditPdfLinks = () => [
  { rel: 'stylesheet', href: '/app.css' },
  { rel: 'stylesheet', href: '/audit-log-print.css' },
];

export async function auditPdfLoader({ request }: { request: Request }) {
  const d = new URL(request.url).searchParams.get('d');

  if (typeof d !== 'string' || !d) {
    throw redirect('/');
  }

  const rawDocumentId = decryptSecondaryData(d);

  if (!rawDocumentId || isNaN(Number(rawDocumentId))) {
    throw redirect('/');
  }

  const documentId = Number(rawDocumentId);

  const envelope = await unsafeGetEntireEnvelopeForPdf({
    id: { type: 'documentId', id: documentId },
    type: 'DOCUMENT',
  });

  const locale = new URL(request.url).searchParams.get('locale') ?? 'en';
  const translations = await getAuditLogTranslations(locale);

  return { envelope, translations };
}

export default function AuditLogPdfPage({ loaderData }: { loaderData: { envelope: unknown; translations: unknown } }) {
  const { envelope, translations } = loaderData;

  return (
    <Card>
      <CardContent>
        <AuditLogTable envelope={envelope} translations={translations} />
      </CardContent>
    </Card>
  );
}
