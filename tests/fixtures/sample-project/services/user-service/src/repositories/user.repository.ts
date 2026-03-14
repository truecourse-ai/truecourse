import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class UserRepository {
  async findAll() {
    return prisma.user.findMany();
  }

  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  async create(data: { name: string; email: string }) {
    return prisma.user.create({ data });
  }

  async delete(id: string) {
    return prisma.user.delete({ where: { id } });
  }
}
