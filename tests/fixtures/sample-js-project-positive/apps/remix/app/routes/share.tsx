
// FP shape f9bdc369d708: ts-pattern match().with() on discriminated union — no type mismatch
declare const match: <T>(val: T) => { with: <P>(pattern: P, fn: (val: T) => unknown) => { otherwise: (fn: (val: T) => unknown) => unknown } };
declare const P: { array: (p: unknown) => unknown; _: unknown };
declare function getShareData(slug: string): Promise<{ Signature?: object; signatures?: Array<{ imageAsBase64?: string | null }> } | { signature?: string | null; name?: string; email?: string }>;

async function resolveShareOpengraphData(slug: string) {
  const recipientOrSender = await getShareData(slug);

  if ('error' in (recipientOrSender as object)) {
    return null;
  }

  const signatureImage = match(recipientOrSender)
    .with({ signatures: P.array(P._) }, (recipient) => {
      return (recipient as any).signatures?.[0]?.imageAsBase64 || null;
    })
    .otherwise((sender) => {
      return (sender as any).signature || null;
    });

  const signatureName = match(recipientOrSender)
    .with({ signatures: P.array(P._) }, (recipient) => {
      return (recipient as any).name || (recipient as any).email;
    })
    .otherwise((sender) => {
      return (sender as any).name || (sender as any).email;
    });

  return { signatureImage, signatureName };
}



// FP shape f9c653e1de3b: second ts-pattern match block on same discriminated union — no type mismatch
declare const match2: <T>(val: T) => { with: <P>(pattern: P, fn: (val: T) => unknown) => { otherwise: (fn: (val: T) => unknown) => unknown } };
declare const P2: { array: (p: unknown) => unknown; _: unknown };
declare const shareResource: { signatures?: Array<{ name?: string | null }>; name?: string; email?: string };

const displayName = match2(shareResource)
  .with({ signatures: P2.array(P2._) }, (recipient) => {
    return (recipient as any).signatures?.[0]?.name || (recipient as any).email;
  })
  .otherwise((sender) => {
    return (sender as any).name || (sender as any).email;
  });
