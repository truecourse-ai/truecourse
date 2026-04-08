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
