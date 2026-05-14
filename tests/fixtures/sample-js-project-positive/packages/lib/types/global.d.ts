
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace AppJson {
    type DocumentMetadata = {
      title: string;
      createdAt: string;
      signers: string[];
    };
    type AuditEntry = {
      action: string;
      actorId: string;
      timestamp: string;
    };
  }
}
