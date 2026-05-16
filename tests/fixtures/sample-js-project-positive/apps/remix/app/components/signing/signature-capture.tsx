
// FF41 — destructured onChange event handler; correctly typed prop, no mismatch
declare function useState<T>(init: T): [T, (v: T) => void];
declare function SignaturePad(props: {
  onChange: (event: { value: string; isEmpty: boolean }) => void;
  className?: string;
}): JSX.Element;

function SignatureCapture() {
  const [localSignature, setLocalSignature] = useState<string>('');
  return (
    <SignaturePad
      onChange={({ value }) => setLocalSignature(value)}
      className="w-full h-48"
    />
  );
}



// --- argument-type-mismatch FP: canvas measureText with repeated character string ---
declare const canvasCtx: CanvasRenderingContext2D;

function measureAverageCharWidth(): number {
  const metrics = canvasCtx.measureText('m'.repeat(10));
  return metrics.width / 10;
}
