import { Router } from 'express';
import { archiveUser, createUser, getUserById, getUsers } from './handlers/user.handler';

export const userRoutes = Router()
  .get('/', getUsers)
  .get('/:id', getUserById)
  .post('/', createUser)
  .post('/:id/archive', archiveUser);



// Promise.all with async map over ORM updates (argument-type-mismatch FP: orm-query-builder-apis)
declare const prisma: any;

async function bulkUpdateUserPreferences(
  updates: Array<{ userId: string; preferences: Record<string, unknown> }>
): Promise<void> {
  await Promise.all(
    updates.map(async (item) =>
      prisma.userPreference.update({
        where: { userId: item.userId },
        data: { preferences: item.preferences },
      })
    )
  );
}



// Promise.all with async map over recipient notifications (argument-type-mismatch FP)
declare function sendNotification(args: { recipientId: string; message: string }): Promise<void>;

async function notifyAllRecipients(
  recipients: Array<{ id: string; name: string }>,
  message: string
): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) =>
      sendNotification({ recipientId: recipient.id, message })
    )
  );
}
