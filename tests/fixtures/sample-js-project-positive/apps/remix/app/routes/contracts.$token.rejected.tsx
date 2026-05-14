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
