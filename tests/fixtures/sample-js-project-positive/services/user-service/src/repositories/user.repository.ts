import { PrismaClient, User } from '@prisma/client';

export class UserRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: { name: string; email: string }): Promise<User> {
    return this.prisma.user.create({ data });
  }

  archive(id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { archived: true } });
  }
}



  // Positive FP: Promise.all with multiple Prisma query builder calls
  // This is a valid pattern for running ORM queries in parallel
  async findUserWithProfile(userId: string, organizationId: string) {
    const userWhereClause = { id: userId, active: true };
    const profileInclude = { include: { preferences: true, avatar: true } };

    const [userRecord, organizationProfile] = await Promise.all([
      this.prisma.user.findFirst({
        where: userWhereClause,
        include: profileInclude,
      }),
      this.prisma.user.findFirst({
        where: {
          organizationId: organizationId,
          role: 'admin',
        },
        include: profileInclude,
      }),
    ]);

    return userRecord ?? organizationProfile;
  }

  // Positive FP: Promise.all with different Prisma query methods
  async getUserStats(userId: string) {
    const [userDetails, activityCount, associatedProjects] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.activity.count({ where: { userId } }),
      this.prisma.project.findMany({ where: { ownerId: userId }, take: 10 }),
    ]);

    return { userDetails, activityCount, projects: associatedProjects };
  }



// Bulk member management operations
interface TeamMember {
  id: string;
  userId: string;
  teamId: string;
  role: string;
}

declare const db: {
  teamMember: {
    findMany(args: any): Promise<TeamMember[]>;
    deleteMany(args: any): Promise<{ count: number }>;
  };
};

export async function removeBulkTeamMembers(
  teamId: string,
  memberIdsToRemove: string[]
): Promise<string[]> {
  const currentMembers = await db.teamMember.findMany({
    where: { teamId }
  });

  const membersToDelete = currentMembers.filter((member) =>
    memberIdsToRemove.includes(member.id)
  );

  const removedUserIds = membersToDelete.map((member) => member.userId);

  await db.teamMember.deleteMany({
    where: {
      id: {
        in: memberIdsToRemove
      }
    }
  });

  return removedUserIds;
}



  async createBulkPreferences(
    userId: string,
    preferences: Array<{ category: string; enabled: boolean; metadata?: Record<string, unknown> }>
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    // Standard Prisma batch insert pattern - map input to create data
    const createdPreferences = await this.prisma.userPreference.createMany({
      data: preferences.map((pref) => ({
        userId: user.id,
        category: pref.category,
        enabled: pref.enabled,
        settings: pref.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    });

    return createdPreferences;
  }

  async bulkCreateTags(
    items: Array<{ name: string; color?: string; priority?: number }>
  ) {
    // Another common pattern: transforming input array for batch creation
    await this.prisma.tag.createMany({
      data: items.map((item) => ({
        name: item.name,
        color: item.color ?? '#000000',
        priority: item.priority ?? 0,
        slug: item.name.toLowerCase().replace(/\s+/g, '-'),
      })),
    });
  }



// ---- argument-type-mismatch FP: Promise.all with ORM findMany + count (b6af359cbbfc) ----
declare const db: {
  document: {
    findMany(opts: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
      skip?: number;
      take?: number;
      orderBy?: Record<string, string>;
    }): Promise<unknown[]>;
    count(opts: { where: Record<string, unknown> }): Promise<number>;
  };
};

async function listDocuments(
  filter: Record<string, unknown>,
  page: number,
  perPage: number,
) {
  const include = {
    owner: { select: { id: true, name: true, email: true } },
    tags: true,
    metadata: true,
  } as const;

  const where = filter;

  const [items, total] = await Promise.all([
    db.document.findMany({
      where,
      include,
      skip: Math.max(page - 1, 0) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
    }),
    db.document.count({ where }),
  ]);

  return {
    items,
    total,
    currentPage: Math.max(page, 1),
    perPage,
    totalPages: Math.ceil(total / perPage),
  };
}
