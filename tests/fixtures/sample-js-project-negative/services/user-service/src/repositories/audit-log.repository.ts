// VIOLATION: architecture/deterministic/data-layer-depends-on-external
import { PrismaClient } from '@prisma/client';
import { AuditEventsClient } from '../external/audit-events-client';

const prisma = new PrismaClient();
const audit = new AuditEventsClient();

export class AuditLogRepository {
  async record(userId: string, event: string): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { archived: event === 'archived' } });
    await audit.post(userId, event);
  }
}
