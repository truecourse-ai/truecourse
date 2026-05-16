
// --- FP shape: React component returning JSX; return type trivially inferred, codebase-wide pattern ---
declare function useSigningContext(): { fullName: string; setFullName(v: string): void; signature: string; setSignature(v: string): void };

export default function EnvelopeSignerForm() {
  const {
    fullName,
    signature,
    setFullName,
    setSignature,
  } = useSigningContext();

  return (
    <form>
      <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <input value={signature} onChange={(e) => setSignature(e.target.value)} />
    </form>
  );
}



// --- FP shape: local helper function with a single statement body returning void; trivially inferred ---
declare function onDocumentSelect(doc: unknown): void;
declare interface DocumentEnvelope { document: { id: string; title: string } }

function handleView(doc: DocumentEnvelope['document']) {
  onDocumentSelect(doc);
}


// useMemo filtering fields by page and currentEnvelopeItemId — no function call with mismatched args
declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
declare const signerFields: Array<{ page: number; envelopeItemId: string; fieldType: string }>;
declare const assistantFields: Array<{ page: number; envelopeItemId: string; fieldType: string }>;
declare const signerRole: string;
declare const activePage: number;
declare const currentEnvelopeItemId: string | undefined;

const pageVisibleFields = useMemo(() => {
  let fieldsToShow = signerFields;

  if (signerRole === 'ASSISTANT') {
    fieldsToShow = assistantFields;
  }

  return fieldsToShow.filter(
    (field) => field.page === activePage && field.envelopeItemId === currentEnvelopeItemId,
  );
}, [signerFields, assistantFields, signerRole, activePage, currentEnvelopeItemId]);

