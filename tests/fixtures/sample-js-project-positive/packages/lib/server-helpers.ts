
declare function deactivateAccount(userId: string): Promise<void>;

async function disableAccount(userId: string): Promise<void> {
  try {
    await deactivateAccount(userId);
  } catch (error) {
    console.error('Error disabling account', error);
    throw error;
  }
}



declare function sendConfirmationEmail(userId: string, email: string): Promise<void>;

async function sendUserConfirmationToken(userId: string, email: string): Promise<void> {
  try {
    await sendConfirmationEmail(userId, email);
  } catch (err) {
    console.log(err);
    throw new Error('Failed to send confirmation email');
  }
}



// FP: enum-field-type-dispatch — !== guard on field.type to route field auth validation
declare const FieldKind: { SIGNATURE: string; FREE_SIGNATURE: string; TEXT: string };
declare function validateGenericFieldAuth(field: { type: string; authMode: string }): void;

function validateFieldAuthentication(field: { type: string; authMode: string }) {
  if (field.type !== FieldKind.SIGNATURE) {
    validateGenericFieldAuth(field);
    return;
  }
  // signature fields skip additional auth validation
}



// FP: token-lookup-data-wiring — Array.find comparing .token === hashedToken after DB already filtered by hashed token
declare function computeTokenHash(raw: string): string;
declare const apiTokenRecords: Array<{ id: number; token: string; userId: number }>;

function resolveApiTokenRecord(rawToken: string) {
  const hashedToken = computeTokenHash(rawToken);
  // DB already filtered by hashed value; this find is data-wiring, not auth gating
  return apiTokenRecords.find((record) => record.token === hashedToken) ?? null;
}



// FP: boolean-config-flag-or-length-check — comparing boolean feature flags to literal false for configuration validation
declare const drawSignatureAllowed: boolean;
declare const uploadSignatureAllowed: boolean;
declare const typedSignatureAllowed: boolean;
declare function throwValidationError(msg: string): never;

function validateSignatureSettings(settings: { drawEnabled: boolean; uploadEnabled: boolean; typedEnabled: boolean }) {
  if (settings.drawEnabled === false && drawSignatureAllowed === false) {
    throwValidationError('Draw signature cannot be disabled when not permitted by org policy');
  }
  if (settings.uploadEnabled === false && uploadSignatureAllowed === false) {
    throwValidationError('Upload signature cannot be disabled when not permitted by org policy');
  }
  if (settings.typedEnabled === false && typedSignatureAllowed === false) {
    throwValidationError('Typed signature cannot be disabled when not permitted by org policy');
  }
}



// FP: token-lookup-data-wiring — Array.find on r.token === token to retrieve recipient record; auth is done above via DB query
declare const recipients: Array<{ id: number; token: string; email: string; signingOrder: number }>;
declare const recipientToken: string;

function getRecipientByToken(token: string) {
  // recipients list already fetched by authenticated DB context; this is pure data wiring
  return recipients.find((r) => r.token === token) ?? null;
}

const currentRecipient = getRecipientByToken(recipientToken);



// FP: enum-field-type-dispatch — comparing field.type === FieldKind.SIGNATURE to locate signature field for PDF generation
declare const FieldKind: { SIGNATURE: string; FREE_SIGNATURE: string; TEXT: string; DATE: string };
declare const documentFields: Array<{ type: string; value: string; pageNumber: number }>;

function findSignatureFieldForCertificate(fields: Array<{ type: string; value: string; pageNumber: number }>) {
  return fields.find((field) => field.type === FieldKind.SIGNATURE) ?? null;
}

const sigField = findSignatureFieldForCertificate(documentFields);



// FP: token-lookup-data-wiring — Array.find r.token === token to look up recipient; real auth via isRecipientAuthorized below
declare const envelopeRecipients: Array<{ id: number; token: string; email: string; completed: boolean }>;
declare function isRecipientAuthorized(recipientId: number, sessionUserId: number): boolean;
declare const sessionUserId: number;

function resolveRecipientForSigning(token: string) {
  const recipient = envelopeRecipients.find((r) => r.token === token);
  if (!recipient) return null;
  if (!isRecipientAuthorized(recipient.id, sessionUserId)) return null;
  return recipient;
}



// FP: boolean-config-flag-or-length-check — comparing derived boolean feature flag === false for org settings validation
declare function throwConstraintError(msg: string): never;
declare const orgTypedSignatureAllowed: boolean;

function validateOrgSignatureConstraint(derivedTypedSignatureEnabled: boolean) {
  if (derivedTypedSignatureEnabled === false && orgTypedSignatureAllowed === false) {
    throwConstraintError('Org policy requires at least one signature type to remain enabled');
  }
}



// FP: boolean-config-flag-or-length-check — comparing typedSignatureEnabled === false feature flag to reject a signature type
declare function throwUnsupportedSignatureType(type: string): never;

function assertSignatureTypeAllowed(
  signatureType: string,
  typedSignatureEnabled: boolean,
  drawSignatureEnabled: boolean,
) {
  if (signatureType === 'typed' && typedSignatureEnabled === false) {
    throwUnsupportedSignatureType('typed');
  }
  if (signatureType === 'draw' && drawSignatureEnabled === false) {
    throwUnsupportedSignatureType('draw');
  }
}



// FP: typeof-type-guard-presence-check — typeof csrfToken !== 'string' type/presence guard, not a value comparison
declare function rejectRequest(reason: string): never;
declare function validateCsrfToken(token: string): boolean;

function assertCsrfTokenValid(csrfToken: unknown) {
  if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
    rejectRequest('Missing or invalid CSRF token');
  }
  // csrfToken is narrowed to string here; validate its value separately
  if (!validateCsrfToken(csrfToken as string)) {
    rejectRequest('CSRF token validation failed');
  }
}



// FP: token-lookup-data-wiring — Array.findIndex on r.token === token to determine position for sequential signing order
declare const signingRecipients: Array<{ id: number; token: string; signingOrder: number }>;

function getRecipientSigningPosition(token: string): number {
  return signingRecipients.findIndex((r) => r.token === token);
}

function isRecipientTurn(token: string): boolean {
  const position = getRecipientSigningPosition(token);
  // first unsigned slot with matching position determines whose turn it is
  return position >= 0 && position === signingRecipients.findIndex((r) => !r.signingOrder);
}



// FP: enum-field-type-dispatch — type guard comparing field.type === FieldKind.SIGNATURE or FREE_SIGNATURE
declare const FieldKind: { SIGNATURE: string; FREE_SIGNATURE: string; TEXT: string; DATE: string };

function isSignatureField(field: { type: string }): boolean {
  return field.type === FieldKind.SIGNATURE || field.type === FieldKind.FREE_SIGNATURE;
}

function separateSignatureFields<T extends { type: string }>(fields: T[]) {
  return {
    signatureFields: fields.filter(isSignatureField),
    otherFields: fields.filter((f) => !isSignatureField(f)),
  };
}



// FP: enum-field-type-dispatch — filtering args where signature !== null to separate signature fields for grouping
declare const recipientFieldArgs: Array<{ fieldId: number; signature: string | null; textValue: string | null }>;

const signatureFieldArgs = recipientFieldArgs.filter((arg) => arg.signature !== null);
const plainFieldArgs = recipientFieldArgs.filter((arg) => arg.signature === null);



// FP: hashString used for high-entropy random tokens and content fingerprints, not password hashing
// Passwords handled by bcrypt separately; a salt would break deterministic token lookup semantics
declare function sha256Hex(input: string): string;

function hashTokenForStorage(rawToken: string): string {
  // rawToken is cryptographically random (~96 bits entropy from alphaid); salt unnecessary
  return sha256Hex(rawToken);
}

function hashDocumentFingerprint(content: string): string {
  // deterministic hash for content addressing; salt would break lookup
  return sha256Hex(content);
}
