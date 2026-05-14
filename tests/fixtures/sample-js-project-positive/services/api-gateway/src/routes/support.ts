declare const z: { object: (s: Record<string, any>) => any; string: () => { min: (n: number, msg: string) => any } };

const ZSupportTicketSchema = z.object({
  subject: z.string().min(3, 'Subject is required'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});
