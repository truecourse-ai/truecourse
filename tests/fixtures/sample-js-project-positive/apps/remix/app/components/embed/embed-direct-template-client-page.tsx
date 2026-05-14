declare const isThrottled: boolean;
declare const hasSignatureField: boolean;
declare const signatureValid: boolean;
declare function throttledOnCompleteClick(): void;

const DirectTemplateCompleteButton = () => {
  return (
    <button
      disabled={isThrottled || (hasSignatureField && !signatureValid)}
      onClick={() => throttledOnCompleteClick()}
    >
      Complete
    </button>
  );
};



// [unknown-catch-variable] catch(err) — String(err) coercion for postMessage; no property access
declare const parentOrigin: string;
declare const formToken: string;
declare const recipientId: string;
declare function completeSigningFlow(opts: { token: string; recipientId: string }): Promise<void>;
declare function showBanner(opts: { title: string; description: string; variant?: string }): void;

async function submitSignedDocument(): Promise<void> {
  try {
    await completeSigningFlow({ token: formToken, recipientId });
    if (window.parent) {
      window.parent.postMessage({ action: 'signing-complete', data: { token: formToken, recipientId } }, parentOrigin);
    }
  } catch (err) {
    if (window.parent) {
      window.parent.postMessage({ action: 'signing-error', data: String(err) }, parentOrigin);
    }
    showBanner({
      title: 'Something went wrong',
      description: 'We were unable to complete signing at this time. Please try again later.',
      variant: 'destructive',
    });
  }
}
