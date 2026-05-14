
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
