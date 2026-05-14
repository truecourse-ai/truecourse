
declare const contract: {
  signers: Array<{
    id: string;
    email: string;
    name: string;
    attachments: Array<{ attachmentId: string; name: string }>;
  }>;
  fields: Array<{ signerId: string; type: string; page: number }>;
};

function buildSignerPayloads() {
  return contract.signers.map((signer) => {
    const signerFields = contract.fields.filter((f) => f.signerId === signer.id);
    return {
      email: signer.email,
      name: signer.name,
      attachments: signer.attachments.map((a) => a.attachmentId),
      fields: signerFields,
    };
  });
}
