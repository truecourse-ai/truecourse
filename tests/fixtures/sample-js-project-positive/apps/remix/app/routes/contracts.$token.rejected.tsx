// Remix route: contract rejection confirmation page.
// The loader is the API/controller layer — it is NOT a data-layer module.
// This shape triggers the false positive: a routes/ file with an exported
// `loader` function that calls server-only data utilities, which the rule
// misclassifies as a data-layer → api-layer violation.

declare function getOptionalSession(request: Request): Promise<{ user?: { id: string; email: string } }>;
declare function getContractByToken(opts: { token: string; requireAccessAuth: boolean }): Promise<{ id: string; title: string; authOptions: Record<string, unknown> } | null>;
declare function getSignerByToken(opts: { token: string }): Promise<{ id: string; name: string; email: string } | null>;
declare function getFieldsForContract(opts: { token: string }): Promise<Array<{ type: string; customText?: string }>>;
declare function isSignerAuthorized(opts: { type: string; contractAuthOptions: Record<string, unknown>; signer: { id: string; name: string; email: string }; userId?: string }): Promise<boolean>;
declare function truncateTitle(title: string): string;

interface LoaderArgs {
  params: { token?: string };
  request: Request;
}

interface LoaderData {
  isContractAccessValid: boolean;
  signerReference: string;
  truncatedTitle?: string;
}

export async function loader({ params, request }: LoaderArgs): Promise<LoaderData> {
  const { user } = await getOptionalSession(request);

  const { token } = params;

  if (!token) {
    throw new Response('Not Found', { status: 404 });
  }

  const contract = await getContractByToken({
    token,
    requireAccessAuth: false,
  }).catch(() => null);

  if (!contract) {
    throw new Response('Not Found', { status: 404 });
  }

  const truncatedTitle = truncateTitle(contract.title);

  const [fields, signer] = await Promise.all([
    getFieldsForContract({ token }),
    getSignerByToken({ token }).catch(() => null),
  ]);

  if (!signer) {
    throw new Response('Not Found', { status: 404 });
  }

  const isContractAccessValid = await isSignerAuthorized({
    type: 'ACCESS',
    contractAuthOptions: contract.authOptions,
    signer,
    userId: user?.id,
  });

  const signerReference =
    signer.name ||
    fields.find((field) => field.type === 'NAME')?.customText ||
    signer.email;

  if (isContractAccessValid) {
    return {
      isContractAccessValid: true,
      signerReference,
      truncatedTitle,
    };
  }

  return {
    isContractAccessValid: false,
    signerReference,
  };
}

export default function ContractRejectedPage({ loaderData }: { loaderData: LoaderData }) {
  const { isContractAccessValid, signerReference, truncatedTitle } = loaderData;

  if (!isContractAccessValid) {
    return null;
  }

  return truncatedTitle ? `${signerReference} rejected ${truncatedTitle}` : null;
}



// E38: ts-pattern match().with().exhaustive() inside Array.every() — correct ts-pattern usage; no type mismatch.
declare const match: <T>(value: T) => {
  with<P>(pattern: P, handler: () => boolean): { exhaustive(): boolean };
};

const enum FieldStatus {
  SIGNED = 'SIGNED',
  DECLINED = 'DECLINED',
  PENDING = 'PENDING',
}

interface ContractField {
  status: FieldStatus;
  required: boolean;
}

declare const contractFields: ContractField[];

const allRequiredFieldsComplete = contractFields.every((field) =>
  match(field.status)
    .with(FieldStatus.SIGNED, () => true)
    .exhaustive()
);



// --- argument-type-mismatch FP: .filter() comparing status to enum value ---
enum SigningStatus { PENDING = 'PENDING', SIGNED = 'SIGNED', REJECTED = 'REJECTED' }

interface Recipient { id: number; email: string; signingStatus: SigningStatus; role: string; }

function getSignedRecipients(recipients: Recipient[]): Recipient[] {
  return recipients.filter(
    (r) => r.signingStatus === SigningStatus.SIGNED,
  );
}



// --- argument-type-mismatch FP: ts-pattern .with() using P.array matcher ---
declare const P: { array: (pattern?: unknown) => unknown; _: unknown };
declare function match<T>(value: T): { with: (pattern: unknown, handler: (v: T) => unknown) => { otherwise: (fn: () => unknown) => unknown } };

interface ContractData { signatures: Array<{ id: string; signedAt: string }> }

function checkContractSigned(contract: ContractData): string {
  return match(contract)
    .with({ signatures: P.array(P._) }, () => 'has-signatures')
    .otherwise(() => 'unsigned') as string;
}



// --- argument-type-mismatch FP: .find() with fallback object via || ---
interface FieldRecipient { id: number; name: string; color: string; }
interface FormField { id: number; recipientId: number; type: string; }

const DEFAULT_RECIPIENT: FieldRecipient = { id: 0, name: 'Unknown', color: '#ccc' };

function getFieldRecipient(
  recipients: FieldRecipient[],
  field: FormField,
): FieldRecipient {
  return recipients.find((r) => r.id === field.recipientId) || DEFAULT_RECIPIENT;
}



// --- argument-type-mismatch FP: .find() with enum comparison and optional chaining ---
enum FieldType { NAME = 'NAME', EMAIL = 'EMAIL', DATE = 'DATE', SIGNATURE = 'SIGNATURE' }

interface ContractField { id: number; type: FieldType; label?: string; required: boolean; }

function getNameField(fields: ContractField[]): string | undefined {
  return fields.find((f) => f.type === FieldType.NAME)?.label;
}



// --- argument-type-mismatch FP: .map() with ts-pattern match on field.type in JSX ---
declare const P: { string: unknown; number: unknown; };
declare function match<T>(value: T): { with: <R>(pattern: unknown, fn: (v: T) => R) => { with: <R2>(pattern2: unknown, fn2: (v: T) => R2) => { exhaustive: () => R | R2 } } };

type FormFieldType = 'text' | 'checkbox' | 'signature' | 'date';
interface ContractFormField { id: string; type: FormFieldType; label: string; }

function renderField(field: ContractFormField): JSX.Element {
  return match(field)
    .with({ type: 'signature' }, () => <canvas key={field.id} />)
    .with({ type: 'checkbox' }, () => <input key={field.id} type="checkbox" />)
    .exhaustive() as JSX.Element;
}


// fields.find() with FieldType enum comparison and optional chaining — valid find, no type mismatch
enum FieldType { NAME = 'NAME', EMAIL = 'EMAIL', DATE = 'DATE', SIGNATURE = 'SIGNATURE' }

interface EnvelopeField { id: number; type: FieldType; customText?: string; required: boolean }

export function getContactReference(
  recipient: { name?: string | null; email: string },
  fields: EnvelopeField[],
): string {
  return (
    recipient.name ||
    fields.find((f) => f.type === FieldType.NAME)?.customText ||
    recipient.email
  );
}



// Shape: .find() with fallback object via || — valid find pattern, no type mismatch
interface EnvelopeSigner { id: number; name: string; avatarColor: string; }
interface EnvelopeField { id: number; signerId: number; fieldType: string; }

const PLACEHOLDER_SIGNER: EnvelopeSigner = { id: 0, name: 'Unknown', avatarColor: '#e5e7eb' };

export function resolveFieldSigner(
  signers: EnvelopeSigner[],
  field: EnvelopeField,
): EnvelopeSigner {
  return signers.find((s) => s.id === field.signerId) || PLACEHOLDER_SIGNER;
}



// Comparing match?.id against route name strings to determine the active layout — React Router route
// ID string comparison for navigation logic, not secret comparison; timing attack does not apply.
declare const useMatches19: () => Array<{ id: string; pathname: string }> | undefined;

const SIGNING_LAYOUT_ROUTE19 = '_recipient._layout';
const SIGNING_ACTIVE_ROUTE19 = '_recipient._layout.sign.$token._index';

export function getSigningRouteState19() {
  const matches = useMatches19();
  const activeMatch = matches?.find(
    (m) => m.id === SIGNING_LAYOUT_ROUTE19 || m.id === SIGNING_ACTIVE_ROUTE19,
  );
  return activeMatch?.id === SIGNING_ACTIVE_ROUTE19 ? 'active' : 'layout';
}



// FP shape: localFields.map() with ts-pattern match on field.type in JSX —
// valid pattern matching in a React render; no type mismatch.
declare const matchField: <T>(value: T) => {
  with: <R>(pattern: unknown, fn: (v: T) => R) => {
    with: <R2>(pattern2: unknown, fn2: (v: T) => R2) => {
      with: <R3>(pattern3: unknown, fn3: (v: T) => R3) => {
        otherwise: (fn4: (v: T) => null) => R | R2 | R3 | null;
      };
    };
  };
};

type SigningFieldType = 'SIGNATURE' | 'CHECKBOX' | 'DATE' | 'TEXT';
interface SigningFormField { id: string; type: SigningFieldType; label: string; required: boolean; }

declare const localSigningFields: SigningFormField[];

const renderedSigningFields = localSigningFields.map((field) =>
  matchField(field)
    .with({ type: 'SIGNATURE' }, (f) => <canvas key={f.id} data-field-id={f.id} />)
    .with({ type: 'CHECKBOX' }, (f) => <input key={f.id} type="checkbox" aria-label={f.label} />)
    .with({ type: 'DATE' }, (f) => <input key={f.id} type="date" aria-label={f.label} />)
    .otherwise(() => null)
);



// Comparing contract token status against route ID strings — route navigation logic, not secret comparison
declare const useMatches: () => Array<{ id: string; pathname: string }> | undefined;

const CONTRACT_TOKEN_ROUTE = '_recipient._layout.contracts.$token.rejected';

export function getContractTokenRouteState() {
  const matches = useMatches();
  const activeMatch = matches?.find((m) => m.id === CONTRACT_TOKEN_ROUTE);
  return activeMatch?.id === CONTRACT_TOKEN_ROUTE ? 'rejected' : 'other';
}

