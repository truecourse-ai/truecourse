// VIOLATION: architecture/deterministic/circular-module-dependency
// VIOLATION: architecture/deterministic/data-layer-depends-on-api
import { PrismaClient } from '@prisma/client';
import { getUsers } from '../handlers/user.handler';

const prisma = new PrismaClient();

export class UserRepository {
  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async findAll() {
    // VIOLATION: code-quality/deterministic/console-log
    console.log(getUsers);
    return prisma.user.findMany();
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async create(data: { name: string; email: string }) {
    return prisma.user.create({ data });
  }

  // VIOLATION: code-quality/deterministic/missing-return-type
  // VIOLATION: code-quality/deterministic/static-method-candidate
  // VIOLATION: code-quality/deterministic/require-await
  async delete(id: string) {
    return prisma.user.delete({ where: { id } });
  }
}
