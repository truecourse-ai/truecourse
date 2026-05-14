declare const prisma: { organisation: { findFirst: (args: unknown) => Promise<unknown | null> }; organisationMember: { findFirst: (args: unknown) => Promise<unknown | null> } };
declare const getAuthSession: (req: unknown) => Promise<{ userId: string } | null>;

import { z } from 'zod';

const GetOrganisationSessionSchema = z.object({
  organisationSlug: z.string().min(1),
  request: z.unknown(),
});

export async function getOrganisationSession(input: z.infer<typeof GetOrganisationSessionSchema>) {
  const { organisationSlug, request } = GetOrganisationSessionSchema.parse(input);

  const authSession = await getAuthSession(request);

  if (!authSession) {
    return { organisation: null, member: null, isAuthenticated: false };
  }

  const organisation = await prisma.organisation.findFirst({
    where: { slug: organisationSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
    },
  });

  if (!organisation) {
    return { organisation: null, member: null, isAuthenticated: true };
  }

  const member = await prisma.organisationMember.findFirst({
    where: {
      organisationId: (organisation as { id: string }).id,
      userId: authSession.userId,
    },
    select: {
      id: true,
      role: true,
      joinedAt: true,
    },
  });

  return {
    organisation,
    member,
    isAuthenticated: true,
    isMember: !!member,
  };
}
