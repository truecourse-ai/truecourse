
declare function _<T>(msg: T): T;
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

function renderStatusLabel(status: string) {
  if (status === 'rejected') {
    return _(msg`Rejected`);
  }
  return _(msg`Completed`);
}



declare const useLingui: () => { _: <T>(msg: T) => string };
declare const useLoaderData: <T>() => T;
declare const redirect: (url: string) => never;
declare const UAParser: new (ua: string) => { setUA(ua: string): void; getResult(): { os: { name: string }; browser: { name: string; version: string } } };

type Recipient = {
  id: number;
  name: string;
  email: string;
  role: string;
  authOptions: unknown;
  fields: Array<{ type: string; signature?: { signatureImageAsBase64?: string } | null }>;
};

type AuditLog = {
  type: string;
  createdAt: Date;
  data: {
    recipientId?: number;
    userAgent?: string | null;
    ipAddress?: string | null;
    fieldSecurity?: { type: string } | null;
  };
};

type LoaderData = {
  document: {
    id: string;
    title: string;
    status: string;
    user: { name: string; email: string };
    recipients: Recipient[];
    authOptions: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
  auditLogs: {
    EMAIL_SENT: AuditLog[];
    DOCUMENT_SENT: AuditLog[];
    DOCUMENT_OPENED: AuditLog[];
    DOCUMENT_RECIPIENT_COMPLETED: AuditLog[];
    DOCUMENT_RECIPIENT_REJECTED: AuditLog[];
    DOCUMENT_FIELD_INSERTED: AuditLog[];
  };
  documentLanguage: string;
  hidePoweredBy: boolean;
};

declare function extractDocumentAuthMethods(opts: { documentAuth: unknown; recipientAuth: unknown }): {
  derivedRecipientAccessAuth: string[];
};

declare function jsx(tag: string, props: unknown, ...children: unknown[]): unknown;

export default function AuditCertificate() {
  const { document, auditLogs, hidePoweredBy } = useLoaderData<LoaderData>();
  const { _ } = useLingui();

  const isOwner = (email: string) => {
    return email.toLowerCase() === document.user.email.toLowerCase();
  };

  const getDeviceInfo = (userAgent?: string | null): string => {
    if (!userAgent) {
      return 'Unknown';
    }
    const parser = new UAParser(userAgent);
    parser.setUA(userAgent);
    const result = parser.getResult();
    return `${result.os.name} - ${result.browser.name} ${result.browser.version}`;
  };

  const getAuthLevel = (recipientId: number): string => {
    const recipient = document.recipients.find((r) => r.id === recipientId);
    if (!recipient) {
      return 'Unknown';
    }
    const extracted = extractDocumentAuthMethods({
      documentAuth: document.authOptions,
      recipientAuth: recipient.authOptions,
    });
    const fieldLogs = auditLogs.DOCUMENT_FIELD_INSERTED.filter(
      (log) => log.data.recipientId === recipient.id && log.data.fieldSecurity,
    );
    const latestFieldAuth = fieldLogs.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0]?.data?.fieldSecurity?.type;

    if (latestFieldAuth === 'TWO_FACTOR_AUTH') {
      return _(msg`Two-Factor Re-Authentication`);
    }
    if (latestFieldAuth === 'PASSWORD') {
      return _(msg`Password Re-Authentication`);
    }
    if (latestFieldAuth === 'PASSKEY') {
      return _(msg`Passkey Re-Authentication`);
    }
    if (latestFieldAuth === 'ACCOUNT') {
      return _(msg`Account Re-Authentication`);
    }

    const accessMethod = extracted.derivedRecipientAccessAuth[0];
    if (accessMethod === 'ACCOUNT') {
      return _(msg`Account Authentication`);
    }
    if (accessMethod === 'TWO_FACTOR_AUTH') {
      return _(msg`Two-Factor Authentication`);
    }
    return _(msg`Email`);
  };

  const getRecipientLogs = (recipientId: number) => ({
    emailSent: auditLogs.EMAIL_SENT.filter((log) => log.data.recipientId === recipientId),
    documentSent: auditLogs.DOCUMENT_SENT,
    documentOpened: auditLogs.DOCUMENT_OPENED.filter(
      (log) => log.data.recipientId === recipientId,
    ),
    recipientCompleted: auditLogs.DOCUMENT_RECIPIENT_COMPLETED.filter(
      (log) => log.data.recipientId === recipientId,
    ),
    recipientRejected: auditLogs.DOCUMENT_RECIPIENT_REJECTED.filter(
      (log) => log.data.recipientId === recipientId,
    ),
  });

  const getSignatureField = (recipientId: number) =>
    document.recipients
      .find((r) => r.id === recipientId)
      ?.fields.find((f) => f.type === 'SIGNATURE' || f.type === 'FREE_SIGNATURE');

  return (
    <div className="print-provider pointer-events-none mx-auto max-w-screen-md">
      <div className="flex items-center">
        <h1 className="my-8 font-bold text-2xl">{_(msg`Audit Certificate`)}</h1>
      </div>

      <div className="rounded border">
        <table className="w-full">
          <thead>
            <tr>
              <th>{_(msg`Signer`)}</th>
              <th>{_(msg`Signature`)}</th>
              <th>{_(msg`Details`)}</th>
            </tr>
          </thead>
          <tbody>
            {document.recipients.map((recipient, i) => {
              const logs = getRecipientLogs(recipient.id);
              const sigField = getSignatureField(recipient.id);
              const ownerFlag = isOwner(recipient.email);
              const emailLog = logs.emailSent[0];
              const openedLog = logs.documentOpened[0];
              const completedLog = logs.recipientCompleted[0];
              const rejectedLog = logs.recipientRejected[0];
              const deviceInfo = getDeviceInfo(openedLog?.data?.userAgent);
              const authLevel = getAuthLevel(recipient.id);

              return (
                <tr key={i}>
                  <td className="align-top max-w-[220px]">
                    <div className="font-medium">{recipient.name}</div>
                    <div className="break-all">{recipient.email}</div>
                    {ownerFlag && (
                      <span className="text-xs text-muted-foreground">{_(msg`Owner`)}</span>
                    )}
                    <p className="mt-2 text-sm">
                      <span className="font-medium">{_(msg`Authentication Level`)}:</span>{' '}
                      <span className="block">{authLevel}</span>
                    </p>
                  </td>
                  <td className="align-top">
                    {sigField?.signature?.signatureImageAsBase64 ? (
                      <img
                        src={sigField.signature.signatureImageAsBase64}
                        alt={_(msg`Signature`)}
                        className="max-h-12"
                      />
                    ) : (
                      <span className="text-muted-foreground text-sm">{_(msg`No signature`)}</span>
                    )}
                  </td>
                  <td className="align-top text-sm">
                    <p>
                      <span className="font-medium">{_(msg`Invitation Sent`)}:</span>{' '}
                      {emailLog ? new Date(emailLog.createdAt).toLocaleString() : _(msg`Not sent`)}
                    </p>
                    <p>
                      <span className="font-medium">{_(msg`Document Opened`)}:</span>{' '}
                      {openedLog
                        ? new Date(openedLog.createdAt).toLocaleString()
                        : _(msg`Not opened`)}
                    </p>
                    {completedLog && (
                      <p>
                        <span className="font-medium">{_(msg`Signed`)}:</span>{' '}
                        {new Date(completedLog.createdAt).toLocaleString()}
                      </p>
                    )}
                    {rejectedLog && (
                      <p>
                        <span className="font-medium">{_(msg`Rejected`)}:</span>{' '}
                        {new Date(rejectedLog.createdAt).toLocaleString()}
                      </p>
                    )}
                    <p>
                      <span className="font-medium">{_(msg`Device`)}:</span>{' '}
                      {deviceInfo}
                    </p>
                    <p>
                      <span className="font-medium">{_(msg`IP Address`)}:</span>{' '}
                      {openedLog?.data?.ipAddress ?? _(msg`Unknown`)}
                    </p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!hidePoweredBy && (
        <div className="mt-8 text-center text-xs text-muted-foreground">
          <span>{_(msg`Powered by TrueCourse`)}</span>
        </div>
      )}
    </div>
  );
}
