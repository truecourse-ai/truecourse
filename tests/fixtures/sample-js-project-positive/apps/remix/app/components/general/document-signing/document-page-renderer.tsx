
declare function useCanvasRenderer(
  createCanvas: (stage: unknown, layer: unknown) => unknown,
  pageData: { scale: number; pageNumber: number },
): { stage: unknown; layer: unknown; container: unknown; viewport: unknown };
declare function createSignatureCanvas(stage: unknown, layer: unknown): unknown;
declare const pageData: { scale: number; pageNumber: number };

function DocumentPageRenderer() {
  const { stage, layer, container, viewport } = useCanvasRenderer(
    ({ stage, layer }) => createSignatureCanvas(stage, layer),
    pageData,
  );

  return { stage, layer, container, viewport };
}



// --- argument-type-mismatch FP: ts-pattern match().with() for discriminated union ---
declare const match: <T>(value: T) => {
  with<P>(pattern: P, handler: (val: T) => JSX.Element): {
    with<P2>(pattern: P2, handler: (val: T) => JSX.Element): {
      otherwise(handler: (val: T) => JSX.Element): JSX.Element;
    };
    otherwise(handler: (val: T) => JSX.Element): JSX.Element;
  };
};

type AuthMethod = { type: 'password'; hash: string } | { type: 'otp'; secret: string } | { type: 'passkey'; credentialId: string };

function AuthMethodDisplay({ method }: { method: AuthMethod }): JSX.Element {
  return match(method)
    .with({ type: 'password' }, (m) => <div>Password auth: {m.hash.slice(0, 8)}</div>)
    .with({ type: 'otp' }, (m) => <div>OTP auth: {m.secret}</div>)
    .otherwise((m) => <div>Passkey auth</div>);
}
