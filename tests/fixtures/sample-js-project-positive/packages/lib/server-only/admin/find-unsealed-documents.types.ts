declare const z: { object: (s: Record<string, any>) => any; number: () => { optional: () => { default: (n: number) => any } } };
declare const ZFindSearchParamsSchema: any;

const ZFindPendingDocumentsRequestSchema = ZFindSearchParamsSchema.pick({
  page: true,
  perPage: true,
}).extend({
  perPage: z.number().optional().default(20),
});


declare function zEmail(msg?: string): { trim: () => { toLowerCase: () => { max: (n: number) => any } } };

const ZRecipientEmailField = zEmail('Invalid email').trim().toLowerCase().max(254);
