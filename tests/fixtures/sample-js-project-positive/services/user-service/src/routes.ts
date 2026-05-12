import { Router } from 'express';
import { archiveUser, createUser, getUserById, getUsers } from './handlers/user.handler';

export const userRoutes = Router()
  .get('/', getUsers)
  .get('/:id', getUserById)
  .post('/', createUser)
  .post('/:id/archive', archiveUser);



// Positive: commented-out-code — feature-staged OpenAPI meta export.
// READ ME: Keeping this meta export commented out as a private API until the
// request/response schemas are finalized and integration tests are updated.
// Uncomment to expose this route in the public OpenAPI spec.
//
// export const bulkArchiveUsersMeta: TrpcRouteMeta = {
//   openapi: {
//     method: 'POST',
//     path: '/users/bulk-archive',
//     summary: 'Bulk archive users',
//     tags: ['users'],
//   },
// };
declare const authenticatedProcedure: {
  input: (schema: unknown) => { output: (schema: unknown) => { mutation: (fn: () => Promise<void>) => unknown } };
};
declare const ZBulkArchiveUsersRequestSchema: unknown;
declare const ZBulkArchiveUsersResponseSchema: unknown;
export const bulkArchiveUsersRoute = authenticatedProcedure
  // .meta(bulkArchiveUsersMeta) // Keeping this as a private API until the request/response schemas are finalized.
  .input(ZBulkArchiveUsersRequestSchema)
  .output(ZBulkArchiveUsersResponseSchema)
  .mutation(async () => {
    return;
  });
