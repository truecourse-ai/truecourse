declare const cn: (...args: unknown[]) => string;
declare const formatDateTime: (d: Date) => string;
declare const getCountryName: (code: string) => string;

type AuditLogEntry = {
  id: string;
  event: string;
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  createdAt: Date;
};

type SignatureRecord = {
  recipientId: string;
  dataUrl: string;
  signedAt: Date;
};

type CertificateRecipient = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  signingOrder?: number;
};

type SigningCertificateProps = {
  documentTitle: string;
  documentId: string;
  createdAt: Date;
  completedAt?: Date;
  recipients: CertificateRecipient[];
  auditLogs: AuditLogEntry[];
  signatures: SignatureRecord[];
};

export function SigningCertificateRenderer({
  documentTitle,
  documentId,
  createdAt,
  completedAt,
  recipients,
  auditLogs,
  signatures,
}: SigningCertificateProps) {
  const getSignature = (recipientId: string) =>
    signatures.find((s) => s.recipientId === recipientId);

  const getRecipientLogs = (recipientId: string) =>
    auditLogs.filter((l) => l.event.includes(recipientId));

  return (
    <div className="pointer-events-none mx-auto max-w-screen-md px-4 py-8 print:px-0">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Signing Certificate</h1>
          <p className="text-sm text-muted-foreground">Document ID: {documentId}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Created: {formatDateTime(createdAt)}</p>
          {completedAt && (
            <p className="text-sm text-muted-foreground">Completed: {formatDateTime(completedAt)}</p>
          )}
        </div>
      </div>
      <h2 className="mb-4 text-lg font-semibold">{documentTitle}</h2>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium">Signer</th>
              <th className="px-4 py-3 text-left font-medium">Signature</th>
              <th className="px-4 py-3 text-left font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((recipient) => {
              const signature = getSignature(recipient.id);
              const logs = getRecipientLogs(recipient.id);
              return (
                <tr key={recipient.id} className="border-b last:border-0 print:break-inside-avoid">
                  <td className="px-4 py-4 align-top">
                    <div className="font-medium">{recipient.name}</div>
                    <div className="break-all text-xs text-muted-foreground">{recipient.email}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{recipient.role}</div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    {signature ? (
                      <div className="flex flex-col gap-1">
                        <img
                          src={signature.dataUrl}
                          alt="Signature"
                          className="max-h-16 max-w-[160px] object-contain"
                        />
                        <p className="text-xs text-muted-foreground">
                          Signed: {formatDateTime(signature.signedAt)}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not signed</span>
                    )}
                  </td>
                  <td className="px-4 py-4 align-top">
                    {logs.length > 0 ? (
                      <ul className="flex flex-col gap-1">
                        {logs.slice(0, 5).map((log) => (
                          <li key={log.id} className="text-xs">
                            <span className="font-medium">{log.event}</span>
                            {log.ipAddress && <span className="ml-1 text-muted-foreground">({log.ipAddress})</span>}
                            {log.country && <span className="ml-1 text-muted-foreground">{getCountryName(log.country)}</span>}
                            <span className="ml-1 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-muted-foreground">No activity</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
