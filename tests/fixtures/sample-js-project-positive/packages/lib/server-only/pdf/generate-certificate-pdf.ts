
// enum-keyed-grouped-map: auditLogs['DOCUMENT_RECIPIENT_REJECTED'] — mirrors computed-property bracket definition
declare type TAuditLogEntry = { type: string; data: { recipientId?: string } };
declare const eventLogs: Record<string, TAuditLogEntry[]>;
declare const recipientId: string;

function findRecipientRejectedEvent() {
  const recipientRejected: TAuditLogEntry | undefined = eventLogs[
    'DOCUMENT_RECIPIENT_REJECTED'
  ].find((log) => log.type === 'DOCUMENT_RECIPIENT_REJECTED' && log.data.recipientId === recipientId);
  return recipientRejected;
}



// enum-keyed-grouped-map: auditLogs['DOCUMENT_SENT'] — same enum-keyed grouped map bracket access pattern; matches computed-property bracket definition
declare type TAuditLogBase = { type: string; data: Record<string, any> };
declare const documentEventLogs: Record<string, TAuditLogBase[]>;

function findDocumentSentEvent() {
  const documentSent: TAuditLogBase | undefined = documentEventLogs['DOCUMENT_SENT'].find(
    (log) => log.type === 'DOCUMENT_SENT',
  );
  return documentSent;
}



// enum-keyed-grouped-map: auditLogs['DOCUMENT_RECIPIENT_COMPLETED'] — same enum-keyed grouped map bracket access; mirrors computed-property bracket definition
declare type TAuditEvent = { type: string; data: { recipientId?: string } };
declare const workflowEvents: Record<string, TAuditEvent[]>;
declare const currentRecipientId: string;

function findRecipientCompletedEvent() {
  const recipientCompleted: TAuditEvent | undefined = workflowEvents[
    'DOCUMENT_RECIPIENT_COMPLETED'
  ].find((log) => log.type === 'DOCUMENT_RECIPIENT_COMPLETED' && log.data.recipientId === currentRecipientId);
  return recipientCompleted;
}



// external-api-or-library-internals: product.metadata is a Stripe Record<string,string> metadata dict; bracket access is idiomatic convention for Stripe metadata keys to signal runtime-dynamic lookup
declare const StripeClaimId: { STARTER: string; PRO: string; ENTERPRISE: string };
declare type StripeProduct = { metadata: Record<string, string> };
declare type StripePrice = { unit_amount: number | null; recurring?: { interval: string }; metadata: Record<string, string>; currency: string };

function resolveClaimFromStripeProduct(product: StripeProduct, price: StripePrice) {
  const claimId = product.metadata['claimId'] as keyof typeof StripeClaimId | undefined;
  const isSeatBased = product.metadata['isSeatBased'] === 'true';
  const isVisible = price.metadata['visibleInApp'] === 'true';
  return { claimId, isSeatBased, isVisible };
}
