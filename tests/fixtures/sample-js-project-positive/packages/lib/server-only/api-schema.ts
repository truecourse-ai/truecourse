
declare const STATUS_OPTIONS: Array<{ value: string; label: string }>;
declare const z: { string: () => { openapi: (opts: { description: string; enum: string[] }) => unknown }; default: (val: string) => unknown };

const statusOpenApiField = z.string().openapi({
  description: 'The current status of the document.',
  enum: STATUS_OPTIONS.map((option) => option.value),
});



declare const z: {
  object: <T extends Record<string, unknown>>(shape: T) => { parse: (data: unknown) => unknown };
  string: () => { min: (n: number) => unknown; optional: () => unknown };
  number: () => { optional: () => unknown };
  boolean: () => { optional: () => unknown; default: (v: boolean) => unknown };
  nativeEnum: <T>(e: T) => { optional: () => unknown };
};
declare enum RecipientRole { SIGNER = 'SIGNER', VIEWER = 'VIEWER' }

const ZCreateInvitationSchema = z.object({
  recipientName: z.string().min(1),
  recipientEmail: z.string().min(1),
  role: z.nativeEnum(RecipientRole).optional(),
  sendEmail: z.boolean().optional().default(true),
});
