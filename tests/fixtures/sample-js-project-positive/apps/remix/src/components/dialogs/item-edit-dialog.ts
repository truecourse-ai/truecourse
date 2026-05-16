
declare function useMutation<T>(opts: { onSuccess: (result: T) => void; onError: () => void }): { mutateAsync: (input: unknown) => Promise<T> };
declare function useLocalStore(): { setItems: (items: unknown[]) => void };

type EditResult = { data: { id: string; title: string }; metadata: { updatedAt: Date } | null };

function useItemEditMutation() {
  const { setItems } = useLocalStore();

  const { mutateAsync: editItem } = useMutation<EditResult>({
    onSuccess: ({ data, metadata }) => {
      setItems([{ id: data.id, title: data.title, updatedAt: metadata?.updatedAt }]);
    },
    onError: () => {
      console.error('Edit failed');
    },
  });

  return { editItem };
}



import * as z from 'zod';

const ZDocumentResendSchema = z.object({
  recipients: z.array(
    z.object({
      id: z.string(),
      email: z.string().email(),
      name: z.string().optional(),
    }),
  ),
  message: z.string().optional(),
  sendCopy: z.boolean().default(false),
});

type TDocumentResendSchema = z.infer<typeof ZDocumentResendSchema>;

export { ZDocumentResendSchema, type TDocumentResendSchema };



import * as z from 'zod';

const ZDocumentDistributeSchema = z.object({
  meta: z.object({
    emailTemplateId: z.string().nullable(),
    replyTo: z.string().email().optional(),
    subject: z.string(),
    message: z.string(),
    distributionMethod: z.enum(['EMAIL', 'LINK']).default('EMAIL'),
  }),
});

type TDocumentDistributeSchema = z.infer<typeof ZDocumentDistributeSchema>;

export { ZDocumentDistributeSchema, type TDocumentDistributeSchema };



import * as z from 'zod';

const ZTemplateUseSchema = z.object({
  recipients: z.array(
    z.object({
      email: z.string().email(),
      name: z.string(),
      role: z.enum(['SIGNER', 'VIEWER', 'APPROVER']),
    }),
  ),
  externalId: z.string().optional(),
  customSubject: z.string().optional(),
  customMessage: z.string().optional(),
});

type TTemplateUseSchema = z.infer<typeof ZTemplateUseSchema>;

export { ZTemplateUseSchema, type TTemplateUseSchema };



import * as z from 'zod';

const ZRedistributeEnvelopeSchema = z.object({
  meta: z.object({
    emailTemplateId: z.string().nullable(),
    replyTo: z.string().email().optional(),
    subject: z.string(),
    message: z.string(),
  }),
  recipientIds: z.array(z.string()).min(1),
});

type TRedistributeEnvelopeSchema = z.infer<typeof ZRedistributeEnvelopeSchema>;

export { ZRedistributeEnvelopeSchema, type TRedistributeEnvelopeSchema };
