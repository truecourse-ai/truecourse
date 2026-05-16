// rejectContractWithToken — thin-server FP shape
declare const prisma_reject: {
  recipient: {
    findFirst: (opts: unknown) => Promise<{
      id: number;
      name: string;
      email: string;
      signingStatus: string;
      expiresAt?: Date | null;
      envelope: { id: number; status: string };
    } | null>;
    update: (opts: unknown) => Promise<{ id: number }>;
  };
  contractAuditLog: { create: (opts: unknown) => Promise<void> };
  $transaction: <T>(fn: ((tx: unknown) => Promise<T>) | Promise<T>[]) => Promise<T>;
};
declare const AppError_reject: new (code: string, opts: { message: string }) => Error;
declare const AppErrorCode_reject: { NOT_FOUND: string; INVALID_REQUEST: string };
declare const ContractStatus_reject: { PENDING: string };
declare const SigningStatus_reject: { REJECTED: string };
declare const AUDIT_LOG_TYPE_reject: { RECIPIENT_REJECTED: string };
declare const createAuditLogData_reject: (opts: {
  contractId: number;
  type: string;
  user: { name: string; email: string };
  data: { recipientEmail: string; recipientName: string; rejectionReason: string };
}) => unknown;
declare const buildEnvelopeIdQuery_reject: (id: unknown, type: string) => unknown;
declare const assertRecipientNotExpired_reject: (recipient: unknown) => void;
declare const jobs_reject: { triggerJob: (opts: { name: string; payload: unknown }) => Promise<void> };
declare const ContractType_reject: { DOCUMENT: string };

type RejectContractTokenOptions = {
  token: string;
  id: { documentId?: number; secondaryId?: string };
  rejectionReason: string;
  requestMeta?: { ipAddress?: string; userAgent?: string };
};

export async function rejectContractWithToken({
  token,
  id,
  rejectionReason,
  requestMeta,
}: RejectContractTokenOptions) {
  const recipient = await prisma_reject.recipient.findFirst({
    where: {
      token,
      envelope: buildEnvelopeIdQuery_reject(id, ContractType_reject.DOCUMENT),
    } as unknown as Parameters<typeof prisma_reject.recipient.findFirst>[0]['where'],
    include: { envelope: true },
  } as unknown as Parameters<typeof prisma_reject.recipient.findFirst>[0]);

  const envelope = recipient?.envelope;

  if (!recipient || !envelope) {
    throw new AppError_reject(AppErrorCode_reject.NOT_FOUND, {
      message: 'Contract or recipient not found',
    });
  }

  if (envelope.status !== ContractStatus_reject.PENDING) {
    throw new AppError_reject(AppErrorCode_reject.INVALID_REQUEST, {
      message: `Contract ${envelope.id} must be in pending state to reject`,
    });
  }

  assertRecipientNotExpired_reject(recipient);

  const [updatedRecipient] = await prisma_reject.$transaction([
    prisma_reject.recipient.update({
      where: { id: recipient.id },
      data: {
        signingStatus: SigningStatus_reject.REJECTED,
        rejectionReason,
        signedAt: new Date(),
      },
    }),
    prisma_reject.contractAuditLog.create({
      data: createAuditLogData_reject({
        contractId: envelope.id,
        type: AUDIT_LOG_TYPE_reject.RECIPIENT_REJECTED,
        user: { name: recipient.name, email: recipient.email },
        data: {
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          rejectionReason,
        },
      }),
    }),
  ] as unknown as Promise<unknown>[]) as [{ id: number }, void];

  await jobs_reject.triggerJob({
    name: 'send.contract-rejected.notification',
    payload: {
      contractId: envelope.id,
      recipientId: updatedRecipient.id,
      rejectionReason,
      requestMeta,
    },
  });

  return updatedRecipient;
}
