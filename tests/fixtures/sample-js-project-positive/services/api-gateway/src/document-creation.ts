
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (typed object spread) ---
declare function uploadFile(opts: { arrayBuffer: () => Promise<ArrayBuffer>; name: string; type: string }): Promise<{ id: string }>;
declare function createEmbeddedDocument(opts: {
  title: string;
  documentDataId: string;
  externalId?: string;
  meta: Record<string, unknown>;
  recipients: Array<{ name: string; email: string; role: string; fields: any[] }>;
}): Promise<{ id: string }>;
declare const DocumentSignatureType: { DRAW: string; TYPE: string; UPLOAD: string };

export async function initiateEmbeddedDocument(configuration: {
  title: string;
  documentData: { data: { buffer: ArrayBuffer }; name: string; type: string } | null;
  meta: { externalId?: string; signatureTypes?: string[]; [key: string]: unknown };
  signers: Array<{ name: string; email: string; role: string }>;
  fields: Array<{ signerEmail: string; pageX: number; pageY: number; [key: string]: unknown }>;
}, externalId?: string) {
  if (!configuration.documentData) {
    throw new Error('Please configure the document first');
  }

  const fileData = await uploadFile({
    arrayBuffer: async () => Promise.resolve(configuration.documentData!.data.buffer),
    name: configuration.documentData.name,
    type: configuration.documentData.type,
  });

  const docExternalId = externalId || configuration.meta.externalId;
  const signatureTypes = configuration.meta.signatureTypes ?? [];

  const result = await createEmbeddedDocument({
    title: configuration.title,
    documentDataId: fileData.id,
    externalId: docExternalId,
    meta: {
      ...configuration.meta,
      drawSignatureEnabled: signatureTypes.length === 0 || signatureTypes.includes(DocumentSignatureType.DRAW),
      typedSignatureEnabled: signatureTypes.length === 0 || signatureTypes.includes(DocumentSignatureType.TYPE),
      uploadSignatureEnabled: signatureTypes.length === 0 || signatureTypes.includes(DocumentSignatureType.UPLOAD),
    },
    recipients: configuration.signers.map((signer) => ({
      name: signer.name,
      email: signer.email,
      role: signer.role,
      fields: configuration.fields
        .filter((field) => field.signerEmail === signer.email)
        .map<any>((f) => ({ ...f, pageX: f.pageX, pageY: f.pageY })),
    })),
  });

  return result;
}



// --- elseif-without-else shape: exhaustive-conditions-implicit-noop ---
// Recipient sync: if matched by serverId update, else-if no serverId match by email.
// If neither (has serverId but no match), return recipient unchanged — no else needed.
declare function scheduleSync(data: unknown, cb: (response: { recipients?: Array<{ id: string; email: string }> } | null) => void): void;
declare function getFormValues(key: string): Array<{ nativeId?: string; email: string }>;
declare function setFormValue(key: string, value: unknown): void;

export function syncRecipientsAfterSave(onComplete?: () => void): void {
  scheduleSync(getFormValues('recipients'), (response) => {
    if (!response?.recipients) {
      onComplete?.();
      return;
    }
    const current = getFormValues('recipients');
    const updated = current.map((recipient) => {
      const matchingRecord = response.recipients!.find((r) => r.id === recipient.nativeId);
      if (matchingRecord) {
        return { ...recipient, nativeId: matchingRecord.id };
      } else if (!recipient.nativeId) {
        const newRecord = response.recipients!.find((r) => r.email === recipient.email);
        if (newRecord) {
          return { ...recipient, nativeId: newRecord.id };
        }
      }
      return recipient;
    });
    setFormValue('recipients', updated);
    onComplete?.();
  });
}



// --- elseif-without-else shape: type-category-dispatch-unknown-skip ---
// Webhook dispatch: DOCUMENT fires one webhook, TEMPLATE fires another.
// Other envelope types need no webhook — missing else is intentional.
declare const EnvelopeKind: { DOCUMENT: string; TEMPLATE: string };
declare function triggerDocumentCreatedHook(data: unknown): Promise<void>;
declare function triggerTemplateCreatedHook(data: unknown): Promise<void>;
declare function buildWebhookPayload(envelope: unknown): unknown;
declare const createdEnvelope: { id: string; kind: string };

export async function dispatchCreationWebhook(
  envelope: { id: string; kind: string },
  userId: string,
  teamId: string,
): Promise<void> {
  if (envelope.kind === EnvelopeKind.DOCUMENT) {
    await triggerDocumentCreatedHook(buildWebhookPayload(envelope));
  } else if (envelope.kind === EnvelopeKind.TEMPLATE) {
    await triggerTemplateCreatedHook(buildWebhookPayload(envelope));
  }
}



// --- elseif-without-else shape: pre-initialized-default-variable ---
// Audit log message selection: start with anonymous description, then override
// with user-specific message if viewer identity is known. Pre-initialized default.
declare type MessageDescriptor = { id: string; defaultMessage: string };
declare const msg: (template: TemplateStringsArray, ...args: unknown[]) => MessageDescriptor;
declare const i18n: { _: (m: MessageDescriptor) => string };

interface AuditDescription {
  anonymous: MessageDescriptor;
  you: MessageDescriptor;
  user: MessageDescriptor;
}

export function resolveAuditDescription(
  description: AuditDescription,
  isCurrentUser: boolean,
  user: { id: string } | null,
): string {
  let selectedDescription = description.anonymous;

  if (isCurrentUser) {
    selectedDescription = description.you;
  } else if (user) {
    selectedDescription = description.user;
  }

  return i18n._(selectedDescription);
}
