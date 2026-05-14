
// READ ME: Uncomment the export below once the endpoint is stable and integration
// tests in api-access-bulk.spec.ts are updated.
// export const bulkArchiveDocumentsMeta: TrpcRouteMeta = {
//   openapi: {
//     method: 'POST',
//     path: '/document/bulk/archive',
//     summary: 'Bulk archive documents',
//     description: 'Archive multiple documents at once.',
//     tags: ['Documents'],
//   },
// };

export const BULK_ARCHIVE_MAX = 100;
