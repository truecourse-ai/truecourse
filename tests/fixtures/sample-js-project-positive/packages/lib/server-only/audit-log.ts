
declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

function formatAuditEntry(action: string, documentTitle: string, actorName: string) {
  // Tagged template (i18n macro) nested inside outer template — intentional idiom
  const label = `${actorName}: ${msg`Document "${documentTitle}" was ${action}`}`;
  return label;
}

function formatBulkAuditEntry(actions: string[], documentTitle: string) {
  return actions.map(action => `action: ${msg`"${documentTitle}" ${action}`}`);
}



declare type AuditLogType = 'DOCUMENT_OPENED' | 'DOCUMENT_SIGNED' | 'DOCUMENT_SENT';
declare type AuditLogData<T extends AuditLogType> =
  T extends 'DOCUMENT_OPENED' ? { viewedAt: string } :
  T extends 'DOCUMENT_SIGNED' ? { signedAt: string; signatureId: string } :
  { recipients: string[] };

declare interface AuditLogRecord { type: AuditLogType; envelopeId: string; userId: string }

export const createAuditLogData = <T extends AuditLogType>(options: {
  type: T;
  envelopeId: string;
  userId: string;
  data: AuditLogData<T>;
}): AuditLogRecord => {
  return {
    type: options.type,
    envelopeId: options.envelopeId,
    userId: options.userId,
  };
};
