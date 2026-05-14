declare function nanoid(size: number): string;
declare const RecipientRole: { SIGNER: string };
declare const user: { name?: string; email?: string };
declare const signers: Array<{ signingOrder?: number }>;
declare function appendSigner(signer: any, opts?: any): void;

const addSelfSigner = () => {
  appendSigner(
    {
      formId: nanoid(12),
      name: user?.name ?? '',
      email: user?.email ?? '',
      role: RecipientRole.SIGNER,
      actionAuth: [],
      signingOrder: signers.length > 0 ? (signers[signers.length - 1]?.signingOrder ?? 0) + 1 : 1,
    },
    { shouldFocus: true },
  );
};
