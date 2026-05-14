
// FF18 — void executeAuthProcedure with async callback; no argument type mismatch
type AuthOptions = { method: string; token: string };
declare function runAuthenticatedAction(opts: {
  onReauthRequired: (authOptions: AuthOptions) => Promise<void>;
}): Promise<void>;
declare function submitSignedField(fieldId: string, authOpts: AuthOptions): Promise<void>;
declare const currentFieldId: string;

void runAuthenticatedAction({
  onReauthRequired: async (authOptions) => {
    await submitSignedField(currentFieldId, authOptions);
  },
});



// --- argument-type-mismatch FP: ts-pattern match().with() branch using P.array guard ---
declare const match: <T>(val: T) => MatchBuilder<T>;
declare const P: {
  array: <T>(pattern?: T) => ArrayPattern;
  _: WildcardPattern;
};
declare type MatchBuilder<T> = {
  with<P>(pattern: P, fn: (val: T) => string | null): MatchBuilderChained<T>;
};
declare type MatchBuilderChained<T> = {
  otherwise(fn: (val: T) => string | null): string | null;
};
declare type ArrayPattern = { _tag: 'ArrayPattern' };
declare type WildcardPattern = { _tag: 'WildcardPattern' };

type Signer = { signatures: Array<{ imageData: string | null }>; name: string; email: string };
type Sender = { signature: string | null; name: string; email: string };

function resolveSignatureImage(signerOrSender: Signer | Sender): string | null {
  return match(signerOrSender)
    .with({ signatures: P.array(P._) }, (signer) => {
      return (signer as Signer).signatures?.[0]?.imageData || null;
    })
    .otherwise((sender) => {
      return (sender as Sender).signature || null;
    });
}
