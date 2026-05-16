
// tRPC router - fluent builder chain (argument-type-mismatch FP: trpc-fluent-builder-chain)
declare const z: any;
declare const router: any;
declare const authenticatedProcedure: any;

const getUserProfileSchema = z.object({
  userId: z.string().uuid(),
});

const profileRouter = router({
  getProfile: authenticatedProcedure
    .input(getUserProfileSchema)
    .query(async ({ input, ctx }: { input: { userId: string }; ctx: any }) => {
      return { userId: input.userId, displayName: ctx.user.name };
    }),
  updateDisplayName: authenticatedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }: { input: { name: string }; ctx: any }) => {
      return { success: true, name: input.name };
    }),
});



// tRPC mutation definition - input().mutation() chain (argument-type-mismatch FP: trpc-fluent-builder-chain)
declare const z: any;
declare const authenticatedProcedure: any;
declare function updateField(args: any): Promise<any>;

const updateFieldSchema = z.object({
  fieldId: z.string().uuid(),
  value: z.string(),
  metadata: z.record(z.string()).optional(),
});

const updateFieldMutation = authenticatedProcedure
  .input(updateFieldSchema)
  .mutation(async ({ input, ctx }: { input: any; ctx: any }) => {
    const result = await updateField({
      fieldId: input.fieldId,
      value: input.value,
      userId: ctx.user.id,
    });
    return result;
  });



// tRPC procedure chain .input().output().mutation() (argument-type-mismatch FP: trpc-fluent-builder-chain)
declare const z: any;
declare const authenticatedProcedure: any;
declare function replacePdfFile(args: any): Promise<any>;

const replacePdfSchema = z.object({ envelopeItemId: z.string().uuid(), newPdfKey: z.string() });
const replacePdfResponseSchema = z.object({ success: z.boolean(), updatedAt: z.string() });

const replacePdfMutation = authenticatedProcedure
  .input(replacePdfSchema)
  .output(replacePdfResponseSchema)
  .mutation(async ({ input }: { input: any }) => {
    const result = await replacePdfFile(input);
    return { success: true, updatedAt: result.updatedAt.toISOString() };
  });



// ts-pattern async match with .with() - standard pattern matching (argument-type-mismatch FP)
declare function match<T>(val: T): any;

enum ContentType { DOCUMENT = 'DOCUMENT', TEMPLATE = 'TEMPLATE', FORM = 'FORM' }

declare function processDocument(id: string): Promise<void>;
declare function processTemplate(id: string): Promise<void>;
declare function processForm(id: string): Promise<void>;

async function processContent(contentType: ContentType, contentId: string): Promise<void> {
  await match(contentType)
    .with(ContentType.DOCUMENT, async () => processDocument(contentId))
    .with(ContentType.TEMPLATE, async () => processTemplate(contentId))
    .with(ContentType.FORM, async () => processForm(contentId))
    .exhaustive();
}



// ts-pattern match on subscription status enum (argument-type-mismatch FP: ts-pattern-match-with)
declare function match<T>(val: T): any;

enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  TRIALING = 'TRIALING',
}

interface BannerConfig { message: string; variant: 'warning' | 'error' | 'info' }

function getBillingBannerConfig(status: SubscriptionStatus): BannerConfig | null {
  return match(status)
    .with(SubscriptionStatus.PAST_DUE, () => ({
      message: 'Your payment is past due. Please update your billing information.',
      variant: 'warning' as const,
    }))
    .with(SubscriptionStatus.CANCELED, () => ({
      message: 'Your subscription has been canceled.',
      variant: 'error' as const,
    }))
    .otherwise(() => null);
}



// ts-pattern destructured object match - standard .with() usage (argument-type-mismatch FP)
declare function match<T>(val: T): any;
declare const P: any;

interface TeamEmailState {
  teamEmail: string | null;
  emailVerification: { status: 'PENDING' | 'VERIFIED' } | null;
}

function getEmailStatusMessage(state: TeamEmailState): string {
  return match({ teamEmail: state.teamEmail, emailVerification: state.emailVerification })
    .with({ emailVerification: { status: 'PENDING' } }, () => 'Verification email sent')
    .with({ emailVerification: { status: 'VERIFIED' } }, () => 'Email verified')
    .with({ teamEmail: P.string }, () => 'Email set but not verified')
    .otherwise(() => 'No team email configured');
}


// Function call with discriminated union id param {type, id} — correct argument types
declare function createEnvelopeFields(options: {
  userId: number;
  teamId: number | null;
  id: { type: string; id: number };
  fields: Array<{ name: string; value: string; position: number }>;
  requestMetadata: Record<string, unknown>;
}): Promise<{ fields: Array<{ id: number }> }>;

export async function addFieldsToEnvelope(
  currentUserId: number,
  currentTeamId: number | null,
  envelopeId: number,
  rawFields: Array<{ label: string; content: string; pageNumber: number }>,
  requestMeta: Record<string, unknown>,
) {
  return createEnvelopeFields({
    userId: currentUserId,
    teamId: currentTeamId,
    id: {
      type: 'envelopeId',
      id: envelopeId,
    },
    fields: rawFields.map((field) => ({
      name: field.label,
      value: field.content,
      position: field.pageNumber,
    })),
    requestMetadata: requestMeta,
  });
}



// Function call passing discriminated union id {type, id} — correct arg types, no mismatch
declare function getOrganisationTemplateById(options: {
  id: { type: string; id: number };
  userId: number;
  teamId: number | null;
}): Promise<{ id: number; title: string; fields: unknown[] } | null>;

export async function loadOrganisationTemplate(
  templateId: number,
  userId: number,
  teamId: number | null,
) {
  const template = await getOrganisationTemplateById({
    id: { type: 'templateId', id: templateId },
    userId,
    teamId,
  });

  if (!template) {
    throw new Error('Template not found');
  }

  return template;
}



// FP: getOrgTemplateById requires teamId: number but receives number | null from session
declare function getOrgTemplateById(options: {
  id: { type: 'templateId'; id: number };
  userId: number;
  teamId: number;
}): Promise<{ id: number; title: string } | null>;

export async function loadOrgTemplate(templateId: number, userId: number, teamId: number | null) {
  return getOrgTemplateById({ id: { type: 'templateId', id: templateId }, userId, teamId });
}

